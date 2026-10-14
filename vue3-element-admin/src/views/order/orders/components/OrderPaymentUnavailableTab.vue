<template>
  <div class="order-unavailable">
    <DataState
      variant="empty"
      :title="t('order.unavailable.title')"
      :description="t('order.unavailable.paymentsDesc')"
    />
  </div>
</template>

<script setup lang="ts">
import DataState from "@/components/DataState/DataState.vue";

/**
 * 订单详情 · 支付记录页签（MVP-WEB-07-02）
 *
 * PRD《页面功能》#订单详情 3「支付记录：Payment 流水，含支付方式、金额、状态机
 * 流转时间、操作人；退款以负向记录呈现」——依赖 **Payment 域**。
 *
 * 🔴 当前版本 `payment` **尚未建模**（`packages/db/prisma/schema.prisma` 无 Payment
 * 模型、库内无 `payment` 表）⇒ 本页签**不渲染任何占位流水或假金额**，以诚实空态
 * 说明数据源未上线（对齐 05-01 `PetUnavailableTab` 既有口径；服务器侧同样不返回
 * 空数组冒充数据源，见 `OrderService.getOrderDetail` 注释）。
 *
 * 支付状态机 / 支付方式 / 支付形态的常量已在 `@peluvida/shared` 就绪
 * （`PAYMENT_STATUS_META` / `PAYMENT_METHOD_META` / `PAYMENT_MODE_META`），
 * 待支付域建模后本页签可直接消费，无需新增映射表。
 */
defineOptions({ name: "OrderPaymentUnavailableTab", inheritAttrs: false });

const { t } = useI18n();
</script>

<style lang="scss" scoped>
.order-unavailable {
  min-height: 260px;
}
</style>
