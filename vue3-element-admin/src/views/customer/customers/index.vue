<template>
  <div class="page-container">
    <!-- 筛选区（PRD《Web规范》§布局与栅格 3：列表页布局固定三段之「筛选区」） -->
    <el-card class="page-search" shadow="never">
      <el-form ref="queryFormRef" :model="params" :inline="true" @submit.prevent>
        <el-form-item :label="t('customer.field.keyword')" prop="keyword">
          <el-input
            v-model="params.keyword"
            :placeholder="t('customer.search.keywordPlaceholder')"
            clearable
            class="w-[220px]"
            @keyup.enter="handleQuery"
          />
        </el-form-item>

        <el-form-item :label="t('customer.field.store')" prop="storeId">
          <el-select
            v-model="params.storeId"
            :placeholder="t('customer.search.storePlaceholder')"
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

        <el-form-item :label="t('customer.field.lifecycle')" prop="lifecycle">
          <el-select
            v-model="params.lifecycle"
            :placeholder="t('customer.search.lifecyclePlaceholder')"
            clearable
            class="w-[140px]"
          >
            <el-option
              v-for="option in LIFECYCLE_OPTIONS"
              :key="option.value"
              :label="t(option.labelKey)"
              :value="option.value"
            />
          </el-select>
        </el-form-item>

        <el-form-item :label="t('customer.field.createdAt')">
          <el-date-picker
            v-model="createdRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            :start-placeholder="t('customer.search.dateStart')"
            :end-placeholder="t('customer.search.dateEnd')"
            unlink-panels
            class="!w-[260px]"
          />
        </el-form-item>

        <el-form-item>
          <el-button type="primary" @click="handleQuery">
            {{ t("customer.search.search") }}
          </el-button>
          <el-button @click="handleReset">{{ t("customer.search.reset") }}</el-button>
        </el-form-item>
      </el-form>

      <!-- 分层分布（MVP-WEB-04-04 · FR-6 展示侧）：**全量口径**，点击分层即钻取筛选。
           置于筛选卡内 —— 该卡 body 是常规块级流（非 page-content 的三段式 grid，
           见踩坑 96），加第二个直接子元素不会挤坏正文行。
           分布拉取失败时整体不渲染（静默降级，不阻断列表主链路）。 -->
      <LifecycleDistributionBar
        v-if="lifecycleStats"
        :stats="lifecycleStats"
        :active-lifecycle="params.lifecycle"
        @select="handleLifecycleSelect"
        @clear="handleLifecycleClear"
      />
    </el-card>

    <el-card class="page-content" shadow="never">
      <div class="page-toolbar">
        <div class="page-toolbar__left">
          <el-button
            v-hasPerm="'customer:delete'"
            type="danger"
            :disabled="!hasSelection"
            @click="handleBatchDelete()"
          >
            {{ t("customer.action.batchDelete") }}
            <template v-if="selectedIds.length">（{{ selectedIds.length }}）</template>
          </el-button>
        </div>

        <div class="page-toolbar__right">
          <ColumnSetting :controller="columnController" />
          <el-tooltip :content="t('customer.action.refresh')" placement="top">
            <el-button class="page-icon-btn" @click="fetchList">
              <el-icon><Refresh /></el-icon>
            </el-button>
          </el-tooltip>
          <el-tooltip :content="t('customer.action.fullscreen')" placement="top">
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
          :title="t('customer.empty.errorTitle')"
          :description="loadError"
          :action-text="t('customer.empty.errorRetry')"
          @action="fetchList"
        />

        <DataState
          v-else-if="list.length === 0"
          :variant="isFiltered ? 'filtered' : 'empty'"
          :title="isFiltered ? t('customer.empty.filteredTitle') : t('customer.empty.title')"
          :description="isFiltered ? t('customer.empty.filteredDesc') : t('customer.empty.desc')"
          :action-text="isFiltered ? t('customer.action.clearFilter') : ''"
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
              <!-- 主名称列可点击进详情（PRD《Web规范》§表格规范 2「主名称列（可点击进详情）」）
                   详情以右侧抽屉承载（§页面模式 1），不跳页、保留列表筛选与滚动位置 -->
              <el-button
                v-if="column.key === 'name'"
                class="customer-name"
                type="primary"
                link
                @click="openDetail(row as CustomerItem)"
              >
                {{ (row as CustomerItem).name }}
              </el-button>

              <el-tag
                v-else-if="column.key === 'gender'"
                :type="genderTagType((row as CustomerItem).gender)"
                effect="plain"
              >
                {{ genderLabel((row as CustomerItem).gender) }}
              </el-tag>

              <span v-else-if="column.key === 'source'">
                {{ sourceLabel((row as CustomerItem).source) }}
              </span>

              <span v-else-if="column.key === 'store'">
                {{ storeName((row as CustomerItem).storeId) }}
              </span>

              <el-tag
                v-else-if="column.key === 'lifecycle'"
                :type="lifecycleTagType((row as CustomerItem).lifecycle)"
              >
                {{ lifecycleLabel((row as CustomerItem).lifecycle) }}
              </el-tag>

              <el-tooltip
                v-else-if="column.key === 'createdAt' || column.key === 'updatedAt'"
                :content="cellText(row as CustomerItem, column.key)"
                placement="top"
                :disabled="!cellRaw(row as CustomerItem, column.key)"
              >
                <span>{{ formatTime(cellRaw(row as CustomerItem, column.key)) }}</span>
              </el-tooltip>

              <span v-else>{{ cellText(row as CustomerItem, column.key) }}</span>
            </template>
          </el-table-column>

          <!-- 操作列：详情入口仅需 `customer:list`（本页已要求），故恒渲染；
               合并按 `customer:merge`、删除按 `customer:delete` 粒度由 v-hasPerm 决定 -->
          <el-table-column fixed="right" :label="t('table.actions')" width="190" align="center">
            <template #default="{ row }">
              <el-button type="primary" size="small" link @click="openDetail(row as CustomerItem)">
                {{ t("customer.action.detail") }}
              </el-button>
              <el-button
                v-hasPerm="'customer:merge'"
                type="warning"
                size="small"
                link
                @click="openMerge(row as CustomerItem)"
              >
                {{ t("customer.merge.entry") }}
              </el-button>
              <el-button
                v-hasPerm="'customer:delete'"
                type="danger"
                size="small"
                link
                @click="handleDelete(row as CustomerItem)"
              >
                {{ t("customer.action.delete") }}
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

    <!-- 客户详情抽屉（MVP-WEB-04-02：宠物 / 触达 / 黑名单）。
         抽屉开关为交互瞬态，**不写进地址栏** —— 工作区组件按 route.fullPath（含 query）
         重建（踩坑 95），写 query 会在每次开合时整页重建、列表重新拉取并丢失筛选现场。 -->
    <CustomerDetailDrawer
      v-model="detailVisible"
      :customer-id="detailCustomerId"
      @refresh="fetchList"
    />

    <!-- 客户合并（MVP-WEB-04-03：source 并入 target，源客户归档）。
         与抽屉同为交互瞬态，不写地址栏（同踩坑 95 的理由）。
         合并会归档一个客户 ⇒ 刷新列表同时刷新分层分布计数。 -->
    <CustomerMergeDialog
      v-model="mergeVisible"
      :source="mergeSource"
      @refresh="handleDataChanged"
    />
  </div>
</template>

<script setup lang="ts">
import { useFullscreen } from "@vueuse/core";
import { ElMessage, ElMessageBox, type FormInstance } from "element-plus";
import { FullScreen, Refresh } from "@element-plus/icons-vue";

import CustomerAPI from "@/api/customer";
import type {
  CustomerItem,
  CustomerLifecycleStats,
  CustomerQueryParams,
  CustomerSourceOption,
} from "@/api/customer";
import StoreAPI from "@/api/store";
import ColumnSetting from "@/components/ColumnSetting/index.vue";
import DataState from "@/components/DataState/DataState.vue";
import TableSkeleton from "@/components/DataState/TableSkeleton.vue";
import CustomerDetailDrawer from "./components/CustomerDetailDrawer.vue";
import CustomerMergeDialog from "./components/CustomerMergeDialog.vue";
import LifecycleDistributionBar from "./components/LifecycleDistributionBar.vue";
import { usePageTable, useTableColumns, useTableSelection } from "@/composables";
import type { TableColumnDef } from "@/composables/useTableColumns";
import { CustomerGender, CustomerLifecycle } from "@/enums";
import { hasPerm } from "@/utils/auth";
import { isApiError } from "@/utils/request";
import { formatTableDateTime } from "@/utils/format";

/**
 * 客户列表 DataTable（MVP-WEB-04-01）
 *
 * 规格来源：PRD《页面清单》（路径 `customers`，可见角色 超管 / 总部 / 店长 / 前台 / 财务 / 运营）
 * +《客户管理》FR-1 宠主档案 +《Customer API》端点清单与验收要点
 * +《Web规范》（三段式布局、表格规范、空态/加载/错误态、通用规则）。
 *
 * 硬要求落地对照：
 *  1. 三段式布局：筛选区（单行）/ 数据区（占剩余高度、内部滚动）/ 分页器固定底部；
 *  2. 列数 > 8 ⇒ 列配置（显示 / 隐藏 / 顺序），偏好按账号持久化（`useTableColumns`）；
 *  3. 必带列：主名称列（姓名，本任务不做跳转）/ 状态列（生命周期分层，居中）/ 更新时间列；
 *     金额列本页无；文本列左对齐、时间列统一 `YYYY-MM-DD HH:mm`（三天内相对表达）；
 *  4. 排序走服务端白名单（`createdAt` / `name` / `mobile`，白名单外后端回落 `createdAt`）；
 *  5. 超长文本截断 + 悬浮完整；无斑马纹、行高 44px、悬浮高亮（全局样式已保证）；
 *  6. 两种空态（从未有数据 / 筛选无结果）+ 错误态（可读原因 + 重试）+ 骨架屏；
 *  7. 列表刷新不重置筛选；筛选与排序在地址栏可还原（支持分享定位）；
 *  8. 删除为强确认（输入客户姓名 / 「确认」二字），确认文案写明影响范围与对象数量；
 *  9. 写入口按 `customer:delete` 粒度渲染（无删除权限 ⇒ 多选列与操作列整体不渲染）。
 *
 * 边界说明（**不越界**）：
 *  · 「新建客户」「编辑客户」的入口与表单归「客户建档 / 客户编辑」任务，本任务**不渲染**
 *    （PRD《页面清单》维护规则 1 与《Web规范》§权限与视图 1：无权限/未上线入口直接不渲染，
 *    而非渲染后报错）。
 *  · 「客户详情（多宠物 / 触达 / 黑名单）」已由 MVP-WEB-04-02 落地为
 *    `./components/CustomerDetailDrawer.vue`，经主名称列与操作列「详情」入口打开。
 *  · 「客户合并」已由 MVP-WEB-04-03 落地为 `./components/CustomerMergeDialog.vue`，
 *    经操作列「合并」入口打开（按 `customer:merge` 粒度渲染）；「宠物转移审批」的
 *    **审批侧**是独立列表页 `views/customer/transfers/index.vue`（菜单「转移审批」），
 *    **发起侧**在详情抽屉「宠物」页签（按 `customer:transfer:create` 粒度渲染）。
 *  · 生命周期分层的**规则解释与分布统计**已由 MVP-WEB-04-04 落地：
 *    筛选卡内 `./components/LifecycleDistributionBar.vue`（全量口径分布条 + 点击钻取筛选
 *    + 「分层规则」口径气泡），数据源 `GET /customers/lifecycle-stats`（权限复用
 *    `customer:list`）。分层标签列与按分层筛选仍由本页既有实现承载。
 *  · 「高价值」分层依赖尚未建模的会员 / 订单数据 ⇒ 分布**刻意只呈现后端返回的
 *    4 层真实计数**，不臆造自动分层结果（PRD《Web规范》§权限与视图 1：未上线内容不渲染）。
 */
defineOptions({
  name: "Customers",
  inheritAttrs: false,
});

const { t } = useI18n();
const router = useRouter();
const route = useRoute();

const tableWrapperRef = ref<HTMLElement | null>(null);
const { toggle: toggleFullscreen } = useFullscreen(tableWrapperRef);

const queryFormRef = ref<FormInstance>();
const dataTableRef = ref<{ clearSelection: () => void }>();

/** 写权限（决定多选列 / 操作列是否渲染） */
const canWrite = computed(() => hasPerm("customer:delete"));

/** 生命周期下拉选项（值与标签分离：值为后端值域，标签走 i18n） */
const LIFECYCLE_OPTIONS: Array<{ value: number; labelKey: string }> = [
  { value: CustomerLifecycle.NEW, labelKey: "customer.value.lifecycleNew" },
  { value: CustomerLifecycle.ACTIVE, labelKey: "customer.value.lifecycleActive" },
  { value: CustomerLifecycle.DORMANT, labelKey: "customer.value.lifecycleDormant" },
  { value: CustomerLifecycle.LOST, labelKey: "customer.value.lifecycleLost" },
];

// ── 门店选项（筛选下拉 + 列表列名映射）──────────────────────────────────
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
    // 门店选项拉取失败不阻断客户列表（列名回退为门店 ID 短码）；
    // 前台 / 财务等无 `store:list` 权限的角色命中此分支属预期
    storeOptions.value = [];
  }
}

/** storeId → 门店名（未命中时回退 ID 前 8 位，避免出现令人困惑的空值） */
const storeNameMap = computed(() => {
  const map = new Map<string, string>();
  for (const store of storeOptions.value) map.set(store.id, store.name);
  return map;
});

function storeName(storeId: string | null): string {
  if (!storeId) return t("customer.value.tenantLevel");
  return storeNameMap.value.get(storeId) ?? `${storeId.slice(0, 8)}…`;
}

// ── 客户来源选项（标签唯一来源为后端 source-options）────────────────────
const sourceOptions = ref<CustomerSourceOption[]>([]);

async function fetchSourceOptions(): Promise<void> {
  try {
    sourceOptions.value = await CustomerAPI.getSourceOptions();
  } catch {
    // 选项拉取失败不阻断列表（来源列回退为 `-`）
    sourceOptions.value = [];
  }
}

function sourceLabel(source: number | null): string {
  if (source === null || source === undefined) return t("customer.value.unset");
  return sourceOptions.value.find((item) => item.value === source)?.label ?? String(source);
}

// ── 查询参数（含地址栏还原）──────────────────────────────────────────────
const DEFAULT_PAGE_SIZE = 20;

/** 从地址栏还原筛选 / 排序 / 分页（PRD《Web规范》§通用规则 2） */
function paramsFromQuery(): CustomerQueryParams {
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

  const lifecycle = asNumber(query.lifecycle);
  const lifecycleValid =
    lifecycle !== undefined && LIFECYCLE_OPTIONS.some((option) => option.value === lifecycle);

  return {
    pageNum: asNumber(query.pageNum) ?? 1,
    pageSize: asNumber(query.pageSize) ?? DEFAULT_PAGE_SIZE,
    sortBy: asString(query.sortBy) ?? "createdAt",
    order: (asString(query.order) ?? "DESC").toUpperCase() as CustomerQueryParams["order"],
    keyword: asString(query.keyword) ?? "",
    storeId: asString(query.storeId),
    lifecycle: lifecycleValid ? lifecycle : undefined,
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
const RESET_BASELINE: CustomerQueryParams = {
  pageNum: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  sortBy: "createdAt",
  order: "DESC",
  keyword: "",
  storeId: undefined,
  lifecycle: undefined,
  createdAtStart: undefined,
  createdAtEnd: undefined,
};

const { loading, list, total, params, fetchData, handleQuery, handleResetQuery } = usePageTable<
  CustomerItem,
  CustomerQueryParams
>({
  initialParams: { ...RESET_BASELINE },
  request: CustomerAPI.getPage,
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
 * 下拉清空归一化
 *
 * `el-select` 清空时可能置空串：`storeId` 是 `@IsUUID`（空串 ⇒ 真 HTTP 400），
 * `lifecycle` 是 `@IsIn` + `@Type(() => Number)`（空串 ⇒ 0 ⇒ 不在值域 ⇒ 400，同踩坑 101
 * 的隐式转换陷阱）。故统一归一为 `undefined`（axios 跳过 undefined 参数，等价「不过滤」）。
 */
watch(
  () => params.storeId,
  (value) => {
    if (value === "" || value === null) params.storeId = undefined;
  }
);

watch(
  () => params.lifecycle,
  (value) => {
    const raw = value as unknown;
    if (raw === "" || raw === null || raw === undefined) {
      params.lifecycle = undefined;
      return;
    }
    if (!LIFECYCLE_OPTIONS.some((option) => option.value === Number(raw))) {
      params.lifecycle = undefined;
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
    Boolean(params.keyword) ||
    Boolean(params.storeId) ||
    params.lifecycle !== undefined ||
    Boolean(params.createdAtStart) ||
    Boolean(params.createdAtEnd)
);

/** 空态主行动：仅「筛选无结果 ⇒ 清除筛选」（本任务无新建入口，见文件头边界说明） */
function handleEmptyAction(): void {
  if (isFiltered.value) handleReset();
}

/** 重置筛选（并清理地址栏） */
function handleReset(): void {
  handleResetQuery();
  void syncUrl();
}

// ── 地址栏同步（PRD《Web规范》§通用规则 2：支持分享定位）──────────────
function syncUrl(): Promise<void> {
  const query: Record<string, string> = {};
  if (params.keyword) query.keyword = params.keyword;
  if (params.storeId) query.storeId = params.storeId;
  if (params.lifecycle !== undefined) query.lifecycle = String(params.lifecycle);
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
  { key: "name", label: t("customer.field.name"), fixed: true },
  { key: "mobile", label: t("customer.field.mobile"), fixed: true },
  { key: "lifecycle", label: t("customer.field.lifecycle"), fixed: true },
  { key: "gender", label: t("customer.field.gender") },
  { key: "source", label: t("customer.field.source") },
  { key: "store", label: t("customer.field.store") },
  { key: "remark", label: t("customer.field.remark") },
  { key: "createdAt", label: t("customer.field.createdAt") },
  { key: "updatedAt", label: t("customer.field.updatedAt"), fixed: true },
  { key: "birthday", label: t("customer.field.birthday"), visible: false },
];

/** 列宽 / 对齐 / 排序能力（sortable 仅限后端白名单：createdAt/name/mobile） */
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
  name: { minWidth: 140, custom: true, sortable: true },
  mobile: { width: 140, custom: true, sortable: true },
  lifecycle: { width: 110, align: "center", custom: true },
  gender: { width: 90, align: "center", custom: true },
  source: { width: 120, custom: true },
  store: { minWidth: 160 },
  remark: { minWidth: 200 },
  createdAt: { width: 170, custom: true, sortable: true },
  updatedAt: { width: 170, custom: true },
  birthday: { width: 130 },
};

const columnController = useTableColumns({
  namespace: "customers",
  columns: COLUMN_DEFS,
});

const visibleColumns = columnController.visibleColumns;

const { selectedIds, hasSelection, handleSelectionChange, clearSelection } =
  useTableSelection<CustomerItem>();

// ── 单元格渲染 ──────────────────────────────────────────────────────────
function genderLabel(gender: number | null): string {
  if (gender === CustomerGender.MALE) return t("customer.value.genderMale");
  if (gender === CustomerGender.FEMALE) return t("customer.value.genderFemale");
  if (gender === CustomerGender.UNKNOWN) return t("customer.value.genderUnknown");
  return t("customer.value.unset");
}

function genderTagType(gender: number | null): "primary" | "success" | "info" {
  if (gender === CustomerGender.MALE) return "primary";
  if (gender === CustomerGender.FEMALE) return "success";
  return "info";
}

function lifecycleLabel(lifecycle: number | null): string {
  const matched = LIFECYCLE_OPTIONS.find((option) => option.value === lifecycle);
  return matched ? t(matched.labelKey) : t("customer.value.unset");
}

/** 分层标签配色（新客=主色、活跃=成功、沉睡=警告、流失=危险），与经营分析四象限口径一致 */
function lifecycleTagType(
  lifecycle: number | null
): "primary" | "success" | "warning" | "danger" | "info" {
  if (lifecycle === CustomerLifecycle.NEW) return "primary";
  if (lifecycle === CustomerLifecycle.ACTIVE) return "success";
  if (lifecycle === CustomerLifecycle.DORMANT) return "warning";
  if (lifecycle === CustomerLifecycle.LOST) return "danger";
  return "info";
}

/** 单元格原始值（未加工，空值返回 `undefined`） */
function cellRaw(row: CustomerItem, key: string): string | undefined {
  const value = (row as unknown as Record<string, unknown>)[key];
  if (value === undefined || value === null || value === "") return undefined;
  return String(value);
}

/** 单元格文本（空值占位 `-`） */
function cellText(row: CustomerItem, key: string): string {
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

// ── 删除（强确认：输入客户姓名 / 「确认」二字）───────────────────────────
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
    const { value } = await ElMessageBox.prompt(message, t("customer.delete.title"), {
      confirmButtonText: t("customer.action.delete"),
      cancelButtonText: t("customer.form.cancel"),
      inputPlaceholder: placeholder,
      inputValidator: (input: string) => String(input ?? "").trim() === expected,
      inputErrorMessage: t("customer.delete.mismatch"),
      type: "warning",
    });
    return String(value ?? "").trim() === expected;
  } catch {
    return false;
  }
}

/** 删除单个客户（软删，手机号随之释放） */
async function handleDelete(row: CustomerItem): Promise<void> {
  const ok = await confirmStrong(
    row.name,
    t("customer.delete.confirmText", { name: row.name, mobile: row.mobile }),
    t("customer.delete.inputPlaceholder")
  );
  if (!ok) return;

  try {
    await CustomerAPI.deleteById(row.id);
    ElMessage.success(t("customer.delete.success"));
    await handleDataChanged();
  } catch {
    // 失败提示由请求层统一渲染（含可读原因），此处不再重复弹窗
  }
}

/** 批量删除当前页选中客户 */
async function handleBatchDelete(): Promise<void> {
  const count = selectedIds.value.length;
  if (count === 0) return;

  const ok = await confirmStrong(
    t("customer.delete.confirmKeyword"),
    t("customer.delete.batchConfirmText", { count }),
    t("customer.delete.batchInputPlaceholder")
  );
  if (!ok) return;

  try {
    await Promise.all(selectedIds.value.map((id) => CustomerAPI.deleteById(String(id))));
    ElMessage.success(t("customer.delete.batchSuccess", { count }));
    clearSelection();
    dataTableRef.value?.clearSelection();
    await handleDataChanged();
  } catch {
    await handleDataChanged();
  }
}

// ── 客户详情抽屉（MVP-WEB-04-02）─────────────────────────────────────────
const detailVisible = ref(false);
const detailCustomerId = ref("");

/** 打开详情抽屉（保留列表上下文：筛选 / 排序 / 分页与滚动位置均不受影响） */
function openDetail(row: CustomerItem): void {
  detailCustomerId.value = row.id;
  detailVisible.value = true;
}

// ── 客户合并（MVP-WEB-04-03 · FR-7）──────────────────────────────────────
const mergeVisible = ref(false);
const mergeSource = ref<CustomerItem | null>(null);

/** 打开合并对话框：当前行默认作为「被合并客户」，可在对话框内交换方向 */
function openMerge(row: CustomerItem): void {
  mergeSource.value = row;
  mergeVisible.value = true;
}

// ── 分层分布（MVP-WEB-04-04 · FR-6 展示侧）───────────────────────────────
/** 分层分布统计（`null` = 未拉到 / 拉取失败 ⇒ 分布条整体不渲染） */
const lifecycleStats = ref<CustomerLifecycleStats | null>(null);

/**
 * 拉取分层分布统计（后端 `GET /customers/lifecycle-stats`，**全量租户口径**）
 *
 * 失败静默降级：分布是辅助的「钻取入口」，不得阻断客户列表主链路
 * （与 `fetchStoreOptions` / `fetchSourceOptions` 的降级口径一致）。
 * 只在首屏与**写操作后**（删除 / 合并会改变分层计数）刷新；筛选变化**不重拉**
 * —— 分布口径固定为全量，跟随筛选会让「选中一层后其余层归零」而使分布失去意义。
 */
async function fetchLifecycleStats(): Promise<void> {
  try {
    lifecycleStats.value = await CustomerAPI.getLifecycleStats();
  } catch {
    lifecycleStats.value = null;
  }
}

/**
 * 点击分层块 → 钻取筛选
 *
 * 再次点击**已选中**的分层等价于取消（chip 直觉），并统一回到第一页。
 * 地址栏由 `params` 的深度监听同步（复用既有 `syncUrl`），此处不重复处理。
 */
function handleLifecycleSelect(lifecycle: number): void {
  params.lifecycle = params.lifecycle === lifecycle ? undefined : lifecycle;
  params.pageNum = 1;
  fetchList();
}

/** 清除分层筛选（保留其它筛选条件，与列表筛选下拉解耦） */
function handleLifecycleClear(): void {
  params.lifecycle = undefined;
  params.pageNum = 1;
  fetchList();
}

/** 写操作后的统一刷新：列表 + 分层分布（删除 / 合并都会改变分层计数） */
async function handleDataChanged(): Promise<void> {
  await fetchList();
  await fetchLifecycleStats();
}

// ── 初始化 ──────────────────────────────────────────────────────────────
onMounted(() => {
  fetchList();
  void fetchStoreOptions();
  void fetchSourceOptions();
  void fetchLifecycleStats();
});

/**
 * keep-alive 激活时按地址栏对齐状态（踩坑 122 · 本次实测定位）
 *
 * 工作区 `<component :key="route.fullPath">` + `<keep-alive>`（`LayoutMain.vue`）以
 * **fullPath 为缓存键**；而本页的筛选一律「先改 `params` → 深度监听同步地址栏」，
 * 因此键变化时被缓存的实例，其内存 `params` 已被改过、与地址栏不一致。
 * 当 query 回到曾被用过的取值（如从 `?lifecycle=4` 回到无 query），**复用的是那个
 * 缓存实例**：它不重跑 `setup`/`onMounted`，不重读地址栏，于是出现
 * 「地址栏已清筛选、列表却仍是旧筛选结果」的渲染态滞留（实测可稳定复现，
 * 且对既有的筛选下拉同样成立）。
 *
 * 修复：每次**非首次**激活都按地址栏重新对齐 `params` 并重取数据，使
 * 「地址栏 = 渲染态」成为不变式。仅作用于被缓存的实例，首次挂载仍走 `onMounted`
 * （`onActivated` 在首次挂载时也会触发，用 `hadActivated` 去重，避免首屏双请求）。
 */
let hadActivated = false;
onActivated(() => {
  if (!hadActivated) {
    hadActivated = true;
    return;
  }
  Object.assign(params, paramsFromQuery());
  createdRange.value =
    params.createdAtStart && params.createdAtEnd
      ? [params.createdAtStart, params.createdAtEnd]
      : null;
  void fetchList();
  void fetchLifecycleStats();
});
</script>

<style lang="scss" scoped>
/* 主名称列：链接式呈现（PRD《Web规范》§表格规范 2「主名称列（可点击进详情）」），
   点击打开右侧详情抽屉而非跳页（§页面模式 1） */
.customer-name {
  padding: 0;
  font-weight: 500;
}

:deep(.el-table__row) {
  cursor: default;
}
</style>
