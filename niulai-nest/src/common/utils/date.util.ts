import { formatDateToString } from "./serialize.util";

/**
 * 应用统一时区。
 *
 * 背景：数据库时间列是 `timestamptz`（存真实瞬时），而展示与「按天分组」都要求
 * 北京时间口径。此前代码直接用 `date.getFullYear()/getHours()`，隐式依赖**进程时区**，
 * 一旦部署在 UTC 机器上就会整体偏移 8 小时，且不会有任何报错。
 * 统一走本工具，把时区变成显式参数，彻底消除该依赖。
 */
export const APP_TIME_ZONE = "Asia/Shanghai";

/** 读取当前生效的应用时区（可由环境变量 TIME_ZONE 覆盖，与响应层同源） */
export function getAppTimeZone(): string {
  const configured = process.env.TIME_ZONE?.trim();
  return configured || APP_TIME_ZONE;
}

/**
 * 计算某瞬时在指定时区相对 UTC 的偏移毫秒数（东八区为 +28800000）。
 * 通过 Intl 反查该时区的墙钟表示，再与真实瞬时相减，因此天然支持夏令时地区。
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  // 归一到秒，避免毫秒参与运算造成抖动
  const floored = Math.floor(instant.getTime() / 1000) * 1000;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(floored));

  const num = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  // 注意：Intl 在 hourCycle 边界可能返回 24（表示当日 0 点），取模归一
  const asUTC = Date.UTC(
    num("year"),
    num("month") - 1,
    num("day"),
    num("hour") % 24,
    num("minute"),
    num("second")
  );
  return asUTC - floored;
}

/**
 * 把「墙钟字符串」按指定时区解析为真实瞬时。
 *
 * - `"2025-01-01"` / `"2025-01-01 12:00:00"` 视为**该时区的本地时间**
 * - 已带时区标记（`Z` 或 `±HH:MM`）的字符串按原生规则解析
 * - 无法解析返回 `null`
 *
 * ⚠️ 不要退回 `new Date("2025-01-01 12:00:00")` —— 它按**进程时区**解释，
 * 正是本次要消除的隐患。
 */
export function parseWallClock(
  value: string | Date | null | undefined,
  timeZone: string = getAppTimeZone()
): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const text = String(value).trim();
  if (!text) return null;

  // 已含时区信息则交给原生解析
  if (/[zZ]$/.test(text) || /[+-]\d{2}:?\d{2}$/.test(text)) {
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  if (!match) {
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] ?? "0");
  const minute = Number(match[5] ?? "0");
  const second = Number(match[6] ?? "0");

  const naiveUTC = Date.UTC(year, month - 1, day, hour, minute, second);
  // 两轮校正：先用假定瞬时取偏移，再用修正后的瞬时复核（覆盖夏令时切换日）
  let timestamp = naiveUTC - zoneOffsetMs(new Date(naiveUTC), timeZone);
  timestamp = naiveUTC - zoneOffsetMs(new Date(timestamp), timeZone);
  return new Date(timestamp);
}

/** 取某日期在指定时区的自然日起点（00:00:00.000） */
export function startOfDay(value: string | Date, timeZone: string = getAppTimeZone()): Date | null {
  const day = toDayString(value, timeZone);
  return day ? parseWallClock(`${day} 00:00:00`, timeZone) : null;
}

/** 取某日期在指定时区的自然日终点（23:59:59.999），便于 `lte` 闭区间筛选 */
export function endOfDay(value: string | Date, timeZone: string = getAppTimeZone()): Date | null {
  const start = startOfDay(value, timeZone);
  if (!start) return null;
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}

/** 取某瞬时在指定时区的日期（`yyyy-MM-dd`） */
export function toDayString(
  value: string | Date,
  timeZone: string = getAppTimeZone()
): string | null {
  const instant = parseWallClock(value, timeZone);
  if (!instant) return null;
  return formatDateToString(instant, { timeZone })?.slice(0, 10) ?? null;
}

/**
 * 按日历天推进 `yyyy-MM-dd`（不依赖进程时区，也不受夏令时影响）。
 * 用 `Date.UTC` 做纯日期算术，规避本地时间在时区边界上的歧义。
 */
export function addDays(day: string, amount: number): string {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  const shifted = new Date(Date.UTC(y, m - 1, d + amount));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** 生成闭区间 `[from, to]` 的完整日期序列（`yyyy-MM-dd`） */
export function enumerateDays(from: string, to: string, maxDays = 3660): string[] {
  const days: string[] = [];
  let cursor = from;
  while (cursor <= to && days.length < maxDays) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

/** 按应用时区格式化时间，与响应层保持同一口径；空值返回 `null` */
export function formatDateTimeInZone(
  value: Date | null | undefined,
  timeZone: string = getAppTimeZone()
): string | null {
  if (!value) return null;
  return formatDateToString(value, { timeZone });
}
