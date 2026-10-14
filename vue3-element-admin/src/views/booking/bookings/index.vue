<template>
  <div class="page-container">
    <!-- 筛选区（PRD《Web规范》§布局与栅格 3：列表页布局固定三段之「筛选区」） -->
    <el-card class="page-search" shadow="never">
      <el-form ref="queryFormRef" :model="params" :inline="true" @submit.prevent>
        <el-form-item :label="t('booking.field.bookingNo')" prop="bookingNo">
          <el-input
            v-model="params.bookingNo"
            :placeholder="t('booking.search.bookingNoPlaceholder')"
            clearable
            class="w-[220px]"
            @keyup.enter="handleQuery"
          />
        </el-form-item>

        <el-form-item :label="t('booking.field.store')" prop="storeId">
          <el-select
            v-model="params.storeId"
            :placeholder="t('booking.search.storePlaceholder')"
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

        <el-form-item :label="t('booking.field.status')" prop="status">
          <el-select
            v-model="params.status"
            :placeholder="t('booking.search.statusPlaceholder')"
            clearable
            class="w-[150px]"
          >
            <el-option
              v-for="option in BOOKING_STATUS_OPTIONS"
              :key="option.value"
              :label="t(option.labelKey)"
              :value="option.value"
            />
          </el-select>
        </el-form-item>

        <el-form-item :label="t('booking.field.appointmentDate')">
          <el-date-picker
            v-model="bookingDateRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            :start-placeholder="t('booking.search.dateStart')"
            :end-placeholder="t('booking.search.dateEnd')"
            unlink-panels
            class="!w-[260px]"
          />
        </el-form-item>

        <el-form-item>
          <el-button type="primary" @click="handleQuery">
            {{ t("booking.search.search") }}
          </el-button>
          <el-button @click="handleReset">{{ t("booking.search.reset") }}</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card class="page-content" shadow="never">
      <div class="page-toolbar">
        <div class="page-toolbar__left">
          <!-- 新建入口（MVP-WEB-06-02）：权限 `booking:create` 不满足时**不渲染**
               （PRD《Web规范》§权限与视图 1） -->
          <el-button
            v-hasPerm="'booking:create'"
            type="primary"
            data-testid="booking-create-btn"
            @click="handleCreate"
          >
            {{ t("booking.action.create") }}
          </el-button>
        </div>

        <div class="page-toolbar__right">
          <ColumnSetting :controller="columnController" />
          <el-tooltip :content="t('booking.action.refresh')" placement="top">
            <el-button class="page-icon-btn" @click="fetchList">
              <el-icon><Refresh /></el-icon>
            </el-button>
          </el-tooltip>
          <el-tooltip :content="t('booking.action.fullscreen')" placement="top">
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
          :title="t('booking.empty.errorTitle')"
          :description="loadError"
          :action-text="t('booking.empty.errorRetry')"
          @action="fetchList"
        />

        <DataState
          v-else-if="list.length === 0"
          :variant="isFiltered ? 'filtered' : 'empty'"
          :title="isFiltered ? t('booking.empty.filteredTitle') : t('booking.empty.title')"
          :description="isFiltered ? t('booking.empty.filteredDesc') : t('booking.empty.desc')"
          :action-text="emptyActionText"
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
              <!-- 主名称列可点击进详情（PRD《Web规范》§表格规范 2「主名称列（可点击进详情）」）
                   详情以右侧抽屉承载（§页面模式 1），不跳页、保留列表筛选与滚动位置 -->
              <el-button
                v-if="column.key === 'bookingNo'"
                class="booking-no"
                type="primary"
                link
                @click="openDetail(row as BookingItem)"
              >
                {{ (row as BookingItem).bookingNo }}
              </el-button>

              <!-- 状态列：文案 / 语义色唯一取共享状态元信息（经 utils/booking.ts 派生），
                   本页不私写映射表（踩坑 126-bis 双源漂移） -->
              <el-tag
                v-else-if="column.key === 'status'"
                :type="bookingStatusTagType((row as BookingItem).status)"
              >
                {{ t(bookingStatusLabelKey((row as BookingItem).status)) }}
              </el-tag>

              <span v-else-if="column.key === 'appointmentDate'">
                {{ bookingDateLabel((row as BookingItem).bookingDate) }}
              </span>

              <span v-else-if="column.key === 'timeRange'">
                {{
                  bookingTimeRangeLabel(
                    (row as BookingItem).startTime,
                    (row as BookingItem).endTime
                  )
                }}
              </span>

              <!-- 关联实体列：服务端已回查补齐，缺失时渲染 `未指定` 而非裸 UUID -->
              <span v-else-if="column.key === 'store'">
                {{ displayText((row as BookingItem).storeName) }}
              </span>

              <span v-else-if="column.key === 'customer'">
                {{ displayText((row as BookingItem).customerName) }}
              </span>

              <span v-else-if="column.key === 'pet'">
                {{ displayText((row as BookingItem).petName) }}
              </span>

              <span v-else-if="column.key === 'service'">
                {{ displayText((row as BookingItem).serviceName) }}
              </span>

              <span v-else-if="column.key === 'employee'">
                {{ displayText((row as BookingItem).employeeName) }}
              </span>

              <span v-else-if="column.key === 'room'">
                {{ displayText((row as BookingItem).roomLabel) }}
              </span>

              <el-tooltip
                v-else-if="column.key === 'createdAt'"
                :content="cellText(row as BookingItem, column.key)"
                placement="top"
                :disabled="!cellRaw(row as BookingItem, column.key)"
              >
                <span>{{ formatTime(cellRaw(row as BookingItem, column.key)) }}</span>
              </el-tooltip>

              <span v-else>{{ cellText(row as BookingItem, column.key) }}</span>
            </template>
          </el-table-column>

          <!-- 操作列：本页只放**只读入口**。状态流转 / 改期 / 取消 / 爽约（06-05）走
               详情抽屉内的动作区（PRD《页面功能》：动作在详情抽屉里，按状态机 × 权限
               渲染）⇒ 列表行不复制一份按钮，避免「两处入口两套判据」而漂移。 -->
          <el-table-column fixed="right" :label="t('table.actions')" width="90" align="center">
            <template #default="{ row }">
              <el-button type="primary" size="small" link @click="openDetail(row as BookingItem)">
                {{ t("booking.action.detail") }}
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

    <!-- 预约详情抽屉（MVP-WEB-06-01；06-05 起内含状态流转动作区）：
         抽屉开关为交互瞬态，**不写进地址栏** —— 工作区组件按 route.fullPath（含 query）
         重建（踩坑 95），写 query 会在每次开合时整页重建、列表重新拉取并丢失筛选现场。
         动作成功后抽屉已就地刷新自身，列表由 `updated` 事件重取（不重置筛选）。 -->
    <BookingDetailDrawer
      v-model="detailVisible"
      :booking-id="detailBookingId"
      @updated="handleDetailUpdated"
    />

    <!-- 预约创建对话框（MVP-WEB-06-02）：门店选项复用列表页已加载数据 -->
    <BookingFormDialog
      v-model="formVisible"
      :store-options="storeOptions"
      @success="handleCreateSuccess"
    />
  </div>
</template>

<script setup lang="ts">
import { useFullscreen } from "@vueuse/core";
import type { FormInstance } from "element-plus";
import { FullScreen, Refresh } from "@element-plus/icons-vue";

import BookingAPI from "@/api/booking";
import type { BookingItem, BookingQueryParams } from "@/api/booking";
import StoreAPI from "@/api/store";
import ColumnSetting from "@/components/ColumnSetting/index.vue";
import DataState from "@/components/DataState/DataState.vue";
import TableSkeleton from "@/components/DataState/TableSkeleton.vue";
import BookingDetailDrawer from "./components/BookingDetailDrawer.vue";
import BookingFormDialog from "./components/BookingFormDialog.vue";
import { usePageTable, useTableColumns, useSse } from "@/composables";
import type { TableColumnDef } from "@/composables/useTableColumns";
import { hasPerm } from "@/utils/auth";
import {
  BOOKING_STATUS_OPTIONS,
  bookingDateLabel,
  bookingStatusLabelKey,
  bookingStatusTagType,
  bookingTimeRangeLabel,
} from "@/utils/booking";
import { formatTableDateTime } from "@/utils/format";
import { isApiError } from "@/utils/request";

/**
 * 预约列表 DataTable（MVP-WEB-06-01 预约列表与状态展示 / 06-02 预约创建表单）
 *
 * 规格来源：PRD《Web端页面清单》（路径 `bookings`，可见角色 超管 / 总部 / 店长 / 前台 /
 * 美容师 / 寄养员）+《预约管理》统一预约引擎（服务 / 宠物 / 客户 / 门店 / 员工 / 房间 /
 * 时间 / 容量 / 状态）+《Booking API》`GET /bookings` + `POST /bookings` +《Web规范》
 * （§布局与栅格 3 三段式、§表格规范、§空态/加载/错误态、§通用规则 2 地址栏还原、
 * §权限与视图 1 未上线入口不渲染）。
 *
 * 硬要求落地对照：
 *  1. 三段式布局：筛选区 / 数据区（占剩余高度、内部滚动）/ 分页器固定底部；
 *  2. 列数 > 8 ⇒ 列配置（显示 / 隐藏 / 顺序），偏好按账号持久化（`useTableColumns`）；
 *  3. 必带列：主名称列（预约单号，可点击进详情）/ 状态列 / 创建时间列；文本列左对齐、
 *     时间列统一 `YYYY-MM-DD HH:mm`（三天内相对表达）；
 *  4. 排序走服务端白名单（`bookingDate` / `startTime` / `createdAt` / `bookingNo` /
 *     `status`），白名单外后端静默回落 `bookingDate`；服务端另有 `id` 二级排序键
 *     保证并列（同日多单）时分页边界稳定；
 *  5. 两种空态（从未有数据 / 筛选无结果）+ 错误态（可读原因 + 重试）+ 骨架屏；
 *  6. 列表刷新不重置筛选；筛选与排序在地址栏可还原（支持分享定位）。
 *
 * 状态口径（**关键**）：`status` 是 snake_case 字符串，值域与语义色唯一取
 * `@peluvida/shared`（经 `utils/booking.ts` 派生文案 key 与标签类型），本页与抽屉
 * 都不私写状态映射表（踩坑 126-bis 双源漂移）。
 *
 * 创建入口（MVP-WEB-06-02）：工具栏「新建预约」+ 空态主行动，均以 `booking:create`
 * 门控；对话框成功后**回第 1 页重取**（新单默认 `status=pending`、`bookingDate` 为
 * 所选日期，落在默认「预约日期倒序」队列里可立即看到）。
 *
 * 边界说明（**不越界**）：预约日历（06-03）不在本页。状态流转 / 改期 / 取消 / 爽约
 * （06-05）的**入口**在详情抽屉的动作区（按状态机 × 权限渲染），本页只提供「详情」只读
 * 入口并消费抽屉的 `updated` 事件回源刷新 —— 列表行不放写操作按钮（PRD《页面功能》把
 * 动作放在详情抽屉里；两处入口会带来两套判据，正是踩坑 126-bis 要避免的）。
 * 容量预校验（06-04）已接入**创建表单**：提交前调 `POST /bookings/capacity-check`，
 * 不可用即阻止提交并给出冲突明细与可替代时段 —— 列表页本身不展示可用性信息。
 * 注意：创建端点自身仍**不做**容量校验（PRD「创建与校验之间不加锁，`confirm` 时二次
 * 校验」）⇒ 防超卖的权威点在 06-05 的 `confirm` 事务，本页/表单只做前置提示。
 * 「美容师、寄养员仅可见本人相关数据」属**数据权限**范畴（三级），与 customer / room /
 * pet 各域同口径：菜单已授予该角色，行级收窄待数据权限专项，本页不做前端裁剪。
 */
defineOptions({
  name: "Bookings",
  inheritAttrs: false,
});

const { t } = useI18n();
const router = useRouter();
const route = useRoute();

const tableWrapperRef = ref<HTMLElement | null>(null);
const { toggle: toggleFullscreen } = useFullscreen(tableWrapperRef);

const queryFormRef = ref<FormInstance>();

// ── 门店选项（筛选下拉）──────────────────────────────────────────────────
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
    // 门店选项拉取失败不阻断预约列表（筛选下拉为空即可，
    // 预约行上的门店名由服务端回查补齐，不依赖本选项）
    storeOptions.value = [];
  }
}

// ── 查询参数（含地址栏还原）──────────────────────────────────────────────
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_SORT_BY = "bookingDate";
const DEFAULT_ORDER = "DESC";

/**
 * 列 key → 后端排序字段
 *
 * 只有表头 `prop` 与后端白名单字段**同名**时才能直接透传；`appointmentDate` /
 * `timeRange` 是展示列（对应 `bookingDate` / `startTime`），必须显式映射，
 * 否则后端白名单会把它们当作非法值静默回落默认排序（表现为「点了表头没反应」）。
 */
const SORT_FIELD_BY_COLUMN: Record<string, string> = {
  bookingNo: "bookingNo",
  status: "status",
  appointmentDate: "bookingDate",
  timeRange: "startTime",
  createdAt: "createdAt",
};

/** 后端排序字段 → 列 key（用于还原表头默认排序指示） */
const COLUMN_BY_SORT_FIELD: Record<string, string> = Object.fromEntries(
  Object.entries(SORT_FIELD_BY_COLUMN).map(([column, field]) => [field, column])
);

/** 从地址栏还原筛选 / 排序 / 分页（PRD《Web规范》§通用规则 2） */
function paramsFromQuery(): BookingQueryParams {
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
  const statusValid =
    status !== undefined && BOOKING_STATUS_OPTIONS.some((o) => o.value === status);
  const sortByRaw = asString(query.sortBy);
  const sortByValid =
    sortByRaw !== undefined && Object.values(SORT_FIELD_BY_COLUMN).includes(sortByRaw);

  return {
    pageNum: asNumber(query.pageNum) ?? 1,
    pageSize: asNumber(query.pageSize) ?? DEFAULT_PAGE_SIZE,
    sortBy: sortByValid ? sortByRaw : DEFAULT_SORT_BY,
    order: (asString(query.order) ?? DEFAULT_ORDER).toUpperCase() as BookingQueryParams["order"],
    bookingNo: asString(query.bookingNo) ?? "",
    storeId: asString(query.storeId),
    status: statusValid ? (status as BookingQueryParams["status"]) : undefined,
    bookingDateStart: asString(query.bookingDateStart),
    bookingDateEnd: asString(query.bookingDateEnd),
  };
}

/**
 * 重置基准
 *
 * 恒为「无筛选」基线（而非地址栏带来的条件）：否则「重置」会回到一个带筛选的状态，
 * 与 PRD《Web规范》§空态 2「筛选无结果 → 清除筛选」语义冲突。
 */
const RESET_BASELINE: BookingQueryParams = {
  pageNum: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  sortBy: DEFAULT_SORT_BY,
  order: DEFAULT_ORDER,
  bookingNo: "",
  storeId: undefined,
  status: undefined,
  bookingDateStart: undefined,
  bookingDateEnd: undefined,
};

const { loading, list, total, params, fetchData, handleQuery, handleResetQuery } = usePageTable<
  BookingItem,
  BookingQueryParams
>({
  initialParams: { ...RESET_BASELINE },
  request: BookingAPI.getPage,
  onBeforeReset: () => {
    bookingDateRange.value = null;
    queryFormRef.value?.clearValidate();
  },
});

/** 用地址栏条件覆盖初始参数（一次性，之后以 params 为准） */
Object.assign(params, paramsFromQuery());

/** 预约日期区间（独立 ref，便于 el-date-picker 绑定） */
const bookingDateRange = ref<[string, string] | null>(
  params.bookingDateStart && params.bookingDateEnd
    ? [params.bookingDateStart, params.bookingDateEnd]
    : null
);

watch(bookingDateRange, (range) => {
  params.bookingDateStart = range?.[0];
  params.bookingDateEnd = range?.[1];
});

/**
 * 下拉 / 输入清空归一化
 *
 * `el-select` 清空时可能置空串：`storeId` 是 `@IsUUID`（空串 ⇒ 真 HTTP 400）、
 * `status` 是 `@IsIn`（空串 ⇒ 不在值域 ⇒ 400）。故统一归一为 `undefined`
 * （axios 跳过 undefined 参数，等价「不过滤」）。`bookingNo` 空串虽能通过校验，
 * 也一并对齐，避免地址栏留下无意义的 `bookingNo=`。
 */
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
    if (!BOOKING_STATUS_OPTIONS.some((option) => option.value === raw)) {
      params.status = undefined;
    }
  }
);

watch(
  () => params.bookingNo,
  (value) => {
    if (value === null || value === undefined) params.bookingNo = "";
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
    Boolean(params.bookingNo) ||
    Boolean(params.storeId) ||
    params.status !== undefined ||
    Boolean(params.bookingDateStart) ||
    Boolean(params.bookingDateEnd)
);

/** 空态主行动文案：筛选无结果 ⇒ 清除筛选；从未有数据 ⇒ 有权限者直接新建 */
const emptyActionText = computed(() => {
  if (isFiltered.value) return t("booking.action.clearFilter");
  return hasPerm("booking:create") ? t("booking.action.create") : "";
});

/** 空态主行动：错误态重试已在模板单独处理，这里只处理两种空态 */
function handleEmptyAction(): void {
  if (isFiltered.value) {
    handleReset();
    return;
  }
  if (hasPerm("booking:create")) handleCreate();
}

/** 重置筛选（并清理地址栏） */
function handleReset(): void {
  handleResetQuery();
  void syncUrl();
}

// ── 地址栏同步（PRD《Web规范》§通用规则 2：支持分享定位）──────────────
function syncUrl(): Promise<void> {
  const query: Record<string, string> = {};
  if (params.bookingNo) query.bookingNo = params.bookingNo;
  if (params.storeId) query.storeId = params.storeId;
  if (params.status) query.status = params.status;
  if (params.bookingDateStart) query.bookingDateStart = params.bookingDateStart;
  if (params.bookingDateEnd) query.bookingDateEnd = params.bookingDateEnd;
  if (params.sortBy && params.sortBy !== DEFAULT_SORT_BY) query.sortBy = params.sortBy;
  if (params.order && String(params.order).toUpperCase() !== DEFAULT_ORDER) {
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
  { key: "bookingNo", label: t("booking.field.bookingNo"), fixed: true },
  { key: "status", label: t("booking.field.status"), fixed: true },
  { key: "appointmentDate", label: t("booking.field.appointmentDate"), fixed: true },
  { key: "timeRange", label: t("booking.field.timeRange") },
  { key: "store", label: t("booking.field.store") },
  { key: "customer", label: t("booking.field.customer") },
  { key: "pet", label: t("booking.field.pet") },
  { key: "service", label: t("booking.field.service") },
  { key: "employee", label: t("booking.field.employee") },
  { key: "room", label: t("booking.field.room") },
  { key: "remark", label: t("booking.field.remark") },
  { key: "createdAt", label: t("booking.field.createdAt") },
];

/** 列宽 / 对齐 / 排序能力（sortable 仅限后端白名单字段所属列） */
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
  bookingNo: { width: 170, custom: true, sortable: true },
  status: { width: 110, align: "center", custom: true, sortable: true },
  appointmentDate: { width: 130, custom: true, sortable: true },
  timeRange: { width: 140, custom: true, sortable: true },
  store: { minWidth: 140, custom: true },
  customer: { minWidth: 120, custom: true },
  pet: { minWidth: 120, custom: true },
  service: { minWidth: 130, custom: true },
  employee: { minWidth: 110, custom: true },
  room: { minWidth: 110, custom: true },
  remark: { minWidth: 180 },
  createdAt: { width: 170, custom: true, sortable: true },
};

const columnController = useTableColumns({
  namespace: "bookings",
  columns: COLUMN_DEFS,
});

const visibleColumns = columnController.visibleColumns;

// ── 单元格渲染 ──────────────────────────────────────────────────────────
/** 关联实体展示文本（服务端回查缺失 ⇒ `未指定`，不渲染裸 UUID） */
function displayText(value: string | null | undefined): string {
  const text = value === undefined || value === null ? "" : String(value).trim();
  return text === "" ? t("booking.value.unset") : text;
}

/** 单元格原始值（未加工，空值返回 `undefined`） */
function cellRaw(row: BookingItem, key: string): string | undefined {
  const value = (row as unknown as Record<string, unknown>)[key];
  if (value === undefined || value === null || value === "") return undefined;
  return String(value);
}

/** 单元格文本（空值占位 `-`） */
function cellText(row: BookingItem, key: string): string {
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
  prop: COLUMN_BY_SORT_FIELD[params.sortBy ?? DEFAULT_SORT_BY] ?? "appointmentDate",
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

// ── 预约详情抽屉（MVP-WEB-06-01）─────────────────────────────────────────
const detailVisible = ref(false);
const detailBookingId = ref("");

/** 打开详情抽屉（保留列表上下文：筛选 / 排序 / 分页与滚动位置均不受影响） */
function openDetail(row: BookingItem): void {
  detailBookingId.value = row.id;
  detailVisible.value = true;
}

/**
 * 抽屉内发生状态流转（确认 / 到店 / 开始 / 完成 / 改期 / 取消 / 爽约）⇒ 重取当前页
 *
 * 抽屉自己已就地刷新（服务端出参带流转后的预约），但**列表行还是旧状态** ⇒ 必须回源。
 * 刻意不重置筛选与页码（PRD《Web规范》§通用规则 1「列表刷新不重置筛选」）：
 * 例如「筛选 = 待确认」时确认一单，该行会自然从当前筛选结果里消失 —— 这是正确反馈。
 */
function handleDetailUpdated(): void {
  void fetchList();
}

// ── 预约创建（MVP-WEB-06-02）─────────────────────────────────────────────
const formVisible = ref(false);

/** 打开创建对话框（入口由 `booking:create` 门控，无权限时按钮不渲染） */
function handleCreate(): void {
  formVisible.value = true;
}

/**
 * 创建成功：回第 1 页并重取列表
 *
 * 不复位筛选（PRD《Web规范》§通用规则 1「列表刷新不重置筛选」）：新单可能落在
 * 当前筛选之外，但用户能通过清空筛选自行查看 —— 强行清筛选会丢失现场。
 */
function handleCreateSuccess(): void {
  params.pageNum = 1;
  void fetchList();
}

// ── 初始化 ──────────────────────────────────────────────────────────────
onMounted(() => {
  fetchList();
  void fetchStoreOptions();
});

/**
 * SSE 预约通知订阅（MVP-WEB-06-06）
 *
 * 后端状态流转后推送 `booking-notification` 事件，前端收到后刷新列表。
 * 与 dashboard 页的 SSE 订阅同原则：信号驱动刷新，不携带业务数据。
 */
const sse = useSse();
let sseUnsubscribe: (() => void) | null = null;
onMounted(() => {
  sseUnsubscribe = sse.on("booking-notification", () => {
    void fetchList();
  });
});
onBeforeUnmount(() => {
  sseUnsubscribe?.();
  sseUnsubscribe = null;
});

/**
 * keep-alive 激活时按地址栏对齐状态（踩坑 122）
 *
 * 工作区 `<component :key="route.fullPath">` + `<keep-alive>` 以 **fullPath 为缓存键**；
 * 本页筛选一律「先改 `params` → 深度监听同步地址栏」，故 query 回到曾用过的取值时
 * 会复用那个缓存实例（不重跑 `setup`/`onMounted`），出现「地址栏已清筛选、渲染未变」
 * 的滞留。修复：每次**非首次**激活都按地址栏重新对齐 `params` 并重取数据，
 * 使「地址栏 = 渲染态」成为不变式。首次挂载走 `onMounted`（`onActivated` 首挂也触发，
 * 用 `hadActivated` 去重，避免首屏双请求）。
 */
let hadActivated = false;
onActivated(() => {
  if (!hadActivated) {
    hadActivated = true;
    return;
  }
  Object.assign(params, paramsFromQuery());
  bookingDateRange.value =
    params.bookingDateStart && params.bookingDateEnd
      ? [params.bookingDateStart, params.bookingDateEnd]
      : null;
  void fetchList();
});
</script>

<style lang="scss" scoped>
/* 主名称列：链接式呈现（PRD《Web规范》§表格规范 2「主名称列（可点击进详情）」），
   点击打开右侧详情抽屉而非跳页（§页面模式 1） */
.booking-no {
  padding: 0;
  font-weight: 500;
}

:deep(.el-table__row) {
  cursor: default;
}
</style>
