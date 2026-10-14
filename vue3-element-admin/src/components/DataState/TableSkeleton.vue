<template>
  <div class="data-skeleton" aria-busy="true" :aria-label="t('dataState.loading')">
    <div class="data-skeleton__row data-skeleton__row--head">
      <span v-for="col in columnCount" :key="`h-${col}`" class="data-skeleton__cell" />
    </div>
    <div v-for="row in rowCount" :key="`r-${row}`" class="data-skeleton__row">
      <span v-for="col in columnCount" :key="`r-${row}-${col}`" class="data-skeleton__cell" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

/**
 * 列表骨架屏（PRD《交互规范》§加载与骨架屏 第 1 条）
 *
 * 「骨架屏形状必须与真实内容结构一致（列表为行骨架、卡片为卡骨架），
 * 禁止以统一转圈替代。」—— 故本组件按「列数 × 行数」绘制行骨架，
 * 与调用方表格的列数对齐。
 */
defineOptions({ name: "TableSkeleton", inheritAttrs: false });

withDefaults(
  defineProps<{
    /** 骨架列数（建议与真实可见列数一致） */
    columnCount?: number;
    /** 骨架行数 */
    rowCount?: number;
  }>(),
  {
    columnCount: 6,
    rowCount: 8,
  }
);

const { t } = useI18n();
</script>

<style lang="scss" scoped>
.data-skeleton {
  display: flex;
  flex-direction: column;
  padding: 0 12px;

  &__row {
    display: grid;
    grid-auto-columns: minmax(0, 1fr);
    grid-auto-flow: column;
    gap: 16px;
    align-items: center;
    height: 46px;
    border-bottom: 1px solid var(--el-table-border-color, var(--el-border-color-extra-light));

    &--head {
      height: 44px;
      background: var(--el-table-header-bg-color, transparent);
    }
  }

  &__cell {
    display: block;
    height: 12px;
    background: linear-gradient(
      90deg,
      var(--el-fill-color) 25%,
      var(--el-fill-color-light) 37%,
      var(--el-fill-color) 63%
    );
    background-size: 400% 100%;
    border-radius: 4px;
    animation: data-skeleton-loading 1.4s ease infinite;
  }
}

@keyframes data-skeleton-loading {
  0% {
    background-position: 100% 50%;
  }

  100% {
    background-position: 0 50%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .data-skeleton__cell {
    animation: none;
  }
}
</style>
