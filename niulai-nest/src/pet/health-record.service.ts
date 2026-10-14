import { Injectable, Logger, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../common/prisma/prisma.service";
import { toBigInt } from "../common/prisma/prisma-ids";
import { RequestContext } from "../common/context/request-context";
import { ErrorCode } from "../common/enums/error-code.enum";
import { BusinessException } from "../common/exceptions/business.exception";
import { parseWallClock, addDays, toDayString } from "../common/utils/date.util";
import { SseService } from "../message/sse.service";
import { TimelineWriteService } from "./timeline-write.service";
import type { TimelineWriteInput } from "./timeline-write.service";
import {
  EXPIRE_TRACKED_RECORD_TYPES,
  HEALTH_EXPIRY_MAX_SCAN,
  HEALTH_EXPIRY_URGENT_DAYS,
  HEALTH_RECORD_TYPE_NAMES,
  VALIDITY_TRACKED_RECORD_TYPES,
} from "./pet-health.constants";
import type { HealthExpiryLevel } from "./pet-health.constants";
import { CreateHealthRecordDto } from "./dto/create-health-record.dto";
import { UpdateHealthRecordDto } from "./dto/update-health-record.dto";
import { QueryHealthRecordDto } from "./dto/query-health-record.dto";
import { QueryHealthExpiryReminderDto } from "./dto/query-health-expiry-reminder.dto";

/** 毫秒/天（日期差天数计算用） */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 把 `yyyy-MM-dd` 解析为 `@db.Date` 列承载的 **UTC 午夜瞬时**。
 *
 * 口径与 `PetService` 的 birthday 一致：DATE 列以 UTC 午夜瞬时承载，显式 UTC
 * 解析（`parseWallClock(day, "UTC")`），**不依赖进程时区**（日期处理铁律）。
 * 非法日期返回 `null`，由调用方按业务码拒绝。
 */
function toDateColumn(day: string | null | undefined): Date | null {
  if (!day) return null;
  return parseWallClock(day, "UTC");
}

/** 单条疫苗/驱虫有效性判定结果 */
export interface HealthValidityItem {
  recordType: number;
  recordName: string;
  hasRecord: boolean;
  valid: boolean;
  latestRecordId: string | null;
  recordDate: Date | null;
  expireDate: Date | null;
  daysLeft: number | null;
}

/** 疫苗/驱虫有效性判定汇总（供寄养入住校验消费） */
export interface HealthValidityResult {
  petId: string;
  asOf: string | null;
  allValid: boolean;
  items: HealthValidityItem[];
}

/**
 * 跨宠物到期提醒条目（MVP-WEB-05-02）
 *
 * `ownerName/ownerMobile/storeName` 与 `PetService.attachDisplayFields` 同口径：
 * **两次 `in` 批量回查**（非 N+1）、**不过滤 `deletedAt`**、关联缺失回退 `null`。
 */
export interface HealthExpiryReminderItem {
  recordId: string;
  petId: string;
  petName: string | null;
  petType: number | null;
  ownerCustomerId: string | null;
  ownerName: string | null;
  ownerMobile: string | null;
  storeId: string | null;
  storeName: string | null;
  recordType: number;
  recordName: string;
  recordDate: Date | null;
  expireDate: Date | null;
  /** 到期剩余天数（<0 = 已过期，取整口径与 validity 一致） */
  daysLeft: number;
  level: HealthExpiryLevel;
}

/** 三档计数（基于「窗口内全部命中」，**不受 `level` 筛选影响**——提醒条恒展示全貌） */
export interface HealthExpiryReminderSummary {
  expired: number;
  urgent: number;
  soon: number;
}

/** 跨宠物到期提醒查询结果（**普通对象出参**，不走分页信封：对齐 04-04 聚合端点先例） */
export interface HealthExpiryReminderResult {
  asOf: string | null;
  windowDays: number;
  urgentDays: number;
  total: number;
  summary: HealthExpiryReminderSummary;
  pageNum: number;
  pageSize: number;
  items: HealthExpiryReminderItem[];
}

/**
 * 健康档案服务（P0-06-03 · FR-2）
 *
 * 数据访问统一走 `prisma.scoped.healthRecord`（租户隔离扩展自动注入 tenantId，
 * RLS 兜底）；宠物归属校验以「宠物存在（租户内 + 未软删）」为前置锚点
 * （不存在抛 A0601，避免越权探测他人宠物）。
 *
 * 契约口径（对齐 pet 范式）：
 *  - 列表返回 `{ data, page: { pageNum, pageSize, total } }`，由全局
 *    ResponseInterceptor 改写成 `list/total/page/page_size` 信封；
 *  - 软删（deletedAt = now），列表/更新入口一律过滤 `deletedAt: null`；
 *  - 乐观锁：update 以 `where: { id, petId, version }` 提交，不匹配抛 A0609；
 *  - 到期提醒消费的「有效性判定」见 {@link getValidity}。
 */
@Injectable()
export class HealthRecordService {
  private readonly logger = new Logger(HealthRecordService.name);

  constructor(
    private readonly prisma: PrismaService,
    // 时间线写入 SDK（P0-06-10）：@Optional 保证单测直构签名不变；未注入则短路
    @Optional() private readonly timelineWrite?: TimelineWriteService,
    // SSE 推送（MVP-WEB-03-02）：@Optional 保证单测直构签名不变；未注入则静默
    @Optional() private readonly sseService?: SseService
  ) {}

  /**
   * 通知工作台刷新（MVP-WEB-03-02）：健康档案写入会改变「待处理」读数，
   * 推送租户级 dashboard 变更信号。最佳努力，失败不影响主流程。
   */
  private notifyDashboardChanged(reason: string): void {
    try {
      this.sseService?.sendDashboardChange(
        RequestContext.getTenantId(),
        reason,
        RequestContext.getStoreId()
      );
    } catch {
      // 推送失败不影响业务写入
    }
  }

  /**
   * 建档（FR-2）
   *
   * 校验宠物归属（A0601）；记录日期与到期日期走 DATE 列口径解析；到期日若早于
   * 记录日抛 A0608（业务约束：到期必然晚于接种/驱虫日）。operatorId 缺省取当前用户。
   */
  async createRecord(petId: string, dto: CreateHealthRecordDto) {
    const userId = RequestContext.getUserId();
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw new BusinessException(ErrorCode.TENANT_CONTEXT_MISSING);
    }
    await this.assertPetExists(petId);

    const recordDate = toDateColumn(dto.recordDate);
    if (!recordDate) {
      throw new BusinessException(ErrorCode.HEALTH_RECORD_DATE_INVALID);
    }
    const expireDate = toDateColumn(dto.expireDate ?? null);
    this.assertDateOrder(recordDate, expireDate);

    const data: Prisma.HealthRecordUncheckedCreateInput = {
      tenantId: BigInt(tenantId),
      petId,
      recordType: dto.recordType,
      recordDate,
      expireDate,
      content: dto.content ?? null,
      operatorId: dto.operatorId ? toBigInt(dto.operatorId) : toBigInt(userId),
      createdBy: toBigInt(userId),
      updatedBy: toBigInt(userId),
    };

    const record = await this.prisma.scoped.healthRecord.create({ data });
    // 统一时间线写入点（P0-06-10 · health.record.created）：最佳努力，失败不阻断建档
    await this.recordHealthTimeline("health.record.created", petId, record);
    this.notifyDashboardChanged("health.created");
    return record;
  }

  /**
   * 列表（FR-2）
   *
   * recordType 精确 + recordDate 区间 + expireDate 区间；排序固定为
   * `recordDate`（默认倒序，可用 order=asc 反转）+ `createdAt` 兜底。
   */
  async listRecords(petId: string, query: QueryHealthRecordDto) {
    await this.assertPetExists(petId);

    const pageNum = Number(query.pageNum) > 0 ? Number(query.pageNum) : 1;
    const pageSize = Number(query.pageSize) > 0 ? Number(query.pageSize) : 20;

    const where: Prisma.HealthRecordWhereInput = { petId, deletedAt: null };
    if (query.recordType !== undefined && query.recordType !== null) {
      where.recordType = query.recordType;
    }

    const recordDateFilter: Prisma.DateTimeFilter = {};
    const recordFrom = toDateColumn(query.from ?? null);
    const recordTo = toDateColumn(query.to ?? null);
    if (recordFrom) recordDateFilter.gte = recordFrom;
    if (recordTo) recordDateFilter.lte = recordTo;
    if (Object.keys(recordDateFilter).length > 0) {
      where.recordDate = recordDateFilter;
    }

    const expireFilter: Prisma.DateTimeNullableFilter = {};
    const expireFrom = toDateColumn(query.expireFrom ?? null);
    const expireTo = toDateColumn(query.expireTo ?? null);
    if (expireFrom) expireFilter.gte = expireFrom;
    if (expireTo) expireFilter.lte = expireTo;
    if (Object.keys(expireFilter).length > 0) {
      where.expireDate = expireFilter;
    }

    const order: Prisma.SortOrder = query.order?.toUpperCase() === "ASC" ? "asc" : "desc";
    const orderBy: Prisma.HealthRecordOrderByWithRelationInput[] = [
      { recordDate: order },
      { createdAt: order },
    ];

    const [list, total] = await Promise.all([
      this.prisma.scoped.healthRecord.findMany({
        where,
        orderBy,
        skip: (pageNum - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.scoped.healthRecord.count({ where }),
    ]);

    return {
      data: list,
      page: { pageNum, pageSize, total },
    };
  }

  /**
   * 更正（FR-2，乐观锁）
   *
   * 先回读现有记录（存在性校验 A0606），合并出「下一次记录日/到期日」后统一校验
   * 日期顺序（A0608），再以 `where: { id, petId, version, deletedAt: null }` 提交；
   * P2025 时回查区分「不存在」（A0606）与「版本冲突」（A0609）。
   */
  async updateRecord(petId: string, recordId: string, dto: UpdateHealthRecordDto) {
    const userId = RequestContext.getUserId();
    await this.assertPetExists(petId);

    const existing = await this.prisma.scoped.healthRecord.findFirst({
      where: { id: recordId, petId, deletedAt: null },
    });
    if (!existing) {
      throw new BusinessException(ErrorCode.HEALTH_RECORD_NOT_FOUND);
    }

    const nextRecordDate =
      dto.recordDate !== undefined ? toDateColumn(dto.recordDate) : existing.recordDate;
    if (dto.recordDate !== undefined && !nextRecordDate) {
      throw new BusinessException(ErrorCode.HEALTH_RECORD_DATE_INVALID);
    }
    let nextExpireDate: Date | null =
      dto.expireDate !== undefined ? toDateColumn(dto.expireDate ?? null) : existing.expireDate;
    if (dto.expireDate !== undefined && dto.expireDate !== null && !nextExpireDate) {
      throw new BusinessException(ErrorCode.HEALTH_RECORD_DATE_INVALID);
    }
    this.assertDateOrder(nextRecordDate, nextExpireDate);

    const data: Prisma.HealthRecordUncheckedUpdateInput = {
      updatedBy: toBigInt(userId),
    };
    if (dto.recordType !== undefined) data.recordType = dto.recordType;
    if (dto.recordDate !== undefined) data.recordDate = nextRecordDate;
    if (dto.expireDate !== undefined) data.expireDate = nextExpireDate;
    if (dto.content !== undefined) data.content = dto.content ?? null;
    if (dto.operatorId !== undefined) {
      data.operatorId = dto.operatorId === null ? null : toBigInt(dto.operatorId);
    }

    try {
      await this.prisma.scoped.healthRecord.update({
        where: { id: recordId, petId, version: dto.version, deletedAt: null },
        data: { ...data, version: { increment: 1 } },
      });
    } catch (error) {
      if ((error as { code?: string })?.code === "P2025") {
        const exists = await this.prisma.scoped.healthRecord.findFirst({
          where: { id: recordId, petId, deletedAt: null },
          select: { id: true },
        });
        if (!exists) {
          throw new BusinessException(ErrorCode.HEALTH_RECORD_NOT_FOUND);
        }
        throw new BusinessException(ErrorCode.HEALTH_RECORD_VERSION_CONFLICT);
      }
      throw error;
    }

    const updated = await this.prisma.scoped.healthRecord.findFirstOrThrow({
      where: { id: recordId, petId, deletedAt: null },
    });
    // 统一时间线写入点（P0-06-10 · health.record.updated）：最佳努力
    await this.recordHealthTimeline("health.record.updated", petId, updated);
    this.notifyDashboardChanged("health.updated");
    return updated;
  }

  /**
   * 软删（FR-2）
   *
   * 置 deletedAt（保留行以便追溯，符合「历史不可丢失」）；不存在抛 A0606。
   */
  async softDeleteRecord(petId: string, recordId: string) {
    const userId = RequestContext.getUserId();
    await this.assertPetExists(petId);

    const existing = await this.prisma.scoped.healthRecord.findFirst({
      where: { id: recordId, petId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) {
      throw new BusinessException(ErrorCode.HEALTH_RECORD_NOT_FOUND);
    }

    await this.prisma.scoped.healthRecord.update({
      where: { id: recordId },
      data: { deletedAt: new Date(), updatedBy: toBigInt(userId) },
    });
    this.notifyDashboardChanged("health.deleted");
    return true;
  }

  /**
   * 疫苗/驱虫有效性判定（P0-06-03 · 入住疫苗校验只读接口）
   *
   * 对每种受跟踪记录类型（疫苗/驱虫），取最近一条（recordDate desc，平按 createdAt desc），
   * 以其 expireDate 判定是否在有效期内（>= 今日）。返回结构含最近记录 id / 记录日 /
   * 到期日 / 剩余天数，供后续寄养入住校验消费（stay 域尚未建，仅提供读接口）。
   */
  async getValidity(petId: string): Promise<HealthValidityResult> {
    await this.assertPetExists(petId);

    const today = toDayString(new Date());
    const todayInstant = toDateColumn(today);

    const records = await this.prisma.scoped.healthRecord.findMany({
      where: {
        petId,
        deletedAt: null,
        recordType: { in: [...VALIDITY_TRACKED_RECORD_TYPES] },
      },
      orderBy: [{ recordDate: "desc" }, { createdAt: "desc" }],
    });

    const items: HealthValidityItem[] = VALIDITY_TRACKED_RECORD_TYPES.map((type) => {
      const latest = records.find((r) => r.recordType === type) ?? null;
      const expireDate = latest?.expireDate ?? null;
      const valid = Boolean(
        expireDate && todayInstant && expireDate.getTime() >= todayInstant.getTime()
      );
      const daysLeft =
        expireDate && todayInstant
          ? Math.floor((expireDate.getTime() - todayInstant.getTime()) / MS_PER_DAY)
          : null;
      return {
        recordType: type,
        recordName: HEALTH_RECORD_TYPE_NAMES[type] ?? String(type),
        hasRecord: Boolean(latest),
        valid,
        latestRecordId: latest?.id ?? null,
        recordDate: latest?.recordDate ?? null,
        expireDate,
        daysLeft,
      };
    });

    return {
      petId,
      asOf: today,
      allValid: items.every((item) => item.valid),
      items,
    };
  }

  /**
   * 跨宠物健康到期提醒清单（MVP-WEB-05-02 · FR-2 / BR-1）
   *
   * **租户级**（非单宠）：列出「疫苗/驱虫 且 `expireDate ≤ 今日 + windowDays`」的未软删
   * 记录，**含已过期**（前台需知道「谁该补打了」；后台扫描器只覆盖未来窗口，见 DTO 注释）。
   *
   * 数据访问走 `prisma.scoped.healthRecord` ⇒ 自动带租户隔离 + 数据权限（本门店/仅本人），
   * 因此**不需要**手工拼 `tenantId`，也**不越权**到别的门店（`storeId` 筛选交给数据权限层）。
   *
   * 口径：
   *  - `daysLeft` 以「DATE 列的 UTC 午夜瞬时」相对「今日 UTC 午夜」取整（与 `getValidity` 同口径，
   *    库内 2026-10-13 相对 2026-10-10 = 3 天）；
   *  - `summary` 基于窗口内**全部命中**（三档计数），`items` 才受 `level` 筛选 + 分页影响 ⇒
   *    提醒条始终能展示「已过期 X / 14 天内 Y / 窗口内 Z」全貌；
   *  - 排序固定 `expireDate asc`（最紧急在前）+ `id asc` 兜底（分页稳定）；
   *  - 扫描上限 {@link HEALTH_EXPIRY_MAX_SCAN}：按到期日升序取前 N 条，避免无界结果集。
   */
  async listExpiryReminders(
    query: QueryHealthExpiryReminderDto
  ): Promise<HealthExpiryReminderResult> {
    const today = toDayString(new Date());
    const todayInstant = toDateColumn(today);
    const windowDays = Number(query.windowDays) > 0 ? Number(query.windowDays) : 30;
    const windowEndDay = today ? addDays(today, windowDays) : null;
    const windowEnd = toDateColumn(windowEndDay);

    const empty: HealthExpiryReminderResult = {
      asOf: today,
      windowDays,
      urgentDays: HEALTH_EXPIRY_URGENT_DAYS,
      total: 0,
      summary: { expired: 0, urgent: 0, soon: 0 },
      pageNum: Number(query.pageNum) > 0 ? Number(query.pageNum) : 1,
      pageSize: Number(query.pageSize) > 0 ? Number(query.pageSize) : 20,
      items: [],
    };
    if (!today || !todayInstant || !windowEnd) return empty;

    const where: Prisma.HealthRecordWhereInput = {
      deletedAt: null,
      recordType:
        query.recordType !== undefined && query.recordType !== null
          ? query.recordType
          : { in: [...EXPIRE_TRACKED_RECORD_TYPES] },
      // 含已过期 ⇒ 只设上界（gte 不设）；expireDate 为空的行（过敏/用药等无到期语义）排除
      expireDate: { not: null, lte: windowEnd },
    };
    if (query.petId) where.petId = query.petId;

    const records = await this.prisma.scoped.healthRecord.findMany({
      where,
      orderBy: [{ expireDate: "asc" }, { id: "asc" }],
      take: HEALTH_EXPIRY_MAX_SCAN,
    });

    const rows: HealthExpiryReminderItem[] = records
      .filter((record) => Boolean(record.expireDate))
      .map((record) => {
        const expireDate = record.expireDate as Date;
        const daysLeft = Math.floor((expireDate.getTime() - todayInstant.getTime()) / MS_PER_DAY);
        return {
          recordId: record.id,
          petId: record.petId,
          petName: null,
          petType: null,
          ownerCustomerId: null,
          ownerName: null,
          ownerMobile: null,
          storeId: null,
          storeName: null,
          recordType: record.recordType,
          recordName: HEALTH_RECORD_TYPE_NAMES[record.recordType] ?? String(record.recordType),
          recordDate: record.recordDate ?? null,
          expireDate,
          daysLeft,
          level: HealthRecordService.resolveExpiryLevel(daysLeft),
        };
      });

    const summary = rows.reduce<HealthExpiryReminderSummary>(
      (acc, row) => {
        acc[row.level] += 1;
        return acc;
      },
      { expired: 0, urgent: 0, soon: 0 }
    );

    const filtered = query.level ? rows.filter((row) => row.level === query.level) : rows;
    const total = filtered.length;
    const start = (empty.pageNum - 1) * empty.pageSize;
    const items = filtered.slice(start, start + empty.pageSize);

    await this.attachReminderDisplayFields(items);

    return { ...empty, total, summary, items };
  }

  /** 紧急度分级（唯一判定点，供 service 与单测共用） */
  static resolveExpiryLevel(daysLeft: number): HealthExpiryLevel {
    if (daysLeft < 0) return "expired";
    if (daysLeft <= HEALTH_EXPIRY_URGENT_DAYS) return "urgent";
    return "soon";
  }

  /**
   * 补展示字段（宠物名/类型、主人姓名与手机号、门店名）。
   *
   * 与 `PetService.attachDisplayFields` 同打法：**两次 `in` 批量回查**（非 N+1），
   * **不过滤 `deletedAt`**（宠物可能已被软删但记录仍在 ⇒ 提醒仍要可读），
   * 关联缺失一律回退 `null`（不抛、不渲染裸 UUID）。
   */
  private async attachReminderDisplayFields(items: HealthExpiryReminderItem[]): Promise<void> {
    if (items.length === 0) return;

    const petIds = Array.from(new Set(items.map((item) => item.petId).filter(Boolean)));
    const pets =
      petIds.length > 0
        ? await this.prisma.scoped.pet.findMany({
            where: { id: { in: petIds } },
            select: { id: true, name: true, petType: true, ownerCustomerId: true, storeId: true },
          })
        : [];
    const petMap = new Map(pets.map((pet) => [pet.id, pet]));

    const customerIds = Array.from(
      new Set(pets.map((pet) => pet.ownerCustomerId).filter((id): id is string => Boolean(id)))
    );
    const storeIds = Array.from(
      new Set(pets.map((pet) => pet.storeId).filter((id): id is string => Boolean(id)))
    );
    const [customers, stores] = await Promise.all([
      customerIds.length > 0
        ? this.prisma.scoped.customer.findMany({
            where: { id: { in: customerIds } },
            select: { id: true, name: true, mobile: true },
          })
        : Promise.resolve([]),
      storeIds.length > 0
        ? this.prisma.scoped.store.findMany({
            where: { id: { in: storeIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);
    const customerMap = new Map(customers.map((customer) => [customer.id, customer]));
    const storeMap = new Map(stores.map((store) => [store.id, store]));

    for (const item of items) {
      const pet = petMap.get(item.petId);
      if (!pet) continue;
      item.petName = pet.name ?? null;
      item.petType = pet.petType ?? null;
      item.ownerCustomerId = pet.ownerCustomerId ?? null;
      item.storeId = pet.storeId ?? null;
      const customer = pet.ownerCustomerId ? customerMap.get(pet.ownerCustomerId) : undefined;
      const store = pet.storeId ? storeMap.get(pet.storeId) : undefined;
      item.ownerName = customer?.name ?? null;
      item.ownerMobile = customer?.mobile ?? null;
      item.storeName = store?.name ?? null;
    }
  }

  /**
   * 统一时间线写入（P0-06-10 · 最佳努力）：失败仅告警不阻断主流程；未注入 SDK 时短路。
   * 事件时间取落库时刻 now()（分区路由到当月）；记录日 / 到期日作为负载快照。
   */
  private async recordHealthTimeline(
    eventName: string,
    petId: string,
    record: Prisma.HealthRecordGetPayload<null>
  ): Promise<void> {
    if (!this.timelineWrite) return;
    const typeName = HEALTH_RECORD_TYPE_NAMES[record.recordType] ?? String(record.recordType);
    const input: TimelineWriteInput = {
      petId,
      eventName,
      content: `健康档案（${typeName}）${record.content ?? ""}`.trim().slice(0, 500),
      payload: {
        recordId: record.id,
        recordType: record.recordType,
        recordDate: record.recordDate ? toDayString(record.recordDate, "UTC") : null,
        expireDate: record.expireDate ? toDayString(record.expireDate, "UTC") : null,
      },
      refType: "health_record",
      refId: record.id,
    };
    try {
      await this.timelineWrite.recordSync(input);
    } catch (error) {
      this.logger.warn(
        `时间线写入失败（不阻断主流程）event=${eventName} pet=${petId}: ${(error as Error).message}`
      );
    }
  }

  /** 宠物归属校验（scoped：租户内 + 未软删），不通过抛 A0601 */
  private async assertPetExists(petId: string): Promise<void> {
    const pet = await this.prisma.scoped.pet.findFirst({
      where: { id: petId, deletedAt: null },
      select: { id: true },
    });
    if (!pet) {
      throw new BusinessException(ErrorCode.PET_NOT_FOUND);
    }
  }

  /** 日期顺序约束：到期日不得早于记录日（A0608） */
  private assertDateOrder(recordDate: Date | null, expireDate: Date | null): void {
    if (expireDate && recordDate && expireDate.getTime() < recordDate.getTime()) {
      throw new BusinessException(ErrorCode.HEALTH_RECORD_DATE_INVALID);
    }
  }
}
