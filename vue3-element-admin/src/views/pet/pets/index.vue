<template>
  <div class="page-container">
    <!-- 筛选区（PRD《Web规范》§布局与栅格 3：列表页布局固定三段之「筛选区」） -->
    <el-card class="page-search" shadow="never">
      <el-form ref="queryFormRef" :model="params" :inline="true" @submit.prevent>
        <el-form-item :label="t('pet.field.name')" prop="name">
          <el-input
            v-model="params.name"
            :placeholder="t('pet.search.namePlaceholder')"
            clearable
            class="w-[200px]"
            @keyup.enter="handleQuery"
          />
        </el-form-item>

        <el-form-item :label="t('pet.field.petType')" prop="petType">
          <el-select
            v-model="params.petType"
            :placeholder="t('pet.search.petTypePlaceholder')"
            clearable
            class="w-[140px]"
          >
            <el-option
              v-for="option in PET_TYPE_OPTIONS"
              :key="option.value"
              :label="t(option.labelKey)"
              :value="option.value"
            />
          </el-select>
        </el-form-item>

        <el-form-item :label="t('pet.field.owner')" prop="ownerCustomerId">
          <CustomerPickerSelect
            v-model="params.ownerCustomerId"
            :placeholder="t('pet.search.ownerPlaceholder')"
            class="w-[200px]"
          />
        </el-form-item>

        <el-form-item :label="t('pet.field.store')" prop="storeId">
          <el-select
            v-model="params.storeId"
            :placeholder="t('pet.search.storePlaceholder')"
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

        <el-form-item :label="t('pet.field.createdAt')">
          <el-date-picker
            v-model="createdRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            :start-placeholder="t('pet.search.dateStart')"
            :end-placeholder="t('pet.search.dateEnd')"
            unlink-panels
            class="!w-[260px]"
          />
        </el-form-item>

        <el-form-item>
          <el-button type="primary" @click="handleQuery">{{ t("pet.search.search") }}</el-button>
          <el-button @click="handleReset">{{ t("pet.search.reset") }}</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 健康到期提醒条（MVP-WEB-05-02）：跨宠物疫苗/驱虫到期与**已过期**清单。
         刻意放在「筛选区」与「数据区」两张卡**之间**，而不是塞进 `.page-content`：
         内容卡 `.el-card__body` 是三段式 grid（auto/1fr/auto），直接子元素超过 3 个会
         把此后的块压进 1fr 滚动行、撑破 body 被 `overflow:hidden` 裁掉（踩坑 96）。 -->
    <PetHealthReminderBar ref="reminderBarRef" @navigate="openProfileById" />

    <el-card class="page-content" shadow="never">
      <div class="page-toolbar">
        <div class="page-toolbar__left">
          <el-button
            v-hasPerm="'pet:delete'"
            type="danger"
            :disabled="!hasSelection"
            @click="handleBatchDelete()"
          >
            {{ t("pet.action.batchDelete") }}
            <template v-if="selectedIds.length">（{{ selectedIds.length }}）</template>
          </el-button>
        </div>

        <div class="page-toolbar__right">
          <el-button v-hasPerm="'pet:create'" type="primary" @click="openCreate">
            {{ t("pet.action.create") }}
          </el-button>
          <ColumnSetting :controller="columnController" />
          <el-tooltip :content="t('pet.action.refresh')" placement="top">
            <el-button class="page-icon-btn" @click="handleRefreshAll">
              <el-icon><Refresh /></el-icon>
            </el-button>
          </el-tooltip>
          <el-tooltip :content="t('pet.action.fullscreen')" placement="top">
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
          :title="t('pet.empty.errorTitle')"
          :description="loadError"
          :action-text="t('pet.empty.errorRetry')"
          @action="fetchList"
        />

        <DataState
          v-else-if="list.length === 0"
          :variant="isFiltered ? 'filtered' : 'empty'"
          :title="isFiltered ? t('pet.empty.filteredTitle') : t('pet.empty.title')"
          :description="isFiltered ? t('pet.empty.filteredDesc') : t('pet.empty.desc')"
          :action-text="isFiltered ? t('pet.action.clearFilter') : ''"
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
              <!-- 主名称列可点击进档案页（PRD《Web规范》§表格规范 2「主名称列可点击进详情」）。
                   宠物档案页是《页面清单》登记的独立路由 `pets/:pet_id`（5 页签 + Timeline），
                   宽度需求超出抽屉承载（§页面模式 1 的 480px 抽屉）⇒ 本域用**跳页**而非抽屉。 -->
              <el-button
                v-if="column.key === 'name'"
                class="pet-name"
                type="primary"
                link
                @click="openProfile(row as PetItem)"
              >
                {{ (row as PetItem).name }}
              </el-button>

              <el-tag
                v-else-if="column.key === 'petType'"
                :type="petTypeTagType((row as PetItem).petType)"
                effect="plain"
              >
                {{ t(petTypeLabelKey((row as PetItem).petType)) }}
              </el-tag>

              <el-tag
                v-else-if="column.key === 'gender'"
                :type="genderTagType((row as PetItem).gender)"
                effect="plain"
              >
                {{ t(petGenderLabelKey((row as PetItem).gender)) }}
              </el-tag>

              <span v-else-if="column.key === 'age'">{{ ageText((row as PetItem).birthday) }}</span>

              <span v-else-if="column.key === 'owner'">{{ ownerText(row as PetItem) }}</span>

              <span v-else-if="column.key === 'store'">{{ storeText(row as PetItem) }}</span>

              <el-progress
                v-else-if="column.key === 'profileCompleteness'"
                :percentage="(row as PetItem).profileCompleteness"
                :stroke-width="8"
                :status="(row as PetItem).profileCompleteness >= 80 ? 'success' : undefined"
                class="pet-completeness"
              />

              <span v-else-if="column.key === 'sterilized'">
                {{ sterilizedText((row as PetItem).sterilized) }}
              </span>

              <el-tooltip
                v-else-if="column.key === 'createdAt' || column.key === 'updatedAt'"
                :content="cellText(row as PetItem, column.key)"
                placement="top"
                :disabled="!cellRaw(row as PetItem, column.key)"
              >
                <span>{{ formatTime(cellRaw(row as PetItem, column.key)) }}</span>
              </el-tooltip>

              <span v-else>{{ cellText(row as PetItem, column.key) }}</span>
            </template>
          </el-table-column>

          <!-- 操作列：「档案」入口仅需 `pet:list`（本页已要求），故恒渲染；
               编辑 / 删除按各自权限码由 v-hasPerm 决定 -->
          <el-table-column fixed="right" :label="t('table.actions')" width="200" align="center">
            <template #default="{ row }">
              <el-button type="primary" size="small" link @click="openProfile(row as PetItem)">
                {{ t("pet.action.detail") }}
              </el-button>
              <el-button
                v-hasPerm="'pet:update'"
                type="warning"
                size="small"
                link
                @click="openEdit(row as PetItem)"
              >
                {{ t("pet.action.edit") }}
              </el-button>
              <el-button
                v-hasPerm="'pet:delete'"
                type="danger"
                size="small"
                link
                @click="handleDelete(row as PetItem)"
              >
                {{ t("pet.action.delete") }}
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

    <!-- 建档 / 编辑对话框（交互瞬态，**不写地址栏**：工作区组件按 route.fullPath 重建，
         见踩坑 95） -->
    <PetFormDialog
      v-model="formVisible"
      :pet="formPet"
      :store-options="storeOptions"
      @refresh="fetchList"
    />
  </div>
</template>

<script setup lang="ts">
import { useFullscreen } from "@vueuse/core";
import { ElMessage, ElMessageBox, type FormInstance } from "element-plus";
import { FullScreen, Refresh } from "@element-plus/icons-vue";

import PetAPI from "@/api/pet";
import type { PetItem, PetQueryParams } from "@/api/pet";
import StoreAPI from "@/api/store";
import ColumnSetting from "@/components/ColumnSetting/index.vue";
import DataState from "@/components/DataState/DataState.vue";
import TableSkeleton from "@/components/DataState/TableSkeleton.vue";
import CustomerPickerSelect from "@/views/customer/customers/components/CustomerPickerSelect.vue";
import PetFormDialog from "./components/PetFormDialog.vue";
import PetHealthReminderBar from "./components/PetHealthReminderBar.vue";
import { usePageTable, useTableColumns, useTableSelection } from "@/composables";
import type { TableColumnDef } from "@/composables/useTableColumns";
import { PetType } from "@/enums";
import { hasPerm } from "@/utils/auth";
import { isApiError } from "@/utils/request";
import { formatTableDateTime } from "@/utils/format";
import { calcPetAge, petAgeLabel, petGenderLabelKey, petTypeLabelKey } from "@/utils/pet";

/**
 * 宠物列表 DataTable（MVP-WEB-05-01）
 *
 * 规格来源：PRD《页面清单》（路径 `pets`，可见角色 全部角色）+
 * 《宠物管理》FR-1 宠物档案 / 字段全表 +
 * 《页面功能》§宠物档案页 + 《Web规范》（三段式布局 / 表格规范 / 空态三态）。
 *
 * 硬要求落地对照：
 *  1. 三段式布局：筛选区 / 数据区（内部滚动）/ 分页器固定底部；
 *  2. 列数 > 8 ⇒ 列配置（显示 / 隐藏 / 顺序），偏好按账号持久化（`useTableColumns`）；
 *  3. 服务端排序白名单 `createdAt` / `name`（白名单外后端**静默回落** `createdAt`）；
 *  4. 两种空态（从未有数据 / 筛选无结果）+ 错误态（可读原因 + 重试）+ 首屏骨架；
 *  5. 列表刷新不重置筛选；筛选与排序在地址栏可还原（PRD《Web规范》§通用规则 2）；
 *  6. 删除为强确认（输入**宠物名**），文案写明影响范围（档案移除、健康/体重/时间线保留）；
 *  7. 写入口按权限粒度渲染（`pet:create` / `pet:update` / `pet:delete`）。
 *
 * 边界说明（**不越界**）：
 *  · 「宠物档案页（5 页签）」已由本任务落地为独立路由 `pets/:petId`
 *    （`./detail.vue` + `./components/Pet*`），经主名称列 / 操作列「档案」进入。
 *  · 健康记录的写路径（建档 / 更正 / 删除、到期提醒）归 `MVP-WEB-05-02`；
 *    体重曲线图归 `05-03`；Pet Timeline 组件与独立页归 `05-04`；
 *    行为标签**库**管理页归 `05-05` ⇒ 本页与档案页均只**只读**消费这些能力。
 */
defineOptions({
  name: "Pets",
  inheritAttrs: false,
});

const { t } = useI18n();
const router = useRouter();
const route = useRoute();

const tableWrapperRef = ref<HTMLElement | null>(null);
const { toggle: toggleFullscreen } = useFullscreen(tableWrapperRef);

const queryFormRef = ref<FormInstance>();
const dataTableRef = ref<{ clearSelection: () => void }>();

/** 健康到期提醒条（MVP-WEB-05-02）：写路径/删除后需要联动刷新，故持引用 */
const reminderBarRef = ref<{ reload: () => Promise<void> } | null>(null);

/** 写权限（决定多选列是否渲染） */
const canWrite = computed(() => hasPerm("pet:delete"));

/** 宠物类型选项（值与标签分离：值为后端值域，标签走 i18n） */
const PET_TYPE_OPTIONS: Array<{ value: number; labelKey: string }> = [
  { value: PetType.DOG, labelKey: "pet.value.petTypeDog" },
  { value: PetType.CAT, labelKey: "pet.value.petTypeCat" },
  { value: PetType.OTHER, labelKey: "pet.value.petTypeOther" },
];

// ── 门店选项（筛选下拉；无 `store:list` 权限时静默降级为空）──────────────
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

// ── 查询参数（含地址栏还原）──────────────────────────────────────────────
const DEFAULT_PAGE_SIZE = 20;

/** 从地址栏还原筛选 / 排序 / 分页（PRD《Web规范》§通用规则 2） */
function paramsFromQuery(): PetQueryParams {
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

  const petType = asNumber(query.petType);
  const petTypeValid =
    petType !== undefined && PET_TYPE_OPTIONS.some((option) => option.value === petType);

  return {
    pageNum: asNumber(query.pageNum) ?? 1,
    pageSize: asNumber(query.pageSize) ?? DEFAULT_PAGE_SIZE,
    sortBy: asString(query.sortBy) ?? "createdAt",
    order: (asString(query.order) ?? "DESC").toUpperCase() as PetQueryParams["order"],
    name: asString(query.name) ?? "",
    petType: petTypeValid ? petType : undefined,
    ownerCustomerId: asString(query.ownerCustomerId),
    storeId: asString(query.storeId),
    chipNo: asString(query.chipNo),
    createdAtStart: asString(query.createdAtStart),
    createdAtEnd: asString(query.createdAtEnd),
  };
}

/** 重置基准恒为「无筛选」基线（与「筛选无结果 → 清除筛选」语义一致） */
const RESET_BASELINE: PetQueryParams = {
  pageNum: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  sortBy: "createdAt",
  order: "DESC",
  name: "",
  petType: undefined,
  ownerCustomerId: undefined,
  storeId: undefined,
  chipNo: undefined,
  createdAtStart: undefined,
  createdAtEnd: undefined,
};

const { loading, list, total, params, fetchData, handleQuery, handleResetQuery } = usePageTable<
  PetItem,
  PetQueryParams
>({
  initialParams: { ...RESET_BASELINE },
  request: PetAPI.getPage,
  onBeforeReset: () => {
    createdRange.value = null;
    queryFormRef.value?.clearValidate();
  },
});

/** 用地址栏条件覆盖初始参数（一次性，之后以 params 为准） */
Object.assign(params, paramsFromQuery());

/** 建档时间区间（独立 ref，便于 el-date-picker 绑定） */
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
 * `el-select` 清空可能置空串：`storeId` / `ownerCustomerId` 是 `@IsUUID`（空串 ⇒
 * 真 HTTP 400），`petType` 是 `@IsIn` + `@Type(() => Number)`（空串 ⇒ 0 ⇒ 不在值域 ⇒ 400，
 * 同踩坑 101 的隐式转换陷阱）。故统一归一为 `undefined`。
 */
watch(
  () => params.storeId,
  (value) => {
    if (value === "" || value === null) params.storeId = undefined;
  }
);

watch(
  () => params.ownerCustomerId,
  (value) => {
    if (value === "" || value === null) params.ownerCustomerId = undefined;
  }
);

watch(
  () => params.petType,
  (value) => {
    const raw = value as unknown;
    if (raw === "" || raw === null || raw === undefined) {
      params.petType = undefined;
      return;
    }
    if (!PET_TYPE_OPTIONS.some((option) => option.value === Number(raw))) {
      params.petType = undefined;
    }
  }
);

// ── 首屏与错误态 ────────────────────────────────────────────────────────
const hasLoaded = ref(false);
const loadError = ref("");
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

/**
 * 工具栏「刷新」：列表 + 到期提醒条一并回源（MVP-WEB-05-02）
 *
 * 提醒条是**跨宠物**聚合视图，其数据源（`GET /pets/health-expiry-reminders`）与本页
 * 列表不是同一次请求；若刷新只重取列表，用户会看到「列表已刷新、提醒条仍是旧数」的
 * 割裂态。故刷新手势统一收口到本函数。
 */
function handleRefreshAll(): void {
  void fetchList();
  void reminderBarRef.value?.reload();
}

/** 是否处于筛选状态（决定空态种类） */
const isFiltered = computed(
  () =>
    Boolean(params.name) ||
    params.petType !== undefined ||
    Boolean(params.ownerCustomerId) ||
    Boolean(params.storeId) ||
    Boolean(params.chipNo) ||
    Boolean(params.createdAtStart) ||
    Boolean(params.createdAtEnd)
);

/** 空态主行动：仅「筛选无结果 ⇒ 清除筛选」 */
function handleEmptyAction(): void {
  if (isFiltered.value) handleReset();
}

/** 重置筛选（并清理地址栏） */
function handleReset(): void {
  handleResetQuery();
  void syncUrl();
}

// ── 地址栏同步 ──────────────────────────────────────────────────────────
function syncUrl(): Promise<void> {
  const query: Record<string, string> = {};
  if (params.name) query.name = params.name;
  if (params.petType !== undefined) query.petType = String(params.petType);
  if (params.ownerCustomerId) query.ownerCustomerId = params.ownerCustomerId;
  if (params.storeId) query.storeId = params.storeId;
  if (params.chipNo) query.chipNo = params.chipNo;
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
  { key: "name", label: t("pet.field.name"), fixed: true },
  { key: "petType", label: t("pet.field.petType"), fixed: true },
  { key: "owner", label: t("pet.field.owner"), fixed: true },
  { key: "breed", label: t("pet.field.breed") },
  { key: "gender", label: t("pet.field.gender") },
  { key: "age", label: t("pet.field.age") },
  { key: "weightKg", label: t("pet.field.weightKg") },
  { key: "profileCompleteness", label: t("pet.field.profileCompleteness") },
  { key: "store", label: t("pet.field.store") },
  { key: "createdAt", label: t("pet.field.createdAt") },
  { key: "updatedAt", label: t("pet.field.updatedAt") },
  { key: "chipNo", label: t("pet.field.chipNo"), visible: false },
  { key: "coatColor", label: t("pet.field.coatColor"), visible: false },
  { key: "sterilized", label: t("pet.field.sterilized"), visible: false },
  { key: "remark", label: t("pet.field.remark"), visible: false },
];

/** 列宽 / 对齐 / 排序能力（sortable 仅限后端白名单：createdAt/name） */
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
  name: { minWidth: 150, custom: true, sortable: true },
  petType: { width: 100, align: "center", custom: true },
  owner: { minWidth: 150, custom: true },
  breed: { minWidth: 120 },
  gender: { width: 90, align: "center", custom: true },
  age: { width: 130, custom: true },
  weightKg: { width: 110, align: "right" },
  profileCompleteness: { width: 150, custom: true },
  store: { minWidth: 150, custom: true },
  createdAt: { width: 170, custom: true, sortable: true },
  updatedAt: { width: 170, custom: true },
  chipNo: { minWidth: 150 },
  coatColor: { width: 110 },
  sterilized: { width: 100, align: "center", custom: true },
  remark: { minWidth: 200 },
};

const columnController = useTableColumns({
  namespace: "pets",
  columns: COLUMN_DEFS,
});

const visibleColumns = columnController.visibleColumns;

const { selectedIds, hasSelection, handleSelectionChange, clearSelection } =
  useTableSelection<PetItem>();

// ── 单元格渲染 ──────────────────────────────────────────────────────────
function petTypeTagType(petType: number | null): "primary" | "success" | "info" {
  if (petType === PetType.DOG) return "primary";
  if (petType === PetType.CAT) return "success";
  return "info";
}

function genderTagType(gender: number | null): "primary" | "success" | "info" {
  if (gender === 1) return "primary";
  if (gender === 2) return "success";
  return "info";
}

/** 生日 → 年龄文案（不满 1 岁只报月；无生日为「年龄未知」） */
function ageText(birthday: string | null): string {
  const label = petAgeLabel(calcPetAge(birthday));
  return t(label.key, label.params);
}

/** 主人：姓名 + 手机号（关联缺失时回退「未登记」，不渲染裸 UUID） */
function ownerText(row: PetItem): string {
  if (!row.ownerName) return t("pet.value.unset");
  return row.ownerMobile ? `${row.ownerName}（${row.ownerMobile}）` : row.ownerName;
}

/** 归属门店：服务端下发的 `storeName`；`storeId` 为空 = 租户级档案 */
function storeText(row: PetItem): string {
  if (!row.storeId) return t("pet.value.tenantLevel");
  return row.storeName ?? `${String(row.storeId).slice(0, 8)}…`;
}

function sterilizedText(sterilized: boolean | null): string {
  if (sterilized === true) return t("pet.value.yes");
  if (sterilized === false) return t("pet.value.no");
  return t("pet.value.unset");
}

/** 单元格原始值（未加工，空值返回 `undefined`） */
function cellRaw(row: PetItem, key: string): string | undefined {
  const value = (row as unknown as Record<string, unknown>)[key];
  if (value === undefined || value === null || value === "") return undefined;
  return String(value);
}

/** 单元格文本（空值占位 `-`） */
function cellText(row: PetItem, key: string): string {
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

// ── 建档 / 编辑 ─────────────────────────────────────────────────────────
const formVisible = ref(false);
const formPet = ref<PetItem | null>(null);

/** 新建（`formPet = null` ⇒ 对话框走「建档」分支） */
function openCreate(): void {
  formPet.value = null;
  formVisible.value = true;
}

/** 编辑（携带行数据预填 + `version` 乐观锁基准） */
function openEdit(row: PetItem): void {
  formPet.value = row;
  formVisible.value = true;
}

// ── 档案页跳转（《页面清单》`pets/:pet_id`）─────────────────────────────
function openProfile(row: PetItem): void {
  void router.push(`/pets/${row.id}`);
}

/**
 * 从健康到期提醒条下钻到该宠物的**健康页签**
 *
 * 健康页签是档案页第 2 个页签（`?tab=health`）；档案页按地址栏还原页签，
 * 故直接带 query 跳页即可（不需要先跳页再点击切换）。
 */
function openProfileById(petId: string): void {
  if (!petId) return;
  void router.push(`/pets/${petId}?tab=health`);
}

// ── 删除（强确认：输入宠物名）───────────────────────────────────────────
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
    const { value } = await ElMessageBox.prompt(message, t("pet.delete.title"), {
      confirmButtonText: t("pet.action.delete"),
      cancelButtonText: t("pet.form.cancel"),
      inputPlaceholder: placeholder,
      inputValidator: (input: string) => String(input ?? "").trim() === expected,
      inputErrorMessage: t("pet.delete.mismatch"),
      type: "warning",
    });
    return String(value ?? "").trim() === expected;
  } catch {
    return false;
  }
}

/** 删除单只宠物（软删；健康 / 体重 / 时间线历史保留） */
async function handleDelete(row: PetItem): Promise<void> {
  const ok = await confirmStrong(
    row.name,
    t("pet.delete.confirmText", { name: row.name, owner: row.ownerName ?? t("pet.value.unset") }),
    t("pet.delete.inputPlaceholder")
  );
  if (!ok) return;

  try {
    await PetAPI.deleteById(row.id);
    ElMessage.success(t("pet.delete.success"));
    await fetchList();
  } catch {
    // 失败提示由请求层统一渲染（含可读原因），此处不再重复弹窗
  }
}

/** 批量删除当前页选中宠物 */
async function handleBatchDelete(): Promise<void> {
  const count = selectedIds.value.length;
  if (count === 0) return;

  const ok = await confirmStrong(
    t("pet.delete.confirmKeyword"),
    t("pet.delete.batchConfirmText", { count }),
    t("pet.delete.batchInputPlaceholder")
  );
  if (!ok) return;

  try {
    await Promise.all(selectedIds.value.map((id) => PetAPI.deleteById(String(id))));
    ElMessage.success(t("pet.delete.batchSuccess", { count }));
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
  void fetchStoreOptions();
});

/**
 * keep-alive 激活时按地址栏对齐状态（踩坑 122）
 *
 * 工作区 `<component :key="route.fullPath">` + `<keep-alive>` 以 **fullPath 为缓存键**；
 * 本页筛选一律「先改 `params` → 深度监听同步地址栏」，故 query 回到曾用过的取值时
 * 会复用**旧缓存实例**（不重跑 `setup`/`onMounted`），出现「地址栏已清筛选、列表仍
 * 是旧结果」的渲染态滞留。修复：非首次激活按地址栏重新对齐并重取。
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
  void fetchStoreOptions();
  // 到期清单可能已被别的会话/别的页签改动（档案页写了疫苗记录）⇒ 一并回源
  void reminderBarRef.value?.reload();
});
</script>

<style lang="scss" scoped>
/* 主名称列：链接式呈现（PRD《Web规范》§表格规范 2「主名称列可点击进详情」）。
   宠物档案页是《页面清单》登记的独立路由（5 页签 + Timeline），故此处为**跳页**
   而非 04-02 客户域使用的右侧抽屉（抽屉 480px 承载不下 5 页签 + 时间线）。 */
.pet-name {
  padding: 0;
  font-weight: 500;
}

.pet-completeness {
  width: 110px;
}

:deep(.el-table__row) {
  cursor: default;
}
</style>
