<template>
  <div class="bh-editor">
    <el-alert
      class="bh-editor__hint"
      type="info"
      :closable="false"
      show-icon
      :title="t('storeConfig.hours.tip')"
    />

    <div v-for="day in WEEKDAY_OPTIONS" :key="day.key" class="bh-editor__day">
      <div class="bh-editor__day-head">
        <span class="bh-editor__day-name">{{ t(day.i18nKey) }}</span>
        <el-tag v-if="segmentsOf(day.key).length === 0" type="info" effect="plain" size="small">
          {{ t("storeConfig.hours.dayOff") }}
        </el-tag>
        <span v-else class="bh-editor__day-count">
          {{ t("storeConfig.hours.segmentCount", { count: segmentsOf(day.key).length }) }}
        </span>
      </div>

      <div class="bh-editor__day-body">
        <div
          v-for="(segment, index) in segmentsOf(day.key)"
          :key="`${day.key}-${index}`"
          class="bh-editor__segment"
          :class="{ 'is-invalid': segmentErrorKey(segment) !== null }"
        >
          <el-time-select
            class="bh-editor__time"
            :model-value="segment[0]"
            :disabled="readonly"
            :placeholder="t('storeConfig.hours.openPlaceholder')"
            :aria-label="`${t(day.i18nKey)} ${t('storeConfig.hours.openPlaceholder')}`"
            start="00:00"
            step="00:15"
            end="23:45"
            :clearable="false"
            @update:model-value="(value: string) => updateTime(day.key, index, 0, value)"
          />
          <span class="bh-editor__dash">–</span>
          <el-time-select
            class="bh-editor__time"
            :model-value="segment[1]"
            :disabled="readonly"
            :placeholder="t('storeConfig.hours.closePlaceholder')"
            :aria-label="`${t(day.i18nKey)} ${t('storeConfig.hours.closePlaceholder')}`"
            start="00:15"
            step="00:15"
            end="23:45"
            :clearable="false"
            @update:model-value="(value: string) => updateTime(day.key, index, 1, value)"
          />
          <el-button
            v-if="!readonly"
            class="bh-editor__remove"
            link
            type="danger"
            :aria-label="t('storeConfig.hours.removeSegment')"
            @click="removeSegment(day.key, index)"
          >
            <el-icon><Delete /></el-icon>
          </el-button>

          <span v-if="segmentErrorKey(segment)" class="bh-editor__error">
            {{ t(`storeConfig.hours.${segmentErrorKey(segment)}`) }}
          </span>
        </div>

        <div v-if="!readonly" class="bh-editor__day-actions">
          <el-button
            link
            type="primary"
            :disabled="segmentsOf(day.key).length >= MAX_SEGMENTS_PER_DAY"
            @click="addSegment(day.key)"
          >
            <el-icon><Plus /></el-icon>
            <span>{{ t("storeConfig.hours.addSegment") }}</span>
          </el-button>

          <el-dropdown
            v-if="segmentsOf(day.key).length > 0"
            trigger="click"
            @command="(command: string) => copyFrom(day.key, command)"
          >
            <el-button link type="primary">
              <span>{{ t("storeConfig.hours.copyMenuLabel") }}</span>
              <el-icon class="el-icon--right"><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="workdays">
                  {{ t("storeConfig.hours.copyToWorkdays") }}
                </el-dropdown-item>
                <el-dropdown-item command="all">
                  {{ t("storeConfig.hours.copyToAll") }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ArrowDown, Delete, Plus } from "@element-plus/icons-vue";
import type { BusinessHoursSegment, WeekdayKey, WeeklyBusinessHours } from "@/api/store";
import { MAX_SEGMENTS_PER_DAY, WEEKDAY_KEYS } from "@/constants";
import { WEEKDAY_OPTIONS, cloneWeeklyHours, segmentErrorKey } from "@/utils/business-hours";

/**
 * 每周营业时段编辑器（MVP-WEB-02-03）
 *
 * 受控组件：所有变更都以**不可变方式**产生新对象后 `emit("update:modelValue")`
 * 交回父组件，父组件据此做变更比对（脏检查）与地址栏同步。
 *
 * ⚠️ 组件内部另持一份 `draft`：`emit` 后父级虽同步更新了自己的 ref，但子组件的
 * `props` 要到**下一个渲染周期**才会刷新（Vue 单向数据流的固有节奏）。若直接以
 * `props.modelValue` 为基准连续编辑（例如连点两次「添加时段」、或一次动作里批量
 * 删改多天），后一次会基于陈旧快照生成新对象，把前一次的改动整体覆盖掉
 * （last-write-wins）。故内部以 draft 为唯一编辑基准，外部值仅在**确有差异**时
 * 回灌，兼顾「父级重置/重新加载能同步进来」与「连续编辑不丢改动」。
 */
const props = defineProps<{
  /** 每周营业时段（7 天键齐全） */
  modelValue: WeeklyBusinessHours;
  /** 只读模式（无 store:update 权限时） */
  readonly?: boolean;
}>();

const emit = defineEmits<{ "update:modelValue": [value: WeeklyBusinessHours] }>();

const { t } = useI18n();

const WORKDAYS: WeekdayKey[] = ["mon", "tue", "wed", "thu", "fri"];

/** 内部编辑草稿（唯一编辑基准） */
const draft = ref<WeeklyBusinessHours>(cloneWeeklyHours(props.modelValue));

watch(
  () => props.modelValue,
  (value) => {
    // 自身 emit 引发的回写与本稿一致 → 跳过，避免把连续编辑打断
    if (JSON.stringify(value) !== JSON.stringify(draft.value)) {
      draft.value = cloneWeeklyHours(value);
    }
  },
  { deep: true }
);

function segmentsOf(day: WeekdayKey): BusinessHoursSegment[] {
  return draft.value[day] ?? [];
}

function commit(next: WeeklyBusinessHours): void {
  draft.value = next;
  emit("update:modelValue", next);
}

function updateTime(day: WeekdayKey, index: number, slot: 0 | 1, value: string): void {
  const next = cloneWeeklyHours(draft.value);
  const segment = next[day][index];
  if (!segment) return;
  segment[slot] = value;
  commit(next);
}

function addSegment(day: WeekdayKey): void {
  if (segmentsOf(day).length >= MAX_SEGMENTS_PER_DAY) return;
  const next = cloneWeeklyHours(draft.value);
  next[day].push(["09:00", "18:00"]);
  commit(next);
}

function removeSegment(day: WeekdayKey, index: number): void {
  const next = cloneWeeklyHours(draft.value);
  next[day].splice(index, 1);
  commit(next);
}

/** 把某天的时段整组复制到工作日 / 每一天（源日自身跳过） */
function copyFrom(day: WeekdayKey, command: string): void {
  const source = segmentsOf(day);
  if (source.length === 0) {
    ElMessage.warning(t("storeConfig.hours.copyNoSource"));
    return;
  }
  const targets = (command === "all" ? [...WEEKDAY_KEYS] : WORKDAYS).filter((key) => key !== day);
  const next = cloneWeeklyHours(draft.value);
  for (const key of targets) {
    next[key] = source.map((segment) => [segment[0], segment[1]] as BusinessHoursSegment);
  }
  commit(next);
  ElMessage.success(
    t("storeConfig.hours.copyApplied", {
      day: t(`storeConfig.weekday.${day}`),
      count: targets.length,
    })
  );
}
</script>

<style lang="scss" scoped>
.bh-editor {
  display: flex;
  flex-direction: column;
  gap: 16px;

  &__hint {
    align-items: center;
  }

  &__day {
    display: grid;
    grid-template-columns: 96px 1fr;
    gap: 16px;
    align-items: start;
    padding: 12px 0;
    border-bottom: 1px solid var(--el-border-color-lighter);

    &:last-child {
      border-bottom: 0;
    }
  }

  &__day-head {
    display: flex;
    gap: 8px;
    align-items: center;
    min-height: 32px;
  }

  &__day-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  &__day-count {
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }

  &__day-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  &__segment {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    min-height: 32px;

    &.is-invalid {
      :deep(.el-input__wrapper) {
        box-shadow: 0 0 0 1px var(--el-color-danger) inset;
      }
    }
  }

  &__time {
    width: 132px;
  }

  &__dash {
    color: var(--el-text-color-secondary);
  }

  &__remove {
    padding: 0 4px;
  }

  &__error {
    flex-basis: 100%;
    font-size: 12px;
    line-height: 1.4;
    color: var(--el-color-danger);
  }

  &__day-actions {
    display: flex;
    gap: 16px;
    align-items: center;
  }
}
</style>
