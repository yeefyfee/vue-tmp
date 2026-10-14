<template>
  <div class="page-container">
    <!-- 筛选区（PRD《Web规范》§布局与栅格 3：列表页布局固定三段之「筛选区」） -->
    <el-card class="page-search" shadow="never">
      <el-form ref="queryFormRef" :model="params" :inline="true" @submit.prevent>
        <el-form-item :label="t('store.field.code')" prop="code">
          <el-input
            v-model="params.code"
            :placeholder="t('store.search.codePlaceholder')"
            clearable
            class="w-[180px]"
            @keyup.enter="handleQuery"
          />
        </el-form-item>

        <el-form-item :label="t('store.field.name')" prop="name">
          <el-input
            v-model="params.name"
            :placeholder="t('store.search.namePlaceholder')"
            clearable
            class="w-[180px]"
            @keyup.enter="handleQuery"
          />
        </el-form-item>

        <el-form-item :label="t('store.field.status')" prop="status">
          <el-select
            v-model="params.status"
            :placeholder="t('store.search.statusPlaceholder')"
            clearable
            class="w-[140px]"
          >
            <el-option :label="t('store.value.statusEnabled')" :value="CommonStatus.ENABLED" />
            <el-option :label="t('store.value.statusDisabled')" :value="CommonStatus.DISABLED" />
          </el-select>
        </el-form-item>

        <el-form-item :label="t('store.field.createdAt')">
          <el-date-picker
            v-model="createdRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            :start-placeholder="t('store.search.dateStart')"
            :end-placeholder="t('store.search.dateEnd')"
            unlink-panels
            class="!w-[260px]"
          />
        </el-form-item>

        <el-form-item>
          <el-button type="primary" @click="handleQuery">{{ t("store.search.search") }}</el-button>
          <el-button @click="handleReset">{{ t("store.search.reset") }}</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card class="page-content" shadow="never">
      <div class="page-toolbar">
        <div class="page-toolbar__left">
          <el-button v-hasPerm="'store:create'" type="primary" @click="handleCreate()">
            {{ t("store.action.create") }}
          </el-button>
          <el-button
            v-hasPerm="'store:delete'"
            type="danger"
            :disabled="!hasSelection"
            @click="handleBatchDelete()"
          >
            {{ t("store.action.batchDelete") }}
            <template v-if="selectedIds.length">（{{ selectedIds.length }}）</template>
          </el-button>
        </div>

        <div class="page-toolbar__right">
          <ColumnSetting :controller="columnController" />
          <el-tooltip :content="t('store.action.refresh')" placement="top">
            <el-button class="page-icon-btn" @click="fetchList">
              <el-icon><Refresh /></el-icon>
            </el-button>
          </el-tooltip>
          <el-tooltip :content="t('store.action.fullscreen')" placement="top">
            <el-button class="page-icon-btn" @click="toggleFullscreen">
              <el-icon><FullScreen /></el-icon>
            </el-button>
          </el-tooltip>
        </div>
      </div>

      <!-- 数据区（三态：骨架 / 错误 / 空态，PRD《Web规范》§空态/加载/错误态 1） -->
      <div ref="tableWrapperRef" class="page-table-wrapper">
        <TableSkeleton
          v-if="showSkeleton"
          :column-count="visibleColumns.length + 1"
          :row-count="8"
        />

        <DataState
          v-else-if="loadError"
          variant="error"
          :title="t('store.empty.errorTitle')"
          :description="loadError"
          :action-text="t('store.empty.errorRetry')"
          @action="fetchList"
        />

        <DataState
          v-else-if="list.length === 0"
          :variant="isFiltered ? 'filtered' : 'empty'"
          :title="isFiltered ? t('store.empty.filteredTitle') : t('store.empty.title')"
          :description="isFiltered ? t('store.empty.filteredDesc') : t('store.empty.desc')"
          :action-text="emptyActionText"
          @action="handleEmptyAction"
        />

        <el-table
          v-else
          ref="dataTableRef"
          v-loading="loading"
          class="page-table"
          :data="list"
          height="100%"
          row-key="id"
          :default-sort="defaultSort"
          @sort-change="handleSortChange"
          @selection-change="handleSelectionChange"
        >
          <el-table-column
            v-if="canWrite"
            type="selection"
            width="48"
            align="center"
            fixed="left"
          />

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
              <!-- 主名称列：可点击进详情（PRD《Web规范》§表格规范 2） -->
              <el-link
                v-if="column.key === 'name'"
                type="primary"
                :underline="false"
                @click="handleView(row as StoreItem)"
              >
                {{ (row as StoreItem).name }}
              </el-link>

              <el-tag
                v-else-if="column.key === 'type'"
                :type="(row as StoreItem).type === StoreType.FRANCHISE ? 'warning' : 'success'"
                effect="plain"
              >
                {{ typeLabel((row as StoreItem).type) }}
              </el-tag>

              <el-tag
                v-else-if="column.key === 'status'"
                :type="(row as StoreItem).status === CommonStatus.ENABLED ? 'success' : 'info'"
              >
                {{ statusLabel((row as StoreItem).status) }}
              </el-tag>

              <el-tooltip
                v-else-if="column.key === 'createdAt' || column.key === 'updatedAt'"
                :content="cellText(row as StoreItem, column.key)"
                placement="top"
                :disabled="!cellRaw(row as StoreItem, column.key)"
              >
                <span>{{ formatTime(cellRaw(row as StoreItem, column.key)) }}</span>
              </el-tooltip>

              <span v-else>{{ cellText(row as StoreItem, column.key) }}</span>
            </template>
          </el-table-column>

          <el-table-column
            v-if="canWrite"
            fixed="right"
            :label="t('table.actions')"
            width="150"
            align="center"
          >
            <template #default="{ row }">
              <el-button
                v-hasPerm="'store:update'"
                type="primary"
                size="small"
                link
                @click="handleEdit(row as StoreItem)"
              >
                {{ t("store.action.edit") }}
              </el-button>
              <el-button
                v-hasPerm="'store:delete'"
                type="danger"
                size="small"
                link
                @click="handleDelete(row as StoreItem)"
              >
                {{ t("store.action.delete") }}
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

    <StoreFormDrawer
      v-model="drawerVisible"
      :mode="drawerMode"
      :store-id="activeStoreId"
      @success="handleSaved"
    />
  </div>
</template>

<script setup lang="ts">
import { useFullscreen } from "@vueuse/core";
import { ElMessage, ElMessageBox, type FormInstance } from "element-plus";
import { FullScreen, Refresh } from "@element-plus/icons-vue";

import StoreAPI from "@/api/store";
import type { StoreItem, StoreQueryParams } from "@/api/store";
import ColumnSetting from "@/components/ColumnSetting/index.vue";
import DataState from "@/components/DataState/DataState.vue";
import TableSkeleton from "@/components/DataState/TableSkeleton.vue";
import StoreFormDrawer from "./components/StoreFormDrawer.vue";
import { usePageTable, useTableColumns, useTableSelection } from "@/composables";
import type { TableColumnDef } from "@/composables/useTableColumns";
import { CommonStatus, StoreType } from "@/enums";
import { hasPerm } from "@/utils/auth";
import { isApiError } from "@/utils/request";
import { formatTableDateTime } from "@/utils/format";

/**
 * 门店管理列表页（MVP-WEB-02-01）
 *
 * 规格来源：PRD《页面清单》（路径 `stores`，可见角色 超管 / 总部 / 店长只读）
 * +《Web规范》（三段式布局、表格规范、空态/加载/错误态、通用规则）
 * +《交互规范》（操作反馈分级、确认文案含影响范围、表单草稿）。
 *
 * 硬要求落地对照：
 *  1. 三段式布局：筛选区（单行）/ 数据区（占剩余高度、内部滚动）/ 分页器固定底部；
 *  2. 列数 > 8 ⇒ 列配置（显示 / 隐藏 / 顺序），偏好按账号持久化（`useTableColumns`）；
 *  3. 必带列：主名称列（可点击进详情）/ 状态列 / 更新时间列；状态列居中、数字列服务端排序；
 *  4. 时间统一 `YYYY-MM-DD HH:mm`，三天内显示「今天 14:30」式相对表达；
 *  5. 超长文本截断 + 悬浮完整；无斑马纹、行高 44px、悬浮高亮（全局样式已保证）；
 *  6. 两种空态（从未有数据 → 新建；筛选无结果 → 清除筛选）+ 错误态（可读原因 + 重试）+ 骨架屏；
 *  7. 列表刷新不重置筛选；筛选与排序在地址栏可还原（支持分享定位）；
 *  8. 删除为强确认（输入门店名 / 「确认」二字），确认文案写明影响范围与对象数量；
 *  9. 写入口按 `store:list / create / update / delete` 粒度渲染（店长只读 ⇒ 写入口不渲染）。
 */
defineOptions({
  name: "Stores",
  inheritAttrs: false,
});

const { t } = useI18n();
const router = useRouter();
const route = useRoute();

const tableWrapperRef = ref<HTMLElement | null>(null);
const { toggle: toggleFullscreen } = useFullscreen(tableWrapperRef);

const queryFormRef = ref<FormInstance>();
const dataTableRef = ref<{ clearSelection: () => void }>();

/** 写权限（决定多选列 / 操作列是否渲染；店长只读 ⇒ 两列整体不渲染） */
const canWrite = computed(() => hasPerm("store:update") || hasPerm("store:delete"));

// ── 查询参数（含地址栏还原）──────────────────────────────────────────────
const DEFAULT_PAGE_SIZE = 20;

/** 从地址栏还原筛选 / 排序 / 分页（PRD《Web规范》§通用规则 2） */
function paramsFromQuery(): StoreQueryParams {
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

  const status = asNumber(query.status);

  return {
    pageNum: asNumber(query.pageNum) ?? 1,
    pageSize: asNumber(query.pageSize) ?? DEFAULT_PAGE_SIZE,
    sortBy: asString(query.sortBy) ?? "createdAt",
    order: (asString(query.order) ?? "DESC").toUpperCase() as StoreQueryParams["order"],
    code: asString(query.code) ?? "",
    name: asString(query.name) ?? "",
    status: status === 0 || status === 1 ? status : undefined,
    createdAtStart: asString(query.createdAtStart),
    createdAtEnd: asString(query.createdAtEnd),
  };
}

/**
 * 重置基准
 *
 * 恒为「无筛选」基线（而非地址栏带来的条件）：否则「重置」会回到一个带筛选的状态，
 * 与 PRD《Web规范》§空态 2「筛选无结果 → 清除筛选」语义冲突。
 */
const RESET_BASELINE: StoreQueryParams = {
  pageNum: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  sortBy: "createdAt",
  order: "DESC",
  code: "",
  name: "",
  status: undefined,
  createdAtStart: undefined,
  createdAtEnd: undefined,
};

const { loading, list, total, params, fetchData, handleQuery, handleResetQuery } = usePageTable<
  StoreItem,
  StoreQueryParams
>({
  initialParams: { ...RESET_BASELINE },
  request: StoreAPI.getPage,
  onBeforeReset: () => {
    createdRange.value = null;
    queryFormRef.value?.clearValidate();
  },
});

/** 用地址栏条件覆盖初始参数（一次性，之后以 params 为准） */
Object.assign(params, paramsFromQuery());

/** 创建时间区间（独立 ref，便于 el-date-picker 绑定） */
const createdRange = ref<[string, string] | null>(
  params.createdAtStart && params.createdAtEnd ? [params.createdAtStart, params.createdAtEnd] : null
);

watch(createdRange, (range) => {
  params.createdAtStart = range?.[0];
  params.createdAtEnd = range?.[1];
});

/**
 * 状态下拉清空归一化
 *
 * `el-select` 清空时可能置空串，而后端 `QueryStoreDto.status` 是
 * `@IsIn([1, 0])` —— 空串会被判定为非法值并抛真 HTTP 400。
 * 故统一归一为 `undefined`（axios 会跳过 undefined 参数，等价于「不过滤」）。
 */
watch(
  () => params.status,
  (value) => {
    const raw = value as unknown;
    if (raw !== 0 && raw !== 1 && raw !== undefined) {
      params.status = undefined;
    }
  }
);

// ── 首屏与错误态 ────────────────────────────────────────────────────────
const hasLoaded = ref(false);
const loadError = ref("");
/** 首次加载用骨架屏，后续刷新用表格内 loading（避免布局跳动） */
const showSkeleton = computed(() => loading.value && !hasLoaded.value);

/** 拉取列表（统一收口：错误态文案 + 首屏标记） */
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

/** 是否处于筛选状态（决定空态种类） */
const isFiltered = computed(
  () =>
    Boolean(params.code) ||
    Boolean(params.name) ||
    params.status === 0 ||
    params.status === 1 ||
    Boolean(params.createdAtStart) ||
    Boolean(params.createdAtEnd)
);

const emptyActionText = computed(() => {
  if (isFiltered.value) return t("store.action.clearFilter");
  return hasPerm("store:create") ? t("store.action.create") : "";
});

/** 空态主行动：错误态重试已在模板单独处理，这里只处理两种空态 */
function handleEmptyAction(): void {
  if (isFiltered.value) {
    handleReset();
    return;
  }
  if (hasPerm("store:create")) handleCreate();
}

/** 重置筛选（并清理地址栏） */
function handleReset(): void {
  handleResetQuery();
  void syncUrl();
}

// ── 地址栏同步（PRD《Web规范》§通用规则 2：支持分享定位）──────────────
function syncUrl(): Promise<void> {
  const query: Record<string, string> = {};
  if (params.code) query.code = params.code;
  if (params.name) query.name = params.name;
  if (params.status === 0 || params.status === 1) query.status = String(params.status);
  if (params.createdAtStart) query.createdAtStart = params.createdAtStart;
  if (params.createdAtEnd) query.createdAtEnd = params.createdAtEnd;
  if (params.sortBy && params.sortBy !== "createdAt") query.sortBy = params.sortBy;
  if (params.order && String(params.order).toUpperCase() !== "DESC") {
    query.order = String(params.order).toUpperCase();
  }
  if (params.pageNum > 1) query.pageNum = String(params.pageNum);
  if (params.pageSize !== DEFAULT_PAGE_SIZE) query.pageSize = String(params.pageSize);

  // 同路由仅 query 变化：replace 避免污染历史；重复导航被 vue-router 拒绝，静默忽略
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

// ── 表格列（列配置 + 渲染元信息）─────────────────────────────────────────
const COLUMN_DEFS: TableColumnDef[] = [
  { key: "name", label: t("store.field.name"), fixed: true },
  { key: "code", label: t("store.field.code") },
  { key: "type", label: t("store.field.type") },
  { key: "region", label: t("store.field.region") },
  { key: "address", label: t("store.field.address") },
  { key: "phone", label: t("store.field.phone") },
  { key: "status", label: t("store.field.status"), fixed: true },
  { key: "updatedAt", label: t("store.field.updatedAt"), fixed: true },
  { key: "createdAt", label: t("store.field.createdAt"), visible: false },
  { key: "longitude", label: t("store.field.longitude"), visible: false },
  { key: "latitude", label: t("store.field.latitude"), visible: false },
];

/** 列宽 / 对齐 / 排序能力（sortable 仅限后端白名单：createdAt/code/name/status） */
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
  name: { minWidth: 160, custom: true, sortable: true },
  code: { width: 150, sortable: true },
  type: { width: 110, align: "center", custom: true },
  region: { minWidth: 180 },
  address: { minWidth: 200 },
  phone: { width: 150 },
  status: { width: 100, align: "center", custom: true, sortable: true },
  updatedAt: { width: 170, custom: true },
  createdAt: { width: 170, custom: true, sortable: true },
  longitude: { width: 130 },
  latitude: { width: 130 },
};

const columnController = useTableColumns({
  namespace: "stores",
  columns: COLUMN_DEFS,
});

const visibleColumns = columnController.visibleColumns;

const { selectedIds, hasSelection, handleSelectionChange, clearSelection } =
  useTableSelection<StoreItem>();

// ── 单元格渲染 ──────────────────────────────────────────────────────────
function typeLabel(type: number): string {
  return type === StoreType.FRANCHISE
    ? t("store.value.typeFranchise")
    : t("store.value.typeDirect");
}

function statusLabel(status: number): string {
  return status === CommonStatus.ENABLED
    ? t("store.value.statusEnabled")
    : t("store.value.statusDisabled");
}

/** 单元格原始值（未加工，空值返回 `undefined`） */
function cellRaw(row: StoreItem, key: string): string | undefined {
  const value = (row as unknown as Record<string, unknown>)[key];
  if (value === undefined || value === null || value === "") return undefined;
  return String(value);
}

/** 单元格文本（地区拼接 / 空值占位） */
function cellText(row: StoreItem, key: string): string {
  if (key === "region") {
    return [row.province, row.city, row.district].filter(Boolean).join(" / ") || "-";
  }
  return cellRaw(row, key) ?? "-";
}

/** 时间列格式化（三天内相对表达，其余 `YYYY-MM-DD HH:mm`） */
function formatTime(value: unknown): string {
  return formatTableDateTime(value as string, {
    today: t("time.today"),
    yesterday: t("time.yesterday"),
    beforeYesterday: t("time.beforeYesterday"),
  });
}

// ── 排序（服务端）──────────────────────────────────────────────────────
/** 表头默认排序指示（与 `params` 同步，保证地址栏还原后箭头正确） */
const defaultSort = computed<{ prop: string; order: "ascending" | "descending" }>(() => ({
  prop: params.sortBy ?? "createdAt",
  order: String(params.order ?? "DESC").toUpperCase() === "ASC" ? "ascending" : "descending",
}));

function handleSortChange({ prop, order }: { prop: string | null; order: string | null }): void {
  if (!prop || !order) {
    params.sortBy = "createdAt";
    params.order = "DESC";
  } else {
    params.sortBy = prop;
    params.order = order === "ascending" ? "ASC" : "DESC";
  }
  params.pageNum = 1;
  fetchList();
}

// ── 抽屉（新建 / 编辑 / 查看）───────────────────────────────────────────
const drawerVisible = ref(false);
const drawerMode = ref<"create" | "edit" | "view">("create");
const activeStoreId = ref("");

function openDrawer(mode: "create" | "edit" | "view", id = ""): void {
  drawerMode.value = mode;
  activeStoreId.value = id;
  drawerVisible.value = true;
}

function handleCreate(): void {
  openDrawer("create");
}

function handleEdit(row: StoreItem): void {
  openDrawer("edit", row.id);
}

/** 主名称列点击 → 详情抽屉（保留列表上下文） */
function handleView(row: StoreItem): void {
  openDrawer("view", row.id);
}

/** 保存成功：提示 + 刷新（新建回到第一页，编辑保留当前页） */
function handleSaved(payload: { mode: "create" | "edit" }): void {
  if (payload.mode === "create") {
    ElMessage.success(t("store.form.createSuccess"));
    handleQuery();
    return;
  }
  ElMessage.success(t("store.form.updateSuccess"));
  fetchList();
}

// ── 删除（强确认：输入门店名 / 「确认」二字）─────────────────────────────
/**
 * 强确认对话框
 *
 * PRD《交互规范》§确认与撤销 1：「强确认（输入宠物名或"确认"二字才可执行，
 * 用于退款、删除档案、作废订单）」，2：「确认对话框必须写明影响范围与对象数量」。
 */
async function confirmStrong(
  expected: string,
  message: string,
  placeholder: string
): Promise<boolean> {
  try {
    const { value } = await ElMessageBox.prompt(message, t("store.delete.title"), {
      confirmButtonText: t("store.action.delete"),
      cancelButtonText: t("store.form.cancel"),
      inputPlaceholder: placeholder,
      inputValidator: (input: string) => String(input ?? "").trim() === expected,
      inputErrorMessage: t("store.delete.mismatch"),
      type: "warning",
    });
    return String(value ?? "").trim() === expected;
  } catch {
    return false;
  }
}

/** 删除单个门店 */
async function handleDelete(row: StoreItem): Promise<void> {
  const ok = await confirmStrong(
    row.name,
    t("store.delete.confirmText", { name: row.name }),
    t("store.delete.inputPlaceholder")
  );
  if (!ok) return;

  try {
    await StoreAPI.deleteById(row.id);
    ElMessage.success(t("store.delete.success"));
    await fetchList();
  } catch {
    // 失败提示由请求层统一渲染（含可读原因），此处不再重复弹窗
  }
}

/** 批量删除当前页选中门店 */
async function handleBatchDelete(): Promise<void> {
  const count = selectedIds.value.length;
  if (count === 0) return;

  const ok = await confirmStrong(
    t("store.delete.confirmKeyword"),
    t("store.delete.batchConfirmText", { count }),
    t("store.delete.batchInputPlaceholder")
  );
  if (!ok) return;

  try {
    await Promise.all(selectedIds.value.map((id) => StoreAPI.deleteById(String(id))));
    ElMessage.success(t("store.delete.batchSuccess", { count }));
    clearSelection();
    dataTableRef.value?.clearSelection();
    await fetchList();
  } catch {
    await fetchList();
  }
}

// ── 初始化 ──────────────────────────────────────────────────────────────
onMounted(() => {
  fetchList();
});
</script>

<style lang="scss" scoped>
/* 状态列 / 类型列居中、文本列左对齐由 el-table-column 的 align 控制（已在模板指定） */
:deep(.el-table__row) {
  cursor: default;
}
</style>
