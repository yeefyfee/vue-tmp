<template>
  <el-dialog
    v-model="visible"
    :title="t('pet.weight.dialogCreateTitle')"
    width="480px"
    append-to-body
    destroy-on-close
    data-testid="pet-weight-record-dialog"
    @closed="handleClosed"
  >
    <el-form ref="formRef" :model="draft" :rules="rules" label-width="88px" label-position="right">
      <el-form-item :label="t('pet.weight.recordDate')" prop="weighedAt">
        <!-- el-date-picker 不把未知属性透传到 DOM ⇒ 用一层容器承载自动化定位锚点 -->
        <div class="pet-weight-dialog__field" data-testid="pet-weight-record-date">
          <el-date-picker
            v-model="draft.weighedAt"
            class="pet-weight-dialog__field"
            type="date"
            value-format="YYYY-MM-DD"
            :disabled-date="disabledWeighedAt"
            :placeholder="t('pet.weight.recordDatePlaceholder')"
          />
        </div>
      </el-form-item>

      <el-form-item :label="t('pet.weight.recordKg')" prop="weightKg">
        <el-input
          v-model="draft.weightKg"
          class="pet-weight-dialog__field"
          :placeholder="t('pet.weight.recordKgPlaceholder')"
          data-testid="pet-weight-record-kg"
        >
          <template #append>kg</template>
        </el-input>
      </el-form-item>

      <div class="pet-weight-dialog__hint">{{ t("pet.weight.recordHint") }}</div>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">{{ t("pet.form.cancel") }}</el-button>
      <el-button
        type="primary"
        :loading="submitting"
        data-testid="pet-weight-record-submit"
        @click="handleSubmit"
      >
        {{ t("pet.form.submit") }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from "element-plus";

import PetAPI from "@/api/pet";
import { isApiError } from "@/utils/request";
import { formatWeightKg, weightDeltaLabel } from "@/utils/pet";

/**
 * 记录体重对话框（MVP-WEB-05-03 · FR-3）
 *
 * 仅支持**新增**（体重 row 为 append-only 语义，错录走软删回收后重录，不提供更新）。
 * 提交走 `POST /pets/:petId/weights`；服务端回带 BR-4 环比（`deltaPercent` /
 * `deltaAlert`），若 `|环比| > 15%` 则**弹出强提示**提醒前台确认宠物健康状态
 * （PRD《宠物管理》BR-4：「单次称重与上次记录差超过 15% 时，在下次服务前提示前台
 * 确认健康状态」）。
 */
defineOptions({ name: "PetWeightRecordDialog", inheritAttrs: false });

const props = defineProps<{
  /** 宠物 id（必传） */
  petId: string;
}>();

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
  weighedAt: string;
  weightKg: string;
}

const draft = reactive<Draft>({ weighedAt: "", weightKg: "" });

const submitting = ref(false);

/** 与后端 `WEIGHT_KG_PATTERN` 同口径：0~999.99，最多两位小数 */
const WEIGHT_KG_PATTERN = /^\d{1,3}(\.\d{1,2})?$/;

const rules = computed<FormRules>(() => ({
  weighedAt: [
    { required: true, message: t("pet.weight.recordDatePlaceholder"), trigger: "change" },
  ],
  weightKg: [
    { required: true, message: t("pet.weight.recordKgPlaceholder"), trigger: "blur" },
    {
      validator: (_rule, value, callback) => {
        const raw = String(value ?? "").trim();
        if (!WEIGHT_KG_PATTERN.test(raw)) {
          callback(new Error(t("pet.weight.recordKgInvalid")));
          return;
        }
        if (Number(raw) <= 0) {
          callback(new Error(t("pet.weight.recordKgInvalid")));
          return;
        }
        callback();
      },
      trigger: "blur",
    },
  ],
}));

/** 称重日不得晚于今天（体重为「已发生的称重」，未来日期无意义） */
function disabledWeighedAt(date: Date): boolean {
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
  return date.getTime() > end.getTime();
}

/** 今天 → `yyyy-MM-dd`（按本地日历日，与后端 DATE 列口径一致） */
function todayString(): string {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function resetDraft(): void {
  draft.weighedAt = todayString();
  draft.weightKg = "";
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

  submitting.value = true;
  try {
    const result = await PetAPI.createWeight(props.petId, {
      weighedAt: draft.weighedAt,
      weightKg: draft.weightKg.trim(),
    });
    visible.value = false;
    emit("saved");

    // BR-4：环比异常跳变 ⇒ 强制提示前台确认健康状态（不阻断落库，仅提示）
    if (result.deltaAlert && result.deltaPercent !== null) {
      const label = weightDeltaLabel(result.deltaPercent);
      await ElMessageBox.alert(
        t("pet.weight.deltaAlertBody", {
          previous: formatWeightKg(result.previousWeightKg),
          current: formatWeightKg(result.weightKg),
          delta: t(label.key, label.params),
        }),
        t("pet.weight.deltaAlertTitle"),
        { type: "warning", confirmButtonText: t("pet.weight.alertConfirmBtn") }
      );
      return;
    }
    ElMessage.success(t("pet.weight.createSuccess"));
  } catch (error) {
    ElMessage.error(isApiError(error) ? error.message : String(error ?? ""));
  } finally {
    submitting.value = false;
  }
}

function handleClosed(): void {
  draft.weightKg = "";
}
</script>

<style lang="scss" scoped>
.pet-weight-dialog {
  &__field {
    width: 100%;
  }

  &__hint {
    padding-left: 88px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--el-text-color-secondary);
  }
}
</style>
