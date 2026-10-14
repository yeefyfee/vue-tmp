<template>
  <div class="data-state">
    <el-icon class="data-state__icon"><component :is="iconComponent" /></el-icon>
    <p class="data-state__title">{{ title }}</p>
    <p v-if="description" class="data-state__desc">{{ description }}</p>
    <div v-if="actionText" class="data-state__action">
      <el-button v-if="actionType === 'primary'" type="primary" @click="emit('action')">
        {{ actionText }}
      </el-button>
      <el-button v-else @click="emit('action')">{{ actionText }}</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Box, DocumentDelete, WarningFilled } from "@element-plus/icons-vue";

/**
 * 空态 / 错误态标准组件（PRD《Web规范》§空态/加载/错误态 +《组件》§空态与反馈组件）
 *
 * 两种空态由调用方通过 `variant` 区分（PRD 要求必须区分，不给歧义空页面）：
 *  · `empty`   从未有数据 —— 展示介绍文案 + 新建按钮；
 *  · `filtered` 筛选无结果 —— 展示「清除筛选」按钮；
 *  · `error`   错误态 —— 展示可读原因 + 「重试」按钮。
 *
 * 组件只做展示，动作由调用方处理（不内含业务逻辑）。
 */
defineOptions({ name: "DataState", inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    /** 状态类型 */
    variant?: "empty" | "filtered" | "error";
    /** 主标题 */
    title: string;
    /** 补充说明（可读原因 / 引导） */
    description?: string;
    /** 行动按钮文案（为空则不渲染按钮） */
    actionText?: string;
    /** 行动按钮类型 */
    actionType?: "primary" | "default";
  }>(),
  {
    variant: "empty",
    description: "",
    actionText: "",
    actionType: "primary",
  }
);

const emit = defineEmits<{ action: [] }>();

const iconComponent = computed(() => {
  if (props.variant === "error") return WarningFilled;
  if (props.variant === "filtered") return DocumentDelete;
  return Box;
});
</script>

<style lang="scss" scoped>
.data-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 220px;
  padding: 32px 16px;
  text-align: center;

  &__icon {
    font-size: 40px;
    color: var(--el-text-color-placeholder);
  }

  &__title {
    margin: 12px 0 0;
    font-size: 14px;
    font-weight: 500;
    color: var(--el-text-color-regular);
  }

  &__desc {
    margin: 6px 0 0;
    font-size: 12px;
    line-height: 1.6;
    color: var(--el-text-color-secondary);
  }

  &__action {
    margin-top: 16px;
  }
}
</style>
