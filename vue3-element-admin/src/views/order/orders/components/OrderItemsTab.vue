<template>
  <div class="order-items">
    <div v-if="editable" class="order-items__toolbar">
      <el-button
        v-if="canDiscount"
        type="warning"
        plain
        size="small"
        data-testid="order-items-discount"
        @click="emit('set-discount')"
      >
        {{ t("order.discount.button") }}
      </el-button>
      <el-button
        type="primary"
        plain
        size="small"
        data-testid="order-items-edit"
        @click="emit('go-edit')"
      >
        {{ t("order.item.editItems") }}
      </el-button>
    </div>

    <el-table
      v-if="items.length > 0"
      :data="items"
      class="page-table order-items__table"
      size="small"
      row-key="id"
      data-testid="order-items-table"
    >
      <el-table-column :label="t('order.item.field.type')" width="90" align="center">
        <template #default="{ row }">
          <el-tag :type="orderItemTypeTagType(row.itemType)" effect="plain" size="small">
            {{ t(orderItemTypeLabelKey(row.itemType)) }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column
        :label="t('order.item.field.name')"
        prop="itemName"
        min-width="200"
        show-overflow-tooltip
      />

      <el-table-column :label="t('order.item.field.unitPrice')" width="120" align="right">
        <template #default="{ row }">{{ orderAmountLabel(row.unitPrice) }}</template>
      </el-table-column>

      <el-table-column
        :label="t('order.item.field.quantity')"
        prop="quantity"
        width="90"
        align="center"
      />

      <!-- 折扣来源（PRD《页面功能》#订单详情 2 明列）：来源标签 + 该行分摊到的优惠额。
           优惠额 > 0 才渲染金额（分摊额为 0 的行来源恒为「无优惠」，不留金额占位）。 -->
      <el-table-column
        :label="t('order.item.field.discountSource')"
        width="170"
        align="center"
        data-testid="order-item-discount-source"
      >
        <template #default="{ row }">
          <el-tag
            :type="orderItemDiscountSourceTagType(row.discountSource)"
            effect="plain"
            size="small"
          >
            {{ t(orderItemDiscountSourceLabelKey(row.discountSource)) }}
          </el-tag>
          <span
            v-if="orderItemHasDiscount(row.discountAmount)"
            class="order-items__discount"
            data-testid="order-item-discount"
          >
            {{ orderItemDiscountAmountText(row.discountAmount) }}
          </span>
        </template>
      </el-table-column>

      <el-table-column :label="t('order.item.field.subtotal')" width="130" align="right">
        <template #default="{ row }">
          <span class="order-items__subtotal" data-testid="order-item-subtotal">
            {{ orderItemSubtotalLabel(row.unitPrice, row.quantity) }}
          </span>
        </template>
      </el-table-column>

      <!-- 履约状态（MVP-WEB-07-05 履约联动）：随订单状态流转联动
           （paid→开始服务置「进行中」、completed→完成服务置「已完成」）。
           值域/语义色取 shared `OrderItemFulfillStatus` META（唯一来源），本页不私写映射。
           退款状态列仍归退款域（未建模），本期不渲染。 -->
      <el-table-column
        :label="t('order.item.field.fulfillStatus')"
        width="110"
        align="center"
        data-testid="order-item-fulfill-status"
      >
        <template #default="{ row }">
          <el-tag
            :type="orderItemFulfillStatusTagType(row.fulfillStatus)"
            effect="plain"
            size="small"
          >
            {{ t(orderItemFulfillStatusLabelKey(row.fulfillStatus)) }}
          </el-tag>
        </template>
      </el-table-column>
    </el-table>

    <DataState
      v-else
      variant="empty"
      :title="t('order.item.emptyTitle')"
      :description="editable ? t('order.item.emptyEditableDesc') : t('order.item.emptyDesc')"
    />
  </div>
</template>

<script setup lang="ts">
import type { OrderDetailItem } from "@/api/order";
import DataState from "@/components/DataState/DataState.vue";
import {
  orderAmountLabel,
  orderItemDiscountAmountText,
  orderItemDiscountSourceLabelKey,
  orderItemDiscountSourceTagType,
  orderItemFulfillStatusLabelKey,
  orderItemFulfillStatusTagType,
  orderItemHasDiscount,
  orderItemSubtotalLabel,
  orderItemTypeLabelKey,
  orderItemTypeTagType,
} from "@/utils/order";

/**
 * 订单详情 · 明细页签（MVP-WEB-07-02 只读列表 / 07-03 起按状态开放编辑入口 /
 * 07-04 增加「折扣来源」列与优惠分摊展示 / 07-05 增加「履约状态」列）
 *
 * PRD《页面功能》#订单详情 2「明细：OrderItem 列表，含服务项/商品、单价、数量、
 * 折扣来源（会员等级、优惠券）、小计，支持增删改（仅 draft、pending_payment 状态）」。
 *
 * **增删改承载**：明细编辑统一走编辑独立页 `/orders/:orderId/edit`（07-03，
 * 单一编辑实现，页签内不重复做行编辑）⇒ `editable`（状态机判定）时渲染
 * 「编辑明细」入口；明细行内仍**只读**。
 *
 * **折扣来源列（07-04）**：展示该行分摊到的优惠额与来源标签。列位置遵守 PRD 原文顺序
 * （…数量、折扣来源、小计）。来源文案/语义色取 shared `OrderItemDiscountSource`
 * META（唯一来源），本页不私写映射；分摊额为 0 的行不渲染金额（来源恒「无优惠」）。
 *
 * **履约状态列（07-05）**：追加在末尾（不打断 PRD 原文列序），值域/语义色取 shared
 * `OrderItemFulfillStatus` META（唯一来源）；状态随订单整体流转联动，行级只读。
 *
 * 两条边界：
 *  ① 「退款状态」列（`refund_status` 已落库）**不渲染**：其消费方是退款域（未建模）；
 *     「履约状态」列由 07-05 上线渲染（见上）；
 *  ② 优惠**入口**（「设置优惠」按钮）仅在 `editable && canDiscount` 时出现 ——
 *     改价是资金敏感动作（PRD《权限规则》默认角色 = 店长），无 `order:discount`
 *     权限者连入口都不渲染（后端 PermissionGuard 为最终闸门）。
 *
 * 小计在**分**域做整数乘算（`orderItemSubtotalLabel`），与列表页金额同源。
 */
defineOptions({ name: "OrderItemsTab", inheritAttrs: false });

defineProps<{
  items: OrderDetailItem[];
  /** 当前订单是否处于可编辑状态（draft / pending_payment；由详情页按状态机传入） */
  editable?: boolean;
  /** 当前用户是否具备 `order:discount`（由详情页按 /users/me 的 perms 传入） */
  canDiscount?: boolean;
}>();

const emit = defineEmits<{ "go-edit": []; "set-discount": [] }>();

const { t } = useI18n();
</script>

<style scoped lang="scss">
.order-items {
  min-height: 200px;

  &__toolbar {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    margin-bottom: 8px;
  }

  &__table {
    width: 100%;
  }

  &__subtotal {
    font-weight: 500;
    color: var(--el-text-color-primary);
  }

  &__discount {
    font-weight: 500;
    color: var(--el-color-danger);
  }
}
</style>
