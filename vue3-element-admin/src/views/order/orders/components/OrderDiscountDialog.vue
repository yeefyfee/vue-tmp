<template>
  <el-dialog
    v-model="visible"
    :title="t('order.discount.dialogTitle')"
    width="480px"
    append-to-body
    destroy-on-close
    data-testid="order-discount-dialog"
    @closed="handleClosed"
  >
    <el-form ref="formRef" :model="draft" :rules="rules" label-width="88px" label-position="right">
      <el-form-item :label="t('order.discount.amountLabel')" prop="discountYuan">
        <el-input
          v-model="draft.discountYuan"
          class="order-discount-dialog__field"
          :placeholder="t('order.discount.amountPlaceholder')"
          data-testid="order-discount-amount"
        />
      </el-form-item>

      <div class="order-discount-dialog__hint">
        {{ t("order.discount.amountHint", { total: totalLabel }) }}
      </div>
      <div class="order-discount-dialog__hint">{{ t("order.discount.clearHint") }}</div>
    </el-form>

    <template #footer>
      <el-button data-testid="order-discount-cancel" @click="visible = false">
        {{ t("order.form.cancel") }}
      </el-button>
      <el-button
        type="primary"
        :loading="submitting"
        data-testid="order-discount-submit"
        @click="handleSubmit"
      >
        {{ t("order.discount.submit") }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ElMessage, type FormInstance, type FormRules } from "element-plus";
import { centsToYuan, asCents, yuanToCents } from "@peluvida/shared";

import OrderAPI from "@/api/order";
import type { OrderDetail } from "@/api/order";
import { isApiError } from "@/utils/request";

/**
 * 设置订单优惠对话框（MVP-WEB-07-04 优惠与权益分摊）
 *
 * 🔴 **唯一输入 = 订单级优惠额**（元），服务端按明细行小计比例分摊到各行
 * （`PUT /orders/:id/discount`，权限 `order:discount`）—— 前端**不**按行提交优惠，
 * 避免「同一判据两处入口 / 两套实现」；分摊结果由明细页签「折扣来源」列呈现。
 *
 * 入口可见性由父页（明细页签「设置优惠」）按 `order:discount` 权限控制；
 * 后端 `PermissionGuard` 是最终闸门（无权限一律 403）。
 *
 * 金额在**元域仅作输入/展示**，提交前 `yuanToCents` 转分整数字符串（金额铁律）。
 */
defineOptions({ name: "OrderDiscountDialog", inheritAttrs: false });

const props = defineProps<{
  /** 订单 id（必传） */
  orderId: string;
  /** 乐观锁基准版本（打开时的详情版本） */
  version: number;
  /** 订单总额（分，字符串） */
  totalAmount: string;
  /** 当前优惠额（分，字符串；作为编辑初值） */
  discountAmount: string;
}>();

const emit = defineEmits<{ (e: "saved", detail: OrderDetail): void }>();

const visible = defineModel("modelValue", {
  type: Boolean,
  required: true,
  default: false,
});

const { t } = useI18n();

const formRef = ref<FormInstance>();
const submitting = ref(false);

interface Draft {
  discountYuan: string;
}

const draft = reactive<Draft>({ discountYuan: "0.00" });

const totalCents = computed(() => Number(props.totalAmount) || 0);
const totalLabel = computed(() => `¥${(totalCents.value / 100).toFixed(2)}`);

/** 元域输入口径：非负、最多两位小数、上限 7 位整数（与后端 10 位分域上限同量级） */
const DISCOUNT_YUAN_PATTERN = /^\d{1,7}(\.\d{1,2})?$/;

const rules = computed<FormRules>(() => ({
  discountYuan: [
    { required: true, message: t("order.discount.amountPlaceholder"), trigger: "blur" },
    {
      validator: (_rule, value, callback) => {
        const raw = String(value ?? "").trim();
        if (!DISCOUNT_YUAN_PATTERN.test(raw)) {
          callback(new Error(t("order.discount.amountInvalid")));
          return;
        }
        if (yuanToCents(Number(raw)) > totalCents.value) {
          callback(new Error(t("order.discount.amountExceedsTotal")));
          return;
        }
        callback();
      },
      trigger: "blur",
    },
  ],
}));

function resetDraft(): void {
  const cents = Number(props.discountAmount) || 0;
  draft.discountYuan = centsToYuan(asCents(Number.isSafeInteger(cents) ? cents : 0)).toFixed(2);
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
    const result = await OrderAPI.updateDiscount(props.orderId, {
      version: props.version,
      discountAmount: String(yuanToCents(Number(draft.discountYuan.trim()))),
    });
    visible.value = false;
    ElMessage.success(t("order.discount.success"));
    emit("saved", result);
  } catch (error) {
    // A0909（版本冲突）：后端已给出「订单版本已变更，请刷新后重试」文案，统一走请求层提示
    ElMessage.error(isApiError(error) ? error.message : String(error ?? ""));
  } finally {
    submitting.value = false;
  }
}

function handleClosed(): void {
  resetDraft();
}
</script>

<style scoped lang="scss">
.order-discount-dialog {
  &__field {
    width: 100%;
  }

  &__hint {
    padding-left: 88px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--el-text-color-secondary);
  }
}
</style>
