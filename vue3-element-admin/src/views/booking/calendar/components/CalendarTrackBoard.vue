<template>
  <div class="cal-track" data-testid="cal-view-track">
    <div v-for="group in groups" :key="group.key" class="cal-track__group">
      <div class="cal-track__group-title">{{ group.label }}</div>

      <div v-for="lane in group.lanes" :key="lane.key" class="cal-track__row">
        <div class="cal-track__label">{{ lane.label }}</div>

        <!-- 横向时间轨：`data-cal-axis="x"` ⇒ 由 X 偏移换算当日分钟 -->
        <div
          class="cal-track__lane"
          :class="{ 'is-hover': hoverKey === lane.key }"
          data-cal-track
          data-cal-axis="x"
          :data-cal-lane="lane.key"
          :data-cal-date="lane.date"
          :data-cal-employee="lane.employeeId ?? ''"
          :data-cal-room="lane.roomId ?? ''"
        >
          <div
            v-for="slot in slotTicks"
            :key="slot"
            class="cal-track__tick"
            :style="{ left: `${tickLeft(slot)}%` }"
          >
            <span>{{ bookingClockLabel(slot) }}</span>
          </div>

          <CalendarEventCard
            v-for="booking in lane.bookings"
            :key="booking.id"
            variant="track"
            :booking="booking"
            :unset="t('booking.value.unset')"
            :dragging="draggingId === booking.id"
            @dragstart="(event, item) => emit('dragstart', event, item)"
            @open="(item) => emit('open', item)"
          />

          <div
            v-if="preview && preview.laneKey === lane.key"
            class="cal-track__preview"
            :class="{ 'is-valid': preview.valid }"
            :style="previewStyle"
            data-testid="cal-preview"
          ></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, type CSSProperties } from "vue";

import type { BookingItem } from "@/api/booking";
import {
  BOOKING_CALENDAR_END_HOUR,
  BOOKING_CALENDAR_SLOT_MINUTES,
  BOOKING_CALENDAR_START_HOUR,
  BOOKING_CALENDAR_TOTAL_MINUTES,
  bookingClockLabel,
} from "@/utils/booking";
import CalendarEventCard from "./CalendarEventCard.vue";
import type { CalendarGroup, CalendarPreview } from "./calendar-lane";

/**
 * 横向时间轨看板（MVP-WEB-06-03）—— 周视图与资源视图共用
 *
 *  - **周视图**：一个分组、7 根日期轨道（纵轴日期 × 横轴时段概览）；
 *  - **资源视图**：两个分组（美容师 / 房间），每根轨道 = 一个资源
 *    （PRD《页面功能》「资源视图 —— 按美容师、房间分组展示」）。
 *
 * 结构（分组 → 行 → 时间轨）由父页组装（`CalendarGroup[]`），组件只做渲染与拖拽几何。
 */
defineOptions({ name: "CalendarTrackBoard", inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    groups: CalendarGroup[];
    hoverKey?: string | null;
    preview?: CalendarPreview | null;
    draggingId?: string | null;
  }>(),
  { hoverKey: null, preview: null, draggingId: null }
);

const emit = defineEmits<{
  (e: "dragstart", event: MouseEvent, booking: BookingItem): void;
  (e: "open", booking: BookingItem): void;
}>();

const { t } = useI18n();

/** 刻度：整点（08:00 ~ 19:00），用于轨道底纹与时刻标注 */
const slotTicks = computed(() => {
  const out: number[] = [];
  for (
    let minute = BOOKING_CALENDAR_START_HOUR * 60;
    minute < BOOKING_CALENDAR_END_HOUR * 60;
    minute += 60
  ) {
    out.push(minute);
  }
  return out;
});

/** 刻度在轨道上的水平百分比位置 */
function tickLeft(minute: number): number {
  return ((minute - BOOKING_CALENDAR_START_HOUR * 60) / BOOKING_CALENDAR_TOTAL_MINUTES) * 100;
}

const previewStyle = computed<CSSProperties>(() => {
  if (!props.preview) return {};
  const left =
    ((props.preview.minute - BOOKING_CALENDAR_START_HOUR * 60) / BOOKING_CALENDAR_TOTAL_MINUTES) *
    100;
  const duration = Math.max(props.preview.durationMinutes, BOOKING_CALENDAR_SLOT_MINUTES);
  const width = (duration / BOOKING_CALENDAR_TOTAL_MINUTES) * 100;
  return {
    left: `${Math.max(0, Math.min(100, left))}%`,
    width: `${Math.max(1, Math.min(100 - Math.max(0, left), width))}%`,
  };
});
</script>

<style lang="scss" scoped>
.cal-track {
  min-width: 720px;
}

.cal-track__group + .cal-track__group {
  margin-top: 14px;
}

.cal-track__group-title {
  padding: 4px 0;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-regular);
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.cal-track__row {
  display: flex;
  gap: 8px;
  align-items: stretch;
  margin-bottom: 6px;
}

.cal-track__label {
  flex: 0 0 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  line-height: 44px;
  color: var(--el-text-color-regular);
  white-space: nowrap;
}

.cal-track__lane {
  position: relative;
  flex: 1 1 auto;
  min-width: 320px;
  height: 44px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;

  &.is-hover {
    background: var(--el-color-primary-light-9);
  }
}

.cal-track__tick {
  position: absolute;
  top: 0;
  bottom: 0;
  border-left: 1px dashed var(--el-border-color-lighter);

  span {
    padding-left: 3px;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    color: var(--el-text-color-placeholder);
  }
}

.cal-track__preview {
  position: absolute;
  top: 2px;
  bottom: 2px;
  pointer-events: none;
  background: rgb(220 38 38 / 8%);
  border: 2px dashed var(--peluvida-color-danger);
  border-radius: 4px;

  &.is-valid {
    background: rgb(22 163 74 / 10%);
    border-color: var(--peluvida-color-success);
  }
}
</style>
