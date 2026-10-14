<template>
  <div
    class="cal-card"
    :class="[
      `is-${tone}`,
      `is-${variant}`,
      { 'is-dragging': dragging, 'is-no-drag': booking.status !== 'confirmed' },
    ]"
    :style="cardStyle"
    :data-testid="`cal-card-${booking.id}`"
    :data-booking-no="booking.bookingNo"
    :data-booking-status="booking.status"
    @mousedown="handleMouseDown"
    @click="emit('open', booking)"
  >
    <div class="cal-card__row">
      <span class="cal-card__time">{{ timeText }}</span>
      <!-- PRD《页面功能》预约日历：「卡片右上角显示宠物名与头像」 -->
      <span class="cal-card__pet">
        <span class="cal-card__pet-name">{{ booking.petName || unset }}</span>
        <el-avatar class="cal-card__avatar" :size="18" :src="avatarUrl">
          {{ petInitial }}
        </el-avatar>
      </span>
    </div>

    <div class="cal-card__service">{{ booking.serviceName || "-" }}</div>

    <div v-if="variant === 'grid'" class="cal-card__meta">
      <span v-if="booking.employeeName" class="cal-card__meta-item">
        {{ booking.employeeName }}
      </span>
      <span v-if="booking.roomLabel" class="cal-card__meta-item">{{ booking.roomLabel }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, type CSSProperties } from "vue";

import type { BookingItem } from "@/api/booking";
import {
  bookingCalendarTone,
  bookingClockLabel,
  bookingGridGeometry,
  bookingMinuteOfDay,
  bookingTrackGeometry,
} from "@/utils/booking";

/**
 * 预约日历 · 事件卡片（MVP-WEB-06-03）
 *
 * 状态 → 卡片配色的**唯一来源**是 `utils/booking.ts::bookingCalendarTone`
 * （PRD《页面功能》预约日历为卡片指定的专用配色：pending 灰 / confirmed 蓝 /
 * in_service 绿 / completed 深灰 / no_show 红），本组件只做渲染。
 *
 * 定位方式：`grid` 变体走**纵向时间网格**（top/height 像素，日视图），
 * `track` 变体走**横向时间轨**（left/width 百分比，周 / 资源视图）；
 * 两者都由 `utils/booking.ts` 的几何函数给出（超出营业时段自动裁剪）。
 */
defineOptions({ name: "CalendarEventCard", inheritAttrs: false });

const props = defineProps<{
  booking: BookingItem;
  /** `grid` = 日视图纵向网格；`track` = 周 / 资源视图横向轨道 */
  variant: "grid" | "track";
  /** 纵向网格的单格高度（像素；仅 `grid` 变体使用） */
  slotHeight?: number;
  /** 是否正在被拖拽（降低不透明度以示「正在搬运」） */
  dragging?: boolean;
  /** 「未指定」兜底文案（i18n 由父页注入，组件不持有语言上下文） */
  unset: string;
}>();

const emit = defineEmits<{
  (e: "dragstart", event: MouseEvent, booking: BookingItem): void;
  (e: "open", booking: BookingItem): void;
}>();

const tone = computed(() => bookingCalendarTone(props.booking.status));

const cardStyle = computed<CSSProperties>(() => {
  if (props.variant === "grid") {
    const geometry = bookingGridGeometry(
      props.booking.startTime,
      props.booking.endTime,
      props.slotHeight ?? 28
    );
    return {
      top: `${geometry.top}px`,
      height: `${Math.max(geometry.height, 18)}px`,
    };
  }
  const geometry = bookingTrackGeometry(props.booking.startTime, props.booking.endTime);
  return {
    left: `${geometry.left}%`,
    width: `calc(${geometry.width}% - 2px)`,
  };
});

/** `HH:mm - HH:mm`（按字符串分量取，不构造 Date） */
const timeText = computed(() => {
  const start = bookingMinuteOfDay(props.booking.startTime);
  const end = bookingMinuteOfDay(props.booking.endTime);
  if (start === null || end === null) return "";
  return `${bookingClockLabel(start)}-${bookingClockLabel(end)}`;
});

const avatarUrl = computed(() => props.booking.petPhotoUrl || undefined);

/** 无头像时的首字兜底（宠物名首字符；无名字用 `?`） */
const petInitial = computed(() => (props.booking.petName || "?").slice(0, 1));

function handleMouseDown(event: MouseEvent): void {
  if (props.booking.status !== "confirmed") return;
  emit("dragstart", event, props.booking);
}
</script>

<style lang="scss" scoped>
.cal-card {
  position: absolute;
  box-sizing: border-box;
  padding: 2px 6px;
  overflow: hidden;
  font-size: 12px;
  line-height: 1.35;
  cursor: grab;
  border-left: 3px solid transparent;
  border-radius: 4px;
  transition: box-shadow 0.15s ease;

  // 状态配色（PRD《页面功能》预约日历卡片调色板）——档位由 utils 派生，此处只映射到色值
  &.is-gray {
    background: #f3f4f6;
    border-left-color: var(--peluvida-color-neutral);
  }
  &.is-blue {
    background: #dbeafe;
    border-left-color: var(--peluvida-color-info);
  }
  &.is-green {
    background: #dcfce7;
    border-left-color: var(--peluvida-color-success);
  }
  &.is-dark {
    background: #e5e7eb;
    border-left-color: #4b5563;
  }
  &.is-red {
    background: #fee2e2;
    border-left-color: var(--peluvida-color-danger);
  }
  &.is-muted {
    background: #f9fafb;
    border-left-color: #d1d5db;
    opacity: 0.65;
  }

  &.is-track {
    top: 3px;
    bottom: 3px;
    height: auto;
  }

  &.is-dragging {
    opacity: 0.4;
  }

  &.is-no-drag {
    cursor: default;
  }

  &:hover {
    z-index: 3;
    box-shadow: 0 2px 8px rgb(0 0 0 / 18%);
  }
}

.cal-card__row {
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: space-between;
}

.cal-card__time {
  font-variant-numeric: tabular-nums;
  color: var(--el-text-color-regular);
}

.cal-card__pet {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  overflow: hidden;
  white-space: nowrap;
}

.cal-card__pet-name {
  max-width: 72px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.cal-card__avatar {
  flex: none;
  font-size: 11px;
}

.cal-card__service {
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--el-text-color-primary);
  white-space: nowrap;
}

.cal-card__meta {
  display: flex;
  gap: 6px;
  overflow: hidden;
  white-space: nowrap;
}

.cal-card__meta-item {
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--el-text-color-secondary);
}
</style>
