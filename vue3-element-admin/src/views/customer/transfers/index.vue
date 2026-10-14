<template>
  <div class="page-container">
    <!-- 筛选区（PRD《Web规范》§布局与栅格 3：列表页固定三段之「筛选区」） -->
    <el-card class="page-search" shadow="never">
      <el-form ref="queryFormRef" :model="params" :inline="true" @submit.prevent>
        <el-form-item :label="t('customer.transferPage.filterStatus')" prop="status">
          <el-select
            v-model="params.status"
            :placeholder="t('customer.transferPage.filterStatusPlaceholder')"
            clearable
            class="w-[160px]"
          >
            <el-option
              v-for="option in STATUS_OPTIONS"
              :key="option.value"
              :label="t(option.labelKey)"
              :value="option.value"
            />
          </el-select>
        </el-form-item>

        <el-form-item :label="t('customer.transferPage.filterPetId')" prop="petId">
          <el-input
            v-model="params.petId"
            :placeholder="t('customer.transferPage.filterPetIdPlaceholder')"
            clearable
            class="w-[300px]"
            @keyup.enter="handleQuery"
          />
        </el-form-item>

        <el-form-item :label="t('customer.transferPage.filterCreatedAt')">
          <el-date-picker
            v-model="createdRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            :start-placeholder="t('customer.transferPage.dateStart')"
            :end-placeholder="t('customer.transferPage.dateEnd')"
            unlink-panels
            class="!w-[260px]"
          />
        </el-form-item>

        <el-form-item>
          <el-button type="primary" @click="handleQuery">
            {{ t("customer.search.search") }}
          </el-button>
          <el-button @click="handleReset">{{ t("customer.search.reset") }}</el-button>
          <el-button class="page-icon-btn" @click="fetchList">
            <el-icon><Refresh /></el-icon>
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 数据区（三态：骨架 / 错误 / 空态，PRD《Web规范》§空态/加载/错误态 1） -->
    <el-card class="page-content" shadow="never">
      <div ref="tableWrapperRef" class="page-table-wrapper">
        <TableSkeleton v-if="showSkeleton" :column-count="8" :row-count="8" />

        <DataState
          v-else-if="loadError"
          variant="error"
          :title="t('customer.transferPage.errorTitle')"
          :description="loadError"
          :action-text="t('customer.transferPage.retry')"
          @action="fetchList"
        />

        <DataState
          v-else-if="list.length === 0"
          :variant="isFiltered ? 'filtered' : 'empty'"
          :title="
            isFiltered
              ? t('customer.transferPage.filteredTitle')
              : t('customer.transferPage.emptyTitle')
          "
          :description="
            isFiltered
              ? t('customer.transferPage.filteredDesc')
              : t('customer.transferPage.emptyDesc')
          "
          :action-text="isFiltered ? t('customer.transferPage.clearFilter') : ''"
          @action="handleEmptyAction"
        />

        <el-table
          v-else
          v-loading="loading"
          class="page-table"
          :data="list"
          height="100%"
          row-key="id"
        >
          <el-table-column
            :label="t('customer.transferPage.columnPet')"
            min-width="150"
            show-overflow-tooltip
          >
            <template #default="{ row }">
              <div class="transfer-pet">
                <span class="transfer-pet__name">{{ petName(row as PetTransferItem) }}</span>
                <el-tag v-if="(row as PetTransferItem).petType" size="small" effect="plain">
                  {{ petTypeLabel((row as PetTransferItem).petType) }}
                </el-tag>
              </div>
            </template>
          </el-table-column>

          <el-table-column
            :label="t('customer.transferPage.columnFrom')"
            min-width="130"
            show-overflow-tooltip
          >
            <template #default="{ row }">
              {{ customerName((row as PetTransferItem).fromCustomerName) }}
            </template>
          </el-table-column>

          <el-table-column
            :label="t('customer.transferPage.columnTo')"
            min-width="130"
            show-overflow-tooltip
          >
            <template #default="{ row }">
              <span class="transfer-arrow">→</span>
              {{ customerName((row as PetTransferItem).toCustomerName) }}
            </template>
          </el-table-column>

          <el-table-column
            :label="t('customer.transferPage.columnStatus')"
            width="110"
            align="center"
          >
            <template #default="{ row }">
              <el-tag :type="statusTagType((row as PetTransferItem).status)" effect="plain">
                {{ statusLabel((row as PetTransferItem).status) }}
              </el-tag>
            </template>
          </el-table-column>

          <el-table-column
            :label="t('customer.transferPage.columnReason')"
            min-width="160"
            show-overflow-tooltip
          >
            <template #default="{ row }">
              {{ (row as PetTransferItem).reason || "-" }}
            </template>
          </el-table-column>

          <el-table-column
            :label="t('customer.transferPage.columnRejectReason')"
            min-width="160"
            show-overflow-tooltip
          >
            <template #default="{ row }">
              {{ (row as PetTransferItem).rejectReason || "-" }}
            </template>
          </el-table-column>

          <el-table-column :label="t('customer.transferPage.columnCreatedAt')" width="170">
            <template #default="{ row }">
              {{ formatTime((row as PetTransferItem).createdAt) }}
            </template>
          </el-table-column>

          <el-table-column :label="t('customer.transferPage.columnApprovedAt')" width="170">
            <template #default="{ row }">
              {{ approvedAtText(row as PetTransferItem) }}
            </template>
          </el-table-column>

          <el-table-column fixed="right" :label="t('table.actions')" width="200" align="center">
            <template #default="{ row }">
              <template v-if="(row as PetTransferItem).status === PetTransferStatus.PENDING">
                <el-button
                  v-if="canApprove"
                  type="primary"
                  size="small"
                  link
                  @click="handleApprove(row as PetTransferItem)"
                >
                  {{ t("customer.transferPage.actApprove") }}
                </el-button>
                <el-button
                  v-if="canReject"
                  type="warning"
                  size="small"
                  link
                  @click="handleReject(row as PetTransferItem)"
                >
                  {{ t("customer.transferPage.actReject") }}
                </el-button>
                <el-button
                  v-if="canCancel"
                  type="danger"
                  size="small"
                  link
                  @click="handleCancel(row as PetTransferItem)"
                >
                  {{ t("customer.transferPage.actCancel") }}
                </el-button>
              </template>
              <span v-else class="transfer-muted">-</span>
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
import { ElMessage, ElMessageBox, type FormInstance } from "element-plus";
import { Refresh } from "@element-plus/icons-vue";

import CustomerAPI from "@/api/customer";
import type { PetTransferItem, PetTransferQueryParams } from "@/api/customer";
import DataState from "@/components/DataState/DataState.vue";
import TableSkeleton from "@/components/DataState/TableSkeleton.vue";
import { usePageTable } from "@/composables";
import { CustomerPetType, PetTransferStatus } from "@/enums";
import { hasPerm } from "@/utils/auth";
import { isApiError } from "@/utils/request";
import { formatTableDateTime } from "@/utils/format";

/**
 * 宠物转移审批列表（MVP-WEB-04-03 · FR-2 / BR-4）
 *
 * 规格来源：PRD《客户管理》FR-2「一个宠主绑定多只宠物…支持归属转移，**需审批并留痕**」
 * + BR-4「宠物归属转移需原宠主与新宠主双确认；转移后时间线随宠物保留，历史消费记录不
 * 迁移到新宠主」+ 验收要点 2「归属转移双确认并留痕」
 * +《Web规范》（三段式布局、表格规范、空态/加载/错误态、通用规则）。
 *
 * 契约：`GET /pet-transfers`（`QueryTransferDto extends BaseQueryDto` ⇒ 分页入参为
 * **存量 camelCase** `pageNum`/`pageSize`，排序白名单仅 `createdAt`，踩坑 53）；
 * 出参经后端全局 `ResponseInterceptor` 归一为 `{list,total,page,page_size}`（踩坑 115）。
 * 列表行的 `petName`/`petType`/`fromCustomerName`/`toCustomerName` 为**服务端回查**的
 * 展示字段（表内只存 id 快照），缺失时为 `null` ⇒ 本页有兜底文案。
 *
 * 状态机：1 待审批 → 2 已通过 / 3 已拒绝 / 4 已撤销（终态不可再流转）。
 * 故操作列**仅在 status=1 时渲染动作**，其余状态渲染占位（不渲染则显得行为缺失）。
 *
 * 边界（不越界）：
 *  · 「发起转移」入口在 MVP-WEB-04-03 的客户详情抽屉「宠物」页签（本页只做审批侧）；
 *  · 时间线随宠物保留 / 历史消费不迁移属服务端不变式，前端不做二次校验与提示；
 *  · 「双确认」在本期实现为「发起 → 审批」两步（服务端状态机），无原宠主 / 新宠主
 *    各自独立的确认端点 ⇒ 本页不渲染「待对方确认」这类不存在的状态。
 */
defineOptions({
  name: "CustomerTransfers",
  inheritAttrs: false,
});

const { t } = useI18n();
const router = useRouter();
const route = useRoute();

const tableWrapperRef = ref<HTMLElement | null>(null);

const queryFormRef = ref<FormInstance>();

/** 动作权限（ROOT 直放；非 ROOT 角色按 `sys_menu(type='B').perm` 授权链路判定） */
const canApprove = computed(() => hasPerm("customer:transfer:approve"));
const canReject = computed(() => hasPerm("customer:transfer:reject"));
const canCancel = computed(() => hasPerm("customer:transfer:cancel"));

const STATUS_OPTIONS: Array<{ value: number; labelKey: string }> = [
  { value: PetTransferStatus.PENDING, labelKey: "customer.value.transferPending" },
  { value: PetTransferStatus.APPROVED, labelKey: "customer.value.transferApproved" },
  { value: PetTransferStatus.REJECTED, labelKey: "customer.value.transferRejected" },
  { value: PetTransferStatus.CANCELLED, labelKey: "customer.value.transferCancelled" },
];

// ── 查询参数（含地址栏还原）──────────────────────────────────────────────
const DEFAULT_PAGE_SIZE = 20;

function paramsFromQuery(): PetTransferQueryParams {
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
  const statusValid =
    status !== undefined && STATUS_OPTIONS.some((option) => option.value === status);

  return {
    pageNum: asNumber(query.pageNum) ?? 1,
    pageSize: asNumber(query.pageSize) ?? DEFAULT_PAGE_SIZE,
    sortBy: asString(query.sortBy) ?? "createdAt",
    order: (asString(query.order) ?? "DESC").toUpperCase() as PetTransferQueryParams["order"],
    status: statusValid ? status : undefined,
    petId: asString(query.petId),
    createdAtStart: asString(query.createdAtStart),
    createdAtEnd: asString(query.createdAtEnd),
  };
}

/** 重置基准恒为「无筛选」基线（与「筛选无结果 → 清除筛选」语义一致） */
const RESET_BASELINE: PetTransferQueryParams = {
  pageNum: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  sortBy: "createdAt",
  order: "DESC",
  status: undefined,
  petId: undefined,
  createdAtStart: undefined,
  createdAtEnd: undefined,
};

const { loading, list, total, params, fetchData, handleQuery, handleResetQuery } = usePageTable<
  PetTransferItem,
  PetTransferQueryParams
>({
  initialParams: { ...RESET_BASELINE },
  request: CustomerAPI.getTransfers,
  onBeforeReset: () => {
    createdRange.value = null;
    queryFormRef.value?.clearValidate();
  },
});

Object.assign(params, paramsFromQuery());

const createdRange = ref<[string, string] | null>(
  params.createdAtStart && params.createdAtEnd ? [params.createdAtStart, params.createdAtEnd] : null
);

watch(createdRange, (range) => {
  params.createdAtStart = range?.[0];
  params.createdAtEnd = range?.[1];
});

/**
 * 下拉清空归一化（踩坑 101）
 *
 * `status` 是 `@IsIn([1,2,3,4]) + @Type(() => Number)`，清空置空串会被转成 `0`
 * 从而越界报 400；`petId` 是 `@IsUUID`，空串同样 400。统一归一为 `undefined`。
 */
watch(
  () => params.status,
  (value) => {
    const raw = value as unknown;
    if (raw === "" || raw === null || raw === undefined) {
      params.status = undefined;
      return;
    }
    if (!STATUS_OPTIONS.some((option) => option.value === Number(raw))) {
      params.status = undefined;
    }
  }
);

watch(
  () => params.petId,
  (value) => {
    if (value === ("" as unknown) || value === null) params.petId = undefined;
  }
);

// ── 首屏与错误态 ────────────────────────────────────────────────────────
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
    params.status !== undefined ||
    Boolean(params.petId) ||
    Boolean(params.createdAtStart) ||
    Boolean(params.createdAtEnd)
);

function handleEmptyAction(): void {
  if (isFiltered.value) handleReset();
}

function handleReset(): void {
  handleResetQuery();
  void syncUrl();
}

// ── 地址栏同步（PRD《Web规范》§通用规则 2：支持分享定位）──────────────
function syncUrl(): Promise<void> {
  const query: Record<string, string> = {};
  if (params.status !== undefined) query.status = String(params.status);
  if (params.petId) query.petId = params.petId;
  if (params.createdAtStart) query.createdAtStart = params.createdAtStart;
  if (params.createdAtEnd) query.createdAtEnd = params.createdAtEnd;
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

// ── 单元格渲染 ──────────────────────────────────────────────────────────
function statusLabel(status: number): string {
  const matched = STATUS_OPTIONS.find((option) => option.value === status);
  return matched ? t(matched.labelKey) : t("customer.value.unset");
}

function statusTagType(status: number): "primary" | "success" | "danger" | "info" {
  if (status === PetTransferStatus.PENDING) return "primary";
  if (status === PetTransferStatus.APPROVED) return "success";
  if (status === PetTransferStatus.REJECTED) return "danger";
  return "info";
}

function petName(row: PetTransferItem): string {
  return row.petName ?? t("customer.value.petUnknown");
}

function customerName(name: string | null): string {
  return name ?? t("customer.value.customerUnknown");
}

function petTypeLabel(petType: number | null): string {
  if (petType === CustomerPetType.DOG) return t("customer.value.petTypeDog");
  if (petType === CustomerPetType.CAT) return t("customer.value.petTypeCat");
  if (petType === CustomerPetType.OTHER) return t("customer.value.petTypeOther");
  return t("customer.value.unset");
}

function approvedAtText(row: PetTransferItem): string {
  return row.approvedAt ? formatTime(row.approvedAt) : "-";
}

function formatTime(value: unknown): string {
  return formatTableDateTime(value as string, {
    today: t("time.today"),
    yesterday: t("time.yesterday"),
    beforeYesterday: t("time.beforeYesterday"),
  });
}

// ── 审批动作（状态机 1→2/3/4；失败文案由请求层统一渲染）─────────────────
/** 审批通过：强确认（改归属不可逆），确认文案写明目标客户 */
async function handleApprove(row: PetTransferItem): Promise<void> {
  try {
    await ElMessageBox.confirm(
      t("customer.transferPage.approveConfirmText", { to: customerName(row.toCustomerName) }),
      t("customer.transferPage.approveConfirmTitle"),
      {
        confirmButtonText: t("customer.transferPage.actApprove"),
        cancelButtonText: t("customer.form.cancel"),
        type: "warning",
      }
    );
  } catch {
    return;
  }

  try {
    await CustomerAPI.approveTransfer(row.id);
    ElMessage.success(t("customer.transferPage.approveSuccess"));
    await fetchList();
  } catch {
    await fetchList();
  }
}

/** 拒绝：必填理由（服务端 `@IsNotEmpty + @Length(1,255)` ⇒ 前端前置校验，避免空转） */
async function handleReject(row: PetTransferItem): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt(
      t("customer.transferPage.rejectPlaceholder"),
      t("customer.transferPage.rejectTitle"),
      {
        confirmButtonText: t("customer.transferPage.actReject"),
        cancelButtonText: t("customer.form.cancel"),
        inputPlaceholder: t("customer.transferPage.rejectPlaceholder"),
        inputValidator: (input: string) => {
          const text = String(input ?? "").trim();
          if (!text) return t("customer.transferPage.rejectRequired");
          if (text.length > 255) return t("customer.transferPage.rejectLength");
          return true;
        },
        type: "warning",
      }
    );

    await CustomerAPI.rejectTransfer(row.id, { rejectReason: String(value ?? "").trim() });
    ElMessage.success(t("customer.transferPage.rejectSuccess"));
    await fetchList();
  } catch {
    // 取消（ElMessageBox reject）与请求失败共用出口：前者静默，后者由请求层提示
  }
}

/** 撤销：不动归属，但申请终结 ⇒ 二次确认 */
async function handleCancel(row: PetTransferItem): Promise<void> {
  try {
    await ElMessageBox.confirm(
      t("customer.transferPage.cancelConfirmText"),
      t("customer.transferPage.cancelConfirmTitle"),
      {
        confirmButtonText: t("customer.transferPage.actCancel"),
        cancelButtonText: t("customer.form.cancel"),
        type: "warning",
      }
    );
  } catch {
    return;
  }

  try {
    await CustomerAPI.cancelTransfer(row.id);
    ElMessage.success(t("customer.transferPage.cancelSuccess"));
    await fetchList();
  } catch {
    await fetchList();
  }
}

onMounted(() => {
  fetchList();
});
</script>

<style lang="scss" scoped>
.transfer-pet {
  display: flex;
  gap: 6px;
  align-items: center;
}

.transfer-pet__name {
  font-weight: 500;
}

.transfer-arrow {
  margin-right: 4px;
  color: var(--el-text-color-secondary);
}

.transfer-muted {
  color: var(--el-text-color-secondary);
}
</style>
