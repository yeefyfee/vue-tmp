import { onBeforeUnmount, ref, type Ref } from "vue";

import type { BookingItem } from "@/api/booking";
import {
  BOOKING_CALENDAR_END_HOUR,
  BOOKING_CALENDAR_SLOT_MINUTES,
  BOOKING_CALENDAR_START_HOUR,
} from "@/utils/booking";

/**
 * 拖拽落点（吸附到 30 分钟粒度后的候选排期）
 *
 * 只描述**位置事实**（哪一天 / 第几分钟 / 哪个资源），不含业务判断 ——
 * 「这个位置能不能放」一律交给服务端冲突检测裁定（踩坑 126-bis：不在前端复算规则）。
 */
export interface CalendarDragSlot {
  /** 轨道 key（与 `CalendarLane.key` 一致，用于高亮 / 命中预览块） */
  laneKey: string;
  /** `yyyy-MM-dd`（轨道上声明；空串表示该视图不区分日期，由调用方补） */
  date: string;
  /** 当日分钟数（已吸附到 30 分钟，且保证 start + 30 ≤ 营业结束） */
  minute: number;
  /** 目标员工（「未指派」列为 null） */
  employeeId: string | null;
  /** 目标房间（非房间轨道为 null） */
  roomId: string | null;
}

export interface CalendarDragController {
  /** 正在拖拽的预约（null = 未在拖拽） */
  dragging: Ref<BookingItem | null>;
  /** 拖拽幽灵的视口坐标（跟随鼠标） */
  ghost: Ref<{ x: number; y: number } | null>;
  /** 当前悬停落点（用于高亮目标轨道） */
  hover: Ref<CalendarDragSlot | null>;
  /** 在卡片上 `mousedown` 时调用 */
  start: (event: MouseEvent, booking: BookingItem) => void;
  /** 主动取消（视图切换 / 卸载时） */
  cancel: () => void;
}

const DAY_START_MINUTE = BOOKING_CALENDAR_START_HOUR * 60;
const DAY_END_MINUTE = BOOKING_CALENDAR_END_HOUR * 60;
const TOTAL_MINUTES = DAY_END_MINUTE - DAY_START_MINUTE;

/**
 * 预约日历拖拽（MVP-WEB-06-03）
 *
 * 🔴 为什么用 **mousedown/mousemove/mouseup** 而不是 HTML5 `draggable` + DataTransfer：
 *  原生 DnD 在自动化环境里难以驱动（需要真实 DataTransfer 对象），而本项目所有验证
 *  都走**真实 Chromium + CDP 鼠标事件**；指针事件既能被 CDP 稳定驱动，又能天然实现
 *  PRD 要求的「**先本地预览**」（幽灵块跟随指针）。
 *
 * 落点识别：`document.elementFromPoint` 找到带 `[data-cal-track]` 的轨道元素，
 * 读它的 `data-cal-{date,employee,room,axis}` 声明 + `getBoundingClientRect()` 换算比例。
 * 时间轴方向由 `data-cal-axis` 决定（`x` = 横向轨道；`y` = 日视图的纵向资源列）。
 *
 * 🔴 本 composable **只做几何**：`onDrop` 收到的落点仍需由调用方向服务端发起
 *   冲突检测后才可能成立（PRD「落库前做冲突检测」）。
 */
export function useCalendarDrag(
  onDrop: (booking: BookingItem, slot: CalendarDragSlot | null) => void
): CalendarDragController {
  const dragging = ref<BookingItem | null>(null);
  const ghost = ref<{ x: number; y: number } | null>(null);
  const hover = ref<CalendarDragSlot | null>(null);

  /** 指针位置 → 候选落点（吸附 30 分钟；命中非轨道区域返回 null） */
  function resolveSlot(x: number, y: number): CalendarDragSlot | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const track = el?.closest<HTMLElement>("[data-cal-track]") ?? null;
    if (!track) return null;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const alongY = track.dataset.calAxis === "y";
    const ratio = alongY ? (y - rect.top) / rect.height : (x - rect.left) / rect.width;
    const clamped = Math.min(1, Math.max(0, ratio));
    const raw = DAY_START_MINUTE + clamped * TOTAL_MINUTES;
    const snapped = Math.round(raw / BOOKING_CALENDAR_SLOT_MINUTES) * BOOKING_CALENDAR_SLOT_MINUTES;
    // 末格起点保证「至少占满一格」，避免落到 20:00 这种零长度候选
    const maxStart = DAY_END_MINUTE - BOOKING_CALENDAR_SLOT_MINUTES;
    const minute = Math.min(maxStart, Math.max(DAY_START_MINUTE, snapped));

    return {
      laneKey: track.dataset.calLane ?? "",
      date: track.dataset.calDate ?? "",
      minute,
      employeeId: track.dataset.calEmployee ? track.dataset.calEmployee : null,
      roomId: track.dataset.calRoom ? track.dataset.calRoom : null,
    };
  }

  function handleMove(event: MouseEvent): void {
    if (!dragging.value) return;
    ghost.value = { x: event.clientX, y: event.clientY };
    hover.value = resolveSlot(event.clientX, event.clientY);
  }

  function handleUp(event: MouseEvent): void {
    const booking = dragging.value;
    const slot = resolveSlot(event.clientX, event.clientY);
    stop();
    if (booking) onDrop(booking, slot);
  }

  function stop(): void {
    dragging.value = null;
    ghost.value = null;
    hover.value = null;
    window.removeEventListener("mousemove", handleMove);
    window.removeEventListener("mouseup", handleUp);
    document.body.style.removeProperty("user-select");
  }

  function start(event: MouseEvent, booking: BookingItem): void {
    // 仅左键；并阻止默认的文本选中 / 原生图片拖拽
    if (event.button !== 0) return;
    event.preventDefault();
    dragging.value = booking;
    ghost.value = { x: event.clientX, y: event.clientY };
    hover.value = null;
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }

  onBeforeUnmount(stop);

  return { dragging, ghost, hover, start, cancel: stop };
}
