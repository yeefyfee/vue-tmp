<template>
  <el-dialog
    :model-value="visible"
    :title="t('storeCalendar.dialog.createTitle')"
    width="520px"
    append-to-body
    :close-on-click-modal="false"
    @update:model-value="handleVisibleChange"
    @closed="handleClosed"
  >
    <el-form ref="formRef" label-position="top" :model="form">
      <el-form-item :label="t('storeCalendar.dialog.date')" required>
        <el-date-picker
          v-model="form.date"
          type="date"
          value-format="YYYY-MM-DD"
          :placeholder="t('storeCalendar.dialog.datePlaceholder')"
          style="width: 100%"
        />
      </el-form-item>

      <el-form-item :label="t('storeCalendar.dialog.type')" required>
        <el-radio-group v-model="form.type">
          <el-radio v-for="type in CALENDAR_ENTRY_TYPES" :key="type" :value="type">
            {{ t(CALENDAR_TYPE_META[type].i18nKey) }}
          </el-radio>
        </el-radio-group>
      </el-form-item>

      <!-- 仅「特殊营业」需要时段：节假日/临时闭店为全天闭店，后端刻意置 NULL -->
      <el-form-item v-if="form.type === 3" :label="t('storeCalendar.dialog.periods')" required>
        <div class="entry-dialog__periods">
          <el-time-select
            v-model="form.openTime"
            start="00:00"
            end="23:45"
            step="00:30"
            :clearable="false"
            :placeholder="t('storeCalendar.dialog.openPlaceholder')"
          />
          <span class="entry-dialog__sep">–</span>
          <el-time-select
            v-model="form.closeTime"
            start="00:15"
            end="23:59"
            step="00:30"
            :clearable="false"
            :placeholder="t('storeCalendar.dialog.closePlaceholder')"
          />
        </div>
      </el-form-item>

      <el-form-item :label="t('storeCalendar.dialog.remark')">
        <el-input
          v-model="form.remark"
          type="textarea"
          :rows="2"
          maxlength="255"
          show-word-limit
          :placeholder="t('storeCalendar.dialog.remarkPlaceholder')"
        />
      </el-form-item>

      <!-- 就地校验提示：文案写「怎么办」（PRD《交互规范》§文案规范） -->
      <el-alert
        v-if="errorKey"
        class="entry-dialog__error"
        type="error"
        :closable="false"
        show-icon
        :title="t(`storeCalendar.dialog.${errorKey}`)"
      />

      <el-alert
        v-else
        class="entry-dialog__hint"
        type="info"
        :closable="false"
        show-icon
        :title="t('storeCalendar.dialog.effectTip')"
      />
    </el-form>

    <template #footer>
      <el-button :disabled="submitting" @click="handleVisibleChange(false)">
        {{ t("storeCalendar.action.cancel") }}
      </el-button>
      <el-button type="primary" :loading="submitting" :disabled="!!errorKey" @click="handleSubmit">
        {{ t("storeCalendar.action.confirmCreate") }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import type { FormInstance } from "element-plus";
import StoreAPI from "@/api/store";
import type { CalendarEntryType, CreateCalendarEntryForm } from "@/api/store";
import {
  CALENDAR_ENTRY_TYPES,
  CALENDAR_TYPE_META,
  validateEntryForm,
} from "@/utils/store-calendar";

/**
 * 新增日历例外日对话框（MVP-WEB-02-04）
 *
 * 校验与后端 `createCalendarEntry` **同一判定顺序**（`validateEntryForm`）：
 * 日期真实日历日 → 类型白名单 → type=3 时刻成对必填 → `close > open`。
 * 本地先拦（禁用提交并就地提示），后端仍会兜底（`A0438` 同日重复 / `A0400` 非法）。
 *
 * 权限/接口错误（A0438 / A0400 / A0424）由统一请求层渲染文案，本组件只负责
 * 成功后的回调与表单复位，不重复弹提示。
 */
defineOptions({ name: "CalendarEntryDialog" });

const props = defineProps<{
  visible: boolean;
  /** 目标门店（例外日必须归属门店） */
  storeId: string;
  /** 打开时的默认日期（来自月历点击日或今天） */
  defaultDate: string;
}>();

const emit = defineEmits<{
  "update:visible": [visible: boolean];
  /** 创建成功后派发，便于页面刷新月历与例外列表 */
  success: [];
}>();

const { t } = useI18n();

const formRef = ref<FormInstance>();
const submitting = ref(false);

const form = ref<CreateCalendarEntryForm>({
  date: props.defaultDate,
  type: 1,
  openTime: "10:00",
  closeTime: "18:00",
  remark: "",
});

/** 就地校验结果（i18n 子键；null 表示通过） */
const errorKey = computed(() =>
  validateEntryForm({
    date: form.value.date,
    type: form.value.type,
    openTime: form.value.openTime,
    closeTime: form.value.closeTime,
  })
);

/** 打开时用默认日期复位表单（避免上次残留污染下一次新增） */
watch(
  () => props.visible,
  (visible) => {
    if (!visible) return;
    form.value = {
      date: props.defaultDate,
      type: 1,
      openTime: "10:00",
      closeTime: "18:00",
      remark: "",
    };
    formRef.value?.clearValidate();
  }
);

function handleVisibleChange(next: boolean): void {
  emit("update:visible", next);
}

function handleClosed(): void {
  submitting.value = false;
}

async function handleSubmit(): Promise<void> {
  if (errorKey.value || submitting.value) return;
  const storeId = props.storeId;
  if (!storeId) return;

  submitting.value = true;
  try {
    // 时刻仅在「特殊营业」时提交：其余类型提交会被后端按 type 分支忽略
    const payload: CreateCalendarEntryForm = {
      date: form.value.date,
      type: form.value.type as CalendarEntryType,
    };
    if (form.value.type === 3) {
      payload.openTime = form.value.openTime;
      payload.closeTime = form.value.closeTime;
    }
    const remark = (form.value.remark ?? "").trim();
    if (remark) payload.remark = remark;

    await StoreAPI.createCalendarEntry(storeId, payload);
    ElMessage.success(t("storeCalendar.action.createSuccess"));
    emit("update:visible", false);
    emit("success");
  } catch {
    // A0438 日期重复 / A0400 非法 / A0424 门店不存在：请求层已给出含「怎么办」的文案
  } finally {
    submitting.value = false;
  }
}
</script>

<style lang="scss" scoped>
.entry-dialog {
  &__periods {
    display: flex;
    gap: 8px;
    align-items: center;
    width: 100%;

    :deep(.el-select) {
      flex: 1;
    }
  }

  &__sep {
    color: var(--el-text-color-secondary);
  }

  &__error,
  &__hint {
    margin-top: 4px;
  }
}
</style>
