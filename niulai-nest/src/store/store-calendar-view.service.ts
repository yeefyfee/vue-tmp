import { Injectable } from "@nestjs/common";

import { PrismaService } from "../common/prisma/prisma.service";
import { ErrorCode } from "../common/enums/error-code.enum";
import { BusinessException } from "../common/exceptions/business.exception";
import { normalizeWeekly, type WeekdayKey } from "./business-hours.service";
import { parseCalendarMonthRange } from "./store-calendar.service";

/** 墙钟时间 HH:mm（24 小时制） */
const WALL_CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 一天的毫秒数（UTC 口径，UTC 日无 DST，恒定成立） */
const DAY_MS = 86_400_000;

/** Date.getUTCDay()（0=周日…6=周六）→ 周键（与 WEEKDAY_KEYS 同一口径） */
const UTC_DAY_TO_WEEKDAY_KEY: readonly WeekdayKey[] = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
];

/** 整月逐日营业视图条目（P0-04-07 · FR-6 输出契约） */
export interface CalendarViewDay {
  /** 日期（yyyy-MM-dd，UTC 纯日期算术口径） */
  date: string;
  /** 当日是否营业 */
  open: boolean;
  /** 营业状态来源：weekly=周时段推断；calendar=日历例外日 */
  source: "weekly" | "calendar";
  /** 营业时段（闭店为空数组） */
  periods: [string, string][];
  /** 日历例外类型（仅 source=calendar 时出现）：1 节假日闭店 / 2 临时闭店 / 3 特殊营业 */
  calendarType?: 1 | 2 | 3;
}

/** 日历例外日的最小形状（prisma 行或单测造数共用） */
export interface CalendarEntryLike {
  date: Date;
  type: number;
  openTime: string | null;
  closeTime: string | null;
}

/** "HH:mm" → 当日分钟数（调用前须保证已通过 WALL_CLOCK_TIME_PATTERN 校验） */
function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Date（UTC 瞬时）→ "yyyy-MM-dd"（逐字段取 UTC 分量，禁 toISOString 之外的时区口径漂移） */
export function formatUtcDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 周时段单段合法性（读取口径 fail-safe：脏段丢弃而非炸接口） */
function isValidSegment(segment: unknown): segment is [string, string] {
  return (
    Array.isArray(segment) &&
    segment.length === 2 &&
    typeof segment[0] === "string" &&
    typeof segment[1] === "string" &&
    WALL_CLOCK_TIME_PATTERN.test(segment[0]) &&
    WALL_CLOCK_TIME_PATTERN.test(segment[1]) &&
    toMinutes(segment[1]) > toMinutes(segment[0])
  );
}

/**
 * 聚合整月逐日视图（纯函数，P0-04-07 核心规则）：
 *
 *  - store_calendar 例外日**优先于**周时段：
 *      type=1/2 → 全天闭店（open=false, periods=[]）；
 *      type=3   → 特殊营业（open=true, periods=[[openTime, closeTime]]；
 *                 时刻脏数据 fail-safe 按闭店处理，绝不透传非法时段）；
 *  - 无例外日回落周时段：该星期几无有效时段 = 闭店；
 *  - 日期算术沿用 parseCalendarDate 的纯 UTC 口径（Date.UTC + UTC 分量回读）。
 */
export function buildCalendarViewDays(
  range: { gte: Date; lt: Date },
  weeklyRaw: unknown,
  entries: CalendarEntryLike[]
): CalendarViewDay[] {
  // 周时段规整为 7 天键齐全模板（缺失键补空数组、脏数据回落空数组）
  const weekly = normalizeWeekly(weeklyRaw);

  // 例外日按 DATE 索引（同店同日唯一，Map 覆盖语义安全）
  const entryByDate = new Map<string, CalendarEntryLike>();
  for (const entry of entries) {
    entryByDate.set(formatUtcDate(entry.date), entry);
  }

  const dayCount = Math.round((range.lt.getTime() - range.gte.getTime()) / DAY_MS);
  const days: CalendarViewDay[] = [];

  for (let i = 0; i < dayCount; i++) {
    const day = new Date(range.gte.getTime() + i * DAY_MS);
    const dateStr = formatUtcDate(day);
    const entry = entryByDate.get(dateStr);

    if (entry) {
      if (
        entry.type === 3 &&
        entry.openTime &&
        entry.closeTime &&
        WALL_CLOCK_TIME_PATTERN.test(entry.openTime) &&
        WALL_CLOCK_TIME_PATTERN.test(entry.closeTime) &&
        toMinutes(entry.closeTime) > toMinutes(entry.openTime)
      ) {
        days.push({
          date: dateStr,
          open: true,
          source: "calendar",
          periods: [[entry.openTime, entry.closeTime]],
          calendarType: 3,
        });
      } else {
        // type 1/2 全天闭店；type 3 时刻脏数据同样 fail-safe 闭店（不炸、不透传）
        days.push({
          date: dateStr,
          open: false,
          source: "calendar",
          periods: [],
          calendarType: entry.type as 1 | 2 | 3,
        });
      }
      continue;
    }

    // 无例外日：回落周时段（该星期几的规整时段，脏段丢弃）
    const weekdayKey = UTC_DAY_TO_WEEKDAY_KEY[day.getUTCDay()];
    const segments = (weekly[weekdayKey] as unknown[]).filter(isValidSegment);
    days.push({
      date: dateStr,
      open: segments.length > 0,
      source: "weekly",
      periods: segments.map((segment) => [segment[0], segment[1]] as [string, string]),
    });
  }

  return days;
}

/**
 * 门店日历视图服务（P0-04-07 · FR-6：整月逐日营业视图）
 *
 * 聚合口径：`store.business_hours`（周时段）与 `store_calendar`（日期级例外）
 * 两数据源合并为整月逐日视图，例外日优先。
 *
 * 契约口径（对齐 store-calendar.service）：
 *  - 门店归属走 `prisma.scoped.store.findFirst`，非本租户或已软删 → A0424；
 *  - month 非法（service 层兜底，绕过 ValidationPipe 直调场景）→ A0400；
 *  - DATE 查询用 UTC 午夜闭开区间（纯日期算术，不依赖进程时区）。
 */
@Injectable()
export class StoreCalendarViewService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 整月逐日营业视图（FR-6）：`?month=yyyy-MM`。
   *
   * 返回 `{ storeId, month, days: CalendarViewDay[] }`，days 恒为整月
   * 逐日齐全（1 号至月末，与月份实际天数一致）。
   */
  async getCalendarView(storeId: string, month: string) {
    // 门店归属优先校验（非本租户/已软删 → A0424，与日历列表同口径）
    const store = await this.prisma.scoped.store.findFirst({
      where: { id: storeId, deletedAt: null },
    });
    if (!store) {
      throw new BusinessException(ErrorCode.STORE_NOT_FOUND);
    }

    const range = parseCalendarMonthRange(month);
    if (!range) {
      throw new BusinessException(ErrorCode.USER_REQUEST_PARAMETER_ERROR);
    }

    const entries = await this.prisma.scoped.storeCalendar.findMany({
      where: { storeId, date: { gte: range.gte, lt: range.lt }, deletedAt: null },
      orderBy: [{ date: "asc" }],
    });

    const days = buildCalendarViewDays(range, store.businessHours, entries);
    return { storeId, month, days };
  }
}
