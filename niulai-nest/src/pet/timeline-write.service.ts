import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import {
  resolveTimelineActorType,
  resolveTimelineEventType,
  resolveTimelineVisibility,
} from "@peluvida/shared";
import { PrismaService } from "../common/prisma/prisma.service";
import { toBigInt } from "../common/prisma/prisma-ids";
import { RequestContext } from "../common/context/request-context";
import { ErrorCode } from "../common/enums/error-code.enum";
import { BusinessException } from "../common/exceptions/business.exception";
import { parseWallClock } from "../common/utils/date.util";
import { QUEUE_REGISTRY } from "../queue/queue.module";
import { QueueRegistry, TIMELINE_QUEUE } from "../queue/queue-registry";
import type { TimelineWriteJobData } from "../queue/timeline/timeline.constants";

/**
 * 统一时间线写入入参（SDK 契约，P0-06-10）
 *
 * 业务侧只需给出 petId + eventName（+ 业务负载）；eventType / actorType /
 * visibleToOwner 缺省时由 shared 的事件名常量表回落（见 packages/shared/src/timeline.ts）。
 * tenantId 缺省时取当前请求/消费上下文的租户（fail-closed）。
 */
export interface TimelineWriteInput {
  /** 宠物 id（uuid，必填） */
  petId: string;
  /** 统一事件名（`模块.动作`，必填） */
  eventName: string;
  /** 租户 id（缺省取上下文租户；跨租户系统任务可显式传入） */
  tenantId?: string;
  /** 显式事件类型（缺省按事件名回落） */
  eventType?: number;
  /** 事件内容摘要 */
  content?: string | null;
  /** 结构化负载 */
  payload?: Record<string, unknown> | null;
  /** 多态关联对象类型 */
  refType?: string | null;
  /** 多态关联对象 id */
  refId?: string | null;
  /** 操作者类型（缺省按事件名回落） */
  actorType?: number;
  /** 操作人（BigInt/字符串；缺省取当前用户） */
  operatorId?: bigint | string | null;
  /** 宠主端可见性（缺省按事件名回落） */
  visibleToOwner?: boolean;
  /** 事件时间（缺省=落库时刻 now()） */
  eventTime?: Date | string | null;
}

/** 时间线事件对外视图（BigInt 字符串化，PEL 约定） */
export interface TimelineEventView {
  id: string;
  tenantId: string;
  petId: string;
  eventType: number;
  eventName: string | null;
  content: string | null;
  payload: unknown;
  refType: string | null;
  refId: string | null;
  actorType: number;
  operatorId: string | null;
  eventTime: Date;
  visibleToOwner: boolean;
}

/** timeline_event 行类型（复合主键模型） */
export type TimelineEventRow = Prisma.TimelineEventGetPayload<null>;

/** 行 → 视图（BigInt 字符串化在 service 层完成，不在出参抛原始 BigInt） */
export function toTimelineEventView(row: TimelineEventRow): TimelineEventView {
  return {
    id: String(row.id),
    tenantId: String(row.tenantId),
    petId: row.petId,
    eventType: row.eventType,
    eventName: row.eventName ?? null,
    content: row.content ?? null,
    payload: row.payload ?? null,
    refType: row.refType ?? null,
    refId: row.refId ?? null,
    actorType: row.actorType,
    operatorId:
      row.operatorId === null || row.operatorId === undefined ? null : String(row.operatorId),
    eventTime: row.eventTime,
    visibleToOwner: row.visibleToOwner,
  };
}

/** 解析租户：入参优先，否则取上下文；缺失 fail-closed 抛 A0302 */
function resolveTenantId(explicit?: string): string {
  const tid =
    explicit && String(explicit).trim() !== "" ? String(explicit) : RequestContext.getTenantId();
  if (!tid) {
    throw new BusinessException(ErrorCode.TENANT_CONTEXT_MISSING);
  }
  return String(tid);
}

/** BigInt 形态归一为字符串（null/空 → null） */
function toBigIntString(value: bigint | string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

/**
 * 同步写入一条时间线事件（事务内可用；租户上下文内）。
 *
 * 供给：
 *  - `TimelineWriteService.recordSync`（DI 侧）；
 *  - `processTimelineWriteJob`（Worker 消费侧；消费前已用 RequestContext.run 恢复租户）。
 *
 * 事件类型 / 操作者类型 / 可见性一律经 shared 的解析函数落地（显式优先 → 事件名默认
 * → 兜底），写入点无需重复实现回落逻辑。eventTime 缺省时**不写该列**，交由 DB 默认
 * `now()` 承载（保证落到当月分区）。
 */
export async function writeTimelineEventSync(
  prisma: PrismaService,
  input: TimelineWriteInput
): Promise<TimelineEventView> {
  const tenantId = resolveTenantId(input.tenantId);
  const eventName = input.eventName;
  const eventType = resolveTimelineEventType(eventName, input.eventType);
  const actorType = resolveTimelineActorType(eventName, input.actorType);
  const visibleToOwner = resolveTimelineVisibility(eventName, input.visibleToOwner);

  const data: Prisma.TimelineEventUncheckedCreateInput = {
    tenantId: BigInt(tenantId),
    petId: input.petId,
    eventType,
    eventName,
    content: input.content ?? null,
    refType: input.refType ?? null,
    refId: input.refId ?? null,
    actorType,
    operatorId: toBigInt(input.operatorId ?? RequestContext.getUserId()),
    visibleToOwner,
  };

  if (input.payload !== undefined && input.payload !== null) {
    data.payload = input.payload as Prisma.InputJsonValue;
  }
  if (input.eventTime !== undefined && input.eventTime !== null) {
    const instant =
      input.eventTime instanceof Date ? input.eventTime : parseWallClock(input.eventTime);
    if (instant) {
      data.eventTime = instant;
    }
  }

  const row = await prisma.scoped.timelineEvent.create({ data });
  return toTimelineEventView(row);
}

/**
 * 时间线统一写入 SDK（P0-06-10）
 *
 * 提供两条通道：
 *  - {@link recordSync}：事务内同步写（强一致场景，如必须与主业务同事务/同响应）；
 *  - {@link recordAsync}：入队异步写（默认通道；最终一致，消费端恢复租户上下文后落库）。
 *
 * @Inject(QUEUE_REGISTRY) 标 @Optional：单测直构（无队列设施）时 recordAsync 自动
 * 降级为同步写，保证事件不丢；生产由 QueueModule（@Global）注入。
 */
@Injectable()
export class TimelineWriteService {
  private readonly logger = new Logger(TimelineWriteService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(QUEUE_REGISTRY) private readonly registry?: QueueRegistry
  ) {}

  /** 同步写（事务内可用）。 */
  async recordSync(input: TimelineWriteInput): Promise<TimelineEventView> {
    return writeTimelineEventSync(this.prisma, input);
  }

  /**
   * 异步写入：解析租户 + 归一载荷 → 入队 `TIMELINE_QUEUE`。
   *
   * 无队列设施（单测直构）时降级为同步写，返回 `enqueued:false`。
   */
  async recordAsync(input: TimelineWriteInput): Promise<{ enqueued: boolean; tenantId: string }> {
    const tenantId = resolveTenantId(input.tenantId);
    if (!this.registry) {
      this.logger.warn(
        `未注入队列设施，recordAsync 降级为同步写：event=${input.eventName} pet=${input.petId}`
      );
      await this.recordSync({ ...input, tenantId });
      return { enqueued: false, tenantId };
    }

    const eventName = input.eventName;
    const eventTime = input.eventTime
      ? input.eventTime instanceof Date
        ? input.eventTime.toISOString()
        : (parseWallClock(input.eventTime) ?? new Date()).toISOString()
      : null;

    const data: TimelineWriteJobData = {
      tenantId,
      petId: input.petId,
      eventName,
      eventType: resolveTimelineEventType(eventName, input.eventType),
      content: input.content ?? null,
      payload: input.payload ?? null,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      actorType: resolveTimelineActorType(eventName, input.actorType),
      operatorId: toBigIntString(input.operatorId ?? RequestContext.getUserId()),
      visibleToOwner: resolveTimelineVisibility(eventName, input.visibleToOwner),
      eventTime,
    };
    // 租户队列：写键空间带租户前缀；租户归属亦随 job.data 承载（消费端恢复）
    await this.registry.enqueue(TIMELINE_QUEUE, data, { tenantId });
    return { enqueued: true, tenantId };
  }
}
