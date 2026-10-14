import type { BookingItem } from "@/api/booking";

/**
 * 日历「轨道」（Lane）—— 日视图的一列 / 周视图与资源视图的一行
 *
 * 组件是**纯渲染 + 拖拽几何**：`bookings` 由父页按视图规则预先分桶
 * （日视图按 `employeeId`、资源视图按 `employeeId` / `roomId`、周视图按 `bookingDate`），
 * 组件自身不做任何业务筛选 —— 保证「同一判据一个来源」。
 */
export interface CalendarLane {
  key: string;
  label: string;
  /** 该轨道绑定的日期（`yyyy-MM-dd`）；空串 = 由视图统一指定（资源视图只查当天） */
  date: string;
  /** 目标员工（「未指派」列为 null） */
  employeeId: string | null;
  /** 目标房间（非房间轨道为 null） */
  roomId: string | null;
  /** 该轨道上的预约（父页预分桶） */
  bookings: BookingItem[];
}

/** 分组（资源视图按「美容师 / 房间」分区；周视图只有一个分组） */
export interface CalendarGroup {
  key: string;
  label: string;
  lanes: CalendarLane[];
}

/** 拖拽落点预览块（由父页在冲突检测后设置；`valid` 决定观感） */
export interface CalendarPreview {
  laneKey: string;
  minute: number;
  durationMinutes: number;
  valid: boolean;
}
