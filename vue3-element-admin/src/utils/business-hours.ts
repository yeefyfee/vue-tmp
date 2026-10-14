/**
 * 每周营业时段的纯函数工具（MVP-WEB-02-03）
 *
 * 与后端 `niulai-nest/src/store/business-hours.service.ts` 的
 * `assertValidWeekly` / `buildEmptyWeeklyTemplate` / `normalizeWeekly` 保持同口径：
 *  - `businessHours` 必须是**恰好 7 个天键**的普通对象（白名单收敛，多余键拒绝）；
 *  - 每天是数组且最多 `MAX_SEGMENTS_PER_DAY` 段；
 *  - 每段是 `[open, close]` 二元组，均为 `HH:mm` 且 `close > open`（不允许跨天/相等）。
 *
 * 前端先于提交跑同一套校验，是为了落实 PRD《交互规范》「权限/状态不足时禁用入口，
 * 而非提交后再报错」——非法时直接禁用保存按钮并就地提示，而不是等后端回 `A0436`。
 */

import { WALL_CLOCK_TIME_PATTERN } from "@peluvida/shared";
import { MAX_SEGMENTS_PER_DAY, WEEKDAY_KEYS } from "@/constants";
import type { BusinessHoursSegment, WeekdayKey, WeeklyBusinessHours } from "@/api/store";

/** 段内校验失败原因（供 i18n 键后缀拼接，`null` 表示合法） */
export type SegmentErrorKey = "errorTimeRequired" | "errorEndBeforeStart" | null;

/** `"HH:mm"` → 当日分钟数（调用方须保证已通过格式校验） */
export function toMinutes(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

/** 7 天键齐全的空模板（与后端 `buildEmptyWeeklyTemplate` 同形） */
export function buildEmptyWeeklyHours(): WeeklyBusinessHours {
  return {
    mon: [],
    tue: [],
    wed: [],
    thu: [],
    fri: [],
    sat: [],
    sun: [],
  };
}

/**
 * 规整为「7 天键齐全」的模板形态（读取口径从容）
 *
 * 缺失键补空数组；非数组值（脏数据）同样回落空数组——与后端 `normalizeWeekly` 一致。
 */
export function normalizeWeeklyHours(raw: unknown): WeeklyBusinessHours {
  const normalized = buildEmptyWeeklyHours();
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return normalized;
  }
  const source = raw as Record<string, unknown>;
  for (const day of WEEKDAY_KEYS) {
    const value = source[day];
    if (Array.isArray(value)) {
      normalized[day] = value
        .filter(
          (seg): seg is [string, string] =>
            Array.isArray(seg) && seg.length === 2 && seg.every((item) => typeof item === "string")
        )
        .map((seg) => [seg[0], seg[1]] as BusinessHoursSegment);
    }
  }
  return normalized;
}

/** 深拷贝（避免就地改 props，使父组件的变更比对恒能命中） */
export function cloneWeeklyHours(source: WeeklyBusinessHours): WeeklyBusinessHours {
  const cloned = {} as WeeklyBusinessHours;
  for (const day of WEEKDAY_KEYS) {
    cloned[day] = (source[day] ?? []).map((seg) => [seg[0], seg[1]] as BusinessHoursSegment);
  }
  return cloned;
}

/** 单个时段的合法性（返回 i18n 键后缀；`null` 表示合法） */
export function segmentErrorKey(segment: BusinessHoursSegment): SegmentErrorKey {
  const [open, close] = segment;
  if (!WALL_CLOCK_TIME_PATTERN.test(open ?? "") || !WALL_CLOCK_TIME_PATTERN.test(close ?? "")) {
    return "errorTimeRequired";
  }
  return toMinutes(close) <= toMinutes(open) ? "errorEndBeforeStart" : null;
}

/** 是否存在非法时段（保存按钮禁用依据） */
export function hasInvalidSegment(hours: WeeklyBusinessHours): boolean {
  return WEEKDAY_KEYS.some((day) =>
    (hours[day] ?? []).some((seg) => segmentErrorKey(seg) !== null)
  );
}

/** 统计非法时段数量（用于「N 处待修正」提示） */
export function countInvalidSegments(hours: WeeklyBusinessHours): number {
  let count = 0;
  for (const day of WEEKDAY_KEYS) {
    for (const seg of hours[day] ?? []) {
      if (segmentErrorKey(seg) !== null) count += 1;
    }
  }
  return count;
}

/** 是否为可提交的合法形态（键集合若被外部改坏也能兜住） */
export function isValidWeeklyHours(hours: WeeklyBusinessHours): boolean {
  return !hasInvalidSegment(hours);
}

/** 供 UI 遍历的天键位（含 i18n 键名，避免模板里二次拼接） */
export const WEEKDAY_OPTIONS = WEEKDAY_KEYS.map((key) => ({
  key: key as WeekdayKey,
  i18nKey: `storeConfig.weekday.${key}`,
}));

export { MAX_SEGMENTS_PER_DAY, WEEKDAY_KEYS };
