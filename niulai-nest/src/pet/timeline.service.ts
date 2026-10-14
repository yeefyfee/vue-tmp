import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import {
  TIMELINE_REVISION_EVENT_NAME,
  TimelineActorType,
  isKnownTimelineEventName,
} from "@peluvida/shared";
import { PrismaService } from "../common/prisma/prisma.service";
import { toBigInt } from "../common/prisma/prisma-ids";
import { ErrorCode } from "../common/enums/error-code.enum";
import { BusinessException } from "../common/exceptions/business.exception";
import { endOfDay, parseWallClock } from "../common/utils/date.util";
import { TimelineWriteService, toTimelineEventView } from "./timeline-write.service";
import type { TimelineEventView } from "./timeline-write.service";
import { TIMELINE_REF_TYPE_EVENT, TimelineError } from "./timeline.constants";
import { QueryTimelineDto } from "./dto/query-timeline.dto";
import { CreateTimelineEventDto } from "./dto/create-timeline-event.dto";
import { ReviseTimelineEventDto } from "./dto/revise-timeline-event.dto";

/**
 * 宠物时间线读 / 补录 / 冲正服务（P0-06-06 统一事件模型 + P0-06-07 冲正纠错）
 *
 * 数据访问统一走 `prisma.scoped.timelineEvent`（租户隔离扩展自动注入 tenantId，RLS 兜底）；
 * 宠物归属校验以「宠物存在（租户内 + 未软删）」为前置锚点（不存在抛 A0601，防越权探测）。
 *
 * 契约口径（对齐 pet/health 范式）：
 *  - **只读 + 追加**：本服务不提供 UPDATE/DELETE——DB 层亦有拦改删触发器（P0-06-07），
 *    纠错一律通过 {@link reviseEvent} 追加「冲正事件」，原事件保持不变；
 *  - 分页返回 `{ data, page: { pageNum, pageSize, total } }`，由全局 ResponseInterceptor
 *    改写成 `list/total/page/page_size` 信封；
 *  - BigInt 事件 id 在 service 层字符串化（出参不含原始 BigInt）。
 *
 * 写入一律经 {@link TimelineWriteService}（同步 recordSync），手工补录 / 冲正均走统一 SDK。
 */
@Injectable()
export class TimelineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly timelineWrite: TimelineWriteService
  ) {}

  /**
   * 时间线分页查询（P0-06-06 FR-5）
   *
   * 筛选：eventType / eventName / refType + refId（精确）+ visibleToOwner（精确）
   * + eventTime 闭区间；默认 eventTime desc（并列按 id desc 兜底）。
   */
  async listTimeline(
    petId: string,
    query: QueryTimelineDto
  ): Promise<{
    data: TimelineEventView[];
    page: { pageNum: number; pageSize: number; total: number };
  }> {
    await this.assertPetExists(petId);

    const pageNum = Number(query.pageNum) > 0 ? Number(query.pageNum) : 1;
    const pageSize = Number(query.pageSize) > 0 ? Number(query.pageSize) : 20;

    const where: Prisma.TimelineEventWhereInput = { petId };
    if (query.eventType !== undefined && query.eventType !== null) {
      where.eventType = query.eventType;
    }
    if (query.eventName) {
      where.eventName = query.eventName;
    }
    if (query.refType) {
      where.refType = query.refType;
    }
    if (query.refId) {
      where.refId = query.refId;
    }
    if (query.visibleToOwner === "true") {
      where.visibleToOwner = true;
    } else if (query.visibleToOwner === "false") {
      where.visibleToOwner = false;
    }

    // 时间处理铁律 4：区间端点一律走 date.util（禁裸 new Date 解析墙钟）
    const timeFilter: Prisma.DateTimeFilter = {};
    if (query.eventTimeStart) {
      const gte = parseWallClock(query.eventTimeStart);
      if (gte) timeFilter.gte = gte;
    }
    if (query.eventTimeEnd) {
      const lte = endOfDay(query.eventTimeEnd);
      if (lte) timeFilter.lte = lte;
    }
    if (Object.keys(timeFilter).length > 0) {
      where.eventTime = timeFilter;
    }

    const orderBy: Prisma.TimelineEventOrderByWithRelationInput[] = [
      { eventTime: "desc" },
      { id: "desc" },
    ];

    const [list, total] = await Promise.all([
      this.prisma.scoped.timelineEvent.findMany({
        where,
        orderBy,
        skip: (pageNum - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.scoped.timelineEvent.count({ where }),
    ]);

    return {
      data: list.map((row) => toTimelineEventView(row)),
      page: { pageNum, pageSize, total },
    };
  }

  /**
   * 事件详情（P0-06-06）；事件不存在 / 跨租户 / 非法 id 形态统一抛 A0613（防枚举）。
   *
   * 注：分区表复合主键 (id, eventTime) 使其不支持 findUnique，故用 findFirst（id + petId）。
   */
  async getEventDetail(petId: string, eventId: string): Promise<TimelineEventView> {
    await this.assertPetExists(petId);
    const id = this.parseEventId(eventId);
    const row = await this.prisma.scoped.timelineEvent.findFirst({ where: { id, petId } });
    if (!row) {
      throw new BusinessException(TimelineError.EVENT_NOT_FOUND);
    }
    return toTimelineEventView(row);
  }

  /**
   * 手工补录事件（P0-06-06 · POST /pets/:petId/timeline）
   *
   * 未登记事件名且未显式给出 eventType → A0614（强制事件名枚举纪律）。
   * 写入经统一 SDK（事件类型 / 操作者类型 / 可见性按事件名回落）。
   */
  async createManualEvent(petId: string, dto: CreateTimelineEventDto): Promise<TimelineEventView> {
    await this.assertPetExists(petId);
    const eventName = dto.eventName;
    if (!isKnownTimelineEventName(eventName) && dto.eventType === undefined) {
      throw new BusinessException(TimelineError.EVENT_NAME_INVALID);
    }
    return this.timelineWrite.recordSync({
      petId,
      eventName,
      eventType: dto.eventType,
      content: dto.content ?? null,
      payload: dto.payload ?? null,
      refType: dto.refType ?? null,
      refId: dto.refId ?? null,
      actorType: dto.actorType ?? TimelineActorType.STAFF,
      operatorId: dto.operatorId ?? undefined,
      visibleToOwner: dto.visibleToOwner,
      eventTime: dto.eventTime ?? null,
    });
  }

  /**
   * 冲正事件（P0-06-07 · POST /pets/:petId/timeline/:eventId/revise）
   *
   * **不修改原事件**：追加一条 `timeline.event.revised`，payload 记录原事件 id /
   * 原名 / 原因 / 差分，refType=timeline_event、refId=原事件 id。原事件行保持字节级
   * 不变（DB 触发器亦禁止改删）。返回新追加的冲正事件视图。
   */
  async reviseEvent(
    petId: string,
    eventId: string,
    dto: ReviseTimelineEventDto
  ): Promise<TimelineEventView> {
    await this.assertPetExists(petId);
    const id = this.parseEventId(eventId);
    const original = await this.prisma.scoped.timelineEvent.findFirst({ where: { id, petId } });
    if (!original) {
      throw new BusinessException(TimelineError.EVENT_NOT_FOUND);
    }

    return this.timelineWrite.recordSync({
      petId,
      eventName: TIMELINE_REVISION_EVENT_NAME,
      content: dto.reason ?? `冲正事件 #${String(original.id)}`,
      payload: {
        originalEventId: String(original.id),
        originalEventName: original.eventName ?? null,
        reason: dto.reason ?? null,
        changes: dto.changes ?? null,
      },
      refType: TIMELINE_REF_TYPE_EVENT,
      refId: String(original.id),
      actorType: TimelineActorType.STAFF,
      visibleToOwner: dto.visibleToOwner ?? original.visibleToOwner,
    });
  }

  /** 事件 id 解析（BigInt；非法形态归「不存在」防枚举） */
  private parseEventId(eventId: string): bigint {
    const id = toBigInt(eventId);
    if (id === null || id <= 0n) {
      throw new BusinessException(TimelineError.EVENT_NOT_FOUND);
    }
    return id;
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
