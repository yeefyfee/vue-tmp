<template>
  <div class="page-container">
    <el-card class="page-search" shadow="never">
      <el-form ref="queryFormRef" :model="params" :inline="true" @submit.prevent>
        <el-form-item :label="t('order.field.orderNo')" prop="orderNo">
          <el-input
            v-model="params.orderNo"
            :placeholder="t('order.search.orderNoPlaceholder')"
            clearable
            class="w-[220px]"
            @keyup.enter="handleQuery"
          />
        </el-form-item>

        <el-form-item :label="t('order.field.store')" prop="storeId">
          <el-select
            v-model="params.storeId"
            :placeholder="t('order.search.storePlaceholder')"
            clearable
            class="w-[180px]"
          >
            <el-option
              v-for="store in storeOptions"
              :key="store.id"
              :label="store.name"
              :value="store.id"
            />
          </el-select>
        </el-form-item>

        <el-form-item :label="t('order.field.status')" prop="status">
          <el-select
            v-model="params.status"
            :placeholder="t('order.search.statusPlaceholder')"
            clearable
            class="w-[150px]"
          >
            <el-option
              v-for="option in ORDER_STATUS_OPTIONS"
              :key="option.value"
              :label="t(option.labelKey)"
              :value="option.value"
            />
          </el-select>
        </el-form-item>

        <el-form-item :label="t('order.field.createdAt')">
          <el-date-picker
            v-model="createdAtRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            :start-placeholder="t('order.search.dateStart')"
            :end-placeholder="t('order.search.dateEnd')"
            unlink-panels
            class="!w-[260px]"
          />
        </el-form-item>

        <el-form-item>
          <el-button type="primary" @click="handleQuery">
            {{ t("order.search.search") }}
          </el-button>
          <el-button @click="handleReset">{{ t("order.search.reset") }}</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card class="page-content" shadow="never">
      <div class="page-toolbar">
        <div class="page-toolbar__left">
          <el-button
            v-hasPerm="'order:create'"
            type="primary"
            data-testid="order-create"
            @click="openCreate"
          >
            <el-icon><Plus /></el-icon>
            {{ t("order.action.create") }}
          </el-button>
        </div>

        <div class="page-toolbar__right">
          <ColumnSetting :controller="columnController" />
          <el-tooltip :content="t('order.action.refresh')" placement="top">
            <el-button class="page-icon-btn" @click="fetchList">
              <el-icon><Refresh /></el-icon>
            </el-button>
          </el-tooltip>
          <el-tooltip :content="t('order.action.fullscreen')" placement="top">
            <el-button class="page-icon-btn" @click="toggleFullscreen">
              <el-icon><FullScreen /></el-icon>
            </el-button>
          </el-tooltip>
        </div>
      </div>

      <div ref="tableWrapperRef" class="page-table-wrapper">
        <TableSkeleton
          v-if="showSkeleton"
          :column-count="visibleColumns.length + 1"
          :row-count="8"
        />

        <DataState
          v-else-if="loadError"
          variant="error"
          :title="t('order.empty.errorTitle')"
          :description="loadError"
          :action-text="t('order.empty.errorRetry')"
          @action="fetchList"
        />

        <DataState
          v-else-if="list.length === 0"
          :variant="isFiltered ? 'filtered' : 'empty'"
          :title="isFiltered ? t('order.empty.filteredTitle') : t('order.empty.title')"
          :description="isFiltered ? t('order.empty.filteredDesc') : t('order.empty.desc')"
          @action="handleEmptyAction"
        />

        <el-table
          v-else
          v-loading="loading"
          class="page-table"
          :data="list"
          height="100%"
          row-key="id"
          :default-sort="defaultSort"
          @sort-change="handleSortChange"
        >
          <el-table-column
            v-for="column in visibleColumns"
            :key="column.key"
            :prop="column.key"
            :label="column.label"
            :width="COLUMN_META[column.key]?.width"
            :min-width="COLUMN_META[column.key]?.minWidth"
            :align="COLUMN_META[column.key]?.align ?? 'left'"
            :sortable="COLUMN_META[column.key]?.sortable ? 'custom' : false"
            :show-overflow-tooltip="!COLUMN_META[column.key]?.custom"
          >
            <template #default="{ row }">
              <span v-if="column.key === 'orderNo'" class="order-no-cell">
                {{ (row as OrderRow).orderNo }}
              </span>

              <span v-else-if="column.key === 'status'">
                <el-tag :type="orderStatusTagType((row as OrderRow).status)" size="small">
                  {{ t(orderStatusLabelKey((row as OrderRow).status)) }}
                </el-tag>
              </span>

              <span v-else-if="column.key === 'store'">
                {{ displayText((row as OrderRow).storeName) }}
              </span>

              <span v-else-if="column.key === 'customer'">
                {{ displayText((row as OrderRow).customerName) }}
              </span>

              <span v-else-if="column.key === 'pet'">
                {{ displayText((row as OrderRow).petName) }}
              </span>

              <span v-else-if="column.key === 'totalAmount'">
                {{ orderAmountLabel((row as OrderRow).totalAmount) }}
              </span>

              <span v-else-if="column.key === 'payableAmount'">
                {{ orderAmountLabel((row as OrderRow).payableAmount) }}
              </span>

              <span v-else-if="column.key === 'creditFlag'">
                {{
                  (row as OrderRow).creditFlag
                    ? t("order.value.creditYes")
                    : t("order.value.creditNo")
                }}
              </span>

              <el-tooltip
                v-else-if="column.key === 'createdAt'"
                :content="cellText(row as OrderRow, column.key)"
                placement="top"
                :disabled="!cellRaw(row as OrderRow, column.key)"
              >
                <span>{{ formatTime(cellRaw(row as OrderRow, column.key)) }}</span>
              </el-tooltip>

              <span v-else>{{ cellText(row as OrderRow, column.key) }}</span>
            </template>
          </el-table-column>

          <!-- 操作列：「详情」入口恒渲染；编辑 / 删除（MVP-WEB-07-03）按状态机
               （仅 draft / pending_payment，isOrderEditable）+ 各自权限码渲染，
               双重判定：非法状态不出现（PRD《页面功能》验收要点）+ 无权限即隐藏。 -->
          <el-table-column fixed="right" :label="t('table.actions')" width="170" align="center">
            <template #default="{ row }">
              <el-button
                type="primary"
                size="small"
                link
                data-testid="order-row-detail"
                @click="openDetail(row as OrderRow)"
              >
                {{ t("order.action.detail") }}
              </el-button>
              <el-button
                v-if="isOrderEditable((row as OrderRow).status)"
                v-hasPerm="'order:update'"
                type="warning"
                size="small"
                link
                data-testid="order-row-edit"
                @click="openEdit(row as OrderRow)"
              >
                {{ t("order.action.edit") }}
              </el-button>
              <el-button
                v-if="isOrderEditable((row as OrderRow).status)"
                v-hasPerm="'order:delete'"
                type="danger"
                size="small"
                link
                data-testid="order-row-delete"
                @click="handleDelete(row as OrderRow)"
              >
                {{ t("order.action.delete") }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <pagination
        v-if="total > 0"
        v-model:total="total"
        v-model:page="params.pageNum"
        v-model:limit="params.pageSize"
        class="page-pagination"
        @pagination="fetchList"
      />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { useFullscreen } from "@vueuse/core";
import type { FormInstance } from "element-plus";
import { ElMessage, ElMessageBox } from "element-plus";
import { FullScreen, Plus, Refresh } from "@element-plus/icons-vue";

import OrderAPI from "@/api/order";
import type { OrderRow, OrderQueryParams } from "@/api/order";
import StoreAPI from "@/api/store";
import ColumnSetting from "@/components/ColumnSetting/index.vue";
import DataState from "@/components/DataState/DataState.vue";
import TableSkeleton from "@/components/DataState/TableSkeleton.vue";
import { usePageTable, useTableColumns } from "@/composables";
import type { TableColumnDef } from "@/composables/useTableColumns";
import {
  ORDER_STATUS_OPTIONS,
  isOrderEditable,
  orderAmountLabel,
  orderStatusLabelKey,
  orderStatusTagType,
} from "@/utils/order";
import { formatTableDateTime } from "@/utils/format";
import { isApiError } from "@/utils/request";

defineOptions({
  name: "Orders",
  inheritAttrs: false,
});

const { t } = useI18n();
const router = useRouter();
const route = useRoute();

const tableWrapperRef = ref<HTMLElement | null>(null);
const { toggle: toggleFullscreen } = useFullscreen(tableWrapperRef);

const queryFormRef = ref<FormInstance>();

const storeOptions = ref<Array<{ id: string; name: string }>>([]);

async function fetchStoreOptions(): Promise<void> {
  try {
    const data = await StoreAPI.getPage({
      pageNum: 1,
      pageSize: 100,
      sortBy: "createdAt",
      order: "ASC",
    });
    storeOptions.value = (data.list ?? []).map((item) => ({ id: item.id, name: item.name }));
  } catch {
    storeOptions.value = [];
  }
}

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_SORT_BY = "createdAt";
const DEFAULT_ORDER = "DESC";

const SORT_FIELD_BY_COLUMN: Record<string, string> = {
  orderNo: "orderNo",
  status: "status",
  createdAt: "createdAt",
  totalAmount: "totalAmount",
  payableAmount: "payableAmount",
};

const COLUMN_BY_SORT_FIELD: Record<string, string> = Object.fromEntries(
  Object.entries(SORT_FIELD_BY_COLUMN).map(([column, field]) => [field, column])
);

function paramsFromQuery(): OrderQueryParams {
  const query = route.query;
  const asString = (value: unknown): string | undefined => {
    const text = Array.isArray(value) ? value[0] : value;
    return typeof text === "string" && text !== "" ? text : undefined;
  };
  const asNumber = (value: unknown): number | undefined => {
    const text = asString(value);
    if (text === undefined) return undefined;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const status = asString(query.status);
  const statusValid = status !== undefined && ORDER_STATUS_OPTIONS.some((o) => o.value === status);
  const sortByRaw = asString(query.sortBy);
  const sortByValid =
    sortByRaw !== undefined && Object.values(SORT_FIELD_BY_COLUMN).includes(sortByRaw);

  return {
    pageNum: asNumber(query.pageNum) ?? 1,
    pageSize: asNumber(query.pageSize) ?? DEFAULT_PAGE_SIZE,
    sortBy: sortByValid ? sortByRaw : DEFAULT_SORT_BY,
    order: (asString(query.order) ?? DEFAULT_ORDER).toUpperCase() as OrderQueryParams["order"],
    orderNo: asString(query.orderNo) ?? "",
    storeId: asString(query.storeId),
    status: statusValid ? (status as OrderQueryParams["status"]) : undefined,
    createdAtStart: asString(query.createdAtStart),
    createdAtEnd: asString(query.createdAtEnd),
  };
}

const RESET_BASELINE: OrderQueryParams = {
  pageNum: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  sortBy: DEFAULT_SORT_BY,
  order: DEFAULT_ORDER,
  orderNo: "",
  storeId: undefined,
  status: undefined,
  createdAtStart: undefined,
  createdAtEnd: undefined,
};

const { loading, list, total, params, fetchData, handleQuery, handleResetQuery } = usePageTable<
  OrderRow,
  OrderQueryParams
>({
  initialParams: { ...RESET_BASELINE },
  // 单号是「输入框常驻」的空串基线：请求前归一 undefined（踩坑 129-④，
  // 空串不过滤也不上线），其余维度由 watch 归一
  request: (p) => OrderAPI.getPage({ ...p, orderNo: p.orderNo ? p.orderNo : undefined }),
  onBeforeReset: () => {
    createdAtRange.value = null;
    queryFormRef.value?.clearValidate();
  },
});

Object.assign(params, paramsFromQuery());

const createdAtRange = ref<[string, string] | null>(
  params.createdAtStart && params.createdAtEnd ? [params.createdAtStart, params.createdAtEnd] : null
);

watch(createdAtRange, (range) => {
  params.createdAtStart = range?.[0];
  params.createdAtEnd = range?.[1];
});

watch(
  () => params.storeId,
  (value) => {
    if (value === "" || value === null) params.storeId = undefined;
  }
);

watch(
  () => params.status,
  (value) => {
    const raw = value as unknown;
    if (raw === "" || raw === null || raw === undefined) {
      params.status = undefined;
      return;
    }
    if (!ORDER_STATUS_OPTIONS.some((option) => option.value === raw)) {
      params.status = undefined;
    }
  }
);

watch(
  () => params.orderNo,
  (value) => {
    if (value === null || value === undefined) params.orderNo = "";
  }
);

const hasLoaded = ref(false);
const loadError = ref("");
const showSkeleton = computed(() => loading.value && !hasLoaded.value);

async function fetchList(): Promise<void> {
  loadError.value = "";
  try {
    await fetchData();
  } catch (error) {
    loadError.value = isApiError(error) ? error.message : String(error ?? "");
  } finally {
    hasLoaded.value = true;
  }
}

const isFiltered = computed(
  () =>
    Boolean(params.orderNo) ||
    Boolean(params.storeId) ||
    params.status !== undefined ||
    Boolean(params.createdAtStart) ||
    Boolean(params.createdAtEnd)
);

function handleEmptyAction(): void {
  if (isFiltered.value) handleReset();
}

/**
 * 打开订单详情（MVP-WEB-07-02）
 *
 * 跳页（独立路由 `/orders/:orderId`）而非抽屉 —— PRD《页面清单》`订单详情 |
 * orders/:order_id` 明确独立路径；详情承载四页签 + 明细表 + 审计时间序，
 * 超出 480px 抽屉承载（PRD《Web规范》§页面模式 1）。
 * 不向详情透传列表筛选态（地址栏只写身份级 query 的纪律，红线 1）。
 */
function openDetail(row: OrderRow): void {
  void router.push(`/orders/${row.id}`);
}

/** 打开订单创建页（MVP-WEB-07-03 · 独立页 `/orders/new`，路径取 PRD《页面清单》） */
function openCreate(): void {
  void router.push("/orders/new");
}

/** 打开订单编辑页（MVP-WEB-07-03 · 独立页 `/orders/:orderId/edit`） */
function openEdit(row: OrderRow): void {
  void router.push(`/orders/${row.id}/edit`);
}

/**
 * 删除订单（MVP-WEB-07-03 · 软删）
 *
 * PRD《交互规范》§确认与撤销 1：**作废订单属强确认** —— 输入完整单号才可执行，
 * 对话框写明影响范围。仅 draft / pending_payment 可删（状态守卫与后端 A0908 双保险）；
 * 删除后停留本页刷新列表。
 */
async function handleDelete(row: OrderRow): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt(
      t("order.delete.confirmText", { orderNo: row.orderNo }),
      t("order.delete.title"),
      {
        confirmButtonText: t("order.action.delete"),
        cancelButtonText: t("order.form.cancel"),
        inputPlaceholder: row.orderNo,
        inputValidator: (input: string) => String(input ?? "").trim() === row.orderNo,
        inputErrorMessage: t("order.delete.mismatch"),
        type: "warning",
      }
    );
    if (String(value ?? "").trim() !== row.orderNo) return;

    await OrderAPI.remove(row.id);
    ElMessage.success(t("order.delete.success"));
    await fetchList();
  } catch {
    // 取消（ElMessageBox reject）与请求失败均静默：后者由请求层统一渲染提示
  }
}

function handleReset(): void {
  handleResetQuery();
  void syncUrl();
}

function syncUrl(): Promise<void> {
  const query: Record<string, string> = {};
  if (params.orderNo) query.orderNo = params.orderNo;
  if (params.storeId) query.storeId = params.storeId;
  if (params.status) query.status = params.status;
  if (params.createdAtStart) query.createdAtStart = params.createdAtStart;
  if (params.createdAtEnd) query.createdAtEnd = params.createdAtEnd;
  if (params.sortBy && params.sortBy !== DEFAULT_SORT_BY) query.sortBy = params.sortBy;
  if (params.order && String(params.order).toUpperCase() !== DEFAULT_ORDER) {
    query.order = String(params.order).toUpperCase();
  }
  if (params.pageNum > 1) query.pageNum = String(params.pageNum);
  if (params.pageSize !== DEFAULT_PAGE_SIZE) query.pageSize = String(params.pageSize);

  return router.replace({ path: route.path, query }).then(
    () => undefined,
    () => undefined
  );
}

watch(
  params,
  () => {
    void syncUrl();
  },
  { deep: true }
);

const COLUMN_DEFS: TableColumnDef[] = [
  { key: "orderNo", label: t("order.field.orderNo"), fixed: true },
  { key: "status", label: t("order.field.status"), fixed: true },
  { key: "store", label: t("order.field.store") },
  { key: "customer", label: t("order.field.customer") },
  { key: "pet", label: t("order.field.pet") },
  { key: "totalAmount", label: t("order.field.totalAmount") },
  { key: "payableAmount", label: t("order.field.payableAmount") },
  { key: "creditFlag", label: t("order.field.creditFlag") },
  { key: "remark", label: t("order.field.remark") },
  { key: "createdAt", label: t("order.field.createdAt") },
];

const COLUMN_META: Record<
  string,
  {
    width?: number;
    minWidth?: number;
    align?: "left" | "center" | "right";
    sortable?: boolean;
    custom?: boolean;
  }
> = {
  orderNo: { width: 170, custom: true, sortable: true },
  status: { width: 110, align: "center", custom: true, sortable: true },
  store: { minWidth: 140, custom: true },
  customer: { minWidth: 120, custom: true },
  pet: { minWidth: 120, custom: true },
  totalAmount: { width: 120, align: "right", custom: true, sortable: true },
  payableAmount: { width: 120, align: "right", custom: true, sortable: true },
  creditFlag: { width: 80, align: "center", custom: true },
  remark: { minWidth: 180 },
  createdAt: { width: 170, custom: true, sortable: true },
};

const columnController = useTableColumns({
  namespace: "orders",
  columns: COLUMN_DEFS,
});

const visibleColumns = columnController.visibleColumns;

function displayText(value: string | null | undefined): string {
  const text = value === undefined || value === null ? "" : String(value).trim();
  return text === "" ? t("order.value.unset") : text;
}

function cellRaw(row: OrderRow, key: string): string | undefined {
  const value = (row as unknown as Record<string, unknown>)[key];
  if (value === undefined || value === null || value === "") return undefined;
  return String(value);
}

function cellText(row: OrderRow, key: string): string {
  return cellRaw(row, key) ?? "-";
}

function formatTime(value: unknown): string {
  return formatTableDateTime(value as string, {
    today: t("time.today"),
    yesterday: t("time.yesterday"),
    beforeYesterday: t("time.beforeYesterday"),
  });
}

const defaultSort = computed<{ prop: string; order: "ascending" | "descending" }>(() => ({
  prop: COLUMN_BY_SORT_FIELD[params.sortBy ?? DEFAULT_SORT_BY] ?? "createdAt",
  order: String(params.order ?? DEFAULT_ORDER).toUpperCase() === "ASC" ? "ascending" : "descending",
}));

function handleSortChange({ prop, order }: { prop: string | null; order: string | null }): void {
  if (!prop || !order) {
    params.sortBy = DEFAULT_SORT_BY;
    params.order = DEFAULT_ORDER;
  } else {
    params.sortBy = SORT_FIELD_BY_COLUMN[prop] ?? DEFAULT_SORT_BY;
    params.order = order === "ascending" ? "ASC" : "DESC";
  }
  params.pageNum = 1;
  fetchList();
}

onMounted(() => {
  void fetchStoreOptions();
  void fetchList();
});

/**
 * keep-alive 缓存键 = `route.fullPath`（踩坑 122）：回到「用过的 query 组合」时
 * 组件自持 params 可能与地址栏漂移 ⇒ 非首次激活按地址栏对齐后再取数，
 * 使「地址栏 = 渲染态」成为不变式。首次挂载走 `onMounted`（`onActivated` 首挂也触发，
 * 用 `hadActivated` 去重，避免首屏双请求——踩坑 125 两路径互斥）。
 */
let hadActivated = false;
onActivated(() => {
  if (!hadActivated) {
    hadActivated = true;
    return;
  }
  Object.assign(params, paramsFromQuery());
  createdAtRange.value =
    params.createdAtStart && params.createdAtEnd
      ? [params.createdAtStart, params.createdAtEnd]
      : null;
  void fetchList();
});
</script>

<style scoped>
.order-no-cell {
  font-weight: 500;
  color: var(--el-text-color-primary);
}
</style>
