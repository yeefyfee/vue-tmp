<template>
  <el-drawer
    v-model="visible"
    :title="drawerTitle"
    :size="drawerSize"
    :close-on-click-modal="false"
    destroy-on-close
    @closed="handleClosed"
  >
    <div v-loading="detailLoading" class="store-form">
      <el-form
        ref="formRef"
        :model="formData"
        :rules="rules"
        label-position="top"
        :disabled="isReadonly"
      >
        <el-row :gutter="16">
          <el-col :xs="24" :sm="24" :md="12">
            <el-form-item :label="t('store.field.name')" prop="name">
              <el-input
                v-model="formData.name"
                :placeholder="t('store.form.namePlaceholder')"
                maxlength="64"
                clearable
              />
            </el-form-item>
          </el-col>

          <el-col :xs="24" :sm="24" :md="12">
            <el-form-item :label="t('store.field.code')" prop="code">
              <el-input
                v-model="formData.code"
                :placeholder="t('store.form.codePlaceholder')"
                maxlength="32"
                clearable
              />
            </el-form-item>
          </el-col>

          <el-col :xs="24" :sm="24" :md="12">
            <el-form-item :label="t('store.field.type')" prop="type">
              <el-select
                v-model="formData.type"
                :placeholder="t('store.form.typePlaceholder')"
                class="w-full"
              >
                <el-option :label="t('store.value.typeDirect')" :value="StoreType.DIRECT" />
                <el-option :label="t('store.value.typeFranchise')" :value="StoreType.FRANCHISE" />
              </el-select>
            </el-form-item>
          </el-col>

          <el-col :xs="24" :sm="24" :md="12">
            <el-form-item :label="t('store.field.status')" prop="status">
              <el-select
                v-model="formData.status"
                :placeholder="t('store.form.statusPlaceholder')"
                class="w-full"
              >
                <el-option :label="t('store.value.statusEnabled')" :value="CommonStatus.ENABLED" />
                <el-option
                  :label="t('store.value.statusDisabled')"
                  :value="CommonStatus.DISABLED"
                />
              </el-select>
            </el-form-item>
          </el-col>

          <el-col :xs="24" :sm="24" :md="8">
            <el-form-item :label="t('store.field.province')" prop="province">
              <el-input
                v-model="formData.province"
                :placeholder="t('store.form.provincePlaceholder')"
                maxlength="32"
                clearable
              />
            </el-form-item>
          </el-col>

          <el-col :xs="24" :sm="24" :md="8">
            <el-form-item :label="t('store.field.city')" prop="city">
              <el-input
                v-model="formData.city"
                :placeholder="t('store.form.cityPlaceholder')"
                maxlength="32"
                clearable
              />
            </el-form-item>
          </el-col>

          <el-col :xs="24" :sm="24" :md="8">
            <el-form-item :label="t('store.field.district')" prop="district">
              <el-input
                v-model="formData.district"
                :placeholder="t('store.form.districtPlaceholder')"
                maxlength="32"
                clearable
              />
            </el-form-item>
          </el-col>

          <el-col :span="24">
            <el-form-item :label="t('store.field.address')" prop="address">
              <el-input
                v-model="formData.address"
                :placeholder="t('store.form.addressPlaceholder')"
                maxlength="255"
                clearable
              />
            </el-form-item>
          </el-col>

          <el-col :span="24">
            <el-form-item :label="t('store.field.phone')" prop="phone">
              <el-input
                v-model="formData.phone"
                :placeholder="t('store.form.phonePlaceholder')"
                maxlength="20"
                clearable
                @blur="handlePhoneBlur"
              />
            </el-form-item>
          </el-col>

          <el-col :span="24">
            <el-divider content-position="left">
              <span class="store-form__divider-title">{{ t("store.form.coordinateTitle") }}</span>
            </el-divider>
          </el-col>

          <el-col :xs="24" :sm="24" :md="12">
            <el-form-item :label="t('store.field.longitude')" prop="longitude">
              <el-input-number
                v-model="formData.longitude"
                :min="-180"
                :max="180"
                :precision="6"
                :step="0.000001"
                :controls="false"
                :placeholder="t('store.form.longitudePlaceholder')"
                class="w-full"
              />
            </el-form-item>
          </el-col>

          <el-col :xs="24" :sm="24" :md="12">
            <el-form-item :label="t('store.field.latitude')" prop="latitude">
              <el-input-number
                v-model="formData.latitude"
                :min="-90"
                :max="90"
                :precision="6"
                :step="0.000001"
                :controls="false"
                :placeholder="t('store.form.latitudePlaceholder')"
                class="w-full"
              />
            </el-form-item>
          </el-col>

          <el-col :span="24">
            <el-alert
              :title="t('store.form.businessHoursTip')"
              type="info"
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
          v-hasPerm="'store:update'"
          type="primary"
          :disabled="detailLoading"
          @click="switchToEdit"
        >
          {{ t("store.form.edit") }}
        </el-button>
        <el-button v-else type="primary" :loading="submitting" @click="handleSubmit">
          {{ t("store.form.submit") }}
        </el-button>
        <el-button @click="visible = false">{{ t("store.form.cancel") }}</el-button>
      </div>
    </template>
  </el-drawer>
</template>

<script setup lang="ts">
import type { FormInstance, FormRules } from "element-plus";

import StoreAPI from "@/api/store";
import type { StoreForm } from "@/api/store";
import { CommonStatus, DeviceEnum, StoreType } from "@/enums";
import { useAppStore } from "@/stores";

/**
 * 门店表单 / 详情抽屉（MVP-WEB-02-01）
 *
 * 统一承载三种模式（PRD《Web规范》§页面模式 1：「详情一律用右侧抽屉呈现而非跳页，
 * 保留列表上下文」）：
 *  · `create` 新建 —— 空表单，两列栅格（窄屏单列），标签置于输入框上方左对齐；
 *  · `view`   详情 —— 全字段只读；主按钮为「编辑」（无 `store:update` 权限时不渲染，
 *               PRD《Web规范》§权限与视图 1「无权限字段直接不渲染」）；
 *  · `edit`   编辑 —— 回填后提交，携带 `version` 乐观锁。
 *
 * 表单规范对齐 PRD《Web规范》§表单规范：失焦触发单字段校验、提交时全量校验、
 * 错误文案「动作 + 原因」、提交中禁用并 loading、成功后关闭抽屉并由列表页 toast 确认。
 *
 * 已知边界：`businessHours` / `config` 的编辑入口归属 MVP-WEB-02-03
 * （营业时间与门店配置页），本抽屉仅作提示，不改写这两个字段。
 */
defineOptions({ name: "StoreFormDrawer", inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    /** 抽屉可见性（v-model） */
    modelValue: boolean;
    /** 打开模式 */
    mode?: "create" | "edit" | "view";
    /** 门店 ID（edit / view 必填） */
    storeId?: string;
  }>(),
  {
    mode: "create",
    storeId: "",
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

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

const isView = computed(() => internalMode.value === "view");
/** 只读：查看模式，或详情仍在加载 */
const isReadonly = computed(() => isView.value || detailLoading.value);

const drawerTitle = computed(() => {
  if (internalMode.value === "create") return t("store.form.createTitle");
  if (internalMode.value === "edit") return t("store.form.editTitle");
  return t("store.form.viewTitle");
});

const drawerSize = computed(() => (appStore.device === DeviceEnum.DESKTOP ? "480px" : "100%"));

/** 空表单基线（同时作为重置基准） */
function emptyForm(): StoreForm {
  return {
    code: "",
    name: "",
    type: StoreType.DIRECT,
    province: "",
    city: "",
    district: "",
    address: "",
    longitude: undefined,
    latitude: undefined,
    phone: "",
    status: CommonStatus.ENABLED,
  };
}

const formData = reactive<StoreForm>(emptyForm());

/** 联系电话：11 位大陆手机号，或带区号的座机（须落在后端 1~20 字符内） */
const PHONE_PATTERN = /^(1[3-9]\d{9}|\d{3,4}-?\d{7,8}(-\d{1,6})?)$/;

const rules = computed<FormRules<StoreForm>>(() => ({
  code: [
    { required: true, message: t("store.rules.codeRequired"), trigger: "blur" },
    { max: 32, message: t("store.rules.codeLength"), trigger: "blur" },
    {
      pattern: /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/,
      message: t("store.rules.codeFormat"),
      trigger: "blur",
    },
  ],
  name: [
    { required: true, message: t("store.rules.nameRequired"), trigger: "blur" },
    { max: 64, message: t("store.rules.nameLength"), trigger: "blur" },
  ],
  type: [{ required: true, message: t("store.rules.typeRequired"), trigger: "change" }],
  province: [{ required: true, message: t("store.rules.provinceRequired"), trigger: "blur" }],
  city: [{ required: true, message: t("store.rules.cityRequired"), trigger: "blur" }],
  district: [{ required: true, message: t("store.rules.districtRequired"), trigger: "blur" }],
  address: [
    { required: true, message: t("store.rules.addressRequired"), trigger: "blur" },
    { max: 255, message: t("store.rules.addressLength"), trigger: "blur" },
  ],
  phone: [
    { required: true, message: t("store.rules.phoneRequired"), trigger: "blur" },
    { max: 20, message: t("store.rules.phoneLength"), trigger: "blur" },
    {
      validator: (_rule, value: string, callback) => {
        const normalized = String(value ?? "").replace(/\s/g, "");
        if (!normalized) return callback();
        return PHONE_PATTERN.test(normalized)
          ? callback()
          : callback(new Error(t("store.rules.phoneFormat")));
      },
      trigger: "blur",
    },
  ],
  longitude: [
    {
      validator: (_rule, value: number | undefined, callback) => {
        if (value === undefined || value === null) return callback();
        return value >= -180 && value <= 180
          ? callback()
          : callback(new Error(t("store.rules.longitudeRange")));
      },
      trigger: "blur",
    },
  ],
  latitude: [
    {
      validator: (_rule, value: number | undefined, callback) => {
        if (value === undefined || value === null) return callback();
        return value >= -90 && value <= 90
          ? callback()
          : callback(new Error(t("store.rules.latitudeRange")));
      },
      trigger: "blur",
    },
  ],
  status: [{ required: true, message: t("store.rules.statusRequired"), trigger: "change" }],
}));

/** 联系电话失焦自动格式化：11 位手机号 → `138 0013 8000`（PRD《Web规范》§表单规范 4） */
function handlePhoneBlur(): void {
  if (isReadonly.value) return;
  const digits = String(formData.phone ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    formData.phone = `${digits.slice(0, 3)} ${digits.slice(3, 7)} ${digits.slice(7)}`;
  }
}

/** 回填表单（编辑 / 查看） */
async function loadDetail(id: string): Promise<void> {
  detailLoading.value = true;
  try {
    const detail = await StoreAPI.getDetail(id);
    Object.assign(formData, {
      code: detail.code,
      name: detail.name,
      type: detail.type,
      province: detail.province,
      city: detail.city,
      district: detail.district,
      address: detail.address,
      longitude: detail.longitude === null ? undefined : Number(detail.longitude),
      latitude: detail.latitude === null ? undefined : Number(detail.latitude),
      phone: detail.phone,
      status: detail.status,
    });
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
    currentVersion.value = 0;
    await nextTick();
    formRef.value?.clearValidate();

    if (props.mode !== "create" && props.storeId) {
      await loadDetail(props.storeId);
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

  const payload: StoreForm = {
    ...formData,
    code: String(formData.code).trim(),
    name: String(formData.name).trim(),
    province: String(formData.province).trim(),
    city: String(formData.city).trim(),
    district: String(formData.district).trim(),
    address: String(formData.address).trim(),
    phone: String(formData.phone).replace(/\s/g, ""),
  };
  // 后端 `@IsNumber` 不接 `null` / 空串：未填的经纬度整体不提交
  if (payload.longitude === undefined || payload.longitude === null) {
    delete payload.longitude;
  }
  if (payload.latitude === undefined || payload.latitude === null) {
    delete payload.latitude;
  }

  submitting.value = true;
  try {
    if (internalMode.value === "edit" && props.storeId) {
      await StoreAPI.update(props.storeId, { ...payload, version: currentVersion.value });
      emit("success", { mode: "edit" });
    } else {
      await StoreAPI.create(payload);
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
  internalMode.value = props.mode;
}
</script>

<style lang="scss" scoped>
.store-form {
  padding-bottom: 8px;

  &__divider-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--el-text-color-secondary);
  }

  :deep(.el-divider--horizontal) {
    margin: 4px 0 16px;
  }
}
</style>
