/**
 * 订单超时未支付自动关闭 · 扫描入队服务（MVP-WEB-07-06）
 *
 * **职责**：枚举租户 → 逐租户扫描「`pending_payment` 且创建时刻早于超时阈值」的
 * 未软删订单 → 以 Redis 幂等键去重后逐条入队 `ORDER_AUTO_CLOSE_QUEUE`，
 * 由独立 worker 进程消费关闭（原因 `payment_timeout`）。
 *
 * **跨租户扫描与 RLS**：`order` 表启用 `FORCE ROW LEVEL SECURITY`，基础客户端在
 * 未设 GUC 时**全表不可见**（fail-closed）⇒ 不能像 pet-health 那样裸客户端跨租户读。
 * 本服务改为「先枚举租户列表（`tenant` 为平台级表、无 RLS），再逐租户经
 * `PrismaService.withTenantContext()` 在该租户事务内扫描」，既满足 RLS 约束，
 * 又避免绕过租户隔离。
 *
 * **幂等**：`SET NX EX`（键见 {@link buildOrderAutoCloseKey}），TTL 见
 * `ORDER_AUTO_CLOSE_DEDUPE_TTL_SECONDS`；**不建表**（Redis 键承担去重）。
 *
 * **调度接入**：见 `scripts/scan-order-auto-close.ts` + package.json
 * `order:scan-auto-close` 与 `src/worker.ts` 的消费注册（本服务不含调度器；
 * 生产调度由外部 cron 周期调用扫描脚本，接入归 CROSS-21）。
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { OrderStatus } from "@peluvida/shared";

import { PrismaService } from "../common/prisma/prisma.service";
import { RedisService } from "../common/redis/redis.service";
import { QUEUE_REGISTRY } from "../queue/queue.module";
import { ORDER_AUTO_CLOSE_QUEUE, QueueRegistry } from "../queue/queue-registry";
import type { OrderAutoCloseJobData } from "../queue/order-auto-close/order-auto-close.processor";
import {
  ORDER_AUTO_CLOSE_DEDUPE_TTL_SECONDS,
  ORDER_AUTO_CLOSE_MAX_SCAN,
  ORDER_AUTO_CLOSE_TIMEOUT_MINUTES,
} from "./order.constants";

/** 自动关单扫描结果（链路实证 / 日志断言锚点） */
export interface OrderAutoCloseScanResult {
  /** 命中扫描条件的待关闭订单数 */
  scanned: number;
  /** 本次新入队（幂等键首次写入）数 */
  enqueued: number;
  /** 幂等键已存在（重复扫描）跳过数 */
  skipped: number;
  /** 扫描基准时刻（ISO 字符串） */
  asOf: string;
  /** 超时阈值（分钟，回显供脚本/日志核对） */
  timeoutMinutes: number;
}

/**
 * 构造幂等键：`order:auto-close:<tenantId>:<orderId>`。
 *
 * 订单 id 为 UUID 全局唯一，额外带 tenantId 是为对齐 Redis 键的租户命名空间
 * 语义并便于按租户排障。键形态对「扫描侧（无租户上下文）」与「消费侧（有租户
 * 上下文）」一致 —— 因此幂等读写一律走**原生客户端 + 显式完整键**，不经
 * `RedisService.resolveKey` 的前缀改写，避免两侧键不一致。
 */
export function buildOrderAutoCloseKey(tenantId: string, orderId: string): string {
  return `order:auto-close:${tenantId}:${orderId}`;
}

@Injectable()
export class OrderAutoCloseService {
  private readonly logger = new Logger(OrderAutoCloseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(QUEUE_REGISTRY) private readonly queueRegistry: QueueRegistry
  ) {}

  /**
   * 扫描并入库超时待支付订单的关单任务（幂等）。
   *
   * @param now 扫描基准瞬时（默认当前；单测注入固定值以保证确定性与断言）
   */
  async scanAndEnqueue(now: Date = new Date()): Promise<OrderAutoCloseScanResult> {
    const threshold = new Date(now.getTime() - ORDER_AUTO_CLOSE_TIMEOUT_MINUTES * 60_000);

    // 租户列表：tenant 为平台级表（无 tenant_id 列 / 无 RLS）⇒ 基础客户端可读
    const tenants = await this.prisma.tenant.findMany({
      where: { status: 1, deletedAt: null },
      select: { id: true },
      orderBy: { id: "asc" },
    });

    const client = this.redis.getClient();
    let scanned = 0;
    let enqueued = 0;
    let skipped = 0;

    for (const tenant of tenants) {
      const tenantId = String(tenant.id);
      // 逐租户经 withTenantContext 扫描：RLS GUC 一致，租户隔离由 DB 策略兜底
      const orders = await this.prisma.withTenantContext(tenantId, async (tx) =>
        tx.order.findMany({
          where: {
            deletedAt: null,
            status: OrderStatus.PENDING_PAYMENT,
            createdAt: { lt: threshold },
          },
          select: { id: true, orderNo: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: ORDER_AUTO_CLOSE_MAX_SCAN,
        })
      );
      scanned += orders.length;

      for (const order of orders) {
        const key = buildOrderAutoCloseKey(tenantId, order.id);
        // SET NX EX：仅首次写入成功者入队（幂等去重）；原生客户端 + 完整键，
        // 保证扫描侧与消费侧键形态一致（见 buildOrderAutoCloseKey 注释）
        const setResult = await client.set(
          key,
          "1",
          "EX",
          ORDER_AUTO_CLOSE_DEDUPE_TTL_SECONDS,
          "NX"
        );
        if (setResult !== "OK") {
          skipped += 1;
          continue;
        }

        const data: OrderAutoCloseJobData = {
          tenantId,
          orderId: order.id,
          orderNo: order.orderNo,
        };
        // 平台级队列（无 tenantId 选项）：租户归属由 job.data.tenantId 承载
        await this.queueRegistry.enqueue(ORDER_AUTO_CLOSE_QUEUE, data);
        enqueued += 1;
        this.logger.log(`超时关单入队 tenant=${tenantId} order=${order.orderNo}`);
      }
    }

    return {
      scanned,
      enqueued,
      skipped,
      asOf: now.toISOString(),
      timeoutMinutes: ORDER_AUTO_CLOSE_TIMEOUT_MINUTES,
    };
  }
}
