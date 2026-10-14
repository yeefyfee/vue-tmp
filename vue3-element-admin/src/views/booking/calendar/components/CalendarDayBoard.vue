<template>
  <div class="cal-day" :style="{ '--cal-slot-h': `${slotHeight}px` }" data-testid="cal-view-day">
    <!-- 表头：资源列名 -->
    <div class="cal-day__head">
      <div class="cal-day__gutter">{{ t("booking.calendar.axisTime") }}</div>
      <div v-for="lane in lanes" :key="lane.key" class="cal-day__col-head">
        {{ lane.label }}
      </div>
    </div>

    <div class="cal-day__body" :style="{ height: `${trackHeight}px` }">
      <!-- 纵轴时段刻度（PRD：日视图纵轴 30 分钟粒度） -->
      <div class="cal-day__times">
        <div v-for="slot in slots" :key="slot" class="cal-day__time">
          <span>{{ bookingClockLabel(slot) }}</span>
        </div>
      </div>

      <!-- 横轴资源列；每列即一个「纵向时间轨」落点 -->
      <div
        v-for="lane in lanes"
        :key="lane.key"
        class="cal-day__col"
        :class="{ 'is-hover': hoverKey === lane.key }"
        data-cal-track
        data-cal-axis="y"
        :data-cal-lane="lane.key"
        :data-cal-date="lane.date"
        :data-cal-employee="lane.employeeId ?? ''"
        :data-cal-room="lane.roomId ?? ''"
      >
        <div v-for="slot in slots" :key="slot" class="cal-day__cell"></div>

        <CalendarEventCard
          v-for="booking in lane.bookings"
          :key="booking.id"
          variant="grid"
          :slot-height="slotHeight"
          :booking="booking"
          :unset="t('booking.value.unset')"
          :dragging="draggingId === booking.id"
          @dragstart="(event, item) => emit('dragstart', event, item)"
          @open="(item) => emit('open', item)"
        />

        <div
          v-if="preview && preview.laneKey === lane.key"
          class="cal-day__preview"
          :class="{ 'is-valid': preview.valid }"
          :style="previewStyle"
          data-testid="cal-preview"
        ></div>
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
import type { CalendarLane, CalendarPreview } from "./calendar-lane";

/**
 * 日视图（MVP-WEB-06-03）
 *
 * PRD《页面功能》：「日视图 —— 纵轴时段（30 分钟粒度），横轴资源」。
 * 每根资源列都是 `data-cal-axis="y"` 的落点轨道（纵向换算时间），
 * 卡片按 `utils/booking.ts::bookingGridGeometry` 绝对定位。
 */
defineOptions({ name: "CalendarDayBoard", inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    lanes: CalendarLane[];
    /** 单格高度（像素）；24 格 × 28px ≈ 672px */
    slotHeight?: number;
    /** 当前悬停轨道的 key（高亮） */
    hoverKey?: string | null;
    /** 落点预览块（冲突检测后由父页注入） */
    preview?: CalendarPreview | null;
    /** 正在拖拽的预约 id（弱化显示） */
    draggingId?: string | null;
  }>(),
  { slotHeight: 28, hoverKey: null, preview: null, draggingId: null }
);

const emit = defineEmits<{
  (e: "dragstart", event: MouseEvent, booking: BookingItem): void;
  (e: "open", booking: BookingItem): void;
}>();

const { t } = useI18n();

/** 纵轴时段刻度：`08:00` 起每 30 分钟一格，至 `20:00` 前（24 格） */
const slots = computed(() => {
  const out: number[] = [];
  const end = BOOKING_CALENDAR_END_HOUR * 60;
  for (
    let minute = BOOKING_CALENDAR_START_HOUR * 60;
    minute < end;
    minute += BOOKING_CALENDAR_SLOT_MINUTES
  ) {
    out.push(minute);
  }
  return out;
});

/** 时间轴像素总高（= 格数 × 格高） */
const trackHeight = computed(() => slots.value.length * props.slotHeight);

const previewStyle = computed<CSSProperties>(() => {
  if (!props.preview) return {};
  const offset =
    ((props.preview.minute - BOOKING_CALENDAR_START_HOUR * 60) / BOOKING_CALENDAR_TOTAL_MINUTES) *
    trackHeight.value;
  const duration = Math.max(props.preview.durationMinutes, BOOKING_CALENDAR_SLOT_MINUTES);
  const size = (duration / BOOKING_CALENDAR_TOTAL_MINUTES) * trackHeight.value;
  return {
    top: `${Math.max(0, Math.min(trackHeight.value - 18, offset))}px`,
    height: `${Math.max(18, size)}px`,
  };
});
</script>

<style lang="scss" scoped>
.cal-day {
  min-width: 640px;
}

.cal-day__head {
  position: sticky;
  top: 0;
  z-index: 4;
  display: flex;
  background: var(--el-bg-color);
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.cal-day__gutter,
.cal-day__col-head {
  flex: 1 1 0;
  padding: 6px 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-regular);
  text-align: center;
}

.cal-day__gutter {
  flex: 0 0 56px;
}

.cal-day__body {
  position: relative;
  display: flex;
}

.cal-day__times {
  flex: 0 0 56px;
}

.cal-day__time {
  box-sizing: border-box;
  height: var(--cal-slot-h);
  padding-right: 6px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  line-height: var(--cal-slot-h);
  color: var(--el-text-color-secondary);
  text-align: right;
}

.cal-day__col {
  position: relative;
  flex: 1 1 0;
  min-width: 120px;
  border-left: 1px solid var(--el-border-color-lighter);

  &.is-hover {
    background: var(--el-color-primary-light-9);
  }
}

.cal-day__cell {
  box-sizing: border-box;
  height: var(--cal-slot-h);
  border-bottom: 1px dashed var(--el-border-color-lighter);
}

.cal-day__preview {
  position: absolute;
  right: 2px;
  left: 2px;
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
