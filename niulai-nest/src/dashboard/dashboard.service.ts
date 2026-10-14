import { Injectable } from "@nestjs/common";

import { RequestContext } from "../common/context/request-context";
import { PrismaService } from "../common/prisma/prisma.service";
import type {
  DashboardMetric,
  DashboardOverviewResponse,
  DashboardTimeline,
  DashboardTimelineItem,
  DashboardTodoItem,
  DashboardTodayMetrics,
} from "./dashboard.types";

/** 房态：2 = 在住 occupied（与 `RoomService` 口径一致；`room.status` 1 空/2 在住/3 清扫/4 维护） */
const ROOM_STATUS_OCCUPIED = 2;
/** 到期预警关注的健康记录类型：1 疫苗 / 2 驱虫（与 `HealthRecord.recordType` 值域一致） */
const HEALTH_EXPIRING_RECORD_TYPES = [1, 2];
/** 预警窗口（天）：PRD《宠物档案》「到期低于 14 天自动红色预警」 */
const HEALTH_WARNING_DAYS = 14;
/** 待办上限（工作台只做提醒，完整清单走各业务列表页） */
const TODO_LIMIT = 20;
/** 时间线展示上限（工作台「今天的工作」只做概览） */
const TIMELINE_LIMIT = 10;
/**
 * 时间线单次扫描上限
 *
 * `TimelineEvent` 无 `store_id` 列（租户级事件流），门店切片需回查 `pet.store_id`
 * 后过滤，故先多取若干条再截断（避免「前 N 条全属别店」导致本店时间线为空）。
 */
const TIMELINE_SCAN_LIMIT = 60;
/** 宠物转移待审批状态（`PetTransferRequest.status`：1 待审批 / 2 已通过 / 3 已拒绝 / 4 已撤销） */
const TRANSFER_STATUS_PENDING = 1;

/** 一天毫秒数 */
const DAY_MS = 24 * 60 * 60 * 1000;

/** 时间线事件类型中文标签（`TimelineEvent.eventType` 值域） */
const EVENT_TYPE_LABELS: Record<number, string> = {
  1: "入驻",
  2: "离店",
  3: "喂养",
  4: "洗护",
  5: "医疗",
  6: "体重",
  7: "照片",
  8: "系统",
};

/** 严重度排序权重（高在前） */
const SEVERITY_RANK: Record<DashboardTodoItem["severity"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

/**
 * 经营工作台服务（MVP-WEB-03-01 / 03-03）
 *
 * 职责：`GET /dashboard/overview` 的聚合读数。**只读、零副作用**；
 * 数据访问统一走 `prisma.scoped.*`（租户隔离扩展自动注入 tenantId，RLS 兜底）。
 *
 * 数据聚合层能力（诚实口径，见 `dashboard.types.ts` 的 `available` 说明）：
 *  - ✅ 在店宠物数：`room.status = 2` 的容量之和（门店上下文存在时限定该门店）；
 *  - ✅ 今天的工作：`TimelineEvent` **当日**切片（按时间正序，回查宠物名与操作人）；
 *  - ✅ 待处理数 / 待办清单：宠物健康到期预警（疫苗 / 驱虫，14 天窗口）+
 *      宠物转移待审批（`PetTransferRequest.status = 1`）；
 *  - ⛔ 今日营业额 / 今日订单：订单（07）、支付（14）模块未上线 ⇒ `available: false`。
 *
 * 未上线的数据源一律显式声明接入计划（`note`），**不伪造占位数字、不用 mock**。
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** 工作台总览（`since` 命中指纹时返回 changed=false 的轻量响应） */
  async getOverview(since?: string): Promise<DashboardOverviewResponse> {
    const storeId = RequestContext.getStoreId();
    const todayUtc = startOfUtcDay(new Date());
    const tomorrowUtc = new Date(todayUtc.getTime() + DAY_MS);
    const revision = await this.computeRevision(storeId, todayUtc);

    // 增量轮询：指纹未变 ⇒ 只回元信息，跳过全部聚合装配（真正的「增量」）
    if (since && since === revision) {
      return {
        changed: false,
        revision,
        generatedAt: new Date().toISOString(),
        scope: { storeId },
      };
    }

    const warningEnd = new Date(todayUtc.getTime() + HEALTH_WARNING_DAYS * DAY_MS);

    const [roomAggregate, expiringRows, healthCount, transferRows, transferCount, timelineRows] =
      await Promise.all([
        // 在店宠物：在住房间容量之和（多宠房 capacity > 1）
        this.prisma.scoped.room.aggregate({
          where: {
            status: ROOM_STATUS_OCCUPIED,
            deletedAt: null,
            ...(storeId ? { storeId } : {}),
          },
          _sum: { capacity: true },
          _count: { _all: true },
        }),
        // 待办①：宠物健康到期预警（未软删 + 疫苗/驱虫 + 到期日落在窗口内，含已逾期）
        this.prisma.scoped.healthRecord.findMany({
          where: {
            deletedAt: null,
            recordType: { in: HEALTH_EXPIRING_RECORD_TYPES },
            expireDate: { not: null, lte: warningEnd },
          },
          orderBy: { expireDate: "asc" },
          take: TODO_LIMIT,
          select: { id: true, petId: true, recordType: true, expireDate: true },
        }),
        // 待处理数（健康口径）用独立 count：不受 take 截断影响
        this.prisma.scoped.healthRecord.count({
          where: {
            deletedAt: null,
            recordType: { in: HEALTH_EXPIRING_RECORD_TYPES },
            expireDate: { not: null, lte: warningEnd },
          },
        }),
        // 待办②：宠物转移待审批（多宠物归属审批流）
        this.prisma.scoped.petTransferRequest.findMany({
          where: { status: TRANSFER_STATUS_PENDING, deletedAt: null },
          orderBy: { createdAt: "asc" },
          take: TODO_LIMIT,
          select: { id: true, petId: true, createdAt: true },
        }),
        this.prisma.scoped.petTransferRequest.count({
          where: { status: TRANSFER_STATUS_PENDING, deletedAt: null },
        }),
        // 今天的工作：时间线事件流的当日切片
        this.prisma.scoped.timelineEvent.findMany({
          where: { eventTime: { gte: todayUtc, lt: tomorrowUtc } },
          orderBy: { eventTime: "asc" },
          take: TIMELINE_SCAN_LIMIT,
          select: {
            id: true,
            petId: true,
            eventType: true,
            eventName: true,
            content: true,
            operatorId: true,
            eventTime: true,
          },
        }),
      ]);

    const [healthTodos, transferTodos, timeline] = await Promise.all([
      this.buildHealthTodos(expiringRows, todayUtc),
      this.buildTransferTodos(transferRows),
      this.buildTimeline(timelineRows, storeId),
    ]);

    const todoItems = [...healthTodos, ...transferTodos].sort(compareTodos);
    const pendingCount = healthCount + transferCount;

    return {
      changed: true,
      revision,
      generatedAt: new Date().toISOString(),
      scope: { storeId },
      today: this.buildTodayMetrics(
        roomAggregate._sum.capacity ?? 0,
        roomAggregate._count._all,
        pendingCount,
        { health: healthCount, transfer: transferCount }
      ),
      timeline,
      todos: {
        available: true,
        note: "已聚合：宠物健康到期预警（疫苗 / 驱虫，14 天窗口）+ 宠物转移待审批；待确认订单 / 待回复咨询 / 库存预警待对应模块上线后并入",
        items: todoItems,
      },
    };
  }

  /**
   * 计算聚合范围的数据指纹（MVP-WEB-03-02 / 03-03）
   *
   * 取工作台读数依赖的五张表在作用域内的 `max(updated_at)` 与行数拼成不透明
   * 指纹：任一相关行**新增 / 更新 / 软删**都会使其变化（`@updatedAt` 在软删时
   * 同样刷新），同时用行数兜底覆盖「硬删且 max 未变」的边角。五表全部走
   * `prisma.scoped.*`（租户隔离 + 数据权限），与后续读数查询同源，不会因权限
   * 差异产生「指纹变了但数据不可见」的抖动。
   *
   * `TimelineEvent` 为 append-only 事件流（无 `updated_at`），其指纹取
   * `max(event_time)` + 行数；且只统计**当日**事件（与「今天的工作」展示范围
   * 一致），避免昨日事件的写入无谓触发前端重渲染。
   */
  private async computeRevision(storeId: string | null, todayUtc: Date): Promise<string> {
    const tomorrowUtc = new Date(todayUtc.getTime() + DAY_MS);
    const [roomAgg, healthAgg, petAgg, timelineAgg, transferAgg] = await Promise.all([
      this.prisma.scoped.room.aggregate({
        where: { deletedAt: null, ...(storeId ? { storeId } : {}) },
        _max: { updatedAt: true },
        _count: { _all: true },
      }),
      this.prisma.scoped.healthRecord.aggregate({
        where: { deletedAt: null },
        _max: { updatedAt: true },
        _count: { _all: true },
      }),
      this.prisma.scoped.pet.aggregate({
        where: { deletedAt: null },
        _max: { updatedAt: true },
        _count: { _all: true },
      }),
      // 时间线为 append-only 事件流（无 updated_at），指纹取 max(event_time) + 行数
      this.prisma.scoped.timelineEvent.aggregate({
        where: { eventTime: { gte: todayUtc, lt: tomorrowUtc } },
        _max: { eventTime: true },
        _count: { _all: true },
      }),
      this.prisma.scoped.petTransferRequest.aggregate({
        where: { deletedAt: null },
        _max: { updatedAt: true },
        _count: { _all: true },
      }),
    ]);

    const stamp = (d: Date | null | undefined) => (d ? d.getTime() : 0);
    return [
      `r${stamp(roomAgg._max.updatedAt)}.${roomAgg._count._all}`,
      `h${stamp(healthAgg._max.updatedAt)}.${healthAgg._count._all}`,
      `p${stamp(petAgg._max.updatedAt)}.${petAgg._count._all}`,
      `t${stamp(timelineAgg._max.eventTime)}.${timelineAgg._count._all}`,
      `x${stamp(transferAgg._max.updatedAt)}.${transferAgg._count._all}`,
    ].join("-");
  }

  /** 今日数据四指标（PRD：今日营业额 / 今日订单 / 在店宠物 / 待处理） */
  private buildTodayMetrics(
    boardingPetCount: number,
    boardingRoomCount: number,
    pendingCount: number,
    breakdown: { health: number; transfer: number }
  ): DashboardTodayMetrics {
    const roomNote =
      boardingRoomCount > 0
        ? `口径：房态为「在住」的 ${boardingRoomCount} 间房容量之和。寄养模块（MVP-WEB-09）上线后切换为实际在住宠物数`
        : "口径：房态为「在住」的房间容量之和。当前无在住房间；寄养模块（MVP-WEB-09）上线后切换为实际在住宠物数";

    const pendingNote =
      `口径：当前可算待办合计 = 健康到期预警 ${breakdown.health} + 转移待审批 ${breakdown.transfer}。` +
      "PRD 四类中的待确认订单 / 待回复咨询 / 库存预警待对应模块上线后并入";

    return {
      revenue: unavailableMetric(
        "payment",
        "口径：当日 payment.status = success 的金额汇总（单位：分）。支付/收银模块（MVP-WEB-14）上线后接入"
      ),
      orderCount: unavailableMetric(
        "order",
        "口径：当日创建的有效订单数（不含已作废）。订单模块（MVP-WEB-07）上线后接入"
      ),
      boardingPetCount: {
        value: boardingPetCount,
        available: true,
        source: "room",
        note: roomNote,
      },
      pendingCount: {
        value: pendingCount,
        available: true,
        source: "health",
        note: pendingNote,
      },
    };
  }

  /**
   * 「今天的工作」—— 宠物时间线事件流的当日切片
   *
   * 回查 `pet` 取宠物名与归属门店（`TimelineEvent` 无 `store_id`，门店切片靠
   * 回查过滤）；回查 `sys_user` 取操作人昵称。查无实体的宠物（已软删）事件丢弃。
   * 数量截断到 `TIMELINE_LIMIT`，按事件时间正序。
   */
  private async buildTimeline(
    rows: {
      id: bigint;
      petId: string;
      eventType: number;
      eventName: string | null;
      content: string | null;
      operatorId: bigint | null;
      eventTime: Date;
    }[],
    storeId: string | null
  ): Promise<DashboardTimeline> {
    const note =
      "口径：宠物时间线事件流（当日，按时间正序）；数据来自各业务动作的领域事件。" +
      "预约排期 / 接送切片待预约（MVP-WEB-06）与寄养（MVP-WEB-09）模块上线后并入，届时启用「超时未开始」高亮";

    if (rows.length === 0) {
      return { available: true, source: "timeline", note, items: [] };
    }

    const petIds = Array.from(new Set(rows.map((row) => row.petId)));
    const pets = await this.prisma.scoped.pet.findMany({
      where: { id: { in: petIds }, deletedAt: null },
      select: { id: true, name: true, storeId: true },
    });
    const petById = new Map(pets.map((pet) => [pet.id, pet]));

    // 门店切片：有门店上下文时保留「本店宠物」与「租户级宠物（store_id 为空）」
    // 的事件 —— 后者不属于特定门店，在各门店工作台展示均合理；
    // （`TimelineEvent` 无 store_id 列，门店归属只能经 pet 回查推导）
    const scoped = rows
      .filter((row) => {
        const pet = petById.get(row.petId);
        if (!pet) return false;
        if (storeId && pet.storeId !== null && pet.storeId !== storeId) return false;
        return true;
      })
      .slice(0, TIMELINE_LIMIT);

    const operatorIds = Array.from(
      new Set(
        scoped.map((row) => row.operatorId).filter((id): id is bigint => typeof id === "bigint")
      )
    );
    const operators = operatorIds.length
      ? await this.prisma.sysUser.findMany({
          where: { id: { in: operatorIds } },
          select: { id: true, nickname: true, username: true },
        })
      : [];
    const operatorNameById = new Map(
      operators.map((op) => [String(op.id), op.nickname || op.username])
    );

    const items: DashboardTimelineItem[] = scoped.map((row) => {
      const pet = petById.get(row.petId)!;
      return {
        time: row.eventTime.toISOString(),
        eventType: row.eventType,
        petName: pet.name,
        serviceName: row.content?.trim() || EVENT_TYPE_LABELS[row.eventType] || "事件",
        ownerName:
          row.operatorId !== null
            ? (operatorNameById.get(String(row.operatorId)) ?? "员工")
            : "系统",
        // 已发生事件无「超时未开始」；未来排期并入后启用
        overdue: false,
      };
    });

    return { available: true, source: "timeline", note, items };
  }

  /**
   * 把健康到期记录装配成待办项
   *
   * 宠物名做一次批量回查（`health_record.pet_id` 为业务表关联 uuid、无外键）。
   * 已软删 / 查无实体的宠物记录直接丢弃（不产出指向空档案的待办）。
   */
  private async buildHealthTodos(
    rows: { id: string; petId: string; recordType: number; expireDate: Date | null }[],
    todayUtc: Date
  ): Promise<DashboardTodoItem[]> {
    if (rows.length === 0) return [];

    const petIds = Array.from(new Set(rows.map((row) => row.petId)));
    const pets = await this.prisma.scoped.pet.findMany({
      where: { id: { in: petIds }, deletedAt: null },
      select: { id: true, name: true },
    });
    const petNameById = new Map(pets.map((pet) => [pet.id, pet.name]));

    const items: DashboardTodoItem[] = [];
    for (const row of rows) {
      if (!row.expireDate) continue;
      const petName = petNameById.get(row.petId);
      if (!petName) continue;

      const dueInDays = Math.round(
        (startOfUtcDay(row.expireDate).getTime() - todayUtc.getTime()) / DAY_MS
      );

      items.push({
        key: `health:${row.id}`,
        kind: "health",
        category: row.recordType === 1 ? "vaccine" : "deworm",
        petId: row.petId,
        petName,
        severity: resolveSeverity(dueInDays),
        // 宠物档案页（MVP-WEB-05-01）尚未上线，先不给跳转目标
        route: null,
        dueDate: toDateOnly(row.expireDate),
        dueInDays,
      });
    }
    return items;
  }

  /**
   * 把待审批的宠物转移申请装配成待办项
   *
   * `PetTransferRequest` 无到期日语义，严重度统一 medium（待审批 = 需尽快处理但非紧急）。
   * 宠物名批量回查；查无实体（已软删）的申请丢弃。
   */
  private async buildTransferTodos(
    rows: { id: string; petId: string; createdAt: Date }[]
  ): Promise<DashboardTodoItem[]> {
    if (rows.length === 0) return [];

    const petIds = Array.from(new Set(rows.map((row) => row.petId)));
    const pets = await this.prisma.scoped.pet.findMany({
      where: { id: { in: petIds }, deletedAt: null },
      select: { id: true, name: true },
    });
    const petNameById = new Map(pets.map((pet) => [pet.id, pet.name]));

    const items: DashboardTodoItem[] = [];
    for (const row of rows) {
      const petName = petNameById.get(row.petId);
      if (!petName) continue;

      items.push({
        key: `transfer:${row.id}`,
        kind: "transfer",
        category: "transfer",
        petId: row.petId,
        petName,
        severity: "medium",
        // 客户详情页（MVP-WEB-04）尚未上线，先不给跳转目标
        route: null,
        submittedAt: row.createdAt.toISOString(),
      });
    }
    return items;
  }
}

/** 未上线数据源的指标（value 恒 null，前端渲染 `--`） */
function unavailableMetric(source: DashboardMetric["source"], note: string): DashboardMetric {
  return { value: null, available: false, source, note };
}

/** 严重度：已逾期或 ≤3 天 high / ≤7 天 medium / 其余 low */
function resolveSeverity(dueInDays: number): "high" | "medium" | "low" {
  if (dueInDays <= 3) return "high";
  if (dueInDays <= 7) return "medium";
  return "low";
}

/**
 * 待办排序：严重度优先（high > medium > low），同级按到期紧迫度（`dueInDays` 小在前）。
 * 无到期日语义的待办（transfer）排在同级健康待办之后。
 */
function compareTodos(a: DashboardTodoItem, b: DashboardTodoItem): number {
  const rankDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (rankDiff !== 0) return rankDiff;
  const aDue = a.dueInDays ?? Number.MAX_SAFE_INTEGER;
  const bDue = b.dueInDays ?? Number.MAX_SAFE_INTEGER;
  return aDue - bDue;
}

/** 取 UTC 零点（`@db.Date` 列无时区语义，统一以 UTC 午夜承载） */
function startOfUtcDay(input: Date): Date {
  return new Date(
    Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate(), 0, 0, 0, 0)
  );
}

/** 格式化为 yyyy-MM-dd（DATE 列对外口径） */
function toDateOnly(input: Date): string {
  const y = input.getUTCFullYear();
  const m = String(input.getUTCMonth() + 1).padStart(2, "0");
  const d = String(input.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
