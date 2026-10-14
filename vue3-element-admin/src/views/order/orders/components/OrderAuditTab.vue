<template>
  <div class="order-audit">
    <TableSkeleton v-if="showSkeleton" :column-count="4" :row-count="5" />

    <DataState
      v-else-if="loadError"
      variant="error"
      :title="t('order.audit.loadError')"
      :description="loadError"
      :action-text="t('order.detail.retry')"
      @action="load"
    />

    <el-table
      v-else-if="logs.length > 0"
      :data="logs"
      class="page-table order-audit__table"
      size="small"
      row-key="id"
      data-testid="order-audit-table"
    >
      <el-table-column :label="t('order.audit.field.time')" width="170">
        <template #default="{ row }">
          {{ formatTime((row as OrderAuditLogItem).createdAt) }}
        </template>
      </el-table-column>

      <el-table-column :label="t('order.audit.field.action')" width="100" align="center">
        <template #default="{ row }">
          <el-tag
            :type="orderAuditActionTagType((row as OrderAuditLogItem).action)"
            effect="plain"
            size="small"
          >
            {{ t(orderAuditActionLabelKey((row as OrderAuditLogItem).action)) }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column :label="t('order.audit.field.operator')" width="140">
        <template #default="{ row }">{{ operatorText(row as OrderAuditLogItem) }}</template>
      </el-table-column>

      <!-- 变更前后值：仅变更字段（create 的 before 为 null ⇒ 只显示 after） -->
      <el-table-column :label="t('order.audit.field.diff')" min-width="280">
        <template #default="{ row }">
          <div v-if="diffLines(row as OrderAuditLogItem).length > 0" class="order-audit__diff">
            <div
              v-for="line in diffLines(row as OrderAuditLogItem)"
              :key="line.field"
              class="order-audit__diff-line"
              data-testid="order-audit-diff-line"
            >
              <span class="order-audit__diff-field">{{ fieldLabel(line.field) }}</span>
              <span class="order-audit__diff-before">{{ line.before }}</span>
              <el-icon class="order-audit__diff-arrow"><Right /></el-icon>
              <span class="order-audit__diff-after">{{ line.after }}</span>
            </div>
          </div>
          <span v-else class="order-audit__diff-empty">{{ t("order.value.unset") }}</span>
        </template>
      </el-table-column>
    </el-table>

    <DataState
      v-else
      variant="empty"
      :title="t('order.audit.emptyTitle')"
      :description="t('order.audit.emptyDesc')"
    />
  </div>
</template>

<script setup lang="ts">
import { Right } from "@element-plus/icons-vue";

import OrderAPI from "@/api/order";
import type { OrderAuditLogItem } from "@/api/order";
import DataState from "@/components/DataState/DataState.vue";
import TableSkeleton from "@/components/DataState/TableSkeleton.vue";
import { formatTableDateTime } from "@/utils/format";
import {
  orderAuditActionLabelKey,
  orderAuditActionTagType,
  orderAuditDiffLines,
  orderAuditOperatorLabel,
} from "@/utils/order";
import { isApiError } from "@/utils/request";

/**
 * 订单详情 · 操作日志页签（MVP-WEB-07-02）
 *
 * PRD《页面功能》#订单详情 4「操作日志：AuditLog 时间序，记录每次字段变更的前后值
 * 与操作人，不可篡改」。
 *
 * 数据源 = `GET /orders/:id/audit-logs`（订单域只读通道，受 `order:list` 保护，
 * 服务端强制锚定 `entityType=order` + 本单 id，并复用全局审计查询服务）。
 *  `audit_log` 是 **append-only**（触发器拦截 UPDATE/DELETE）⇒ 「不可篡改」是
 *  DB 层不变式而非前端约定。
 *
 * 展示口径：按 `created_at desc, id desc`（服务端固定排序）；快照只含**变更字段**，
 *  故 `before` 为 null（create 动作）时只显示 after 值。
 * `?tab=` 变化会按 fullPath 重建组件（踩坑 122）⇒ 本组件为 `lazy` 页签，
 *  每次激活重新取数，避免缓存住旧实例的日志。
 */
defineOptions({ name: "OrderAuditTab", inheritAttrs: false });

const props = defineProps<{ orderId: string }>();

const { t } = useI18n();

const AUDIT_PAGE_SIZE = 50;

const logs = ref<OrderAuditLogItem[]>([]);
const loading = ref(false);
const hasLoaded = ref(false);
const loadError = ref("");

const showSkeleton = computed(() => loading.value && !hasLoaded.value);

async function load(): Promise<void> {
  const id = props.orderId;
  if (!id) return;
  loadError.value = "";
  loading.value = true;
  try {
    const data = await OrderAPI.getAuditLogs(id, { page: 1, page_size: AUDIT_PAGE_SIZE });
    logs.value = data.list ?? [];
  } catch (error) {
    loadError.value = isApiError(error) ? error.message : String(error ?? "");
  } finally {
    loading.value = false;
    hasLoaded.value = true;
  }
}

function formatTime(value: unknown): string {
  return formatTableDateTime(value as string, {
    today: t("time.today"),
    yesterday: t("time.yesterday"),
    beforeYesterday: t("time.beforeYesterday"),
  });
}

function operatorText(row: OrderAuditLogItem): string {
  const { text, labelKey } = orderAuditOperatorLabel(row.operatorName, row.operatorType);
  return text ?? t(labelKey);
}

function diffLines(row: OrderAuditLogItem) {
  return orderAuditDiffLines(row.before, row.after);
}

/** 变更字段名 → i18n 文案（命中订单字段表则本地化，否则原样显示列名） */
const FIELD_LABEL_KEYS: Record<string, string> = {
  status: "order.field.status",
  orderNo: "order.field.orderNo",
  totalAmount: "order.field.totalAmount",
  discountAmount: "order.field.discountAmount",
  payableAmount: "order.field.payableAmount",
  creditFlag: "order.field.creditFlag",
  remark: "order.field.remark",
  storeId: "order.field.store",
};

function fieldLabel(field: string): string {
  const key = FIELD_LABEL_KEYS[field];
  return key ? t(key) : field;
}

onMounted(() => {
  void load();
});

// 详情页内切换页签会重建组件（fullPath 变化）⇒ 每次挂载即取数；
// `orderId` 变化（同一实例被复用）时同样回源，保证日志与本单一致。
watch(
  () => props.orderId,
  () => void load()
);
</script>

<style lang="scss" scoped>
.order-audit {
  min-height: 200px;

  &__table {
    width: 100%;
  }

  &__diff {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  &__diff-line {
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: 12px;
    line-height: 18px;
  }

  &__diff-field {
    flex-shrink: 0;
    min-width: 72px;
    color: var(--el-text-color-secondary);
  }

  &__diff-before {
    color: var(--el-text-color-placeholder);
    text-decoration: line-through;
  }

  &__diff-arrow {
    color: var(--el-text-color-placeholder);
  }

  &__diff-after {
    font-weight: 500;
    color: var(--el-text-color-primary);
  }

  &__diff-empty {
    color: var(--el-text-color-placeholder);
  }
}
</style>
