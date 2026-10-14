import { Injectable, Logger, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../common/prisma/prisma.service";
import { toBigInt } from "../common/prisma/prisma-ids";
import { RequestContext } from "../common/context/request-context";
import { ErrorCode } from "../common/enums/error-code.enum";
import { BusinessException } from "../common/exceptions/business.exception";
import { parseWallClock } from "../common/utils/date.util";
import { TimelineWriteService } from "./timeline-write.service";
import {
  TIMELINE_EVENT_TYPE_WEIGHT,
  WEIGHT_CURVE_DEFAULT_LIMIT,
  WEIGHT_CURVE_MAX_LIMIT,
  WEIGHT_DELTA_ALERT_PERCENT,
} from "./pet-health.constants";
import { CreateWeightDto } from "./dto/create-weight.dto";
import { QueryWeightCurveDto } from "./dto/query-weight-curve.dto";

/**
 * 把 `yyyy-MM-dd` 解析为 `@db.Date` 列承载的 **UTC 午夜瞬时**（显式 UTC，不依赖进程时区）。
 */
function toDateColumn(day: string | null | undefined): Date | null {
  if (!day) return null;
  return parseWallClock(day, "UTC");
}

/** 体重曲线响应载荷 */
export interface WeightCurveResult {
  petId: string;
  /** pet 当前体重快照（kg，两位小数字符串；null=未登记） */
  weightKg: string | null;
  order: "asc" | "desc";
  from: string | null;
  to: string | null;
  total: number;
  /** 触发 BR-4 预警（`|环比| > 15%`）的点数（派生值，不落库） */
  alertCount: number;
  points: WeightCurvePoint[];
}

/**
 * 曲线数据点：体重行 + **环比派生值**（BR-4）。
 *
 *  - `deltaPercent`：相对**上一条**（按称重日升序紧邻的前一条）的变化百分比，
 *    带正负号、1 位小数；无上一条（序列首点）= `null`；
 *  - `deltaAlert`：`|deltaPercent| > WEIGHT_DELTA_ALERT_PERCENT` 即 `true`
 *    （供前端在曲线上标注异常跳变、提示前台确认健康状态）。
 *
 * ⚠️ 环比恒按**称重日升序**计算，与请求的 `order` 无关 —— 否则 `desc` 会把
 * 「后一条减前一条」算成「更早减更晚」，符号与语义全反。
 */
export type WeightCurvePoint = Prisma.WeightGetPayload<null> & {
  deltaPercent: number | null;
  deltaAlert: boolean;
};

/** 新增体重记录响应载荷（记录行 + pet 更新后的体重快照 + BR-4 环比） */
export interface WeightCreateResult extends Prisma.WeightGetPayload<null> {
  petWeightKg: string | null;
  /** 「上次体重」= 按称重日早于本次的最新一条（无 = null） */
  previousWeightKg: string | null;
  /** 相对上次体重的变化百分比（1 位小数；无上一条 = null） */
  deltaPercent: number | null;
  /** 是否触发 BR-4 预警（`|环比| > 15%`） */
  deltaAlert: boolean;
}

/**
 * 体重曲线服务（P0-06-04 · FR-3）
 *
 * 数据访问统一走 `prisma.scoped.weight` / `prisma.scoped.pet` /
 * `prisma.scoped.timelineEvent`（租户隔离扩展自动注入 tenantId）。
 *
 * 契约口径：
 *  - 曲线按 `weighedAt` 时间序列排序（默认 asc，可 desc），并列按 `createdAt` 兜底；
 *  - 新增体重后**同步 pet.weightKg 快照**：快照恒为「当前最新称重」（按 weighedAt 取最新），
 *    而非盲目取最后插入值 —— 补录历史体重不会让快照倒退；
 *  - 时间线事件（eventType 6）为**最佳努力**：timeline_event 是按月分区表，
 *    分区缺失/写入异常**不阻断**主流程（体重已落库）。
 */
@Injectable()
export class WeightService {
  private readonly logger = new Logger(WeightService.name);

  constructor(
    private readonly prisma: PrismaService,
    // 时间线写入 SDK（P0-06-10）：@Optional 保证单测直构签名不变；未注入则走降级直写
    @Optional() private readonly timelineWrite?: TimelineWriteService
  ) {}

  /**
   * 体重环比变化百分比（BR-4，纯函数便于单测与前端对照）。
   *
   * `(next - prev) / prev * 100`，四舍五入保留 **1 位小数**；`prev` 缺失 / 非正数 /
   * 非法数值时返回 `null`（无基准 ⇒ 无法计算环比）。
   */
  static computeWeightDeltaPercent(
    prevKg: Prisma.Decimal | number | string | null | undefined,
    nextKg: Prisma.Decimal | number | string
  ): number | null {
    if (prevKg === null || prevKg === undefined) return null;
    const prev = Number(prevKg);
    const next = Number(nextKg);
    if (!Number.isFinite(prev) || !Number.isFinite(next) || prev <= 0) return null;
    return Math.round(((next - prev) / prev) * 1000) / 10;
  }

  /** 是否触发 BR-4 预警：`|环比| > 15%`（严格大于；`null` 不触发） */
  static isWeightDeltaAlert(deltaPercent: number | null): boolean {
    return deltaPercent !== null && Math.abs(deltaPercent) > WEIGHT_DELTA_ALERT_PERCENT;
  }

  /**
   * 记录体重（FR-3）
   *
   * 校验宠物归属（A0601）→ 落体重行 → 同步 pet 体重快照 → 追加时间线（不阻断）。
   */
  async createWeight(petId: string, dto: CreateWeightDto): Promise<WeightCreateResult> {
    const userId = RequestContext.getUserId();
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw new BusinessException(ErrorCode.TENANT_CONTEXT_MISSING);
    }
    await this.assertPetExists(petId);

    const weighedAt = toDateColumn(dto.weighedAt);
    if (!weighedAt) {
      throw new BusinessException(ErrorCode.PARAMETER_FORMAT_MISMATCH);
    }

    const data: Prisma.WeightUncheckedCreateInput = {
      tenantId: BigInt(tenantId),
      petId,
      weighedAt,
      weightKg: dto.weightKg,
      createdBy: toBigInt(userId),
      updatedBy: toBigInt(userId),
    };
    const record = await this.prisma.scoped.weight.create({ data });

    // BR-4：取「上次记录」= 称重日**严格早于**本次的最新一条；
    // 同日多次称重时再以写入时间（createdAt）早于本次兜底（补录历史不会误判基准）。
    const prevOr: Prisma.WeightWhereInput[] = [{ weighedAt: { lt: record.weighedAt } }];
    if (record.createdAt) {
      prevOr.push({ weighedAt: record.weighedAt, createdAt: { lt: record.createdAt } });
    }
    const previous = await this.prisma.scoped.weight.findFirst({
      where: { petId, deletedAt: null, id: { not: record.id }, OR: prevOr },
      orderBy: [{ weighedAt: "desc" }, { createdAt: "desc" }],
      select: { weightKg: true },
    });
    const previousWeightKg = previous === null ? null : String(previous.weightKg);
    const deltaPercent = WeightService.computeWeightDeltaPercent(previousWeightKg, record.weightKg);
    const deltaAlert = WeightService.isWeightDeltaAlert(deltaPercent);

    const petWeightKg = await this.syncPetWeightSnapshot(petId, userId);
    await this.appendWeightTimeline(petId, tenantId, dto, userId);

    return { ...record, petWeightKg, previousWeightKg, deltaPercent, deltaAlert };
  }

  /**
   * 体重曲线（FR-3）
   *
   * 按 `weighedAt` 时间序列返回体重记录（闭合区间 from/to 可选，limit 上限 500）；
   * 响应含 pet 当前体重快照与排序方向，便于前端直接绘制曲线。
   */
  async getWeightCurve(petId: string, query: QueryWeightCurveDto): Promise<WeightCurveResult> {
    const pet = await this.prisma.scoped.pet.findFirst({
      where: { id: petId, deletedAt: null },
    });
    if (!pet) {
      throw new BusinessException(ErrorCode.PET_NOT_FOUND);
    }

    const where: Prisma.WeightWhereInput = { petId, deletedAt: null };
    const dateFilter: Prisma.DateTimeFilter = {};
    const from = toDateColumn(query.from ?? null);
    const to = toDateColumn(query.to ?? null);
    if (from) dateFilter.gte = from;
    if (to) dateFilter.lte = to;
    if (Object.keys(dateFilter).length > 0) {
      where.weighedAt = dateFilter;
    }

    const order: Prisma.SortOrder = query.order?.toUpperCase() === "DESC" ? "desc" : "asc";
    const requestedLimit = Number(query.limit);
    const limit =
      Number.isInteger(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, WEIGHT_CURVE_MAX_LIMIT)
        : WEIGHT_CURVE_DEFAULT_LIMIT;

    const rows = await this.prisma.scoped.weight.findMany({
      where,
      orderBy: [{ weighedAt: order }, { createdAt: order }],
      take: limit,
    });

    // BR-4 环比：**恒按称重日升序**计算（与请求排序无关），再按请求方向输出，
    // 避免 desc 请求把「较早减较晚」算成环比（符号与语义会整体反掉）。
    const ascending = [...rows].sort((a, b) => {
      const ta = a.weighedAt.getTime();
      const tb = b.weighedAt.getTime();
      if (ta !== tb) return ta - tb;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    const deltaById = new Map<string, { deltaPercent: number | null; deltaAlert: boolean }>();
    let prevKg: string | null = null;
    for (const row of ascending) {
      const deltaPercent = WeightService.computeWeightDeltaPercent(prevKg, row.weightKg);
      deltaById.set(row.id, {
        deltaPercent,
        deltaAlert: WeightService.isWeightDeltaAlert(deltaPercent),
      });
      prevKg = String(row.weightKg);
    }

    const points: WeightCurvePoint[] = rows.map((row) => ({
      ...row,
      ...(deltaById.get(row.id) ?? { deltaPercent: null, deltaAlert: false }),
    }));

    return {
      petId,
      weightKg: pet.weightKg === null ? null : String(pet.weightKg),
      order: order === "desc" ? "desc" : "asc",
      from: query.from ?? null,
      to: query.to ?? null,
      total: points.length,
      alertCount: points.filter((point) => point.deltaAlert).length,
      points,
    };
  }

  /**
   * 删除体重记录（FR-3，软删）
   *
   * 软删后重算 pet 体重快照（若删的是最新一条，快照回退到次新；全部删空则置 null），
   * 避免快照指向已删记录。不存在抛 A0607。
   */
  async deleteWeight(petId: string, recordId: string): Promise<boolean> {
    const userId = RequestContext.getUserId();
    await this.assertPetExists(petId);

    const existing = await this.prisma.scoped.weight.findFirst({
      where: { id: recordId, petId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) {
      throw new BusinessException(ErrorCode.WEIGHT_RECORD_NOT_FOUND);
    }

    await this.prisma.scoped.weight.update({
      where: { id: recordId },
      data: { deletedAt: new Date(), updatedBy: toBigInt(userId) },
    });
    await this.syncPetWeightSnapshot(petId, userId);
    return true;
  }

  /**
   * 同步 pet.weightKg 快照 = 当前最新称重（按 weighedAt desc，平按 createdAt desc）；
   * 无记录则置 null。返回写入后的快照字符串（便于调用方直接回显）。
   */
  private async syncPetWeightSnapshot(
    petId: string,
    userId: string | null
  ): Promise<string | null> {
    const latest = await this.prisma.scoped.weight.findFirst({
      where: { petId, deletedAt: null },
      orderBy: [{ weighedAt: "desc" }, { createdAt: "desc" }],
    });
    const snapshot = latest === null ? null : String(latest.weightKg);
    await this.prisma.scoped.pet.update({
      where: { id: petId },
      data: { weightKg: snapshot, updatedBy: toBigInt(userId) },
    });
    return snapshot;
  }

  /**
   * 追加体重时间线事件（eventType 6）。
   *
   * 归一：优先经**统一写入 SDK**（P0-06-10，事件名 `weight.recorded`，事件类型 /
   * 可见性按事件名回落）；SDK 未注入时（单测直构）降级为直写，保持既有行为。
   *
   * ⚠️ timeline_event 为按月 RANGE 分区表：分区缺失等异常不应阻断体重落库主流程
   * —— 失败仅告警。
   */
  private async appendWeightTimeline(
    petId: string,
    tenantId: string,
    dto: CreateWeightDto,
    userId: string | null
  ): Promise<void> {
    try {
      if (this.timelineWrite) {
        await this.timelineWrite.recordSync({
          tenantId,
          petId,
          eventName: "weight.recorded",
          content: `weight.record ${dto.weightKg}kg @ ${dto.weighedAt}`,
          payload: { weightKg: dto.weightKg, weighedAt: dto.weighedAt },
          refType: "weight",
          operatorId: userId,
        });
        return;
      }

      // 降级直写（无 SDK）：与既有行为一致（eventType 6 / 当前瞬时）
      const data: Prisma.TimelineEventUncheckedCreateInput = {
        tenantId: BigInt(tenantId),
        petId,
        eventType: TIMELINE_EVENT_TYPE_WEIGHT,
        eventName: "weight.recorded",
        content: `weight.record ${dto.weightKg}kg @ ${dto.weighedAt}`,
        operatorId: toBigInt(userId),
        eventTime: new Date(),
        visibleToOwner: true,
      };
      await this.prisma.scoped.timelineEvent.create({ data });
    } catch (error) {
      this.logger.warn(
        `体重时间线写入失败（不阻断主流程）petId=${petId}: ${(error as Error).message}`
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
}
