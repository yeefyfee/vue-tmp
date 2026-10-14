<template>
  <div class="pet-unavailable">
    <DataState
      variant="empty"
      :title="t('pet.unavailable.title')"
      :description="t(descriptionKey)"
    />
  </div>
</template>

<script setup lang="ts">
import DataState from "@/components/DataState/DataState.vue";

/**
 * 宠物档案 · 未上线数据源页签（MVP-WEB-05-01）
 *
 * 服务历史（`services`）依赖预约 / 寄养域（Booking / Stay），消费记录（`consumption`）
 * 依赖订单 / 支付域（Order / Payment）—— 两者在当前版本**尚未建模**。
 *
 * 按 PRD《Web规范》§权限与视图 1「无数据源 / 无权限字段直接不渲染」：本页签
 * **不渲染任何占位数值或假记录**，而是以诚实空态说明数据源未上线，并指向前置依赖。
 */
defineOptions({ name: "PetUnavailableTab", inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    /** `services` 服务历史 / `consumption` 消费记录 */
    variant?: "services" | "consumption";
  }>(),
  { variant: "services" }
);

const { t } = useI18n();

const descriptionKey = computed(() =>
  props.variant === "consumption"
    ? "pet.unavailable.consumptionDesc"
    : "pet.unavailable.servicesDesc"
);
</script>

<style lang="scss" scoped>
.pet-unavailable {
  min-height: 260px;
}
</style>
