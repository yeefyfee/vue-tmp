<template>
  <el-form class="cfg-form" label-position="top" :disabled="readonly">
    <el-alert
      class="cfg-form__hint"
      type="info"
      :closable="false"
      show-icon
      :title="t('storeConfig.config.tip')"
    />

    <el-row :gutter="16">
      <el-col :xs="24" :sm="12">
        <el-form-item>
          <template #label>
            <span class="cfg-form__label">
              {{ t("storeConfig.config.slotGranularity") }}
              <el-tag
                v-if="isDefault('slotGranularityMin')"
                size="small"
                effect="plain"
                type="info"
              >
                {{ t("storeConfig.config.defaultBadge") }}
              </el-tag>
            </span>
          </template>
          <el-select
            class="cfg-form__control"
            :model-value="draft.slotGranularityMin"
            @update:model-value="(value: number) => patch({ slotGranularityMin: value })"
          >
            <el-option
              v-for="option in SLOT_GRANULARITY_OPTIONS"
              :key="option"
              :label="`${option} ${t('storeConfig.config.unitMinute')}`"
              :value="option"
            />
          </el-select>
          <p class="cfg-form__tip">{{ t("storeConfig.config.slotGranularityTip") }}</p>
        </el-form-item>
      </el-col>

      <el-col :xs="24" :sm="12">
        <el-form-item>
          <template #label>
            <span class="cfg-form__label">
              {{ t("storeConfig.config.bookingLeadHours") }}
              <el-tag v-if="isDefault('bookingLeadHours')" size="small" effect="plain" type="info">
                {{ t("storeConfig.config.defaultBadge") }}
              </el-tag>
            </span>
          </template>
          <div class="cfg-form__inline">
            <el-input-number
              class="cfg-form__control"
              :model-value="draft.bookingLeadHours"
              :min="BOOKING_LEAD_HOURS_RANGE.min"
              :max="BOOKING_LEAD_HOURS_RANGE.max"
              :step="1"
              step-strictly
              controls-position="right"
              @update:model-value="
                (value: number | undefined) => patchNumber('bookingLeadHours', value)
              "
            />
            <span class="cfg-form__unit">{{ t("storeConfig.config.unitHour") }}</span>
          </div>
          <p class="cfg-form__tip">{{ t("storeConfig.config.bookingLeadHoursTip") }}</p>
        </el-form-item>
      </el-col>

      <el-col :xs="24" :sm="12">
        <el-form-item>
          <template #label>
            <span class="cfg-form__label">
              {{ t("storeConfig.config.cancelCutoffHours") }}
              <el-tag v-if="isDefault('cancelCutoffHours')" size="small" effect="plain" type="info">
                {{ t("storeConfig.config.defaultBadge") }}
              </el-tag>
            </span>
          </template>
          <div class="cfg-form__inline">
            <el-input-number
              class="cfg-form__control"
              :model-value="draft.cancelCutoffHours"
              :min="CANCEL_CUTOFF_HOURS_RANGE.min"
              :max="CANCEL_CUTOFF_HOURS_RANGE.max"
              :step="1"
              step-strictly
              controls-position="right"
              @update:model-value="
                (value: number | undefined) => patchNumber('cancelCutoffHours', value)
              "
            />
            <span class="cfg-form__unit">{{ t("storeConfig.config.unitHour") }}</span>
          </div>
          <p class="cfg-form__tip">{{ t("storeConfig.config.cancelCutoffHoursTip") }}</p>
        </el-form-item>
      </el-col>

      <el-col :xs="24" :sm="12">
        <el-form-item>
          <template #label>
            <span class="cfg-form__label">
              {{ t("storeConfig.config.pushEnabled") }}
              <el-tag v-if="isDefault('pushEnabled')" size="small" effect="plain" type="info">
                {{ t("storeConfig.config.defaultBadge") }}
              </el-tag>
            </span>
          </template>
          <div class="cfg-form__inline">
            <el-switch
              :model-value="draft.pushEnabled"
              :active-text="t('storeConfig.config.pushOn')"
              :inactive-text="t('storeConfig.config.pushOff')"
              @update:model-value="
                (value: string | number | boolean) => patch({ pushEnabled: Boolean(value) })
              "
            />
          </div>
          <p class="cfg-form__tip">{{ t("storeConfig.config.pushEnabledTip") }}</p>
        </el-form-item>
      </el-col>

      <el-col :xs="24" :sm="12">
        <el-form-item>
          <template #label>
            <span class="cfg-form__label">
              {{ t("storeConfig.config.boardingCheckinTime") }}
              <el-tag
                v-if="isDefault('boardingCheckinTime')"
                size="small"
                effect="plain"
                type="info"
              >
                {{ t("storeConfig.config.defaultBadge") }}
              </el-tag>
            </span>
          </template>
          <el-time-select
            class="cfg-form__control"
            :model-value="draft.boardingCheckinTime"
            start="00:00"
            step="00:30"
            end="23:30"
            :clearable="false"
            @update:model-value="(value: string) => patch({ boardingCheckinTime: value })"
          />
          <p class="cfg-form__tip">{{ t("storeConfig.config.boardingCheckinTimeTip") }}</p>
        </el-form-item>
      </el-col>

      <el-col :xs="24" :sm="12">
        <el-form-item>
          <template #label>
            <span class="cfg-form__label">
              {{ t("storeConfig.config.boardingCheckoutTime") }}
              <el-tag
                v-if="isDefault('boardingCheckoutTime')"
                size="small"
                effect="plain"
                type="info"
              >
                {{ t("storeConfig.config.defaultBadge") }}
              </el-tag>
            </span>
          </template>
          <el-time-select
            class="cfg-form__control"
            :model-value="draft.boardingCheckoutTime"
            start="00:00"
            step="00:30"
            end="23:30"
            :clearable="false"
            @update:model-value="(value: string) => patch({ boardingCheckoutTime: value })"
          />
          <p class="cfg-form__tip">{{ t("storeConfig.config.boardingCheckoutTimeTip") }}</p>
        </el-form-item>
      </el-col>
    </el-row>
  </el-form>
</template>

<script setup lang="ts">
import {
  BOOKING_LEAD_HOURS_RANGE,
  CANCEL_CUTOFF_HOURS_RANGE,
  DEFAULT_STORE_CONFIG,
  SLOT_GRANULARITY_OPTIONS,
  type StoreConfig,
  type StoreConfigKey,
} from "@peluvida/shared";

/**
 * 门店运营配置表单（MVP-WEB-02-03 · 后端 P0-04-05 · FR-4）
 *
 * 受控组件：仅 `emit` 变更后的**完整配置对象**，变更键的 diff 与提交由父级处理
 * （父级只提交发生变化的键，符合后端 PATCH 浅 merge 语义）。
 *
 * 取值范围与平台默认值均来自 `@peluvida/shared`（三端唯一常量来源），
 * 前端不重复硬编码，避免与后端校验口径漂移。
 *
 * ⚠️ 与营业时段编辑器同理：内部另持一份 `draft` 作为唯一编辑基准。`emit` 后子组件的
 * `props` 要等下个渲染周期才刷新，若直接以 `props.modelValue` 为基准连续改多个字段
 * （例如连拨开关又改粒度），后一次会基于陈旧快照覆盖前一次改动。
 */
const props = defineProps<{
  /** 当前配置（恒为完整六键，后端已把缺失/非法键回落为平台默认值） */
  modelValue: StoreConfig;
  /** 只读模式（无 store:update 权限时） */
  readonly?: boolean;
}>();

const emit = defineEmits<{ "update:modelValue": [value: StoreConfig] }>();

const { t } = useI18n();

/** 内部编辑草稿（唯一编辑基准） */
const draft = ref<StoreConfig>({ ...props.modelValue });

watch(
  () => props.modelValue,
  (value) => {
    if (JSON.stringify(value) !== JSON.stringify(draft.value)) {
      draft.value = { ...value };
    }
  },
  { deep: true }
);

function patch(partial: Partial<StoreConfig>): void {
  const next = { ...draft.value, ...partial };
  draft.value = next;
  emit("update:modelValue", next);
}

/** el-input-number 清空时回传 undefined：忽略之，避免把配置写成非法值 */
function patchNumber(
  key: "bookingLeadHours" | "cancelCutoffHours",
  value: number | undefined
): void {
  if (typeof value !== "number" || Number.isNaN(value)) return;
  patch({ [key]: value } as Partial<StoreConfig>);
}

/** 当前值是否等于平台默认值（用于展示「平台默认」徽标） */
function isDefault(key: StoreConfigKey): boolean {
  const current = draft.value as unknown as Record<string, unknown>;
  const fallback = DEFAULT_STORE_CONFIG as unknown as Record<string, unknown>;
  return current[key] === fallback[key];
}
</script>

<style lang="scss" scoped>
.cfg-form {
  &__hint {
    margin-bottom: 16px;
  }

  &__label {
    display: inline-flex;
    gap: 6px;
    align-items: center;
  }

  &__control {
    width: 100%;
  }

  &__inline {
    display: flex;
    gap: 8px;
    align-items: center;
    width: 100%;

    .cfg-form__control {
      flex: 1;
      min-width: 0;
    }
  }

  &__unit {
    flex-shrink: 0;
    font-size: 13px;
    color: var(--el-text-color-secondary);
  }

  &__tip {
    margin: 4px 0 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--el-text-color-secondary);
  }
}
</style>
