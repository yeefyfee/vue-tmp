import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../common/prisma/prisma.service";
import { toBigInt } from "../common/prisma/prisma-ids";
import { RequestContext } from "../common/context/request-context";
import { ErrorCode } from "../common/enums/error-code.enum";
import { BusinessException } from "../common/exceptions/business.exception";
import { CreateCalendarEntryDto } from "./dto/create-calendar-entry.dto";

/** 日历例外类型：1 节假日闭店 holiday / 2 临时闭店 closure / 3 特殊营业 special */
export const CALENDAR_ENTRY_TYPES = [1, 2, 3] as const;
export type CalendarEntryType = (typeof CALENDAR_ENTRY_TYPES)[number];

/** 墙钟时间 HH:mm（24 小时制） */
const WALL_CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 日期字符串 yyyy-MM-dd（严格两位月/日，配合真实日历日校验） */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** "HH:mm" → 当日分钟数（调用前须保证已通过 WALL_CLOCK_TIME_PATTERN 校验） */
function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * 把 `yyyy-MM-dd` 解析为「UTC 午夜瞬时」——DATE 列无时间语义，用纯日期算术
 * （Date.UTC）承载可规避进程时区漂移（时间处理铁律：禁裸 new Date 解析墙钟）。
 * 非真实日历日（如 2026-02-30）返回 null。
 */
export function parseCalendarDate(value: string): Date | null {
  if (!DATE_PATTERN.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const instant = new Date(Date.UTC(y, m - 1, d));
  // 回读校验：Date.UTC 会把 2026-02-30 滚动成 3 月，必须逐字段复核
  if (
    instant.getUTCFullYear() !== y ||
    instant.getUTCMonth() !== m - 1 ||
    instant.getUTCDate() !== d
  ) {
    return null;
  }
  return instant;
}

/**
 * 把 `yyyy-MM` 解析为该月的 DATE 查询闭开区间 `[gte, lt)`（UTC 午夜口径）。
 * 非法月份返回 null。
 */
export function parseCalendarMonthRange(month: string): { gte: Date; lt: Date } | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  return {
    gte: new Date(Date.UTC(year, monthIndex, 1)),
    lt: new Date(Date.UTC(year, monthIndex + 1, 1)),
  };
}

/**
 * 门店日历服务（P0-04-04 · FR-3 日期级例外：节假日闭店 / 临时闭店 / 特殊营业）
 *
 * 数据落点：独立表 `store_calendar`（同租户同门店同日期唯一），
 * 在 TENANT_SCOPED_MODELS 名单内（租户隔离扩展 + RLS 双层兜底）。
 *
 * 契约口径（对齐 store.service）：
 *  - 门店归属走 `prisma.scoped.store.findFirst`，非本租户或已软删 → A0424；
 *  - 软删（deletedAt = now），所有入口过滤 `deletedAt: null`；
 *  - 唯一冲突：应用层先行查重给 A0438，并发兜底由唯一索引 + P2002 → A0438。
 */
@Injectable()
export class StoreCalendarService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 新建日历例外日（FR-3）
   *
   * type=3（特殊营业）要求 openTime/closeTime 均为合法 HH:mm 且 close > open
   * （缺失或非法 → A0400）；type=1/2 全天闭店，时刻列刻意置 NULL。
   */
  async createCalendarEntry(storeId: string, dto: CreateCalendarEntryDto) {
    const userId = RequestContext.getUserId();

    // 租户归属只认上下文（@RequireTenant 保证非空；直调场景缺失时 fail-closed 拒绝）
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw new BusinessException(ErrorCode.TENANT_CONTEXT_MISSING);
    }

    const store = await this.prisma.scoped.store.findFirst({
      where: { id: storeId, deletedAt: null },
      select: { id: true },
    });
    if (!store) {
      throw new BusinessException(ErrorCode.STORE_NOT_FOUND);
    }

    const date = parseCalendarDate(dto.date);
    if (!date) {
      throw new BusinessException(ErrorCode.USER_REQUEST_PARAMETER_ERROR);
    }

    // type=3 特殊营业：时刻成对必填且 close > open；type=1/2 时刻置 NULL
    let openTime: string | null = null;
    let closeTime: string | null = null;
    if (dto.type === 3) {
      if (
        !dto.openTime ||
        !dto.closeTime ||
        !WALL_CLOCK_TIME_PATTERN.test(dto.openTime) ||
        !WALL_CLOCK_TIME_PATTERN.test(dto.closeTime) ||
        toMinutes(dto.closeTime) <= toMinutes(dto.openTime)
      ) {
        throw new BusinessException(ErrorCode.USER_REQUEST_PARAMETER_ERROR);
      }
      openTime = dto.openTime;
      closeTime = dto.closeTime;
    }

    // 同日同店唯一（软删不腾位）：应用层先行查重给出友好业务码，并发兜底由唯一索引
    const duplicated = await this.prisma.scoped.storeCalendar.findFirst({
      where: { storeId, date, deletedAt: null },
      select: { id: true },
    });
    if (duplicated) {
      throw new BusinessException(ErrorCode.STORE_CALENDAR_DATE_DUPLICATED);
    }

    const data: Prisma.StoreCalendarCreateInput = {
      tenantId: BigInt(tenantId),
      storeId,
      date,
      type: dto.type,
      openTime,
      closeTime,
      ...(dto.remark !== undefined ? { remark: dto.remark } : {}),
      createdBy: toBigInt(userId),
      updatedBy: toBigInt(userId),
    };

    try {
      return await this.prisma.scoped.storeCalendar.create({ data });
    } catch (error) {
      // 唯一约束 uk_store_calendar_tenant_store_date 并发兜底
      if ((error as { code?: string })?.code === "P2002") {
        throw new BusinessException(ErrorCode.STORE_CALENDAR_DATE_DUPLICATED);
      }
      throw error;
    }
  }

  /**
   * 按月列出日历例外日（FR-3）
   *
   * month 固定 `yyyy-MM`；DATE 列查询用 UTC 午夜闭开区间（纯日期算术，
   * 不依赖进程时区）。结果按 date 升序。
   */
  async listCalendarEntries(storeId: string, month: string) {
    const store = await this.prisma.scoped.store.findFirst({
      where: { id: storeId, deletedAt: null },
      select: { id: true },
    });
    if (!store) {
      throw new BusinessException(ErrorCode.STORE_NOT_FOUND);
    }

    const range = parseCalendarMonthRange(month);
    if (!range) {
      throw new BusinessException(ErrorCode.USER_REQUEST_PARAMETER_ERROR);
    }

    const items = await this.prisma.scoped.storeCalendar.findMany({
      where: { storeId, date: { gte: range.gte, lt: range.lt }, deletedAt: null },
      orderBy: [{ date: "asc" }],
    });

    return { storeId, month, items };
  }

  /**
   * 删除日历例外日（FR-3，软删）：deletedAt = now；软删后按月列表不可见
   */
  async deleteCalendarEntry(storeId: string, entryId: string) {
    const userId = RequestContext.getUserId();

    const store = await this.prisma.scoped.store.findFirst({
      where: { id: storeId, deletedAt: null },
      select: { id: true },
    });
    if (!store) {
      throw new BusinessException(ErrorCode.STORE_NOT_FOUND);
    }

    // 门店 + 记录双归属校验：entryId 不属于该门店（含他租户）一律 A0439，不泄露存在性
    const entry = await this.prisma.scoped.storeCalendar.findFirst({
      where: { id: entryId, storeId, deletedAt: null },
      select: { id: true },
    });
    if (!entry) {
      throw new BusinessException(ErrorCode.STORE_CALENDAR_NOT_FOUND);
    }

    await this.prisma.scoped.storeCalendar.update({
      where: { id: entryId },
      data: { deletedAt: new Date(), updatedBy: toBigInt(userId) },
    });
    return true;
  }
}
