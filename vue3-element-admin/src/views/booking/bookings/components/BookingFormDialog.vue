<template>
  <el-dialog
    v-model="visible"
    :title="t('booking.form.createTitle')"
    width="480px"
    append-to-body
    destroy-on-close
    data-testid="booking-form-dialog"
    @closed="handleClosed"
  >
    <el-form ref="formRef" :model="draft" :rules="rules" label-width="88px" label-position="right">
      <el-form-item :label="t('booking.form.store')" prop="storeId">
        <!-- el-select 可透传 testid，但 el-date-picker / el-input-number 不透传（踩坑 124）⇒
             本表单统一由外层 div 承载锚点，口径一致、自动化定位无特例 -->
        <div class="booking-form__field" data-testid="booking-form-store">
          <el-select
            v-model="draft.storeId"
            :placeholder="t('booking.form.storePlaceholder')"
            clearable
            class="w-full"
          >
            <el-option
              v-for="item in storeOptions"
              :key="item.id"
              :label="item.name"
              :value="item.id"
            />
          </el-select>
        </div>
      </el-form-item>

      <el-form-item :label="t('booking.form.customer')" prop="customerId">
        <div class="booking-form__field" data-testid="booking-form-customer">
          <CustomerPickerSelect
            v-model="draft.customerId"
            :placeholder="t('booking.form.customerPlaceholder')"
          />
        </div>
      </el-form-item>

      <el-form-item :label="t('booking.form.pet')" prop="petId">
        <div class="booking-form__field" data-testid="booking-form-pet">
          <el-select
            v-model="draft.petId"
            :placeholder="petPlaceholder"
            :disabled="!draft.customerId"
            :loading="petLoading"
            clearable
            class="w-full"
          >
            <el-option
              v-for="item in petOptions"
              :key="item.id"
              :label="item.name"
              :value="item.id"
            />
          </el-select>
        </div>
      </el-form-item>

      <el-form-item :label="t('booking.form.service')" prop="serviceId">
        <div class="booking-form__field" data-testid="booking-form-service">
          <el-select
            v-model="draft.serviceId"
            :placeholder="t('booking.form.servicePlaceholder')"
            :loading="serviceLoading"
            clearable
            class="w-full"
          >
            <el-option
              v-for="item in serviceItems"
              :key="item.id"
              :label="item.label"
              :value="item.id"
            />
          </el-select>
        </div>
      </el-form-item>

      <el-form-item :label="t('booking.form.startAt')" prop="startAt">
        <div class="booking-form__field" data-testid="booking-form-start-at">
          <el-date-picker
            v-model="draft.startAt"
            type="datetime"
            format="YYYY-MM-DD HH:mm"
            value-format="YYYY-MM-DD HH:mm"
            :placeholder="t('booking.form.startAtPlaceholder')"
            class="w-full"
          />
        </div>
      </el-form-item>

      <el-form-item :label="t('booking.form.duration')" prop="durationMinutes">
        <div class="booking-form__field" data-testid="booking-form-duration">
          <el-input-number
            v-model="draft.durationMinutes"
            :min="15"
            :max="1440"
            :step="15"
            controls-position="right"
            class="w-full"
          />
        </div>
      </el-form-item>

      <el-form-item :label="t('booking.form.employee')" prop="employeeId">
        <div class="booking-form__field" data-testid="booking-form-employee">
          <el-select
            v-model="draft.employeeId"
            :placeholder="t('booking.form.employeePlaceholder')"
            :loading="staffLoading"
            clearable
            class="w-full"
          >
            <el-option
              v-for="item in staffOptions"
              :key="item.id"
              :label="item.name"
              :value="item.id"
            />
          </el-select>
        </div>
      </el-form-item>

      <el-form-item :label="t('booking.form.room')" prop="roomId" :required="requiresRoom">
        <div class="booking-form__field" data-testid="booking-form-room">
          <el-select
            v-model="draft.roomId"
            :placeholder="roomPlaceholder"
            :loading="roomLoading"
            clearable
            class="w-full"
          >
            <el-option
              v-for="item in roomOptions"
              :key="item.id"
              :label="item.label"
              :value="item.id"
            />
          </el-select>
        </div>
      </el-form-item>

      <!-- 寄养类提示：判据来自服务端 `requiresRoom`，前端不复算 catType（踩坑 126-bis） -->
      <div v-if="requiresRoom" class="booking-form__hint" data-testid="booking-form-room-hint">
        {{ t("booking.form.fosterRoomHint") }}
      </div>

      <el-form-item :label="t('booking.form.remark')" prop="remark">
        <el-input
          v-model="draft.remark"
          type="textarea"
          :rows="2"
          maxlength="255"
          show-word-limit
          :placeholder="t('booking.form.remarkPlaceholder')"
          data-testid="booking-form-remark"
        />
      </el-form-item>
    </el-form>

    <!-- 容量预校验结果（MVP-WEB-06-04）：不可用 ⇒ 阻止提交并给出冲突明细与可替代时段 -->
    <div v-if="capacityResult" class="booking-form__capacity" data-testid="booking-form-capacity">
      <el-alert
        :type="capacityResult.available ? 'success' : 'warning'"
        :closable="false"
        show-icon
        :title="
          capacityResult.available
            ? t('booking.form.capacity.capacityAvailable')
            : t('booking.form.capacity.capacityUnavailable')
        "
      />
      <ul v-if="!capacityResult.available" class="booking-form__conflicts">
        <li
          v-for="(item, index) in capacityResult.conflicts"
          :key="index"
          class="booking-form__conflict"
          data-testid="booking-form-conflict"
        >
          {{ describeConflict(item) }}
        </li>
      </ul>
      <div v-if="capacityResult.suggestions.length" class="booking-form__suggestions">
        <span class="booking-form__suggestions-label">
          {{ t("booking.form.capacity.suggestionsLabel") }}
        </span>
        <el-tag
          v-for="item in capacityResult.suggestions"
          :key="item.startAt"
          class="booking-form__suggestion"
          type="info"
          effect="plain"
          data-testid="booking-form-suggestion"
          @click="applySuggestion(item)"
        >
          {{ item.startAt.slice(5) }}
        </el-tag>
      </div>
    </div>

    <template #footer>
      <el-button data-testid="booking-form-cancel" @click="visible = false">
        {{ t("booking.form.cancel") }}
      </el-button>
      <el-button
        type="primary"
        :loading="submitting"
        data-testid="booking-form-submit"
        @click="handleSubmit"
      >
        {{ t("booking.form.submit") }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ElMessage, type FormInstance, type FormRules } from "element-plus";

import BookingAPI from "@/api/booking";
import type {
  BookingCapacityCheckResult,
  BookingCapacityConflict,
  BookingServiceItemOption,
  BookingStaffOption,
} from "@/api/booking";
import PetAPI from "@/api/pet";
import RoomAPI from "@/api/room";
import CustomerPickerSelect from "@/views/customer/customers/components/CustomerPickerSelect.vue";
import { todayWallClockAt } from "@/utils/booking";

/**
 * 预约创建对话框（MVP-WEB-06-02 · FR-1 预约创建；06-04 接入容量预校验）
 *
 * 契约：`POST /api/v1/bookings`（权限 `booking:create`），落库即 `pending`。
 * 参考数据：`GET /bookings/reference/{staffs,service-items}`（同权限门控）+
 * 既有 `GET /stores` / `GET /pets` / `GET /rooms`。
 *
 * 🔴 服务端反查客户：请求体**没有** `customerId`，客户由 `petId` 反查
 * （`pet.owner_customer_id`）⇒ 本表单只做「客户 → 宠物」两级联动，作为
 * **筛选宠物的手段**，不产生"客户与宠物不匹配"的写入可能。
 *
 * 🔴 房间必填判据**不本地复算**：取服务端 `requiresRoom`（= `catType === 3` 寄养），
 * 避免「表单不要求、提交被 A0805 拒绝」的双源漂移（踩坑 126-bis）。
 *
 * 🔴 提交顺序（06-04 起）：表单校验 → **容量预校验**（`POST /bookings/capacity-check`，
 * 与创建同参）→ 不可用则**阻止提交**并展示冲突明细 + 可替代时段（点击可回填开始时间）；
 * 可用才真正 `create`。创建端点自身不做容量校验（PRD「创建与校验之间不加锁，
 * `confirm` 时二次校验」）⇒ 本表单的预校验是 UX 前置，**不承担防超卖**（那是 06-05 的
 * confirm 事务）。
 *
 * 边界：下拉数据源中「服务项」由**服务类目树叶子**承载（`service_item` 表属
 * 《服务管理》模块尚未建模），故服务项名称即类目叶子名。
 */
defineOptions({ name: "BookingFormDialog", inheritAttrs: false });

defineProps<{
  /** 门店选项（由列表页传入，复用其已加载数据，避免重复请求） */
  storeOptions: ReadonlyArray<{ id: string; name: string }>;
}>();

const emit = defineEmits<{
  /** 创建成功（父页据此重取列表并定位第 1 页） */
  (e: "success"): void;
}>();

const visible = defineModel("modelValue", {
  type: Boolean,
  required: true,
  default: false,
});

const { t } = useI18n();

const formRef = ref<FormInstance>();
const submitting = ref(false);

/**
 * 容量预校验结果（MVP-WEB-06-04）
 *
 * `null` = 尚未校验（或输入已变更、上次结论作废）。刻意**不**做输入即校验的
 * 防抖自动探测：一次校验要按「宠物 × 员工 × 房间（逐日）× 建议时段」多路判定，
 * 键入过程中反复打库既费流量也会与后端限流（1s/10 次）打架 ⇒ 收口在**提交**这一个时刻。
 */
const capacityResult = ref<BookingCapacityCheckResult | null>(null);

// ── 参考数据 ────────────────────────────────────────────────────────────
const serviceItems = ref<BookingServiceItemOption[]>([]);
const serviceLoading = ref(false);
const staffOptions = ref<BookingStaffOption[]>([]);
const staffLoading = ref(false);
const petOptions = ref<Array<{ id: string; name: string }>>([]);
const petLoading = ref(false);
const roomOptions = ref<Array<{ id: string; label: string }>>([]);
const roomLoading = ref(false);

// ── 表单草稿 ────────────────────────────────────────────────────────────
const draft = reactive({
  storeId: "",
  customerId: undefined as string | undefined,
  petId: "",
  serviceId: "",
  startAt: "",
  durationMinutes: 60,
  employeeId: "",
  roomId: "",
  remark: "",
});

/** 选中服务项是否要求房间（服务端裁定） */
const requiresRoom = computed(
  () => serviceItems.value.find((item) => item.id === draft.serviceId)?.requiresRoom === true
);

const petPlaceholder = computed(() =>
  draft.customerId ? t("booking.form.petPlaceholder") : t("booking.form.petNeedCustomer")
);

const roomPlaceholder = computed(() =>
  requiresRoom.value ? t("booking.form.roomPlaceholderRequired") : t("booking.form.roomPlaceholder")
);

const rules = computed<FormRules>(() => ({
  storeId: [{ required: true, message: t("booking.form.storeRequired"), trigger: "change" }],
  customerId: [{ required: true, message: t("booking.form.customerRequired"), trigger: "change" }],
  petId: [{ required: true, message: t("booking.form.petRequired"), trigger: "change" }],
  serviceId: [{ required: true, message: t("booking.form.serviceRequired"), trigger: "change" }],
  startAt: [{ required: true, message: t("booking.form.startAtRequired"), trigger: "change" }],
  // 房间必填随服务项动态生效（`required` 由 `requiresRoom` 决定）
  roomId: requiresRoom.value
    ? [{ required: true, message: t("booking.form.roomRequired"), trigger: "change" }]
    : [],
}));

/** 复位为新建立场（门店留空由用户选择；开始时间给「次日 10:00」的合理缺省） */
function resetDraft(): void {
  draft.storeId = "";
  draft.customerId = undefined;
  draft.petId = "";
  draft.serviceId = "";
  draft.startAt = todayWallClockAt(10, 0, 1);
  draft.durationMinutes = 60;
  draft.employeeId = "";
  draft.roomId = "";
  draft.remark = "";
  petOptions.value = [];
  capacityResult.value = null;
}

/**
 * 容量冲突文案（结构化事实 → i18n）
 *
 * 服务端只回 `rule` / `resourceType` / `limit` / `occupied` / `bookingNos`，中文由前端按 i18n
 * 组合（同一判据不留给第二处来源，踩坑 126-bis）。
 */
function describeConflict(item: BookingCapacityConflict): string {
  if (item.rule === "pet_overlap") {
    return t("booking.form.capacity.conflictPet", { nos: item.bookingNos.join("、") });
  }
  if (item.resourceType === "employee") {
    return t("booking.form.capacity.conflictEmployee", {
      name: item.resourceName ?? "-",
      occupied: item.occupied ?? 0,
      limit: item.limit ?? 0,
    });
  }
  return t("booking.form.capacity.conflictRoom", {
    name: item.resourceName ?? "-",
    date: item.date ?? "-",
    occupied: item.occupied ?? 0,
    limit: item.limit ?? 0,
  });
}

/** 采纳建议时段：回填开始时间并**立即复校**（可用则直接给出绿色结论，用户再点创建） */
async function applySuggestion(item: { startAt: string }): Promise<void> {
  draft.startAt = item.startAt;
  capacityResult.value = null;
  await runCapacityCheck();
}

// ── 取数（失败静默降级为空列表，不阻断表单）────────────────────────────
async function fetchServiceItems(): Promise<void> {
  serviceLoading.value = true;
  try {
    serviceItems.value = await BookingAPI.getReferenceServiceItems();
  } catch {
    serviceItems.value = [];
  } finally {
    serviceLoading.value = false;
  }
}

async function fetchStaffOptions(storeId: string): Promise<void> {
  staffLoading.value = true;
  try {
    staffOptions.value = await BookingAPI.getReferenceStaffs({ storeId });
  } catch {
    staffOptions.value = [];
  } finally {
    staffLoading.value = false;
  }
}

async function fetchPetOptions(customerId: string): Promise<void> {
  petLoading.value = true;
  try {
    const data = await PetAPI.getPage({
      pageNum: 1,
      pageSize: 100,
      ownerCustomerId: customerId,
      sortBy: "createdAt",
      order: "DESC",
    });
    petOptions.value = (data.list ?? []).map((item) => ({ id: item.id, name: item.name }));
  } catch {
    petOptions.value = [];
  } finally {
    petLoading.value = false;
  }
}

async function fetchRoomOptions(storeId: string): Promise<void> {
  roomLoading.value = true;
  try {
    const data = await RoomAPI.getPage({
      pageNum: 1,
      pageSize: 100,
      storeId,
      sortBy: "roomNo",
      order: "ASC",
    });
    roomOptions.value = (data.list ?? []).map((item) => ({
      id: item.id,
      label: item.name ?? item.roomNo,
    }));
  } catch {
    roomOptions.value = [];
  } finally {
    roomLoading.value = false;
  }
}

// ── 联动 ────────────────────────────────────────────────────────────────
/** 门店变更 ⇒ 员工 / 房间候选随之收窄，并清掉已选的「上家门店」值 */
watch(
  () => draft.storeId,
  (value) => {
    draft.employeeId = "";
    draft.roomId = "";
    if (value) {
      void fetchStaffOptions(value);
      void fetchRoomOptions(value);
    } else {
      staffOptions.value = [];
      roomOptions.value = [];
    }
  }
);

/** 客户变更 ⇒ 宠物候选重取（客户是宠物的唯一入口），并清掉已选宠物 */
watch(
  () => draft.customerId,
  (value) => {
    draft.petId = "";
    if (value) {
      void fetchPetOptions(value);
    } else {
      petOptions.value = [];
    }
  }
);

/** 服务项变更 ⇒ 由「寄养/非寄养」切换时应清掉可能残留的房间值 */
watch(
  () => draft.serviceId,
  () => {
    if (!requiresRoom.value) draft.roomId = "";
  }
);

/**
 * 参与容量判定的输入一旦变更 ⇒ 上次预校验结论作废（避免「改了时间却还显示旧结论」）
 *
 * 与「提交时校验」配套：结论永远对应当前表单值，不会出现「显示的可用性与实际提交的
 * 时段不一致」这类过期结论缺陷。
 */
watch(
  () => [
    draft.storeId,
    draft.petId,
    draft.serviceId,
    draft.startAt,
    draft.durationMinutes,
    draft.employeeId,
    draft.roomId,
  ],
  () => {
    capacityResult.value = null;
  }
);

// ── 打开 / 关闭 ─────────────────────────────────────────────────────────
watch(visible, (open) => {
  if (!open) return;
  resetDraft();
  void fetchServiceItems();
  nextTick(() => formRef.value?.clearValidate());
});

/** 关闭动效结束后复位（避免下次打开闪现上一次输入） */
function handleClosed(): void {
  formRef.value?.resetFields();
  resetDraft();
}

// ── 提交 ────────────────────────────────────────────────────────────────
/** 容量预校验（只读）；请求失败返回 null（错误提示由请求层统一渲染） */
async function runCapacityCheck(): Promise<BookingCapacityCheckResult | null> {
  try {
    const result = await BookingAPI.checkCapacity({
      storeId: draft.storeId,
      petId: draft.petId,
      serviceId: draft.serviceId,
      // 空串归一为 undefined：可选外键留空时不应把 "" 发给服务端（踩坑 129-④）
      employeeId: draft.employeeId || undefined,
      roomId: draft.roomId || undefined,
      startAt: draft.startAt,
      durationMinutes: Number(draft.durationMinutes) || 60,
    });
    capacityResult.value = result;
    return result;
  } catch {
    capacityResult.value = null;
    return null;
  }
}

/**
 * 提交创建
 *
 * **失败不关闭**对话框（保留输入供修正）：服务端业务码（A0802~A0808）由请求层
 * 统一渲染文案；此处只负责成功路径。
 *
 * 顺序：容量预校验（06-04）⇒ 不可用则**阻止提交**并展示冲突 + 建议时段 ⇒ 可用才落库。
 */
async function handleSubmit(): Promise<void> {
  if (!formRef.value) return;
  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;

  submitting.value = true;
  try {
    const capacity = await runCapacityCheck();
    if (!capacity) return;
    if (!capacity.available) {
      ElMessage.warning(t("booking.form.capacity.capacityBlocked"));
      return;
    }

    await BookingAPI.create({
      storeId: draft.storeId,
      petId: draft.petId,
      serviceId: draft.serviceId,
      // 空串归一为 undefined：可选外键留空时不应把 "" 发给服务端（踩坑 129-④）
      employeeId: draft.employeeId || undefined,
      roomId: draft.roomId || undefined,
      startAt: draft.startAt,
      durationMinutes: Number(draft.durationMinutes) || 60,
      remark: draft.remark.trim() || undefined,
    });
    ElMessage.success(t("booking.form.success"));
    visible.value = false;
    emit("success");
  } catch {
    // 错误提示由请求层统一渲染（业务码 / 校验失败），对话框保持打开
  } finally {
    submitting.value = false;
  }
}
</script>

<style lang="scss" scoped>
.booking-form__field {
  width: 100%;
}

.booking-form__hint {
  padding-left: 88px;
  margin-top: -4px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.booking-form__capacity {
  margin-top: 4px;
}

.booking-form__conflicts {
  padding: 0;
  margin: 8px 0 0;
  list-style: none;
}

.booking-form__conflict {
  padding-left: 22px;
  font-size: 12px;
  line-height: 1.8;
  color: var(--el-color-warning);
}

.booking-form__suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin-top: 8px;
}

.booking-form__suggestions-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.booking-form__suggestion {
  cursor: pointer;
}
</style>
