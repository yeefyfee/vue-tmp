/**
 * 门店日历纯函数工具（MVP-WEB-02-04）
 *
 * 与后端 `niulai-nest/src/store/store-calendar.service.ts` /
 * `store-calendar-view.service.ts` 的**日期算术口径同源**：
 * 一律用 `Date.UTC` + UTC 分量读写（纯日期算术），禁止裸 `new Date(string)`
 * 解析墙钟（时间处理铁律，见项目约定）。
 *
 * 本模块**零副作用、零 store / i18n 依赖**：只做数据换算，文案与组件状态由调用方负责。
 * 月份字符串统一 `yyyy-MM`（与 `GET /calendar?month=` 一致）。
 */

import type {
  CalendarEntryType,
  CalendarViewDay,
  CalendarViewSource,
  StoreCalendarEntry,
} from "@/api/store";

/** 一天的毫秒数（UTC 日无夏令时，恒定成立） */
const DAY_MS = 86_400_000;

/** 月份字符串形态（`yyyy-MM`，01~12；与后端 `QueryCalendarDto` 的 Matches 同口径） */
export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** 日期字符串形态（`yyyy-MM-dd`；真实日历日另由 `isRealCalendarDate` 校验） */
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 墙钟时间 `HH:mm`（24 小时制） */
export const WALL_CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 日历例外类型全集（与后端 `CALENDAR_ENTRY_TYPES` 对齐） */
export const CALENDAR_ENTRY_TYPES = [1, 2, 3] as const;

/** 例外类型元数据：i18n 键 + 标签色（`el-tag` 的 `type`） */
export const CALENDAR_TYPE_META: Record<
  CalendarEntryType,
  { i18nKey: string; tagType: "danger" | "warning" | "success" }
> = {
  // 1 节假日闭店 / 2 临时闭店：均为全天闭店，用红色/橙色区分语义来源
  1: { i18nKey: "storeCalendar.type.holiday", tagType: "danger" },
  2: { i18nKey: "storeCalendar.type.closure", tagType: "warning" },
  3: { i18nKey: "storeCalendar.type.special", tagType: "success" },
};

/**
 * 月历表头（周一为首列）
 *
 * 与周营业时段的 `WEEKDAY_KEYS` 顺序一致（mon…sun），便于把「逐日视图」
 * 与「营业时间」两页的星期语义对齐。
 */
export const CALENDAR_WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** 判断是否为合法的 `yyyy-MM` */
export function isValidMonth(month: string): boolean {
  return MONTH_PATTERN.test(month);
}

/** `yyyy-MM` → `{ year, monthIndex }`（monthIndex 为 0 基）；非法返回 null */
export function parseMonth(month: string): { year: number; monthIndex: number } | null {
  if (!MONTH_PATTERN.test(month)) return null;
  const [year, m] = month.split("-").map(Number);
  return { year, monthIndex: m - 1 };
}

/** `{ year, monthIndex }` → `yyyy-MM`（补零） */
export function formatMonth(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

/** 月份偏移（delta 可负）；非法输入原样返回 */
export function shiftMonth(month: string, delta: number): string {
  const parsed = parseMonth(month);
  if (!parsed) return month;
  const total = parsed.year * 12 + parsed.monthIndex + delta;
  return formatMonth(Math.floor(total / 12), ((total % 12) + 12) % 12);
}

/**
 * 当前月份（本地日期口径）
 *
 * 取「用户所在时区的今天」所属月份 —— 与页面「回到本月」按钮的直觉一致
 * （逐日视图的日期字符串本身由服务端按 UTC 口径给出，两者仅在跨零点的
 * 极端时刻可能相差一天，属可接受口径，见页面说明）。
 */
export function currentMonth(now: Date = new Date()): string {
  return formatMonth(now.getFullYear(), now.getMonth());
}

/** 某年某月的天数（`monthIndex` 为 0 基；利用「下月 0 日」回卷特性） */
export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * 本地时区的今天（`yyyy-MM-dd`）
 *
 * ⚠️ 仅用于月历里的「今天」视觉标记 —— 逐日视图的日期字符串由**服务端按 UTC**
 * 口径给出，两者只在跨零点的极端时刻相差一天，属可接受口径（不影响任何读写）。
 */
export function todayLocalDate(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
}

/** UTC 瞬时 → `yyyy-MM-dd`（逐字段取 UTC 分量，与后端 `formatUtcDate` 同口径） */
export function formatUtcDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate()
  ).padStart(2, "0")}`;
}

/**
 * 是否为**真实日历日**（`2026-02-30` 这类越界日期返回 false）
 *
 * 与后端 `parseCalendarDate` 同口径：`Date.UTC` 会把 2026-02-30 回卷成 3 月，
 * 故必须逐字段回读复核。
 */
export function isRealCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const instant = new Date(Date.UTC(y, m - 1, d));
  return (
    instant.getUTCFullYear() === y && instant.getUTCMonth() === m - 1 && instant.getUTCDate() === d
  );
}

/** 月历网格单元 */
export interface MonthGridCell {
  /** 日期（`yyyy-MM-dd`） */
  date: string;
  /** 是否属于当前月（前后补位为 false，用于弱化显示） */
  inMonth: boolean;
}

/**
 * 构建月历网格（**周一为首列**，前后补位补齐整周）
 *
 * 返回长度为 7 的整数倍（28/35/42），可直接按 7 列渲染。
 * 全部用 UTC 分量计算，不受进程/浏览器时区影响。
 */
export function buildMonthGrid(month: string): MonthGridCell[] {
  const parsed = parseMonth(month);
  if (!parsed) return [];
  const { year, monthIndex } = parsed;

  const firstInstant = Date.UTC(year, monthIndex, 1);
  // getUTCDay()：0=周日…6=周六 → 换算为「周一起始」的前置补位数
  const firstWeekday = new Date(firstInstant).getUTCDay();
  const lead = (firstWeekday + 6) % 7;
  const total = daysInMonth(year, monthIndex);

  const cellCount = Math.ceil((lead + total) / 7) * 7;
  const cells: MonthGridCell[] = [];
  for (let i = 0; i < cellCount; i += 1) {
    const instant = firstInstant + (i - lead) * DAY_MS;
    cells.push({
      date: formatUtcDate(new Date(instant)),
      inMonth: i >= lead && i < lead + total,
    });
  }
  return cells;
}

/**
 * 例外日列表项 → 日期键（`yyyy-MM-dd`）
 *
 * ⚠️ `GET /calendar` 的 `date` 是本地时区形态 `yyyy-MM-dd HH:mm:ss`
 * （实测 `"2026-10-20 08:00:00"`），与 `GET /calendar-view` 的纯 `yyyy-MM-dd`
 * **不一致**，故统一取前 10 位作为对齐键（见 `types.ts` 中 `StoreCalendarEntry.date` 的说明）。
 */
export function entryDateKey(entry: Pick<StoreCalendarEntry, "date"> | string): string {
  const raw = typeof entry === "string" ? entry : entry.date;
  return String(raw ?? "").slice(0, 10);
}

/** 把例外日列表转为「日期 → 列表项」映射（同店同日唯一，Map 覆盖语义安全） */
export function entriesByDate(items: StoreCalendarEntry[]): Record<string, StoreCalendarEntry> {
  const map: Record<string, StoreCalendarEntry> = {};
  for (const item of items) {
    map[entryDateKey(item)] = item;
  }
  return map;
}

/** 把逐日视图转为「日期 → 条目」映射 */
export function viewDaysByDate(days: CalendarViewDay[]): Record<string, CalendarViewDay> {
  const map: Record<string, CalendarViewDay> = {};
  for (const day of days) {
    map[String(day.date).slice(0, 10)] = day;
  }
  return map;
}

/** 时段数组 → 可读摘要（`09:00–12:00、13:00–18:00`），空数组返回空串 */
export function periodsSummary(periods: [string, string][] | undefined): string {
  if (!periods || periods.length === 0) return "";
  return periods.map(([open, close]) => `${open}–${close}`).join("、");
}

/** 单日格子的展示态（组件据此选 i18n 键与标签色） */
export interface DayDisplayState {
  /** 是否营业 */
  open: boolean;
  /** 状态来源 */
  source: CalendarViewSource | "unknown";
  /** 例外类型（仅 source=calendar） */
  calendarType?: CalendarEntryType;
  /** 状态徽标 i18n 键 */
  statusKey: string;
  /** 徽标色（`el-tag` 的 type） */
  tagType: "danger" | "warning" | "success" | "info";
}

/**
 * 单个日期格子的展示态（唯一判定入口，避免组件里散落分支）
 *
 * 优先级：例外日 > 周时段闭店 > 周时段营业；
 * `day` 缺失（视图未返回该日）按「未知」处理，不假装营业。
 */
export function resolveDayDisplay(day: CalendarViewDay | undefined): DayDisplayState {
  if (!day) {
    return {
      open: false,
      source: "unknown",
      statusKey: "storeCalendar.status.unknown",
      tagType: "info",
    };
  }
  if (day.source === "calendar" && day.calendarType) {
    const meta = CALENDAR_TYPE_META[day.calendarType];
    return {
      open: day.open,
      source: "calendar",
      calendarType: day.calendarType,
      statusKey: meta.i18nKey,
      tagType: meta.tagType,
    };
  }
  if (!day.open) {
    return {
      open: false,
      source: day.source,
      statusKey: "storeCalendar.status.closed",
      tagType: "info",
    };
  }
  return {
    open: true,
    source: day.source,
    statusKey: "storeCalendar.status.open",
    tagType: "success",
  };
}

/**
 * 例外日表单校验（与后端 `createCalendarEntry` 同一判定顺序）
 *
 * - `date` 缺失 / 形态非法 / 非真实日历日 → `errorDate`
 * - `type` 不在 1/2/3 → `errorType`
 * - `type=3` 且时刻缺失 / 形态非法 → `errorTimeRequired`
 * - `type=3` 且 `closeTime <= openTime` → `errorEndBeforeStart`
 *
 * 返回 `null` 表示通过。
 */
export function validateEntryForm(form: {
  date: string;
  type: number;
  openTime?: string;
  closeTime?: string;
}): string | null {
  if (!isRealCalendarDate(form.date)) return "errorDate";
  if (!(CALENDAR_ENTRY_TYPES as readonly number[]).includes(form.type)) return "errorType";
  if (form.type === 3) {
    if (!form.openTime || !form.closeTime) return "errorTimeRequired";
    if (
      !WALL_CLOCK_TIME_PATTERN.test(form.openTime) ||
      !WALL_CLOCK_TIME_PATTERN.test(form.closeTime)
    ) {
      return "errorTimeRequired";
    }
    if (form.closeTime <= form.openTime) return "errorEndBeforeStart";
  }
  return null;
}

/** 例外日在「逐日视图」中会覆盖的时段（用于表单预览提示；非 3 类型恒为空） */
export function entryPeriods(form: {
  type: number;
  openTime?: string;
  closeTime?: string;
}): [string, string][] {
  if (form.type !== 3 || !form.openTime || !form.closeTime) return [];
  return [[form.openTime, form.closeTime]];
}
