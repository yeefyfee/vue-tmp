import { Inject, Injectable, Logger } from "@nestjs/common";

import { PrismaService } from "../common/prisma/prisma.service";
import { RedisService } from "../common/redis/redis.service";
import { addDays, parseWallClock, toDayString } from "../common/utils/date.util";
import { QUEUE_REGISTRY } from "../queue/queue.module";
import { HEALTH_REMINDER_QUEUE, QueueRegistry } from "../queue/queue-registry";
import type { HealthReminderJobData } from "../queue/pet-health/health-reminder.processor";
import {
  EXPIRE_TRACKED_RECORD_TYPES,
  HEALTH_RECORD_TYPE_NAMES,
  HEALTH_REMINDER_MIN_TTL_SECONDS,
  HEALTH_REMINDER_RETENTION_DAYS,
  HEALTH_REMINDER_WINDOW_DAYS,
} from "./pet-health.constants";

/** 毫秒/天 */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 到期扫描结果（链路实证 / 日志断言锚点） */
export interface HealthExpiryScanResult {
  /** 命中扫描窗口的到期记录数 */
  scanned: number;
  /** 本次新入队（幂等键首次写入）推送数 */
  enqueued: number;
  /** 幂等键已存在（重复扫描）跳过数 */
  skipped: number;
  /** 扫描基准日（yyyy-MM-dd，应用时区） */
  asOf: string | null;
}

/**
 * 构造幂等键：`pet:health:remind:<tenantId>:<recordId>:<expireDate>`。
 *
 * 记录 id 为 UUID 全局唯一，额外带 tenantId 是为对齐 Redis 键的租户命名空间
 * 语义（`tenant:<id>:`）并便于按租户排障。键形态对「扫描侧（无租户上下文）」
 * 与「消费侧（有租户上下文）」一致 —— 因此幂等读写一律走**原生客户端 + 显式
 * 完整键**，不经 `RedisService.resolveKey` 的前缀改写，避免两侧键不一致。
 */
export function buildHealthReminderKey(
  tenantId: string,
  recordId: string,
  expireDay: string
): string {
  return `pet:health:remind:${tenantId}:${recordId}:${expireDay}`;
}

/**
 * 宠物健康到期提醒服务（P0-06-03 · FR-2）
 *
 * **职责**：扫描「疫苗/驱虫（recordType 1/2）且 expireDate 落在 [今日, 今日+N]」
 * 的未软删记录，逐条以 Redis 幂等键去重后入队 CROSS-11 队列（
 * `HEALTH_REMINDER_QUEUE`），由独立 worker 进程消费推送。
 *
 * **幂等**：`SET NX EX`（键见 {@link buildHealthReminderKey}），TTL 至「到期日 +
 * 保留窗口(M 天)」，覆盖到期前后重复扫描；**不建表**（Redis 键承担去重）。
 *
 * **扫描客户端**：使用基础 Prisma 客户端 `prisma.healthRecord`（**无租户上下文**，
 * 跨租户扫描；系统任务语义），逐行以 `record.tenantId` 入队载荷，消费端恢复上下文。
 *
 * **调度接入**：见 `scripts/scan-health-expiry.ts` + package.json `pet:scan-health-expiry`
 * 与 `src/worker.ts` 的消费注册（本服务不含调度器；生产调度接入归 CROSS-21）。
 */
@Injectable()
export class HealthExpiryReminderService {
  private readonly logger = new Logger(HealthExpiryReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(QUEUE_REGISTRY) private readonly queueRegistry: QueueRegistry
  ) {}

  /**
   * 扫描并推送到期提醒（幂等）。
   *
   * @param now 扫描基准瞬时（默认当前；单测注入固定值以保证确定性与 TTL 断言）
   */
  async scanAndEnqueue(now: Date = new Date()): Promise<HealthExpiryScanResult> {
    const today = toDayString(now);
    if (!today) {
      return { scanned: 0, enqueued: 0, skipped: 0, asOf: null };
    }
    const windowEndDay = addDays(today, HEALTH_REMINDER_WINDOW_DAYS);
    // @db.Date 列以 UTC 午夜瞬时承载 → 区间端点显式按 UTC 解析（不依赖进程时区）
    const gte = parseWallClock(today, "UTC");
    const lte = parseWallClock(windowEndDay, "UTC");
    if (!gte || !lte) {
      return { scanned: 0, enqueued: 0, skipped: 0, asOf: today };
    }

    // 跨租户扫描：基础客户端（无租户上下文），逐行带 tenantId 入队
    const records = await this.prisma.healthRecord.findMany({
      where: {
        deletedAt: null,
        recordType: { in: [...EXPIRE_TRACKED_RECORD_TYPES] },
        expireDate: { gte, lte },
      },
      select: {
        id: true,
        tenantId: true,
        petId: true,
        recordType: true,
        expireDate: true,
      },
      orderBy: [{ expireDate: "asc" }, { id: "asc" }],
    });

    const client = this.redis.getClient();
    let enqueued = 0;
    let skipped = 0;

    for (const record of records) {
      const expireDate = record.expireDate;
      const expireDay = expireDate ? toDayString(expireDate, "UTC") : null;
      if (!expireDate || !expireDay) {
        skipped += 1;
        continue;
      }

      const tenantId = String(record.tenantId);
      const key = buildHealthReminderKey(tenantId, record.id, expireDay);
      const ttl = this.resolveIdempotencyTtl(expireDate, now);

      // SET NX EX：仅首次写入成功者入队（幂等去重）；原生客户端 + 完整键，
      // 保证扫描侧与消费侧键形态一致（见 buildHealthReminderKey 注释）
      const setResult = await client.set(key, "1", "EX", ttl, "NX");
      if (setResult !== "OK") {
        skipped += 1;
        continue;
      }

      const daysLeft = Math.floor((expireDate.getTime() - gte.getTime()) / MS_PER_DAY);
      const data: HealthReminderJobData = {
        tenantId,
        petId: record.petId,
        recordId: record.id,
        recordType: record.recordType,
        recordName: HEALTH_RECORD_TYPE_NAMES[record.recordType] ?? String(record.recordType),
        expireDate: expireDay,
        daysLeft: Math.max(0, daysLeft),
      };
      // 平台级队列（无 tenantId 选项）：租户归属由 job.data.tenantId 承载
      await this.queueRegistry.enqueue(HEALTH_REMINDER_QUEUE, data);
      enqueued += 1;
      this.logger.log(
        `到期提醒入队 tenant=${tenantId} recordId=${record.id} expire=${expireDay} daysLeft=${data.daysLeft}`
      );
    }

    return { scanned: records.length, enqueued, skipped, asOf: today };
  }

  /**
   * 幂等键 TTL：至「到期日 + 保留窗口(M 天)」的秒数；非正数回落最小 TTL。
   * 目的：键存活到「到期 + 保留窗口」结束，覆盖到期前后任意次重复扫描。
   */
  private resolveIdempotencyTtl(expireDate: Date, now: Date): number {
    const expireWithRetention = expireDate.getTime() + HEALTH_REMINDER_RETENTION_DAYS * MS_PER_DAY;
    const ttlSeconds = Math.floor((expireWithRetention - now.getTime()) / 1000);
    return Math.max(HEALTH_REMINDER_MIN_TTL_SECONDS, ttlSeconds);
  }
}
