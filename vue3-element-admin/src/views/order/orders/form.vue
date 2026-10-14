<template>
  <div class="page-container">
    <el-card class="page-content" shadow="never">
      <!-- ── 头部：返回 / 标题 ──────────────────────────────────────────── -->
      <div class="order-form__head">
        <div class="order-form__head-left">
          <el-button link class="order-form__back" data-testid="order-form-back" @click="goBack">
            <el-icon><ArrowLeft /></el-icon>
            {{ t("order.form.back") }}
          </el-button>
          <span class="order-form__title">{{ pageTitle }}</span>
          <el-tag v-if="mode === 'edit' && detail" :type="orderStatusTagType(detail.order.status)">
            {{ t(orderStatusLabelKey(detail.order.status)) }}
          </el-tag>
        </div>
      </div>

      <div class="order-form__scroll">
        <TableSkeleton v-if="showSkeleton" :column-count="4" :row-count="6" />

        <DataState
          v-else-if="loadError"
          variant="error"
          :title="t('order.form.loadError')"
          :description="loadError"
          :action-text="t('order.form.retry')"
          @action="loadDetail"
        />

        <DataState
          v-else-if="notEditable"
          variant="empty"
          :title="t('order.form.notEditableTitle')"
          :description="t('order.form.notEditableDesc')"
          :action-text="t('order.form.back')"
          @action="goBack"
        />

        <template v-else>
          <!-- ── 基础信息 ──────────────────────────────────────────────── -->
          <el-form
            ref="formRef"
            :model="formData"
            :rules="rules"
            label-width="auto"
            class="order-form__base"
            @submit.prevent
          >
            <el-form-item :label="t('order.field.store')" prop="storeId">
              <el-select
                v-model="formData.storeId"
                :placeholder="t('order.form.storePlaceholder')"
                :disabled="mode === 'edit'"
                class="w-[280px]"
                data-testid="order-form-store"
                @change="handleStoreChange"
              >
                <el-option
                  v-for="store in storeOptions"
                  :key="store.id"
                  :label="store.name"
                  :value="store.id"
                />
              </el-select>
            </el-form-item>

            <el-form-item :label="t('order.field.customer')" prop="customerId">
              <el-select
                v-model="formData.customerId"
                filterable
                remote
                clearable
                :remote-method="searchCustomers"
                :loading="customerSearching"
                :placeholder="t('order.form.customerPlaceholder')"
                :disabled="mode === 'edit'"
                class="w-[280px]"
                data-testid="order-form-customer"
                @change="handleCustomerChange"
              >
                <el-option
                  v-for="customer in customerOptions"
                  :key="customer.id"
                  :label="customer.name"
                  :value="customer.id"
                />
              </el-select>
            </el-form-item>

            <el-form-item :label="t('order.field.pet')" prop="petId">
              <el-select
                v-model="formData.petId"
                :placeholder="t('order.form.petPlaceholder')"
                :disabled="mode === 'edit' || !formData.customerId"
                class="w-[280px]"
                data-testid="order-form-pet"
              >
                <el-option
                  v-for="pet in petOptions"
                  :key="pet.id"
                  :label="pet.name"
                  :value="pet.id"
                />
              </el-select>
            </el-form-item>

            <el-form-item v-if="mode === 'edit' && detail?.order.sourceBookingNo" label="">
              <span class="order-form__source-booking">
                {{ t("order.form.sourceBooking") }}：{{ detail.order.sourceBookingNo }}
              </span>
            </el-form-item>
          </el-form>

          <!-- ── 明细组合（价格快照：名称 / 单价落库即固化） ─────────────── -->
          <div class="order-form__section">
            <div class="order-form__section-head">
              <span class="order-form__section-title">{{ t("order.form.itemsTitle") }}</span>
              <el-button
                type="primary"
                plain
                size="small"
                data-testid="order-item-add"
                @click="addItemRow"
              >
                <el-icon><Plus /></el-icon>
                {{ t("order.form.addItem") }}
              </el-button>
            </div>

            <el-table
              v-if="itemRows.length > 0"
              :data="itemRows"
              class="page-table"
              size="small"
              data-testid="order-form-items"
            >
              <el-table-column :label="t('order.item.field.type')" width="110" align="center">
                <template #default="{ row, $index }">
                  <el-select
                    v-model="row.itemType"
                    :disabled="row.refLocked"
                    size="small"
                    @change="handleItemTypeChange($index)"
                  >
                    <el-option
                      v-for="option in ITEM_TYPE_OPTIONS"
                      :key="option.value"
                      :label="t(option.labelKey)"
                      :value="option.value"
                    />
                  </el-select>
                </template>
              </el-table-column>

              <el-table-column :label="t('order.item.field.name')" min-width="220">
                <template #default="{ row }">
                  <el-select
                    v-if="row.itemType === OrderItemType.SERVICE"
                    v-model="row.refId"
                    filterable
                    size="small"
                    :placeholder="t('order.form.servicePlaceholder')"
                    @change="handleServiceSelect(row as OrderItemFormRow)"
                  >
                    <el-option
                      v-for="service in serviceOptions"
                      :key="service.id"
                      :label="service.label"
                      :value="service.id"
                    />
                  </el-select>
                  <el-input v-else v-model="row.itemName" size="small" maxlength="64" />
                </template>
              </el-table-column>

              <el-table-column :label="t('order.item.field.unitPrice')" width="150" align="right">
                <template #default="{ row }">
                  <el-input-number
                    v-model="row.unitPriceYuan"
                    :min="0"
                    :max="999999.99"
                    :precision="2"
                    :step="1"
                    :controls="false"
                    size="small"
                    class="order-form__price-input"
                  />
                </template>
              </el-table-column>

              <el-table-column :label="t('order.item.field.quantity')" width="130" align="center">
                <template #default="{ row }">
                  <el-input-number
                    v-model="row.quantity"
                    :min="1"
                    :max="999"
                    :precision="0"
                    :step="1"
                    size="small"
                    :controls="false"
                    class="order-form__qty-input"
                  />
                </template>
              </el-table-column>

              <el-table-column :label="t('order.item.field.subtotal')" width="120" align="right">
                <template #default="{ row }">
                  <span class="order-form__subtotal" data-testid="order-form-item-subtotal">
                    {{ rowSubtotalLabel(row as OrderItemFormRow) }}
                  </span>
                </template>
              </el-table-column>

              <el-table-column width="70" align="center">
                <template #default="{ $index }">
                  <el-button
                    type="danger"
                    size="small"
                    link
                    data-testid="order-item-remove"
                    @click="removeItemRow($index)"
                  >
                    {{ t("order.form.removeItem") }}
                  </el-button>
                </template>
              </el-table-column>
            </el-table>

            <DataState
              v-else
              variant="empty"
              :title="t('order.item.emptyTitle')"
              :description="t('order.form.itemsEmptyDesc')"
            />
          </div>

          <!-- ── 合计 + 备注 ───────────────────────────────────────────── -->
          <div class="order-form__summary">
            <div class="order-form__total">
              <span>{{ t("order.form.totalAmount") }}</span>
              <span class="order-form__total-value" data-testid="order-form-total">
                {{ totalAmountLabel }}
              </span>
            </div>

            <el-form ref="remarkFormRef" :model="formData" label-width="auto" @submit.prevent>
              <el-form-item :label="t('order.field.remark')" prop="remark">
                <el-input
                  v-model="formData.remark"
                  type="textarea"
                  :rows="2"
                  maxlength="500"
                  show-word-limit
                  :placeholder="t('order.form.remarkPlaceholder')"
                  class="w-[480px]"
                />
              </el-form-item>
            </el-form>
          </div>

          <!-- ── 底部操作 ──────────────────────────────────────────────── -->
          <div class="order-form__footer">
            <el-button data-testid="order-form-cancel" @click="goBack">
              {{ t("order.form.cancel") }}
            </el-button>
            <el-button
              type="primary"
              :loading="submitting"
              data-testid="order-form-submit"
              @click="handleSubmit"
            >
              {{ mode === "create" ? t("order.form.submitCreate") : t("order.form.submitUpdate") }}
            </el-button>
          </div>
        </template>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ArrowLeft, Plus } from "@element-plus/icons-vue";
import type { FormInstance, FormRules } from "element-plus";
import { asCents, centsToYuan, yuanToCents, OrderItemType } from "@peluvida/shared";

import BookingAPI from "@/api/booking";
import type { BookingServiceItemOption } from "@/api/booking";
import CustomerAPI from "@/api/customer";
import OrderAPI from "@/api/order";
import type { OrderDetail, OrderDetailItem } from "@/api/order";
import PetAPI from "@/api/pet";
import StoreAPI from "@/api/store";
import DataState from "@/components/DataState/DataState.vue";
import TableSkeleton from "@/components/DataState/TableSkeleton.vue";
import { useTagsViewStore } from "@/stores";
import { isOrderEditable, orderStatusLabelKey, orderStatusTagType } from "@/utils/order";
import { isApiError } from "@/utils/request";

/**
 * 订单创建 / 编辑页（MVP-WEB-07-03 · 独立页）
 *
 * 路由：`/orders/new`（seed 8103，路径取 PRD《页面清单》）/ `/orders/:orderId/edit`（seed 8104），
 * 两路由共用本组件（`visible=0` 隐藏子菜单，不进侧边栏）。
 *
 * **价格快照**：明细 `itemName` / `unitPrice` 落库即固化（PRD《订单管理》）；
 * 服务项下拉只带名称与 id（服务类目无价格列）⇒ 单价由操作员录入，快照即下单时点定价。
 * 商品 / 套餐无被引实体模型 ⇒ `refId` 由前端生成 uuid（DTO 契约允许）。
 *
 * 编辑模式：状态守卫（仅 draft / pending_payment 可编辑，A0907）前端前置渲染 +
 * 后端兜底；`version` 乐观锁随提交回传（A0909 冲突提示刷新）；明细**全量替换**语义。
 *
 * 服务项下拉复用预约参考端点（`booking:create` 权限；manager/staff 均已授权，边界记入
 * PITFALLS 07-03 段）。
 */
defineOptions({ name: "OrderForm", inheritAttrs: false });

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const tagsViewStore = useTagsViewStore();

/** 编辑模式订单 id（创建模式为空） */
const orderId = computed(() => {
  const raw = route.params.orderId;
  const text = Array.isArray(raw) ? raw[0] : raw;
  return typeof text === "string" ? text : "";
});

const mode = computed<"create" | "edit">(() => (orderId.value ? "edit" : "create"));

const pageTitle = computed(() =>
  mode.value === "create" ? t("order.form.createTitle") : t("order.form.editTitle")
);

// ── 明细行（表单态：单价以「元」编辑，提交前 yuanToCents 转分） ──────────

interface OrderItemFormRow {
  itemType: OrderItemType;
  /** 服务项 id（类型=服务时由下拉选定；商品/套餐提交时生成 uuid） */
  refId: string;
  itemName: string;
  /** 单价（元，输入态；null=未填） */
  unitPriceYuan: number | null;
  quantity: number;
  /** true=refId 已锁定（服务项选中 / 编辑模式回读），不可切换类型 */
  refLocked: boolean;
}

const ITEM_TYPE_OPTIONS: ReadonlyArray<{ value: OrderItemType; labelKey: string }> = [
  { value: OrderItemType.SERVICE, labelKey: "order.itemType.service" },
  { value: OrderItemType.PRODUCT, labelKey: "order.itemType.product" },
  { value: OrderItemType.PACKAGE, labelKey: "order.itemType.package" },
];

const itemRows = ref<OrderItemFormRow[]>([]);

function addItemRow(): void {
  itemRows.value.push({
    itemType: OrderItemType.SERVICE,
    refId: "",
    itemName: "",
    unitPriceYuan: null,
    quantity: 1,
    refLocked: false,
  });
}

function removeItemRow(index: number): void {
  itemRows.value.splice(index, 1);
}

function handleItemTypeChange(index: number): void {
  const row = itemRows.value[index];
  if (!row) return;
  // 切类型即作废原引用：服务项 refId 清空，商品/套餐落库时生成 uuid
  row.refId = "";
  row.itemName = "";
}

function handleServiceSelect(row: OrderItemFormRow): void {
  const service = serviceOptions.value.find((option) => option.id === row.refId);
  if (service) {
    // 🔴 快照存**叶子名**（`service.name`），不存下拉展示用的 `service.label`：
    // ① `label` 是「父类目 / 叶子名」的选择器展示态，不是明细固有属性（`refId` 已保关联可回溯）；
    // ② `order_item.item_name` 上限 64，深树下拼父路径有溢出风险；
    // ③ 与预约域 `serviceName`（叶子名）同源同义，避免同一实体两套名字。
    row.itemName = service.name;
    row.refLocked = true;
  }
}

function rowSubtotalLabel(row: OrderItemFormRow): string {
  if (row.unitPriceYuan === null || !Number.isFinite(row.unitPriceYuan)) return "-";
  const cents = yuanToCents(row.unitPriceYuan);
  const total = cents * row.quantity;
  return `¥${(Number(total) / 100).toFixed(2)}`;
}

const totalCents = computed(() =>
  itemRows.value.reduce((sum, row) => {
    if (row.unitPriceYuan === null || !Number.isFinite(row.unitPriceYuan)) return sum;
    return sum + yuanToCents(row.unitPriceYuan) * row.quantity;
  }, 0)
);

const totalAmountLabel = computed(() => `¥${(Number(totalCents.value) / 100).toFixed(2)}`);

// ── 基础表单 ────────────────────────────────────────────────────────────

const formRef = ref<FormInstance>();

const formData = reactive({
  storeId: "",
  customerId: "",
  petId: "",
  remark: "",
});

const rules: FormRules = {
  storeId: [{ required: true, message: t("order.form.storeRequired"), trigger: "change" }],
  customerId: [{ required: true, message: t("order.form.customerRequired"), trigger: "change" }],
  petId: [{ required: true, message: t("order.form.petRequired"), trigger: "change" }],
};

const storeOptions = ref<Array<{ id: string; name: string }>>([]);

async function fetchStoreOptions(): Promise<void> {
  try {
    const data = await StoreAPI.getPage({ pageNum: 1, pageSize: 100 });
    storeOptions.value = (data.list ?? []).map((item) => ({ id: item.id, name: item.name }));
  } catch {
    storeOptions.value = [];
  }
}

const customerOptions = ref<Array<{ id: string; name: string; mobile: string }>>([]);
const customerSearching = ref(false);

async function searchCustomers(keyword: string): Promise<void> {
  customerSearching.value = true;
  try {
    const data = await CustomerAPI.getPage({
      pageNum: 1,
      pageSize: 50,
      keyword: keyword || undefined,
    });
    customerOptions.value = (data.list ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      mobile: item.mobile,
    }));
  } catch {
    customerOptions.value = [];
  } finally {
    customerSearching.value = false;
  }
}

function handleCustomerChange(): void {
  formData.petId = "";
  petOptions.value = [];
  if (formData.customerId) void fetchPetOptions();
}

const petOptions = ref<Array<{ id: string; name: string }>>([]);

async function fetchPetOptions(): Promise<void> {
  if (!formData.customerId) return;
  try {
    const data = await PetAPI.getPage({
      pageNum: 1,
      pageSize: 100,
      ownerCustomerId: formData.customerId,
    });
    petOptions.value = (data.list ?? []).map((item) => ({ id: item.id, name: item.name }));
  } catch {
    petOptions.value = [];
  }
}

const serviceOptions = ref<BookingServiceItemOption[]>([]);

async function fetchServiceOptions(): Promise<void> {
  try {
    serviceOptions.value = await BookingAPI.getReferenceServiceItems();
  } catch {
    serviceOptions.value = [];
  }
}

function handleStoreChange(): void {
  // 门店切换不强制清服务项：租户级类目恒合法；门店私有类目归属由后端 A0906 兜底
}

// ── 编辑模式：详情回读与状态守卫 ────────────────────────────────────────

const detail = ref<OrderDetail | null>(null);
const loading = ref(false);
const hasLoaded = ref(false);
const loadError = ref("");
const notFound = ref(false);

const notEditable = computed(
  () =>
    mode.value === "edit" &&
    hasLoaded.value &&
    !loadError.value &&
    detail.value !== null &&
    !isOrderEditable(detail.value.order.status)
);

const showSkeleton = computed(() => loading.value && !hasLoaded.value);

function detailItemsToRows(items: OrderDetailItem[]): OrderItemFormRow[] {
  return items.map((item) => ({
    itemType: item.itemType,
    refId: item.refId,
    itemName: item.itemName,
    unitPriceYuan: centsToYuan(asCents(Number(item.unitPrice))),
    quantity: item.quantity,
    refLocked: true,
  }));
}

async function loadDetail(): Promise<void> {
  if (mode.value === "create") return;
  loadError.value = "";
  loading.value = true;
  try {
    const data = await OrderAPI.getDetail(orderId.value);
    detail.value = data;
    notFound.value = false;
    itemRows.value = detailItemsToRows(data.items);
    formData.storeId = data.order.storeId;
    formData.customerId = data.order.customerId;
    formData.petId = data.order.petId;
    formData.remark = data.order.remark ?? "";
    customerOptions.value = [
      { id: data.order.customerId, name: data.order.customerName ?? "", mobile: "" },
    ];
    petOptions.value = [{ id: data.order.petId, name: data.order.petName ?? "" }];
    tagsViewStore.updateTagName(
      route.fullPath,
      `${data.order.orderNo} · ${t("order.form.editTitle")}`
    );
  } catch (error) {
    if (isApiError(error) && error.code === "A0901") {
      notFound.value = true;
      loadError.value = t("order.detail.notFound");
    } else {
      loadError.value = isApiError(error) ? error.message : String(error ?? "");
    }
  } finally {
    loading.value = false;
    hasLoaded.value = true;
  }
}

function goBack(): void {
  void router.push("/orders");
}

// ── 提交 ────────────────────────────────────────────────────────────────

const submitting = ref(false);

function buildItemInputs(): Array<{
  itemType: OrderItemType;
  refId: string;
  itemName: string;
  unitPrice: string;
  quantity: number;
} | null> {
  return itemRows.value.map((row) => {
    if (row.unitPriceYuan === null || !Number.isFinite(row.unitPriceYuan)) return null;
    if (row.itemType === OrderItemType.SERVICE && !row.refId) return null;
    if (row.itemType !== OrderItemType.SERVICE && !row.itemName.trim()) return null;
    return {
      itemType: row.itemType,
      refId: row.itemType === OrderItemType.SERVICE ? row.refId : crypto.randomUUID(),
      itemName: row.itemName.trim(),
      unitPrice: String(yuanToCents(row.unitPriceYuan)),
      quantity: row.quantity,
    };
  });
}

async function handleSubmit(): Promise<void> {
  if (itemRows.value.length === 0) {
    ElMessage.warning(t("order.form.itemsRequired"));
    return;
  }
  const inputs = buildItemInputs();
  if (inputs.some((input) => input === null)) {
    ElMessage.warning(t("order.form.itemIncomplete"));
    return;
  }

  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;

  submitting.value = true;
  try {
    if (mode.value === "create") {
      const detailResult = await OrderAPI.create({
        storeId: formData.storeId,
        customerId: formData.customerId,
        petId: formData.petId,
        items: inputs as NonNullable<(typeof inputs)[number]>[],
        remark: formData.remark || undefined,
      });
      ElMessage.success(t("order.form.createSuccess"));
      void router.push(`/orders/${detailResult.order.id}`);
    } else {
      if (!detail.value) return;
      await OrderAPI.update(orderId.value, {
        version: detail.value.order.version,
        items: inputs as NonNullable<(typeof inputs)[number]>[],
        // 编辑传原值（含空串）：空串 = 显式清空备注；后端 undefined 才保留旧值
        remark: formData.remark,
      });
      ElMessage.success(t("order.form.updateSuccess"));
      void router.push(`/orders/${orderId.value}`);
    }
  } catch (error) {
    if (isApiError(error) && error.code === "A0909") {
      ElMessage.warning(t("order.form.versionConflict"));
    } else {
      ElMessage.error(isApiError(error) ? error.message : String(error ?? ""));
    }
  } finally {
    submitting.value = false;
  }
}

// ── 生命周期 ────────────────────────────────────────────────────────────

onMounted(() => {
  void fetchStoreOptions();
  void fetchServiceOptions();
  void searchCustomers("");
  if (mode.value === "create") {
    hasLoaded.value = true;
    addItemRow();
  } else {
    void loadDetail();
  }
});
</script>

<style lang="scss" scoped>
.order-form {
  &__head {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  &__head-left {
    display: flex;
    gap: 12px;
    align-items: center;
    min-width: 0;
  }

  &__back {
    height: auto;
    padding: 0;
    font-size: 13px;
  }

  &__title {
    font-size: 16px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  &__scroll {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-height: 0;
    overflow: auto;
  }

  &__base {
    max-width: 720px;
  }

  &__source-booking {
    font-size: 13px;
    color: var(--el-text-color-secondary);
  }

  &__section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  &__section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__section-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  &__price-input,
  &__qty-input {
    width: 110px;
  }

  &__subtotal {
    font-weight: 500;
    color: var(--el-text-color-primary);
  }

  &__summary {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  &__total {
    display: flex;
    gap: 12px;
    align-items: baseline;
    justify-content: flex-end;
    padding-right: 8px;
    font-size: 14px;
    color: var(--el-text-color-regular);
  }

  &__total-value {
    font-size: 20px;
    font-weight: 600;
    color: var(--el-color-primary);
  }

  &__footer {
    display: flex;
    gap: 12px;
    justify-content: flex-end;
    padding-top: 8px;
    border-top: 1px solid var(--el-border-color-lighter);
  }
}
</style>
