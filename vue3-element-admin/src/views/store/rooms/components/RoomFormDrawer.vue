<template>
  <el-drawer
    v-model="visible"
    :title="drawerTitle"
    :size="drawerSize"
    :close-on-click-modal="false"
    destroy-on-close
    @closed="handleClosed"
  >
    <div v-loading="detailLoading" class="room-form">
      <el-form
        ref="formRef"
        :model="formData"
        :rules="rules"
        label-position="top"
        :disabled="isReadonly"
      >
        <el-row :gutter="16">
          <el-col :span="24">
            <el-form-item :label="t('room.field.store')" prop="storeId">
              <el-select
                v-model="formData.storeId"
                :placeholder="t('room.form.storePlaceholder')"
                :disabled="isReadonly || internalMode === 'edit'"
                class="w-full"
              >
                <el-option
                  v-for="store in storeOptions"
                  :key="store.id"
                  :label="store.name"
                  :value="store.id"
                />
              </el-select>
              <div v-if="internalMode === 'edit'" class="room-form__tip">
                {{ t("room.form.storeLockedTip") }}
              </div>
            </el-form-item>
          </el-col>

          <el-col :xs="24" :sm="24" :md="12">
            <el-form-item :label="t('room.field.roomNo')" prop="roomNo">
              <el-input
                v-model="formData.roomNo"
                :placeholder="t('room.form.roomNoPlaceholder')"
                maxlength="16"
                clearable
              />
            </el-form-item>
          </el-col>

          <el-col :xs="24" :sm="24" :md="12">
            <el-form-item :label="t('room.field.name')" prop="name">
              <el-input
                v-model="formData.name"
                :placeholder="t('room.form.namePlaceholder')"
                maxlength="64"
                clearable
              />
            </el-form-item>
          </el-col>

          <el-col :xs="24" :sm="24" :md="12">
            <el-form-item :label="t('room.field.roomType')" prop="roomType">
              <el-select
                v-model="formData.roomType"
                :placeholder="t('room.form.roomTypePlaceholder')"
                class="w-full"
              >
                <el-option :label="t('room.value.typeKennel')" :value="RoomType.KENNEL" />
                <el-option :label="t('room.value.typeSuite')" :value="RoomType.SUITE" />
                <el-option :label="t('room.value.typeCat')" :value="RoomType.CAT" />
                <el-option :label="t('room.value.typeDog')" :value="RoomType.DOG" />
                <el-option :label="t('room.value.typeVip')" :value="RoomType.VIP" />
                <el-option :label="t('room.value.typeMulti')" :value="RoomType.MULTI" />
              </el-select>
            </el-form-item>
          </el-col>

          <el-col :xs="24" :sm="24" :md="12">
            <el-form-item :label="t('room.field.capacity')" prop="capacity">
              <el-input-number
                v-model="formData.capacity"
                :min="1"
                :max="32767"
                :precision="0"
                :controls="false"
                :placeholder="t('room.form.capacityPlaceholder')"
                class="w-full"
              />
            </el-form-item>
          </el-col>

          <el-col :span="24">
            <el-divider content-position="left">
              <span class="room-form__divider-title">{{ t("room.form.allowPetSizeTitle") }}</span>
            </el-divider>
          </el-col>

          <el-col :xs="24" :sm="24" :md="12">
            <el-form-item :label="t('room.form.minKgPlaceholder')" prop="minKg">
              <el-input-number
                v-model="minKg"
                :min="0"
                :max="200"
                :precision="1"
                :step="0.5"
                :controls="false"
                class="w-full"
              />
            </el-form-item>
          </el-col>

          <el-col :xs="24" :sm="24" :md="12">
            <el-form-item :label="t('room.form.maxKgPlaceholder')" prop="maxKg">
              <el-input-number
                v-model="maxKg"
                :min="0"
                :max="200"
                :precision="1"
                :step="0.5"
                :controls="false"
                class="w-full"
              />
            </el-form-item>
          </el-col>

          <el-col :span="24">
            <el-alert
              :title="t('room.form.allowPetSizeTip')"
              type="info"
              :closable="false"
              show-icon
            />
          </el-col>

          <el-col v-if="internalMode !== 'create'" :span="24">
            <el-alert
              class="room-form__status-tip"
              :title="t('room.form.statusTip')"
              type="warning"
              :closable="false"
              show-icon
            />
          </el-col>
        </el-row>
      </el-form>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button
          v-if="isView"
          v-hasPerm="'room:update'"
          type="primary"
          :disabled="detailLoading"
          @click="switchToEdit"
        >
          {{ t("room.form.edit") }}
        </el-button>
        <el-button v-else type="primary" :loading="submitting" @click="handleSubmit">
          {{ t("room.form.submit") }}
        </el-button>
        <el-button @click="visible = false">{{ t("room.form.cancel") }}</el-button>
      </div>
    </template>
  </el-drawer>
</template>

<script setup lang="ts">
import type { FormInstance, FormRules } from "element-plus";

import RoomAPI from "@/api/room";
import type { RoomForm, RoomUpdateForm } from "@/api/room";
import { DeviceEnum, RoomType } from "@/enums";
import { useAppStore } from "@/stores";

/**
 * 房间表单 / 详情抽屉（MVP-WEB-02-02）
 *
 * 统一承载三种模式（PRD《Web规范》§页面模式 1：「详情一律用右侧抽屉呈现而非跳页，
 * 保留列表上下文」）：
 *  · `create` 新建 —— 空表单，两列栅格（窄屏单列），标签置于输入框上方左对齐；
 *  · `view`   详情 —— 全字段只读；主按钮为「编辑」（无 `room:update` 权限时不渲染）；
 *  · `edit`   编辑 —— 回填后提交，携带 `version` 乐观锁。
 *
 * 刻意收敛（与后端 `UpdateRoomDto` 对齐）：
 *  · `storeId` 只在创建时可填；编辑态锁定并提示后端不支持跨店迁移；
 *  · `status` 不在表单内 —— 运行时房态由入住流程流转，人工写入口仅有列表页的
 *    维护切换（仅 1 ↔ 4）。
 */
defineOptions({ name: "RoomFormDrawer", inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    /** 抽屉可见性（v-model） */
    modelValue: boolean;
    /** 打开模式 */
    mode?: "create" | "edit" | "view";
    /** 房间 ID（edit / view 必填） */
    roomId?: string;
    /** 门店选项（列表页统一拉取后下发，避免抽屉内重复请求） */
    storeOptions?: Array<{ id: string; name: string }>;
  }>(),
  {
    mode: "create",
    roomId: "",
    storeOptions: () => [],
  }
);

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  /** 保存成功（列表页负责刷新与提示） */
  success: [payload: { mode: "create" | "edit" }];
}>();

const { t } = useI18n();
const appStore = useAppStore();

const formRef = ref<FormInstance>();
const submitting = ref(false);
const detailLoading = ref(false);

/**
 * 抽屉内的实际模式
 *
 * 与 `props.mode` 分离：详情页点「编辑」只在抽屉内切换（PRD 要求保留列表上下文，
 * 关掉再开会丢失滚动位置与筛选），故不通过父组件重开。
 */
const internalMode = ref<"create" | "edit" | "view">(props.mode);

/** 乐观锁版本号（回填时记录，提交时回传） */
const currentVersion = ref(0);

/** 适用体重段（独立 ref，仅在两端都填时组装为 allowPetSize） */
const minKg = ref<number | undefined>(undefined);
const maxKg = ref<number | undefined>(undefined);

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

const isView = computed(() => internalMode.value === "view");
/** 只读：查看模式，或详情仍在加载 */
const isReadonly = computed(() => isView.value || detailLoading.value);

const drawerTitle = computed(() => {
  if (internalMode.value === "create") return t("room.form.createTitle");
  if (internalMode.value === "edit") return t("room.form.editTitle");
  return t("room.form.viewTitle");
});

const drawerSize = computed(() => (appStore.device === DeviceEnum.DESKTOP ? "480px" : "100%"));

/** 空表单基线（同时作为重置基准） */
function emptyForm(): RoomForm {
  return {
    storeId: "",
    roomNo: "",
    name: "",
    roomType: RoomType.KENNEL,
    capacity: 1,
  };
}

const formData = reactive<RoomForm>(emptyForm());

/**
 * 表单校验规则类型
 *
 * `minKg` / `maxKg` 是**表单专属字段**（不属于后端 `RoomForm` 契约），
 * 若直接用 `FormRules<RoomForm>`，这两个键会落到索引签名上、其 validator
 * 参数被推断为隐式 any（TS7006）。故此处显式并入这两个可选字段。
 */
type RoomFormModel = RoomForm & { minKg?: number; maxKg?: number };

const rules = computed<FormRules<RoomFormModel>>(() => ({
  storeId: [{ required: true, message: t("room.rules.storeRequired"), trigger: "change" }],
  roomNo: [
    { required: true, message: t("room.rules.roomNoRequired"), trigger: "blur" },
    { max: 16, message: t("room.rules.roomNoLength"), trigger: "blur" },
  ],
  name: [{ max: 64, message: t("room.rules.nameLength"), trigger: "blur" }],
  roomType: [{ required: true, message: t("room.rules.roomTypeRequired"), trigger: "change" }],
  capacity: [
    { required: true, message: t("room.rules.capacityRequired"), trigger: "blur" },
    {
      validator: (_rule, value: number | undefined, callback) => {
        if (value === undefined || value === null) return callback();
        return Number.isInteger(value) && value >= 1 && value <= 32767
          ? callback()
          : callback(new Error(t("room.rules.capacityRange")));
      },
      trigger: "blur",
    },
  ],
  minKg: [
    {
      validator: (_rule, value: number | undefined, callback) => {
        if (value === undefined || value === null || maxKg.value === undefined) return callback();
        return value <= maxKg.value
          ? callback()
          : callback(new Error(t("room.rules.allowPetSizeRange")));
      },
      trigger: "blur",
    },
  ],
  maxKg: [
    {
      validator: (_rule, value: number | undefined, callback) => {
        if (value === undefined || value === null || minKg.value === undefined) return callback();
        return value >= minKg.value
          ? callback()
          : callback(new Error(t("room.rules.allowPetSizeRange")));
      },
      trigger: "blur",
    },
  ],
}));

/** 从 `allowPetSize`（PRD 口径 `[{min_kg,max_kg}]`）解析出体重段两端 */
function parseAllowPetSize(raw: unknown): { min?: number; max?: number } {
  if (!Array.isArray(raw) || raw.length === 0) return {};
  const first = raw[0] as Record<string, unknown> | undefined;
  if (!first || typeof first !== "object") return {};
  const min = first.min_kg;
  const max = first.max_kg;
  return {
    min: typeof min === "number" ? min : undefined,
    max: typeof max === "number" ? max : undefined,
  };
}

/** 回填表单（编辑 / 查看） */
async function loadDetail(id: string): Promise<void> {
  detailLoading.value = true;
  try {
    const detail = await RoomAPI.getDetail(id);
    Object.assign(formData, {
      storeId: detail.storeId,
      roomNo: detail.roomNo,
      name: detail.name ?? "",
      roomType: detail.roomType,
      capacity: detail.capacity,
    });
    const size = parseAllowPetSize(detail.allowPetSize);
    minKg.value = size.min;
    maxKg.value = size.max;
    currentVersion.value = detail.version;
  } finally {
    detailLoading.value = false;
  }
}

/** 抽屉打开：重置 → 按模式回填 */
watch(
  () => props.modelValue,
  async (opened) => {
    if (!opened) return;
    internalMode.value = props.mode;
    Object.assign(formData, emptyForm());
    minKg.value = undefined;
    maxKg.value = undefined;
    // 新建时若只有一个门店，默认选中（减少一次操作）
    if (props.mode === "create" && props.storeOptions.length === 1) {
      formData.storeId = props.storeOptions[0].id;
    }
    currentVersion.value = 0;
    await nextTick();
    formRef.value?.clearValidate();

    if (props.mode !== "create" && props.roomId) {
      await loadDetail(props.roomId);
    }
  },
  { immediate: true }
);

/** 详情 → 编辑（数据已在表单内，仅解除只读） */
function switchToEdit(): void {
  internalMode.value = "edit";
}

/** 提交：新建走 POST，编辑走 PUT + `version` 乐观锁 */
async function handleSubmit(): Promise<void> {
  const valid = await formRef.value?.validate().then(
    () => true,
    () => false
  );
  if (!valid) return;

  const payload: RoomForm = {
    ...formData,
    roomNo: String(formData.roomNo).trim(),
    name: String(formData.name ?? "").trim(),
    roomType: Number(formData.roomType),
    capacity: Number(formData.capacity),
  };
  // 名称选填：空串整体不提交（后端 `@Length(1,64)` 不接空串）
  if (!payload.name) delete payload.name;

  // 体重段：两端都填才提交，单端填写不组装（避免产生半截规则）
  if (minKg.value !== undefined && maxKg.value !== undefined) {
    payload.allowPetSize = [{ min_kg: minKg.value, max_kg: maxKg.value }];
  }

  submitting.value = true;
  try {
    if (internalMode.value === "edit" && props.roomId) {
      // 编辑不提交 storeId：后端刻意收敛（不支持跨店迁移），故用 RoomUpdateForm 显式构造
      const updatePayload: RoomUpdateForm = {
        roomNo: payload.roomNo,
        name: payload.name,
        roomType: payload.roomType,
        capacity: payload.capacity,
        allowPetSize: payload.allowPetSize,
        version: currentVersion.value,
      };
      await RoomAPI.update(props.roomId, updatePayload);
      emit("success", { mode: "edit" });
    } else {
      await RoomAPI.create(payload);
      emit("success", { mode: "create" });
    }
    visible.value = false;
  } finally {
    submitting.value = false;
  }
}

/** 抽屉关闭动画结束后的清理 */
function handleClosed(): void {
  formRef.value?.clearValidate();
  Object.assign(formData, emptyForm());
  minKg.value = undefined;
  maxKg.value = undefined;
  internalMode.value = props.mode;
}
</script>

<style lang="scss" scoped>
.room-form {
  padding-bottom: 8px;

  &__divider-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--el-text-color-secondary);
  }

  &__tip,
  &__status-tip {
    margin-bottom: 16px;
  }

  &__tip {
    font-size: 12px;
    line-height: 1.5;
    color: var(--el-text-color-secondary);
  }

  :deep(.el-divider--horizontal) {
    margin: 4px 0 16px;
  }
}
</style>
