<template>
  <div class="order-tab">
    <!-- ── 对象卡：客户 + 宠物（均可跳档案）────────────────────────────── -->
    <div class="order-tab__cards">
      <button
        type="button"
        class="order-tab__card"
        data-testid="order-overview-customer"
        @click="emit('open-customer')"
      >
        <el-icon class="order-tab__card-icon"><User /></el-icon>
        <span class="order-tab__card-body">
          <span class="order-tab__card-label">{{ t("order.field.customer") }}</span>
          <span class="order-tab__card-value">
            {{ displayText(order.customerName) }}
          </span>
        </span>
        <el-icon class="order-tab__card-arrow"><ArrowRight /></el-icon>
      </button>

      <button
        type="button"
        class="order-tab__card"
        data-testid="order-overview-pet"
        @click="emit('open-pet')"
      >
        <el-icon class="order-tab__card-icon"><Star /></el-icon>
        <span class="order-tab__card-body">
          <span class="order-tab__card-label">{{ t("order.field.pet") }}</span>
          <span class="order-tab__card-value">{{ displayText(order.petName) }}</span>
        </span>
        <el-icon class="order-tab__card-arrow"><ArrowRight /></el-icon>
      </button>
    </div>

    <!-- ── 订单信息 ─────────────────────────────────────────────────── -->
    <div class="order-tab__section">
      <div class="order-tab__section-head">
        <span class="order-tab__section-title">{{ t("order.detail.sectionInfo") }}</span>
      </div>

      <el-descriptions :column="2" border size="small">
        <el-descriptions-item :label="t('order.field.orderNo')">
          <span data-testid="order-overview-no">{{ order.orderNo }}</span>
        </el-descriptions-item>
        <el-descriptions-item :label="t('order.field.status')">
          <el-tag :type="orderStatusTagType(order.status)" size="small">
            {{ t(orderStatusLabelKey(order.status)) }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item :label="t('order.field.store')">
          {{ displayText(order.storeName) }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('order.field.createdAt')">
          {{ formatTime(order.createdAt) }}
        </el-descriptions-item>
        <!-- 来源预约：`sourceBookingId` 非空时服务端回查单号；无关联则如实显示「未关联」
             （预约详情页为 480px 抽屉、无独立路由 ⇒ 本期不做跳转，记为边界） -->
        <el-descriptions-item :label="t('order.field.sourceBooking')">
          {{ order.sourceBookingNo || t("order.value.noSourceBooking") }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('order.field.creditFlag')">
          {{ order.creditFlag ? t("order.value.creditYes") : t("order.value.creditNo") }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('order.field.remark')" :span="2">
          {{ order.remark || t("order.value.unset") }}
        </el-descriptions-item>
      </el-descriptions>
    </div>

    <!-- ── 金额合计（分 → 元统一走 utils/order.orderAmountLabel）────────── -->
    <div class="order-tab__section">
      <div class="order-tab__section-head">
        <span class="order-tab__section-title">{{ t("order.detail.sectionAmount") }}</span>
      </div>

      <el-descriptions :column="3" border size="small" class="order-tab__amount">
        <el-descriptions-item :label="t('order.field.totalAmount')">
          <span data-testid="order-overview-total">{{ orderAmountLabel(order.totalAmount) }}</span>
        </el-descriptions-item>
        <el-descriptions-item :label="t('order.field.discountAmount')">
          <span data-testid="order-overview-discount">
            {{ orderAmountLabel(order.discountAmount) }}
          </span>
        </el-descriptions-item>
        <el-descriptions-item :label="t('order.field.payableAmount')">
          <span class="order-tab__payable" data-testid="order-overview-payable">
            {{ orderAmountLabel(order.payableAmount) }}
          </span>
        </el-descriptions-item>
      </el-descriptions>
    </div>

    <!-- ── 服务项摘要（取自同一载荷的 items，不额外请求）─────────────────── -->
    <div class="order-tab__section">
      <div class="order-tab__section-head">
        <span class="order-tab__section-title">{{ t("order.detail.sectionItems") }}</span>
        <span class="order-tab__section-extra" data-testid="order-overview-items-count">
          {{ t("order.detail.itemsCount", { count: items.length }) }}
        </span>
      </div>

      <div v-if="items.length > 0" class="order-tab__summary" data-testid="order-overview-summary">
        <el-tag
          v-for="item in items"
          :key="item.id"
          :type="orderItemTypeTagType(item.itemType)"
          effect="plain"
          size="small"
        >
          {{ item.itemName }} ×{{ item.quantity }}
        </el-tag>
      </div>
      <p v-else class="order-tab__empty-hint" data-testid="order-overview-summary-empty">
        {{ t("order.detail.itemsEmpty") }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ArrowRight, Star, User } from "@element-plus/icons-vue";

import type { OrderDetail, OrderDetailItem } from "@/api/order";
import { formatTableDateTime } from "@/utils/format";
import {
  orderAmountLabel,
  orderItemTypeTagType,
  orderStatusLabelKey,
  orderStatusTagType,
} from "@/utils/order";

/**
 * 订单详情 · 概览页签（MVP-WEB-07-02）
 *
 * PRD《页面功能》#订单详情 1「概览：订单号、状态徽章、客户与宠物卡片（可跳档案）、
 * 服务项摘要、金额合计、下单渠道」。
 *
 * 🔴 **下单渠道不渲染**：`order` 表无渠道列（线上 / 线下 / 小程序等未建模）⇒
 * 不渲染该字段、也不以「未知」占位（PRD《Web规范》§权限与视图 1）。
 *
 * 金额口径与列表页同源（`utils/order.orderAmountLabel`，分 → 元），
 * 明细小计合计与「订单总额」可交叉核对（seed 8.13 按此约束造数）。
 */
defineOptions({ name: "OrderOverviewTab", inheritAttrs: false });

defineProps<{
  order: OrderDetail["order"];
  items: OrderDetailItem[];
}>();

const emit = defineEmits<{ "open-customer": []; "open-pet": [] }>();

const { t } = useI18n();

function displayText(value: string | null | undefined): string {
  const text = value === undefined || value === null ? "" : String(value).trim();
  return text === "" ? t("order.value.unset") : text;
}

function formatTime(value: unknown): string {
  return formatTableDateTime(value as string, {
    today: t("time.today"),
    yesterday: t("time.yesterday"),
    beforeYesterday: t("time.beforeYesterday"),
  });
}
</script>

<style lang="scss" scoped>
.order-tab {
  display: flex;
  flex-direction: column;
  gap: 16px;

  &__cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px;
  }

  &__card {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 12px 14px;
    font: inherit;
    text-align: left;
    cursor: pointer;
    background: var(--el-fill-color-lighter);
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 6px;
    transition: border-color 0.15s;

    &:hover {
      border-color: var(--el-color-primary);
    }
  }

  &__card-icon {
    font-size: 20px;
    color: var(--el-color-primary);
  }

  &__card-body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  &__card-label {
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }

  &__card-value {
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 14px;
    font-weight: 500;
    color: var(--el-text-color-primary);
    white-space: nowrap;
  }

  &__card-arrow {
    color: var(--el-text-color-placeholder);
  }

  &__section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  &__section-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  &__section-extra {
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }

  &__payable {
    font-weight: 600;
    color: var(--el-color-danger);
  }

  &__summary {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  &__empty-hint {
    margin: 0;
    font-size: 13px;
    color: var(--el-text-color-secondary);
  }
}
</style>
