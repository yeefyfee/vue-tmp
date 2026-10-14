<template>
  <div class="page-container" data-testid="behavior-tag-page">
    <!-- 筛选区（PRD《Web规范》§布局与栅格 3：列表页固定三段之「筛选区」） -->
    <el-card class="page-search" shadow="never">
      <el-form ref="queryFormRef" :model="params" :inline="true" @submit.prevent>
        <el-form-item :label="t('pet.tag.field.name')" prop="name">
          <el-input
            v-model="params.name"
            data-testid="behavior-tag-search-name"
            :placeholder="t('pet.tag.search.namePlaceholder')"
            clearable
            class="w-[200px]"
            @keyup.enter="handleQuery"
          />
        </el-form-item>

        <el-form-item :label="t('pet.tag.field.status')" prop="status">
          <el-select
            v-model="params.status"
            data-testid="behavior-tag-search-status"
            :placeholder="t('pet.tag.search.statusPlaceholder')"
            clearable
            class="w-[160px]"
          >
            <el-option :label="t('pet.value.statusEnabled')" :value="BehaviorTagStatus.ENABLED" />
            <el-option :label="t('pet.value.statusDisabled')" :value="BehaviorTagStatus.DISABLED" />
          </el-select>
        </el-form-item>

        <el-form-item>
          <el-button type="primary" data-testid="behavior-tag-search-submit" @click="handleQuery">
            {{ t("pet.search.search") }}
          </el-button>
          <el-button data-testid="behavior-tag-search-reset" @click="handleReset">
            {{ t("pet.search.reset") }}
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card class="page-content" shadow="never">
      <div class="page-toolbar">
        <div class="page-toolbar__left">
          <el-button
            v-hasPerm="'pet:tag:create'"
            type="primary"
            data-testid="behavior-tag-create"
            @click="handleCreate"
          >
            {{ t("pet.tag.action.create") }}
          </el-button>
        </div>

        <div class="page-toolbar__right">
          <ColumnSetting :controller="columnController" />
          <el-tooltip :content="t('pet.action.refresh')" placement="top">
            <el-button class="page-icon-btn" data-testid="behavior-tag-refresh" @click="fetchList">
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
          :title="t('pet.tag.empty.errorTitle')"
          :description="loadError"
          :action-text="t('pet.tag.empty.errorRetry')"
          @action="fetchList"
        />

        <DataState
          v-else-if="list.length === 0"
          :variant="isFiltered ? 'filtered' : 'empty'"
          :title="isFiltered ? t('pet.tag.empty.filteredTitle') : t('pet.tag.empty.title')"
          :description="isFiltered ? t('pet.tag.empty.filteredDesc') : t('pet.tag.empty.desc')"
          :action-text="emptyActionText"
          @action="handleEmptyAction"
        />

        <el-table
          v-else
          v-loading="loading"
          data-testid="behavior-tag-table"
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
              <!-- 主名称列：标签本体（停用态以 info 灰签区分，停用后新宠物不可挂） -->
              <el-tag
                v-if="column.key === 'name'"
                data-testid="behavior-tag-name"
                effect="plain"
                :type="
                  (row as BehaviorTagItem).status === BehaviorTagStatus.ENABLED ? 'primary' : 'info'
                "
              >
                {{ (row as BehaviorTagItem).name }}
              </el-tag>

              <span v-else-if="column.key === 'sort'" data-testid="behavior-tag-sort">
                {{ (row as BehaviorTagItem).sort }}
              </span>

              <el-tag
                v-else-if="column.key === 'status'"
                data-testid="behavior-tag-status"
                :type="
                  (row as BehaviorTagItem).status === BehaviorTagStatus.ENABLED ? 'success' : 'info'
                "
              >
                {{
                  (row as BehaviorTagItem).status === BehaviorTagStatus.ENABLED
                    ? t("pet.value.statusEnabled")
                    : t("pet.value.statusDisabled")
                }}
              </el-tag>

              <el-tooltip
                v-else-if="column.key === 'createdAt' || column.key === 'updatedAt'"
                :content="cellText(row as BehaviorTagItem, column.key)"
                placement="top"
                :disabled="!cellRaw(row as BehaviorTagItem, column.key)"
              >
                <span>{{ formatTime(cellRaw(row as BehaviorTagItem, column.key)) }}</span>
              </el-tooltip>

              <span v-else>{{ cellText(row as BehaviorTagItem, column.key) }}</span>
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
                v-hasPerm="'pet:tag:update'"
                type="primary"
                size="small"
                link
                data-testid="behavior-tag-edit"
                @click="handleEdit(row as BehaviorTagItem)"
              >
                {{ t("pet.tag.action.edit") }}
              </el-button>
              <el-button
                v-hasPerm="'pet:tag:delete'"
                type="danger"
                size="small"
                link
                data-testid="behavior-tag-delete"
                @click="handleDelete(row as BehaviorTagItem)"
              >
                {{ t("pet.tag.action.delete") }}
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

    <BehaviorTagFormDialog
      v-model="dialogVisible"
      :mode="dialogMode"
      :tag="activeTag"
      @success="handleSaved"
    />
  </div>
</template>

<script setup lang="ts">
import { useFullscreen } from "@vueuse/core";
import { ElMessage, ElMessageBox, type FormInstance } from "element-plus";
import { FullScreen, Refresh } from "@element-plus/icons-vue";

import PetAPI from "@/api/pet";
import type { BehaviorTagItem, BehaviorTagQueryParams } from "@/api/pet";
import ColumnSetting from "@/components/ColumnSetting/index.vue";
import DataState from "@/components/DataState/DataState.vue";
import TableSkeleton from "@/components/DataState/TableSkeleton.vue";
import BehaviorTagFormDialog from "./components/BehaviorTagFormDialog.vue";
import { usePageTable, useTableColumns } from "@/composables";
import type { TableColumnDef } from "@/composables/useTableColumns";
import { BehaviorTagStatus } from "@/enums";
import { hasPerm } from "@/utils/auth";
import { isApiError } from "@/utils/request";
import { formatTableDateTime } from "@/utils/format";

/**
 * 行为标签管理页（MVP-WEB-05-05 · FR-4）
 *
 * 规格来源：PRD《宠物管理》FR-4「行为标签：咬人、吠叫、应激、社交友好、拆家等，
 * 标签驱动照护任务与房间分配约束」+ BR-2「行为标签含咬人的宠物，强制分配独立房，
 * 照护任务自动追加防护提醒」+ PRD《Web规范》（三段式布局 / 表格规范 / 三态）
 * + 后端真实契约 `niulai-nest/src/pet/behavior-tag.controller.ts`（P0-06-05）。
 *
 * 页面性质：行为标签库是**租户级字典**（`behavior_tag` 表，`name` 租户内唯一），
 * 故本页是**配置类列表页**——无动态段 ⇒ 不进工作区标签区（踩坑 128 口径，
 * 与 PRD《多标签页策略》第 6 条「列表 / 配置页不进标签区」一致）；
 * 增删改走**对话框**（无 480px 抽屉承载问题，且四字段表单体量小）。
 *
 * 路由落位：`/pets/tags`（父菜单 600「宠物」，routePath `tags`）。⚠️ 与兄弟动态
 * 路由 `/pets/:petId`（宠物详情）**段数相同**，命中依赖 vue-router「静态段优先」
 * 排序 ⇒ 真机断言「/pets/tags 渲染本页而非宠物详情」。
 *
 * 停用语义：`status=0` 仅阻断**新**挂载，存量宠物关联保留（`enums.BehaviorTagStatus`）。
 * 删除语义：软删 + **同步清除宠物关联并重算档案完整度**（后端 service），故删除用
 * 「输入标签名」强确认（PRD《交互规范》§确认与撤销 1/2）。
 */
defineOptions({
  name: "BehaviorTags",
  inheritAttrs: false,
});

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const tableWrapperRef = ref<HTMLElement | null>(null);
const { toggle: toggleFullscreen } = useFullscreen(tableWrapperRef);

const queryFormRef = ref<FormInstance>();

/** 写权限（决定操作列是否渲染） */
const canWrite = computed(() => hasPerm("pet:tag:update") || hasPerm("pet:tag:delete"));

// ── 查询参数（含地址栏还原）──────────────────────────────────────────────
const DEFAULT_PAGE_SIZE = 20;
/** 后端排序白名单（service 侧 SORTABLE_FIELDS 收敛） */
const DEFAULT_SORT_BY = "sort";
const DEFAULT_ORDER = "ASC";

/** 从地址栏还原筛选 / 排序 / 分页（PRD《Web规范》§通用规则 2） */
function paramsFromQuery(): BehaviorTagQueryParams {
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
    sortBy: asString(query.sortBy) ?? DEFAULT_SORT_BY,
    order: (asString(query.order) ?? DEFAULT_ORDER).toUpperCase(),
    // 空串一律归一为 undefined（缺省即「不过滤」）—— 见下方 `watch(params.name)`
    name: asString(query.name),
    // 状态仅 1 / 0 合法（DTO @IsIn），越界值一律丢弃（防地址栏投毒触发真 400）
    status:
      status !== undefined &&
      (status === BehaviorTagStatus.ENABLED || status === BehaviorTagStatus.DISABLED)
        ? status
        : undefined,
  };
}

/**
 * 重置基准
 *
 * 恒为「无筛选」基线（而非地址栏带来的条件）：否则「重置」会回到一个带筛选的状态，
 * 与 PRD《Web规范》§空态 2「筛选无结果 → 清除筛选」语义冲突。
 */
const RESET_BASELINE: BehaviorTagQueryParams = {
  pageNum: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  sortBy: DEFAULT_SORT_BY,
  order: DEFAULT_ORDER,
  name: undefined,
  status: undefined,
};

const { loading, list, total, params, fetchData, handleQuery, handleResetQuery } = usePageTable<
  BehaviorTagItem,
  BehaviorTagQueryParams
>({
  initialParams: { ...RESET_BASELINE },
  request: PetAPI.getBehaviorTags,
  onBeforeReset: () => {
    queryFormRef.value?.clearValidate();
  },
});

/** 用地址栏条件覆盖初始参数（一次性，之后以 params 为准） */
Object.assign(params, paramsFromQuery());

/**
 * 搜索框空串归一化（🔴 踩坑 129）
 *
 * `el-input` 清空会把 `params.name` 置为**空串**，而请求层 `qs.stringify` 只跳过
 * `undefined`（`""` 会序列化成 `name=`）⇒ 后端 `QueryBehaviorTagDto.name` 的
 * `@Length(1,32)` 判空串非法，抛 **A0400（真 HTTP 400）**，列表整页落到错误态。
 * 与下方 `status` 同口径：非空有效值之外一律归一为 `undefined`（等价「不过滤」）。
 */
watch(
  () => params.name,
  (value) => {
    if (value === undefined || value === null) return;
    if (String(value).trim() === "") params.name = undefined;
  }
);

/**
 * 下拉清空归一化
 *
 * `el-select` 清空可能置空串，而后端 `QueryBehaviorTagDto.status` 是
 * `@IsIn([0,1])` —— 空串被判非法并抛真 HTTP 400（踩坑 52）。
 * 统一归一为 `undefined`（axios 跳过 undefined 参数，等价「不过滤」）。
 */
watch(
  () => params.status,
  (value) => {
    const raw = value as unknown;
    if (
      raw !== BehaviorTagStatus.ENABLED &&
      raw !== BehaviorTagStatus.DISABLED &&
      raw !== undefined
    ) {
      params.status = undefined;
    } else if (raw === null) {
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
const isFiltered = computed(() => Boolean(params.name) || params.status !== undefined);

const emptyActionText = computed(() => {
  if (isFiltered.value) return t("pet.action.clearFilter");
  return hasPerm("pet:tag:create") ? t("pet.tag.action.create") : "";
});

/** 空态主行动：错误态重试已在模板单独处理，这里只处理两种空态 */
function handleEmptyAction(): void {
  if (isFiltered.value) {
    handleReset();
    return;
  }
  if (hasPerm("pet:tag:create")) handleCreate();
}

/** 重置筛选（并清理地址栏） */
function handleReset(): void {
  handleResetQuery();
  void syncUrl();
}

// ── 地址栏同步（PRD《Web规范》§通用规则 2：支持分享定位）──────────────
function syncUrl(): Promise<void> {
  const query: Record<string, string> = {};
  if (params.name) query.name = params.name;
  if (params.status !== undefined) query.status = String(params.status);
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
  { key: "name", label: t("pet.tag.field.name"), fixed: true },
  { key: "sort", label: t("pet.tag.field.sort") },
  { key: "status", label: t("pet.tag.field.status"), fixed: true },
  { key: "updatedAt", label: t("pet.tag.field.updatedAt") },
  { key: "createdAt", label: t("pet.tag.field.createdAt"), visible: false },
];

/** 列宽 / 对齐 / 排序能力（sortable 仅限后端白名单：createdAt/name/sort/status） */
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
  name: { minWidth: 220, custom: true, sortable: true },
  sort: { width: 110, align: "center", custom: true, sortable: true },
  status: { width: 110, align: "center", custom: true, sortable: true },
  updatedAt: { width: 170, custom: true },
  createdAt: { width: 170, custom: true, sortable: true },
};

const columnController = useTableColumns({
  namespace: "behavior-tags",
  columns: COLUMN_DEFS,
});

const visibleColumns = columnController.visibleColumns;

// ── 单元格渲染 ──────────────────────────────────────────────────────────
/** 单元格原始值（未加工，空值返回 `undefined`） */
function cellRaw(row: BehaviorTagItem, key: string): string | undefined {
  const value = (row as unknown as Record<string, unknown>)[key];
  if (value === undefined || value === null || value === "") return undefined;
  return String(value);
}

/** 单元格文本（空值占位） */
function cellText(row: BehaviorTagItem, key: string): string {
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
  prop: params.sortBy ?? DEFAULT_SORT_BY,
  order: String(params.order ?? DEFAULT_ORDER).toUpperCase() === "ASC" ? "ascending" : "descending",
}));

function handleSortChange({ prop, order }: { prop: string | null; order: string | null }): void {
  if (!prop || !order) {
    params.sortBy = DEFAULT_SORT_BY;
    params.order = DEFAULT_ORDER;
  } else {
    params.sortBy = prop;
    params.order = order === "ascending" ? "ASC" : "DESC";
  }
  params.pageNum = 1;
  void fetchList();
}

// ── 对话框（新建 / 编辑）────────────────────────────────────────────────
const dialogVisible = ref(false);
const dialogMode = ref<"create" | "edit">("create");
const activeTag = ref<BehaviorTagItem | null>(null);

function handleCreate(): void {
  dialogMode.value = "create";
  activeTag.value = null;
  dialogVisible.value = true;
}

/**
 * 编辑
 *
 * ⚠️ 直接以**列表行**为基准：行为标签列表行含全字段（`name`/`sort`/`status`/`version`），
 * 不存在 05-01 宠物档案「列表行不带子集合需补拉详情」的写缺口 ⇒ 无需二次回查。
 * `version` 取列表行现值，落 `PATCH` 的乐观锁基准。
 */
function handleEdit(row: BehaviorTagItem): void {
  dialogMode.value = "edit";
  activeTag.value = row;
  dialogVisible.value = true;
}

/** 保存成功：提示 + 刷新（新建回到第一页，编辑保留当前页） */
function handleSaved(payload: { mode: "create" | "edit" }): void {
  if (payload.mode === "create") {
    ElMessage.success(t("pet.tag.form.createSuccess"));
    handleQuery();
    return;
  }
  ElMessage.success(t("pet.tag.form.updateSuccess"));
  void fetchList();
}

// ── 删除（强确认：输入标签名）─────────────────────────────────────────────
/**
 * 强确认对话框
 *
 * PRD《交互规范》§确认与撤销 1：「强确认（输入宠物名或"确认"二字才可执行，
 * 用于退款、删除档案、作废订单）」，2：「确认对话框必须写明影响范围与对象数量」。
 * 本页删除的影响范围 = 该标签与**所有**宠物的关联（后端同步清除 + 重算完整度）。
 */
async function confirmStrong(
  expected: string,
  message: string,
  placeholder: string
): Promise<boolean> {
  try {
    const { value } = await ElMessageBox.prompt(message, t("pet.tag.delete.title"), {
      confirmButtonText: t("pet.tag.action.delete"),
      cancelButtonText: t("pet.form.cancel"),
      inputPlaceholder: placeholder,
      inputValidator: (input: string) => String(input ?? "").trim() === expected,
      inputErrorMessage: t("pet.tag.delete.mismatch"),
      type: "warning",
    });
    return String(value ?? "").trim() === expected;
  } catch {
    return false;
  }
}

/** 删除单个行为标签（软删 + 清关联） */
async function handleDelete(row: BehaviorTagItem): Promise<void> {
  const ok = await confirmStrong(
    row.name,
    t("pet.tag.delete.confirmText", { name: row.name }),
    t("pet.tag.delete.inputPlaceholder")
  );
  if (!ok) return;

  try {
    await PetAPI.deleteBehaviorTag(row.id);
    ElMessage.success(t("pet.tag.delete.success"));
    await fetchList();
  } catch {
    // 失败提示由请求层统一渲染（含可读原因），此处不再重复弹窗
    await fetchList();
  }
}

// ── 初始化 ──────────────────────────────────────────────────────────────
onMounted(() => {
  void fetchList();
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
  void fetchList();
});
</script>

<style lang="scss" scoped>
.el-tag + .el-tag {
  margin-left: 6px;
}
</style>
