<template>
  <el-dialog
    v-model="visible"
    :title="isEdit ? t('pet.health.dialogEditTitle') : t('pet.health.dialogCreateTitle')"
    width="520px"
    append-to-body
    destroy-on-close
    data-testid="pet-health-record-dialog"
    @closed="handleClosed"
  >
    <el-alert
      v-if="conflictMessage"
      type="error"
      :closable="false"
      show-icon
      class="pet-health-dialog__conflict"
      :title="conflictMessage"
    />

    <el-form ref="formRef" :model="draft" :rules="rules" label-width="96px" label-position="right">
      <el-form-item :label="t('pet.health.recordType')" prop="recordType">
        <el-select
          v-model="draft.recordType"
          class="pet-health-dialog__field"
          :placeholder="t('pet.health.recordTypePlaceholder')"
          data-testid="pet-health-record-type"
        >
          <el-option
            v-for="type in HEALTH_RECORD_TYPES"
            :key="type"
            :label="t(healthRecordTypeLabelKey(type))"
            :value="type"
          />
        </el-select>
      </el-form-item>

      <el-form-item :label="t('pet.health.recordDate')" prop="recordDate">
        <!-- el-date-picker 不把未知属性透传到 DOM ⇒ 用一层容器承载自动化定位锚点 -->
        <div class="pet-health-dialog__field" data-testid="pet-health-record-date">
          <el-date-picker
            v-model="draft.recordDate"
            class="pet-health-dialog__field"
            type="date"
            value-format="YYYY-MM-DD"
            :placeholder="t('pet.health.recordDatePlaceholder')"
          />
        </div>
      </el-form-item>

      <el-form-item :label="t('pet.health.recordExpire')" prop="expireDate">
        <div class="pet-health-dialog__field" data-testid="pet-health-record-expire">
          <el-date-picker
            v-model="draft.expireDate"
            class="pet-health-dialog__field"
            type="date"
            value-format="YYYY-MM-DD"
            :disabled-date="disabledExpireDate"
            :placeholder="t('pet.health.recordExpirePlaceholder')"
          />
        </div>
        <div class="pet-health-dialog__hint">{{ t("pet.health.recordExpireHint") }}</div>
      </el-form-item>

      <el-form-item :label="t('pet.health.recordContent')" prop="content">
        <el-input
          v-model="draft.content"
          type="textarea"
          :rows="3"
          maxlength="500"
          show-word-limit
          :placeholder="t('pet.health.recordContentPlaceholder')"
          data-testid="pet-health-record-content"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">{{ t("pet.form.cancel") }}</el-button>
      <el-button
        type="primary"
        :loading="submitting"
        data-testid="pet-health-record-submit"
        @click="handleSubmit"
      >
        {{ t("pet.form.submit") }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ElMessage, type FormInstance, type FormRules } from "element-plus";

import PetAPI, { HEALTH_RECORD_TYPES } from "@/api/pet";
import type { HealthRecordItem } from "@/api/pet";
import { HealthRecordType } from "@/enums";
import { isApiError } from "@/utils/request";
import { healthRecordTypeLabelKey } from "@/utils/pet";

/**
 * 健康记录建档 / 更正对话框（MVP-WEB-05-02）
 *
 * 新建走 `POST /pets/:petId/health`；更正走 `PUT /pets/:petId/health/:recordId`
 * （`version` 乐观锁**必填**，不一致后端抛 `A0609`）。
 *
 * 与宠物表单同范式（`components/PetFormDialog.vue`）：
 *  - `visible` 经 `v-model` 双向绑定，内部 `draft` 为**深拷贝副本**（提交前不回写 props）；
 *  - 打开时按 `record` 重置草稿（`null` = 新建），避免上一次编辑残留；
 *  - 前端预校验「到期日不得早于记录日」（对齐后端 `A0608`），减少无效请求。
 */
defineOptions({ name: "PetHealthRecordDialog", inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    /** 宠物 id（必传） */
    petId: string;
    /** 编辑目标；`null` = 新建 */
    record?: HealthRecordItem | null;
  }>(),
  { record: null }
);

const emit = defineEmits<{
  (e: "saved"): void;
}>();

const visible = defineModel("modelValue", {
  type: Boolean,
  required: true,
  default: false,
});

const { t } = useI18n();

const formRef = ref<FormInstance>();

interface Draft {
  recordType: number | undefined;
  recordDate: string;
  expireDate: string;
  content: string;
  version: number;
}

const draft = reactive<Draft>({
  recordType: undefined,
  recordDate: "",
  expireDate: "",
  content: "",
  version: 0,
});

const submitting = ref(false);
const conflictMessage = ref("");

const isEdit = computed(() => Boolean(props.record?.id));

const rules = computed<FormRules>(() => ({
  recordType: [
    {
      required: true,
      message: t("pet.health.recordTypePlaceholder"),
      trigger: "change",
    },
  ],
  recordDate: [
    {
      required: true,
      message: t("pet.health.recordDatePlaceholder"),
      trigger: "change",
    },
  ],
}));

/** 到期日不得早于记录日（后端同口径 A0608） */
function disabledExpireDate(date: Date): boolean {
  if (!draft.recordDate) return false;
  return date.getTime() < new Date(`${draft.recordDate}T00:00:00`).getTime();
}

function resetDraft(): void {
  const source = props.record;
  conflictMessage.value = "";
  if (source) {
    draft.recordType = source.recordType;
    draft.recordDate = source.recordDate ? String(source.recordDate).slice(0, 10) : "";
    draft.expireDate = source.expireDate ? String(source.expireDate).slice(0, 10) : "";
    draft.content = source.content ?? "";
    draft.version = source.version ?? 0;
  } else {
    draft.recordType = HealthRecordType.VACCINE;
    draft.recordDate = "";
    draft.expireDate = "";
    draft.content = "";
    draft.version = 0;
  }
}

watch(visible, (open) => {
  if (open) {
    resetDraft();
    nextTick(() => formRef.value?.clearValidate());
  }
});

async function handleSubmit(): Promise<void> {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;

  // 前端预校验：到期日不得早于记录日（A0608），避免无效请求
  if (draft.expireDate && draft.recordDate && draft.expireDate < draft.recordDate) {
    ElMessage.error(t("pet.health.expireBeforeRecord"));
    return;
  }

  submitting.value = true;
  conflictMessage.value = "";
  try {
    if (isEdit.value && props.record) {
      await PetAPI.updateHealthRecord(props.petId, props.record.id, {
        version: draft.version,
        recordType: draft.recordType,
        recordDate: draft.recordDate,
        expireDate: draft.expireDate || null,
        content: draft.content || null,
      });
      ElMessage.success(t("pet.health.updateSuccess"));
    } else {
      await PetAPI.createHealthRecord(props.petId, {
        recordType: draft.recordType as number,
        recordDate: draft.recordDate,
        expireDate: draft.expireDate || undefined,
        content: draft.content || undefined,
      });
      ElMessage.success(t("pet.health.createSuccess"));
    }
    visible.value = false;
    emit("saved");
  } catch (error) {
    if (isApiError(error) && error.code === "A0609") {
      // 乐观锁冲突：保留对话框与用户输入，提示重载后再提交
      conflictMessage.value = t("pet.health.versionConflict");
      return;
    }
    ElMessage.error(isApiError(error) ? error.message : String(error ?? ""));
  } finally {
    submitting.value = false;
  }
}

function handleClosed(): void {
  conflictMessage.value = "";
}
</script>

<style lang="scss" scoped>
.pet-health-dialog {
  &__field {
    width: 100%;
  }

  &__hint {
    margin-top: 2px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--el-text-color-secondary);
  }

  &__conflict {
    margin-bottom: 12px;
  }
}
</style>
