<template>
  <div class="month-cal">
    <!-- 表头：周一为首列，与营业时间页的星期语义对齐 -->
    <div class="month-cal__head">
      <span v-for="key in CALENDAR_WEEKDAY_KEYS" :key="key" class="month-cal__head-cell">
        {{ t(`storeCalendar.weekday.${key}`) }}
      </span>
    </div>

    <div class="month-cal__body">
      <button
        v-for="cell in cells"
        :key="cell.date"
        type="button"
        class="month-cal__cell"
        :data-date="cell.date"
        :class="{
          'is-outside': !cell.inMonth,
          'is-today': cell.date === today,
          'is-selected': cell.date === selectedDate,
          'is-exception': !!entryByDate[cell.date],
          'is-closed': !display(cell).open,
        }"
        :aria-label="`${cell.date} ${t(display(cell).statusKey)}`"
        :aria-pressed="cell.date === selectedDate"
        @click="emit('select', cell.date)"
      >
        <span class="month-cal__day">{{ dayNumber(cell.date) }}</span>
        <span class="month-cal__status" :class="`is-${display(cell).tagType}`">
          {{ t(display(cell).statusKey) }}
        </span>
        <span v-if="display(cell).open" class="month-cal__periods">
          {{ periodsSummary(viewByDate[cell.date]?.periods) }}
        </span>
        <span v-else class="month-cal__periods is-empty">
          {{ t("storeCalendar.status.noPeriods") }}
        </span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CalendarViewDay, StoreCalendarEntry } from "@/api/store";
import {
  CALENDAR_WEEKDAY_KEYS,
  periodsSummary,
  resolveDayDisplay,
  todayLocalDate,
  type MonthGridCell,
} from "@/utils/store-calendar";

/**
 * 月历网格（MVP-WEB-02-04）
 *
 * **纯展示组件**：不请求接口、不持有业务状态 —— 网格单元（含前后补位）、
 * 逐日视图与例外日映射全部由页面传入，故可在真机断言里用属性快照校验。
 *
 * 每格展示三行：日号 / 营业状态徽标 / 时段摘要；例外日额外加边框强调。
 */
defineOptions({ name: "MonthCalendar" });

const props = defineProps<{
  /** 月历单元（`buildMonthGrid(month)` 的产物，长度恒为 7 的整数倍） */
  cells: MonthGridCell[];
  /** 日期 → 逐日视图条目 */
  viewByDate: Record<string, CalendarViewDay>;
  /** 日期 → 例外日（用于例外强调与「例外」标记） */
  entryByDate: Record<string, StoreCalendarEntry>;
  /** 当前选中日期（`yyyy-MM-dd`） */
  selectedDate: string;
}>();

const emit = defineEmits<{ select: [date: string] }>();

const { t } = useI18n();

/** 今天（仅作视觉标记） */
const today = todayLocalDate();

/** 日号（去掉前导 0，符合日历阅读习惯） */
function dayNumber(date: string): string {
  return String(Number(date.slice(8, 10)));
}

/** 单格展示态（营业状态 / 来源 / 标签色） */
function display(cell: MonthGridCell) {
  return resolveDayDisplay(props.viewByDate[cell.date]);
}
</script>

<style lang="scss" scoped>
.month-cal {
  &__head {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--el-border-color-lighter);
  }

  &__head-cell {
    font-size: 13px;
    font-weight: 600;
    color: var(--el-text-color-secondary);
    text-align: center;
  }

  &__body {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 8px;
    padding-top: 8px;
  }

  &__cell {
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: flex-start;
    min-height: 84px;
    padding: 8px;
    font: inherit;
    color: var(--el-text-color-primary);
    text-align: left;
    cursor: pointer;
    background: var(--el-bg-color);
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 6px;
    transition:
      border-color 0.15s ease,
      background-color 0.15s ease;

    &:hover {
      border-color: var(--el-color-primary-light-5);
    }

    &:focus-visible {
      outline: 2px solid var(--el-color-primary);
      outline-offset: 1px;
    }

    &.is-outside {
      color: var(--el-text-color-placeholder);
      background: var(--el-fill-color-lighter);
    }

    &.is-today .month-cal__day {
      font-weight: 700;
      color: var(--el-color-primary);
    }

    &.is-selected {
      border-color: var(--el-color-primary);
      box-shadow: 0 0 0 1px var(--el-color-primary) inset;
    }

    // 例外日：用左侧色条强调「这一天被日历例外覆盖」
    &.is-exception {
      border-left-color: var(--el-color-warning);
      border-left-width: 3px;
    }
  }

  &__day {
    font-size: 14px;
    font-variant-numeric: tabular-nums;
  }

  &__status {
    padding: 0 6px;
    font-size: 12px;
    line-height: 18px;
    border-radius: 3px;

    &.is-success {
      color: var(--el-color-success);
      background: var(--el-color-success-light-9);
    }

    &.is-danger {
      color: var(--el-color-danger);
      background: var(--el-color-danger-light-9);
    }

    &.is-warning {
      color: var(--el-color-warning);
      background: var(--el-color-warning-light-9);
    }

    &.is-info {
      color: var(--el-text-color-secondary);
      background: var(--el-fill-color-light);
    }
  }

  &__periods {
    font-size: 12px;
    color: var(--el-text-color-secondary);
    word-break: break-all;

    &.is-empty {
      color: var(--el-text-color-placeholder);
    }
  }
}

// 窄屏：星期表头与网格仍保持 7 列，但压缩单元高度与字号（PRD《Web规范》§断点）
@media (max-width: 1023px) {
  .month-cal {
    &__cell {
      min-height: 68px;
      padding: 6px;
    }

    &__periods {
      display: none;
    }
  }
}
</style>
