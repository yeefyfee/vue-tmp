<template>
  <div class="page-container">
    <!-- 筛选区（PRD《Web规范》§布局与栅格 3：列表页布局固定三段之「筛选区」） -->
    <el-card class="page-search" shadow="never">
      <el-form ref="queryFormRef" :model="params" :inline="true" @submit.prevent>
        <el-form-item :label="t('room.field.store')" prop="storeId">
          <el-select
            v-model="params.storeId"
            :placeholder="t('room.search.storePlaceholder')"
            clearable
            class="w-[200px]"
          >
            <el-option
              v-for="store in storeOptions"
              :key="store.id"
              :label="store.name"
              :value="store.id"
            />
          </el-select>
        </el-form-item>

        <el-form-item :label="t('room.field.roomNo')" prop="roomNo">
          <el-input
            v-model="params.roomNo"
            :placeholder="t('room.search.roomNoPlaceholder')"
            clearable
            class="w-[160px]"
            @keyup.enter="handleQuery"
          />
        </el-form-item>

        <el-form-item :label="t('room.field.roomType')" prop="roomType">
          <el-select
            v-model="params.roomType"
            :placeholder="t('room.search.roomTypePlaceholder')"
            clearable
            class="w-[140px]"
          >
            <el-option :label="t('room.value.typeKennel')" :value="RoomType.KENNEL" />
            <el-option :label="t('room.value.typeSuite')" :value="RoomType.SUITE" />
            <el-option :label="t('room.value.typeCat')" :value="RoomType.CAT" />
            <el-option :label="t('room.value.typeDog')" :value="RoomType.DOG" />
            <el-option :label="t('room.value.typeVip')" :value="RoomType.VIP" />
            <el-option :label="t('room.value.typeMulti')" :value="RoomType.MULTI" />
          </el-select>
        </el-form-item>

        <el-form-item :label="t('room.field.status')" prop="status">
          <el-select
            v-model="params.status"
            :placeholder="t('room.search.statusPlaceholder')"
            clearable
            class="w-[140px]"
          >
            <el-option :label="t('room.value.statusAvailable')" :value="RoomStatus.AVAILABLE" />
            <el-option :label="t('room.value.statusOccupied')" :value="RoomStatus.OCCUPIED" />
            <el-option :label="t('room.value.statusCleaning')" :value="RoomStatus.CLEANING" />
            <el-option :label="t('room.value.statusMaintenance')" :value="RoomStatus.MAINTENANCE" />
          </el-select>
        </el-form-item>

        <el-form-item>
          <el-button type="primary" @click="handleQuery">{{ t("room.search.search") }}</el-button>
          <el-button @click="handleReset">{{ t("room.search.reset") }}</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card class="page-content" shadow="never">
      <div class="page-toolbar">
        <div class="page-toolbar__left">
          <el-button v-hasPerm="'room:create'" type="primary" @click="handleCreate()">
            {{ t("room.action.create") }}
          </el-button>
          <el-button
            v-hasPerm="'room:delete'"
            type="danger"
            :disabled="!hasSelection"
            @click="handleBatchDelete()"
          >
            {{ t("room.action.batchDelete") }}
            <template v-if="selectedIds.length">（{{ selectedIds.length }}）</template>
          </el-button>
        </div>

        <div class="page-toolbar__right">
          <ColumnSetting :controller="columnController" />
          <el-tooltip :content="t('room.action.refresh')" placement="top">
            <el-button class="page-icon-btn" @click="fetchList">
              <el-icon><Refresh /></el-icon>
            </el-button>
          </el-tooltip>
          <el-tooltip :content="t('room.action.fullscreen')" placement="top">
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
          :title="t('room.empty.errorTitle')"
          :description="loadError"
          :action-text="t('room.empty.errorRetry')"
          @action="fetchList"
        />

        <DataState
          v-else-if="list.length === 0"
          :variant="isFiltered ? 'filtered' : 'empty'"
          :title="isFiltered ? t('room.empty.filteredTitle') : t('room.empty.title')"
          :description="isFiltered ? t('room.empty.filteredDesc') : t('room.empty.desc')"
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
              <!-- 主名称列：可点击进详情（PRD《Web规范》§表格规范 2；名称缺省回退编号） -->
              <el-link
                v-if="column.key === 'name'"
                type="primary"
                :underline="false"
                @click="handleView(row as RoomItem)"
              >
                {{ displayName(row as RoomItem) }}
              </el-link>

              <el-tag
                v-else-if="column.key === 'roomType'"
                effect="plain"
                :type="roomTypeTagType((row as RoomItem).roomType)"
              >
                {{ roomTypeLabel((row as RoomItem).roomType) }}
              </el-tag>

              <el-tag v-else-if="column.key === 'capacity'" type="info" effect="plain">
                {{ t("room.value.capacityUnit", { count: (row as RoomItem).capacity }) }}
              </el-tag>

              <el-tag
                v-else-if="column.key === 'status'"
                :type="statusTagType((row as RoomItem).status)"
              >
                {{ statusLabel((row as RoomItem).status) }}
              </el-tag>

              <el-tooltip
                v-else-if="column.key === 'createdAt' || column.key === 'updatedAt'"
                :content="cellText(row as RoomItem, column.key)"
                placement="top"
                :disabled="!cellRaw(row as RoomItem, column.key)"
              >
                <span>{{ formatTime(cellRaw(row as RoomItem, column.key)) }}</span>
              </el-tooltip>

              <span v-else>{{ cellText(row as RoomItem, column.key) }}</span>
            </template>
          </el-table-column>

          <el-table-column
            v-if="canWrite"
            fixed="right"
            :label="t('table.actions')"
            width="230"
            align="center"
          >
            <template #default="{ row }">
              <!-- 房态维护切换：仅空闲 ↔ 维护中可用（在住 / 清扫中由入住流程流转） -->
              <el-tooltip
                v-if="hasPerm('room:update')"
                :content="maintenanceTip(row as RoomItem)"
                placement="top"
                :disabled="isMaintenanceSwitchable(row as RoomItem)"
              >
                <span>
                  <el-button
                    type="warning"
                    size="small"
                    link
                    :disabled="!isMaintenanceSwitchable(row as RoomItem)"
                    @click="handleSwitchStatus(row as RoomItem)"
                  >
                    {{
                      (row as RoomItem).status === RoomStatus.MAINTENANCE
                        ? t("room.action.restore")
                        : t("room.action.maintenance")
                    }}
                  </el-button>
                </span>
              </el-tooltip>
              <el-button
                v-hasPerm="'room:update'"
                type="primary"
                size="small"
                link
                @click="handleEdit(row as RoomItem)"
              >
                {{ t("room.action.edit") }}
              </el-button>
              <el-button
                v-hasPerm="'room:delete'"
                type="danger"
                size="small"
                link
                @click="handleDelete(row as RoomItem)"
              >
                {{ t("room.action.delete") }}
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

    <RoomFormDrawer
      v-model="drawerVisible"
      :mode="drawerMode"
      :room-id="activeRoomId"
      :store-options="storeOptions"
      @success="handleSaved"
    />
  </div>
</template>

<script setup lang="ts">
import { useFullscreen } from "@vueuse/core";
import { ElMessage, ElMessageBox, type FormInstance } from "element-plus";
import { FullScreen, Refresh } from "@element-plus/icons-vue";

import RoomAPI from "@/api/room";
import type { RoomItem, RoomQueryParams } from "@/api/room";
import StoreAPI from "@/api/store";
import ColumnSetting from "@/components/ColumnSetting/index.vue";
import DataState from "@/components/DataState/DataState.vue";
import TableSkeleton from "@/components/DataState/TableSkeleton.vue";
import RoomFormDrawer from "./components/RoomFormDrawer.vue";
import { usePageTable, useTableColumns, useTableSelection } from "@/composables";
import type { TableColumnDef } from "@/composables/useTableColumns";
import { RoomStatus, RoomType } from "@/enums";
import { hasPerm } from "@/utils/auth";
import { isApiError } from "@/utils/request";
import { formatTableDateTime } from "@/utils/format";

/**
 * 房间资源管理列表页（MVP-WEB-02-02）
 *
 * 规格来源：PRD《Web规范》（三段式布局、表格规范、空态/加载/错误态、通用规则）
 * +《交互规范》（操作反馈分级、确认文案含影响范围）
 * + 后端 `niulai-nest/src/room/room.controller.ts`（P0-04-03 · FR-2）真实契约。
 *
 * 与门店页（02-01）的差异点：
 *  1. 房间必属门店 ⇒ 筛选区首项为门店下拉，列表「所属门店」列由 storeId 映射门店名；
 *  2. 房态是**运行时状态**（1 空闲 / 2 在住 / 3 清扫中 / 4 维护中），非 CRUD 字段 ——
 *     列表页提供「房态维护切换」（仅 1 ↔ 4，后端 `PATCH /rooms/:id/status`），
 *     在住 / 清扫中由 stay 状态机流转，入口置灰并给出原因（PRD「隐藏/禁用优于报错」）；
 *  3. 排序白名单与门店不同：仅 `createdAt / roomNo / roomType / status`（后端 service 收敛）。
 *
 * 已知边界：房态看板与房态图（`GET /rooms/availability`）归 MVP-WEB-09-01，
 * 本页不含看板视图。
 */
defineOptions({
  name: "Rooms",
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
const canWrite = computed(() => hasPerm("room:update") || hasPerm("room:delete"));

// ── 门店选项（筛选下拉 + 表单下拉 + 列表列名映射）────────────────────────
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
    // 门店选项拉取失败不阻断列表（列名回退为门店 ID 短码）
    storeOptions.value = [];
  }
}

/** storeId → 门店名（未命中时回退 ID 前 8 位，避免出现令人困惑的空值） */
const storeNameMap = computed(() => {
  const map = new Map<string, string>();
  for (const store of storeOptions.value) map.set(store.id, store.name);
  return map;
});

function storeName(storeId: string): string {
  return storeNameMap.value.get(storeId) ?? (storeId ? `${storeId.slice(0, 8)}…` : "-");
}

// ── 查询参数（含地址栏还原）──────────────────────────────────────────────
const DEFAULT_PAGE_SIZE = 20;

/** 从地址栏还原筛选 / 排序 / 分页（PRD《Web规范》§通用规则 2） */
function paramsFromQuery(): RoomQueryParams {
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

  const roomType = asNumber(query.roomType);
  const status = asNumber(query.status);

  return {
    pageNum: asNumber(query.pageNum) ?? 1,
    pageSize: asNumber(query.pageSize) ?? DEFAULT_PAGE_SIZE,
    sortBy: asString(query.sortBy) ?? "createdAt",
    order: (asString(query.order) ?? "DESC").toUpperCase() as RoomQueryParams["order"],
    storeId: asString(query.storeId),
    roomNo: asString(query.roomNo) ?? "",
    roomType: roomType && roomType >= 1 && roomType <= 6 ? roomType : undefined,
    status: status && status >= 1 && status <= 4 ? status : undefined,
  };
}

/**
 * 重置基准
 *
 * 恒为「无筛选」基线（而非地址栏带来的条件）：否则「重置」会回到一个带筛选的状态，
 * 与 PRD《Web规范》§空态 2「筛选无结果 → 清除筛选」语义冲突。
 */
const RESET_BASELINE: RoomQueryParams = {
  pageNum: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  sortBy: "createdAt",
  order: "DESC",
  storeId: undefined,
  roomNo: "",
  roomType: undefined,
  status: undefined,
};

const { loading, list, total, params, fetchData, handleQuery, handleResetQuery } = usePageTable<
  RoomItem,
  RoomQueryParams
>({
  initialParams: { ...RESET_BASELINE },
  request: RoomAPI.getPage,
  onBeforeReset: () => {
    queryFormRef.value?.clearValidate();
  },
});

/** 用地址栏条件覆盖初始参数（一次性，之后以 params 为准） */
Object.assign(params, paramsFromQuery());

/**
 * 下拉清空归一化
 *
 * `el-select` 清空时可能置空串，而后端 `QueryRoomDto` 的 `status` 是 `@IsIn([1,2,3,4])`、
 * `roomType` 是 `@IsIn([1..6])` —— 空串会被判定为非法值并抛真 HTTP 400（踩坑 52）。
 * 故统一归一为 `undefined`（axios 会跳过 undefined 参数，等价于「不过滤」）。
 */
watch(
  () => params.status,
  (value) => {
    const raw = value as unknown;
    if (raw !== 1 && raw !== 2 && raw !== 3 && raw !== 4 && raw !== undefined) {
      params.status = undefined;
    }
  }
);

watch(
  () => params.roomType,
  (value) => {
    const raw = value as unknown;
    if (
      raw !== 1 &&
      raw !== 2 &&
      raw !== 3 &&
      raw !== 4 &&
      raw !== 5 &&
      raw !== 6 &&
      raw !== undefined
    ) {
      params.roomType = undefined;
    }
  }
);

watch(
  () => params.storeId,
  (value) => {
    if (value === "" || value === null) params.storeId = undefined;
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
    Boolean(params.storeId) ||
    Boolean(params.roomNo) ||
    params.roomType !== undefined ||
    params.status !== undefined
);

const emptyActionText = computed(() => {
  if (isFiltered.value) return t("room.action.clearFilter");
  return hasPerm("room:create") ? t("room.action.create") : "";
});

/** 空态主行动：错误态重试已在模板单独处理，这里只处理两种空态 */
function handleEmptyAction(): void {
  if (isFiltered.value) {
    handleReset();
    return;
  }
  if (hasPerm("room:create")) handleCreate();
}

/** 重置筛选（并清理地址栏） */
function handleReset(): void {
  handleResetQuery();
  void syncUrl();
}

// ── 地址栏同步（PRD《Web规范》§通用规则 2：支持分享定位）──────────────
function syncUrl(): Promise<void> {
  const query: Record<string, string> = {};
  if (params.storeId) query.storeId = params.storeId;
  if (params.roomNo) query.roomNo = params.roomNo;
  if (params.roomType !== undefined) query.roomType = String(params.roomType);
  if (params.status !== undefined) query.status = String(params.status);
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
  { key: "name", label: t("room.field.name"), fixed: true },
  { key: "roomNo", label: t("room.field.roomNo") },
  { key: "store", label: t("room.field.store") },
  { key: "roomType", label: t("room.field.roomType") },
  { key: "capacity", label: t("room.field.capacity") },
  { key: "status", label: t("room.field.status"), fixed: true },
  { key: "updatedAt", label: t("room.field.updatedAt"), fixed: true },
  { key: "createdAt", label: t("room.field.createdAt"), visible: false },
];

/** 列宽 / 对齐 / 排序能力（sortable 仅限后端白名单：createdAt/roomNo/roomType/status） */
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
  name: { minWidth: 160, custom: true },
  roomNo: { width: 140, sortable: true },
  store: { minWidth: 180 },
  roomType: { width: 120, align: "center", custom: true, sortable: true },
  capacity: { width: 110, align: "center", custom: true },
  status: { width: 100, align: "center", custom: true, sortable: true },
  updatedAt: { width: 170, custom: true },
  createdAt: { width: 170, custom: true, sortable: true },
};

const columnController = useTableColumns({
  namespace: "rooms",
  columns: COLUMN_DEFS,
});

const visibleColumns = columnController.visibleColumns;

const { selectedIds, hasSelection, handleSelectionChange, clearSelection } =
  useTableSelection<RoomItem>();

// ── 单元格渲染 ──────────────────────────────────────────────────────────
/** 主名称：名称缺省回退编号（与后端「看板优先显示名称」口径一致） */
function displayName(row: RoomItem): string {
  return row.name && String(row.name).trim() !== "" ? row.name : row.roomNo;
}

function roomTypeLabel(type: number): string {
  switch (type) {
    case RoomType.SUITE:
      return t("room.value.typeSuite");
    case RoomType.CAT:
      return t("room.value.typeCat");
    case RoomType.DOG:
      return t("room.value.typeDog");
    case RoomType.VIP:
      return t("room.value.typeVip");
    case RoomType.MULTI:
      return t("room.value.typeMulti");
    default:
      return t("room.value.typeKennel");
  }
}

function roomTypeTagType(type: number): "primary" | "success" | "warning" | "info" | "danger" {
  switch (type) {
    case RoomType.VIP:
      return "warning";
    case RoomType.MULTI:
      return "danger";
    case RoomType.CAT:
      return "success";
    default:
      return "info";
  }
}

function statusLabel(status: number): string {
  switch (status) {
    case RoomStatus.OCCUPIED:
      return t("room.value.statusOccupied");
    case RoomStatus.CLEANING:
      return t("room.value.statusCleaning");
    case RoomStatus.MAINTENANCE:
      return t("room.value.statusMaintenance");
    default:
      return t("room.value.statusAvailable");
  }
}

function statusTagType(status: number): "success" | "warning" | "info" | "danger" | "primary" {
  switch (status) {
    case RoomStatus.OCCUPIED:
      return "primary";
    case RoomStatus.CLEANING:
      return "warning";
    case RoomStatus.MAINTENANCE:
      return "info";
    default:
      return "success";
  }
}

/** 单元格原始值（未加工，空值返回 `undefined`） */
function cellRaw(row: RoomItem, key: string): string | undefined {
  const value = (row as unknown as Record<string, unknown>)[key];
  if (value === undefined || value === null || value === "") return undefined;
  return String(value);
}

/** 单元格文本（所属门店映射 / 空值占位） */
function cellText(row: RoomItem, key: string): string {
  if (key === "store") return storeName(row.storeId);
  if (key === "name") return displayName(row);
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
const activeRoomId = ref("");

function openDrawer(mode: "create" | "edit" | "view", id = ""): void {
  drawerMode.value = mode;
  activeRoomId.value = id;
  drawerVisible.value = true;
}

function handleCreate(): void {
  openDrawer("create");
}

function handleEdit(row: RoomItem): void {
  openDrawer("edit", row.id);
}

/** 主名称列点击 → 详情抽屉（保留列表上下文） */
function handleView(row: RoomItem): void {
  openDrawer("view", row.id);
}

/** 保存成功：提示 + 刷新（新建回到第一页，编辑保留当前页） */
function handleSaved(payload: { mode: "create" | "edit" }): void {
  if (payload.mode === "create") {
    ElMessage.success(t("room.form.createSuccess"));
    handleQuery();
    return;
  }
  ElMessage.success(t("room.form.updateSuccess"));
  fetchList();
}

// ── 房态维护切换（仅 1 ↔ 4）─────────────────────────────────────────────
/** 仅空闲（1）与维护中（4）可人工切换；在住 / 清扫中由入住流程流转 */
function isMaintenanceSwitchable(row: RoomItem): boolean {
  return row.status === RoomStatus.AVAILABLE || row.status === RoomStatus.MAINTENANCE;
}

function maintenanceTip(row: RoomItem): string {
  if (isMaintenanceSwitchable(row)) return "";
  return t("room.status.invalidTip");
}

/** 房态维护切换：二次确认 → PATCH /rooms/:id/status */
async function handleSwitchStatus(row: RoomItem): Promise<void> {
  if (!isMaintenanceSwitchable(row)) return;

  const toMaintenance = row.status === RoomStatus.AVAILABLE;
  const targetStatus = toMaintenance ? RoomStatus.MAINTENANCE : RoomStatus.AVAILABLE;
  const no = displayName(row);

  try {
    await ElMessageBox.confirm(
      t(toMaintenance ? "room.status.confirmToMaintenance" : "room.status.confirmToAvailable", {
        no,
      }),
      t("room.status.title"),
      {
        confirmButtonText: t("room.form.submit"),
        cancelButtonText: t("room.form.cancel"),
        type: "warning",
      }
    );
  } catch {
    return;
  }

  try {
    await RoomAPI.switchStatus(row.id, { status: targetStatus });
    ElMessage.success(
      t(toMaintenance ? "room.status.toMaintenanceSuccess" : "room.status.toAvailableSuccess", {
        no,
      })
    );
    await fetchList();
  } catch {
    // 失败提示由请求层统一渲染（含可读原因），此处不再重复弹窗
    await fetchList();
  }
}

// ── 删除（强确认：输入房间编号 / 「确认」二字）───────────────────────────
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
    const { value } = await ElMessageBox.prompt(message, t("room.delete.title"), {
      confirmButtonText: t("room.action.delete"),
      cancelButtonText: t("room.form.cancel"),
      inputPlaceholder: placeholder,
      inputValidator: (input: string) => String(input ?? "").trim() === expected,
      inputErrorMessage: t("room.delete.mismatch"),
      type: "warning",
    });
    return String(value ?? "").trim() === expected;
  } catch {
    return false;
  }
}

/** 删除单个房间 */
async function handleDelete(row: RoomItem): Promise<void> {
  const ok = await confirmStrong(
    row.roomNo,
    t("room.delete.confirmText", { no: row.roomNo }),
    t("room.delete.inputPlaceholder")
  );
  if (!ok) return;

  try {
    await RoomAPI.deleteById(row.id);
    ElMessage.success(t("room.delete.success"));
    await fetchList();
  } catch {
    // 失败提示由请求层统一渲染（含可读原因），此处不再重复弹窗
  }
}

/** 批量删除当前页选中房间 */
async function handleBatchDelete(): Promise<void> {
  const count = selectedIds.value.length;
  if (count === 0) return;

  const ok = await confirmStrong(
    t("room.delete.confirmKeyword"),
    t("room.delete.batchConfirmText", { count }),
    t("room.delete.batchInputPlaceholder")
  );
  if (!ok) return;

  try {
    await Promise.all(selectedIds.value.map((id) => RoomAPI.deleteById(String(id))));
    ElMessage.success(t("room.delete.batchSuccess", { count }));
    clearSelection();
    dataTableRef.value?.clearSelection();
    await fetchList();
  } catch {
    await fetchList();
  }
}

// ── 初始化 ──────────────────────────────────────────────────────────────
onMounted(async () => {
  await fetchStoreOptions();
  await fetchList();
});
</script>

<style lang="scss" scoped>
/* 状态列 / 类型列 / 容量列居中、文本列左对齐由 el-table-column 的 align 控制（已在模板指定） */
:deep(.el-table__row) {
  cursor: default;
}
</style>
