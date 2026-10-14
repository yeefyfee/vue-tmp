<template>
  <el-dialog
    v-model="visible"
    :title="t('booking.cancel.title')"
    width="480px"
    append-to-body
    destroy-on-close
    data-testid="booking-cancel-dialog"
    @closed="handleClosed"
  >
    <div v-if="booking" class="booking-cancel__context" data-testid="booking-cancel-context">
      <span class="booking-cancel__no">{{ booking.bookingNo }}</span>
      <span class="booking-cancel__time">
        {{ bookingDateLabel(booking.bookingDate) }}
        {{ bookingTimeRangeLabel(booking.startTime, booking.endTime) }}
      </span>
    </div>

    <el-alert
      type="warning"
      :closable="false"
      show-icon
      :title="t('booking.cancel.hint')"
      class="booking-cancel__hint"
      data-testid="booking-cancel-hint"
    />

    <el-form ref="formRef" :model="draft" :rules="rules" label-width="88px" label-position="right">
      <el-form-item :label="t('booking.cancel.reason')" prop="reason">
        <el-input
          v-model="draft.reason"
          type="textarea"
          :rows="3"
          maxlength="255"
          show-word-limit
          :placeholder="t('booking.cancel.reasonPlaceholder')"
          data-testid="booking-cancel-reason"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button data-testid="booking-cancel-dismiss" @click="visible = false">
        {{ t("booking.form.cancel") }}
      </el-button>
      <el-button
        type="danger"
        :loading="submitting"
        data-testid="booking-cancel-submit"
        @click="handleSubmit"
      >
        {{ t("booking.cancel.submit") }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import type { FormInstance, FormRules } from "element-plus";

import BookingAPI from "@/api/booking";
import type { BookingItem, BookingTransitionResult } from "@/api/booking";
import { bookingDateLabel, bookingTimeRangeLabel } from "@/utils/booking";

/**
 * 取消预约对话框（MVP-WEB-06-05 · PRD《Booking API》`POST /bookings/:id/cancel`）
 *
 * 契约要点：
 *  - `reason` 必填（服务端追加进 `booking.remark`，形如 `[取消] 原因`）；
 *  - 带上详情里的 `version` ⇒ 参与服务端 CAS（并发被改则 `30002`）；
 *  - 服务已开始 ⇒ `30005`（BR-3「开始后不可取消」，服务端裁定，本组件不预判）；
 *  - 宠主端时间窗 ⇒ `30004`，判据由请求头 `X-Actor-Scope` 承载（Web 端恒走员工口径，
 *    故本组件不带任何身份字段）。
 *
 * 🔴 **计费档位（`free` / `charged` / `review`）不在本组件预判**：档位取决于门店
 * `cancelCutoffHours` + 平台紧窗口 2h + 剩余时间，只有服务端知道（门店配置存在
 * `store.config` JSONB 里，前端不持有）⇒ 对话框只写「档位由系统判定」的提示，
 * 真正的档位在提交成功后由父级横幅展示 `feeRule.policy`（一处判据一处来源，
 * 踩坑 126-bis）。
 *
 * 破坏性语义：确认按钮用 `danger`（PRD《交互规范》：不可逆操作需视觉区分度）。
 */
defineOptions({ name: "BookingCancelDialog", inheritAttrs: false });

const props = defineProps<{
  /** 待取消的预约（打开时必填） */
  booking: BookingItem | null;
}>();

const emit = defineEmits<{
  /** 取消成功（携带服务端统一出参，含 `feeRule`） */
  (e: "success", result: BookingTransitionResult): void;
}>();

const visible = defineModel("modelValue", {
  type: Boolean,
  required: true,
  default: false,
});

const { t } = useI18n();

const formRef = ref<FormInstance>();
const submitting = ref(false);

const draft = reactive({ reason: "" });

const rules = computed<FormRules>(() => ({
  reason: [{ required: true, message: t("booking.cancel.reasonRequired"), trigger: "blur" }],
}));

watch(visible, (open) => {
  if (!open) return;
  draft.reason = "";
  nextTick(() => formRef.value?.clearValidate());
});

/** 关闭动效结束后复位（避免下次打开闪现上一次输入） */
function handleClosed(): void {
  formRef.value?.resetFields();
  draft.reason = "";
}

async function handleSubmit(): Promise<void> {
  if (!formRef.value || !props.booking) return;
  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;

  submitting.value = true;
  try {
    const result = await BookingAPI.cancelBooking(props.booking.id, {
      reason: draft.reason.trim(),
      version: props.booking.version,
    });
    visible.value = false;
    emit("success", result);
  } catch {
    // 失败不关闭对话框（保留原因供修正）：30002 / 30004 / 30005 等文案由请求层统一渲染
  } finally {
    submitting.value = false;
  }
}
</script>

<style lang="scss" scoped>
.booking-cancel {
  &__context {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: baseline;
    padding: 8px 12px;
    margin-bottom: 12px;
    font-size: 12px;
    background-color: var(--el-fill-color-light);
    border-radius: 4px;
  }

  &__no {
    font-size: 13px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  &__time {
    color: var(--el-text-color-secondary);
  }

  &__hint {
    margin-bottom: 12px;
  }
}
</style>
