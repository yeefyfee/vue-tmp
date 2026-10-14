<template>
  <el-dialog
    :model-value="modelValue"
    :title="isEdit ? t('pet.form.editTitle') : t('pet.form.createTitle')"
    width="680px"
    :close-on-click-modal="false"
    append-to-body
    @update:model-value="handleVisibleChange"
  >
    <el-form ref="formRef" :model="draft" :rules="rules" label-width="96px" @submit.prevent>
      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item :label="t('pet.form.name')" prop="name">
            <el-input
              v-model="draft.name"
              :placeholder="t('pet.form.namePlaceholder')"
              maxlength="64"
              show-word-limit
              data-testid="pet-form-name"
            />
          </el-form-item>
        </el-col>

        <el-col :span="12">
          <el-form-item :label="t('pet.form.owner')" prop="ownerCustomerId">
            <CustomerPickerSelect
              v-model="draft.ownerCustomerId"
              :placeholder="t('pet.form.ownerPlaceholder')"
              data-testid="pet-form-owner"
            />
          </el-form-item>
        </el-col>
      </el-row>

      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item :label="t('pet.form.petType')" prop="petType">
            <el-select
              v-model="draft.petType"
              class="w-full"
              data-testid="pet-form-type"
              :placeholder="t('pet.value.unset')"
            >
              <el-option
                v-for="option in PET_TYPE_OPTIONS"
                :key="option.value"
                :label="t(option.labelKey)"
                :value="option.value"
              />
            </el-select>
          </el-form-item>
        </el-col>

        <el-col :span="12">
          <el-form-item :label="t('pet.form.breed')" prop="breed">
            <el-input
              v-model="draft.breed"
              :placeholder="t('pet.form.breedPlaceholder')"
              maxlength="64"
            />
          </el-form-item>
        </el-col>
      </el-row>

      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item :label="t('pet.form.gender')" prop="gender">
            <el-select
              v-model="draft.gender"
              class="w-full"
              clearable
              :placeholder="t('pet.form.genderPlaceholder')"
            >
              <el-option :label="t('pet.value.genderMale')" :value="1" />
              <el-option :label="t('pet.value.genderFemale')" :value="2" />
            </el-select>
          </el-form-item>
        </el-col>

        <el-col :span="12">
          <el-form-item :label="t('pet.form.birthday')" prop="birthday">
            <el-date-picker
              v-model="draft.birthday"
              type="date"
              value-format="YYYY-MM-DD"
              class="!w-full"
              :placeholder="t('pet.form.birthdayPlaceholder')"
            />
          </el-form-item>
        </el-col>
      </el-row>

      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item :label="t('pet.form.weightKg')" prop="weightKg">
            <el-input
              v-model="draft.weightKg"
              :placeholder="t('pet.form.weightKgPlaceholder')"
              data-testid="pet-form-weight"
            />
          </el-form-item>
        </el-col>

        <el-col :span="12">
          <el-form-item :label="t('pet.form.coatColor')" prop="coatColor">
            <el-input
              v-model="draft.coatColor"
              :placeholder="t('pet.form.coatColorPlaceholder')"
              maxlength="32"
            />
          </el-form-item>
        </el-col>
      </el-row>

      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item :label="t('pet.form.sterilized')" prop="sterilized">
            <el-select
              v-model="draft.sterilized"
              class="w-full"
              clearable
              :placeholder="t('pet.form.sterilizedPlaceholder')"
            >
              <el-option :label="t('pet.value.yes')" :value="true" />
              <el-option :label="t('pet.value.no')" :value="false" />
            </el-select>
          </el-form-item>
        </el-col>

        <el-col :span="12">
          <el-form-item :label="t('pet.form.chipNo')" prop="chipNo">
            <el-input
              v-model="draft.chipNo"
              :placeholder="t('pet.form.chipNoPlaceholder')"
              maxlength="64"
            />
          </el-form-item>
        </el-col>
      </el-row>

      <el-form-item :label="t('pet.form.store')" prop="storeId">
        <el-select
          v-model="draft.storeId"
          class="w-full"
          clearable
          :placeholder="t('pet.form.storePlaceholder')"
        >
          <el-option
            v-for="store in storeOptions"
            :key="store.id"
            :label="store.name"
            :value="store.id"
          />
        </el-select>
      </el-form-item>

      <el-form-item :label="t('pet.form.behaviorTags')" prop="behaviorTagIds">
        <el-select
          v-model="draft.behaviorTagIds"
          class="w-full"
          multiple
          collapse-tags
          collapse-tags-tooltip
          :loading="tagLoading || detailLoading"
          :placeholder="t('pet.form.behaviorTagsPlaceholder')"
          data-testid="pet-form-tags"
        >
          <el-option
            v-for="tag in behaviorTagOptions"
            :key="tag.id"
            :label="tag.name"
            :value="tag.id"
          />
        </el-select>
      </el-form-item>

      <el-form-item :label="t('pet.form.remark')" prop="remark">
        <el-input
          v-model="draft.remark"
          type="textarea"
          :rows="2"
          maxlength="500"
          show-word-limit
          :placeholder="t('pet.form.remarkPlaceholder')"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="handleVisibleChange(false)">{{ t("pet.form.cancel") }}</el-button>
      <el-button
        type="primary"
        :loading="submitting"
        data-testid="pet-form-submit"
        @click="handleSubmit"
      >
        {{ t("pet.form.submit") }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ElMessage, type FormInstance, type FormRules } from "element-plus";

import PetAPI from "@/api/pet";
import type {
  BehaviorTagItem,
  CreatePetPayload,
  PetDetail,
  PetItem,
  UpdatePetPayload,
} from "@/api/pet";
import CustomerPickerSelect from "@/views/customer/customers/components/CustomerPickerSelect.vue";
import { PetType } from "@/enums";
import { isApiError } from "@/utils/request";

/**
 * 宠物建档 / 编辑对话框（MVP-WEB-05-01）
 *
 * 设计要点（对齐 02-01 门店表单与 04-03 合并对话框的既有范式）：
 *  1. **内部 `draft` 是唯一编辑基准**（踩坑 90）：打开时由入参同步，父组件只持有
 *     「当前行」引用；提交成功后 emit `refresh` 由父组件重取列表，本组件不自行改父状态。
 *  2. **乐观锁**（踩坑 94）：编辑时提交 `version`；后端 `A0602` ⇒ 提示「数据已被他人
 *     修改，请刷新后重试」，不静默覆盖。
 *  3. **标签为全量替换语义**：提交恒带 `behaviorTagIds`（选中集合即最终集合，空数组=清空），
 *     与 `PUT /pets/:id/tags` 同范式。
 *  4. **下拉清空归一**：`el-select` 清空可能置空串，而 `storeId` 是 `@IsUUID`、
 *     `petType` 是 `@IsIn`+`@Type(Number)`（空串 ⇒ 400，踩坑 101）⇒ 提交前统一归一为
 *     `undefined`（新建）/ `null`（编辑，表示显式清空该可空列）。
 *
 * 边界（**不渲染未上线入口**）：
 *  · 头像 / 多图上传**本任务不落地**：遗留模板的 `POST /api/v1/files` 在本环境恒
 *    `500 B0001`（真机探针实测），依赖它的上传控件渲染出来也必然失败；`photoUrl` /
 *    `photos` 字段已在后端就绪，待文件/媒体域上传链路（媒体域 `media/*`）任务接入后
 *    再补控件，届时无需改动本表单的提交契约。
 */
defineOptions({
  name: "PetFormDialog",
  inheritAttrs: false,
});

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    /**
     * `null` = 新建；非空 = 编辑。
     *
     * 可传入**列表行**（`PetItem`，无 `behaviorTags`）或**详情**（`PetDetail`）：
     * 前者由本组件在打开时补拉一次详情（拿到行为标签与最新 `version`），
     * 避免「用空标签集覆盖写」把既有标签清空（`PUT /pets/:id` 的
     * `behaviorTagIds` 是全量替换语义）。
     */
    pet?: PetItem | PetDetail | null;
    /** 门店下拉选项（由父页面统一拉取，避免对话框内重复请求） */
    storeOptions?: Array<{ id: string; name: string }>;
  }>(),
  {
    pet: null,
    storeOptions: () => [],
  }
);

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  /** 写操作成功（建档 / 更新）后由父组件重取列表 */
  refresh: [];
}>();

const { t } = useI18n();

const formRef = ref<FormInstance>();
const submitting = ref(false);

const PET_TYPE_OPTIONS: Array<{ value: number; labelKey: string }> = [
  { value: PetType.DOG, labelKey: "pet.value.petTypeDog" },
  { value: PetType.CAT, labelKey: "pet.value.petTypeCat" },
  { value: PetType.OTHER, labelKey: "pet.value.petTypeOther" },
];

const isEdit = computed(() => Boolean(props.pet));

/** 编辑基准（`draft` 的初值来源；仅用于判断「是否需要清空可空列」） */
const draft = reactive({
  name: "",
  ownerCustomerId: undefined as string | undefined,
  petType: undefined as number | undefined,
  breed: "",
  gender: undefined as number | undefined,
  birthday: "" as string,
  weightKg: "",
  coatColor: "",
  sterilized: undefined as boolean | undefined,
  chipNo: "",
  storeId: undefined as string | undefined,
  behaviorTagIds: [] as string[],
  remark: "",
  /** 乐观锁基准（详情补拉后会刷新为最新值） */
  version: 0,
});

/** 入参是否已含行为标签（`PetDetail`）——否则编辑时需补拉详情 */
function hasBehaviorTags(pet: PetItem | PetDetail): pet is PetDetail {
  return Array.isArray((pet as PetDetail).behaviorTags);
}

// ── 编辑时补拉详情（列表行不带 behaviorTags，避免空集覆盖写）──────────────
const detailLoading = ref(false);
let detailReqId = 0;

/** 用详情回填「列表行拿不到」的字段（行为标签 + 最新版本号） */
function applyDetail(detail: PetDetail): void {
  draft.behaviorTagIds = detail.behaviorTags.map((tag) => tag.id);
  draft.version = detail.version;
  draft.storeId = detail.storeId ?? undefined;
  draft.birthday = detail.birthday ? String(detail.birthday).slice(0, 10) : "";
  draft.weightKg = detail.weightKg ? String(detail.weightKg) : "";
}

async function loadFullDetail(): Promise<void> {
  const pet = props.pet;
  if (!pet || hasBehaviorTags(pet)) return;

  const reqId = ++detailReqId;
  detailLoading.value = true;
  try {
    const detail = await PetAPI.getDetail(pet.id);
    // 过期响应丢弃（对话框可能已被关闭 / 切换到另一只宠物）
    if (reqId !== detailReqId) return;
    applyDetail(detail);
  } catch {
    // 拉取失败：保留行数据，标签区为空；提交前 update 仍以行 version 校验
  } finally {
    if (reqId === detailReqId) detailLoading.value = false;
  }
}

// ── 打开时同步 draft ────────────────────────────────────────────────────
function resetDraft(): void {
  const pet = props.pet;
  detailReqId += 1; // 使上一次未完成的详情请求失效
  detailLoading.value = false;
  draft.name = pet?.name ?? "";
  draft.ownerCustomerId = pet?.ownerCustomerId ?? undefined;
  draft.petType = pet?.petType ?? undefined;
  draft.breed = pet?.breed ?? "";
  draft.gender = pet?.gender ?? undefined;
  draft.birthday = pet?.birthday ? String(pet.birthday).slice(0, 10) : "";
  draft.weightKg = pet?.weightKg ? String(pet.weightKg) : "";
  draft.coatColor = pet?.coatColor ?? "";
  draft.sterilized = pet?.sterilized ?? undefined;
  draft.chipNo = pet?.chipNo ?? "";
  draft.storeId = pet?.storeId ?? undefined;
  draft.remark = pet?.remark ?? "";
  draft.version = pet?.version ?? 0;
  draft.behaviorTagIds = pet && hasBehaviorTags(pet) ? pet.behaviorTags.map((tag) => tag.id) : [];
}

watch(
  () => props.modelValue,
  (visible) => {
    if (!visible) return;
    resetDraft();
    void fetchBehaviorTags();
    if (isEdit.value) void loadFullDetail();
    // 打开后清理上一次的校验残留
    void nextTick(() => formRef.value?.clearValidate());
  },
  { immediate: true }
);

const rules = computed<FormRules>(() => ({
  name: [
    { required: true, message: t("pet.form.namePlaceholder"), trigger: "blur" },
    { max: 64, message: t("pet.form.namePlaceholder"), trigger: "blur" },
  ],
  ownerCustomerId: [{ required: true, message: t("pet.form.ownerPlaceholder"), trigger: "change" }],
  petType: [{ required: true, message: t("pet.value.unset"), trigger: "change" }],
  // 与后端 DTO 同源：0~999.99、最多两位小数
  weightKg: [
    {
      pattern: /^\d{1,3}(\.\d{1,2})?$/,
      message: t("pet.form.weightKgPlaceholder"),
      trigger: "blur",
    },
  ],
}));

// ── 行为标签选项（打开时拉一页启用的标签；失败静默降级为空）──────────────
const behaviorTagOptions = ref<BehaviorTagItem[]>([]);
const tagLoading = ref(false);
let tagLoaded = false;

async function fetchBehaviorTags(): Promise<void> {
  if (tagLoaded) return;
  tagLoading.value = true;
  try {
    const data = await PetAPI.getBehaviorTags({ pageNum: 1, pageSize: 100, status: 1 });
    behaviorTagOptions.value = data.list ?? [];
    tagLoaded = true;
  } catch {
    behaviorTagOptions.value = [];
  } finally {
    tagLoading.value = false;
  }
}

// ── 打开时同步 draft ────────────────────────────────────────────────────
function handleVisibleChange(visible: boolean): void {
  if (!visible) {
    formRef.value?.clearValidate();
  }
  emit("update:modelValue", visible);
}

// ── 提交 ────────────────────────────────────────────────────────────────
/** 空串归一：新建 ⇒ 不提交该字段；编辑 ⇒ 提交 `null` 显式清空可空列 */
function optionalText(value: string): string | null | undefined {
  const text = value.trim();
  if (text !== "") return text;
  return isEdit.value ? null : undefined;
}

function buildCreatePayload(): CreatePetPayload {
  const payload: CreatePetPayload = {
    name: draft.name.trim(),
    ownerCustomerId: draft.ownerCustomerId as string,
    petType: draft.petType as number,
    behaviorTagIds: [...draft.behaviorTagIds],
  };
  if (draft.storeId) payload.storeId = draft.storeId;
  if (draft.breed.trim()) payload.breed = draft.breed.trim();
  if (draft.gender !== undefined && draft.gender !== null) payload.gender = draft.gender;
  if (draft.birthday) payload.birthday = draft.birthday;
  if (draft.weightKg.trim()) payload.weightKg = draft.weightKg.trim();
  if (draft.coatColor.trim()) payload.coatColor = draft.coatColor.trim();
  if (draft.sterilized !== undefined && draft.sterilized !== null) {
    payload.sterilized = draft.sterilized;
  }
  if (draft.chipNo.trim()) payload.chipNo = draft.chipNo.trim();
  if (draft.remark.trim()) payload.remark = draft.remark.trim();
  return payload;
}

function buildUpdatePayload(): UpdatePetPayload {
  const payload: UpdatePetPayload = {
    // 乐观锁基准：优先用补拉详情后的最新 version（列表行可能已被他人改过）
    version: draft.version,
    name: draft.name.trim(),
    ownerCustomerId: draft.ownerCustomerId as string,
    petType: draft.petType as number,
    behaviorTagIds: [...draft.behaviorTagIds],
  };
  // 显式清空语义：空串 ⇒ null（后端按「清空可空列」处理）；有值 ⇒ 原值
  payload.storeId = draft.storeId ? draft.storeId : null;
  payload.breed = optionalText(draft.breed);
  payload.coatColor = optionalText(draft.coatColor);
  payload.chipNo = optionalText(draft.chipNo);
  payload.remark = optionalText(draft.remark);
  payload.birthday = draft.birthday ? draft.birthday : null;
  payload.weightKg = draft.weightKg.trim() ? draft.weightKg.trim() : null;
  if (draft.gender !== undefined && draft.gender !== null) payload.gender = draft.gender;
  if (draft.sterilized !== undefined && draft.sterilized !== null) {
    payload.sterilized = draft.sterilized;
  }
  return payload;
}

async function handleSubmit(): Promise<void> {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;

  submitting.value = true;
  try {
    if (isEdit.value && props.pet) {
      await PetAPI.update(props.pet.id, buildUpdatePayload());
      ElMessage.success(t("pet.form.updateSuccess"));
    } else {
      await PetAPI.create(buildCreatePayload());
      ElMessage.success(t("pet.form.createSuccess"));
    }
    emit("update:modelValue", false);
    emit("refresh");
  } catch (error) {
    // 版本冲突单独提示（可读文案由请求层兜底，此处补业务语义）
    if (isApiError(error) && error.code === "A0602") {
      ElMessage.warning(t("pet.form.versionConflict"));
    }
  } finally {
    submitting.value = false;
  }
}

defineExpose({ resetDraft });
</script>
