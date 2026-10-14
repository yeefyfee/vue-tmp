<template>
  <el-dropdown :hide-on-click="false" trigger="click" placement="bottom-end">
    <el-button class="page-icon-btn" :title="t('columnSetting.title')">
      <el-icon><Setting /></el-icon>
    </el-button>
    <template #dropdown>
      <div class="column-setting">
        <div class="column-setting__header">
          <span class="column-setting__title">{{ t("columnSetting.title") }}</span>
          <el-button
            text
            type="primary"
            size="small"
            :disabled="!isCustomized"
            @click="handleReset"
          >
            {{ t("columnSetting.reset") }}
          </el-button>
        </div>

        <el-scrollbar class="column-setting__body">
          <div
            v-for="(column, index) in columnStates"
            :key="column.key"
            class="column-setting__row"
          >
            <el-checkbox
              :model-value="column.visible"
              :disabled="column.fixed"
              :title="column.fixed ? t('columnSetting.fixedTip') : ''"
              @change="handleToggle(column)"
            >
              {{ column.label }}
            </el-checkbox>

            <div class="column-setting__actions">
              <el-button
                class="column-setting__action"
                text
                size="small"
                :disabled="index === 0"
                :title="t('columnSetting.moveUp')"
                @click="controller.moveUp(column.key)"
              >
                <el-icon><ArrowUp /></el-icon>
              </el-button>
              <el-button
                class="column-setting__action"
                text
                size="small"
                :disabled="index === columnStates.length - 1"
                :title="t('columnSetting.moveDown')"
                @click="controller.moveDown(column.key)"
              >
                <el-icon><ArrowDown /></el-icon>
              </el-button>
            </div>
          </div>
        </el-scrollbar>
      </div>
    </template>
  </el-dropdown>
</template>

<script setup lang="ts">
import { ElMessage } from "element-plus";
import { ArrowDown, ArrowUp, Setting } from "@element-plus/icons-vue";

import { useI18n } from "vue-i18n";
import type { TableColumnState, UseTableColumnsReturn } from "@/composables/useTableColumns";

/**
 * 列配置下拉面板（PRD《Web规范》§表格规范 第 1 条）
 *
 * 纯展示组件：列状态与持久化由 {@link useTableColumns} 统一持有，
 * 本组件只做交互转发（PRD《组件》§使用与治理 3：通用组件禁止内含业务请求逻辑）。
 */
defineOptions({
  name: "ColumnSetting",
  inheritAttrs: false,
});

const props = defineProps<{
  /** `useTableColumns` 的返回值 */
  controller: UseTableColumnsReturn;
}>();

const { t } = useI18n();

const columnStates = computed(() => props.controller.columnStates.value);
const isCustomized = computed(() => props.controller.isCustomized.value);

function handleToggle(column: TableColumnState): void {
  const ok = props.controller.toggle(column.key);
  if (!ok) {
    ElMessage.warning(column.fixed ? t("columnSetting.fixedTip") : t("columnSetting.keepOneTip"));
  }
}

function handleReset(): void {
  props.controller.reset();
  ElMessage.success(t("columnSetting.resetDone"));
}
</script>

<style lang="scss" scoped>
.column-setting {
  width: 240px;
  padding: 4px 0 8px;

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    border-bottom: 1px solid var(--el-border-color-lighter);
  }

  &__title {
    font-size: 13px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  &__body {
    max-height: 300px;
  }

  &__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;

    &:hover {
      background-color: var(--el-fill-color-light);
    }
  }

  &__actions {
    display: flex;
    gap: 2px;
    align-items: center;
  }

  &__action {
    padding: 0 4px;
    margin: 0;
  }
}
</style>
