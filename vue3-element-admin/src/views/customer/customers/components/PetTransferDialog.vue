<template>
  <el-dialog
    v-model="visible"
    :title="t('customer.transferForm.title')"
    width="440px"
    append-to-body
    destroy-on-close
  >
    <el-form label-position="top" size="small" @submit.prevent>
      <el-form-item :label="t('customer.transferForm.pet')">
        <div class="transfer-form__fixed" data-testid="transfer-pet-fixed">
          <el-tag type="primary" effect="plain">
            {{ pet?.name || t("customer.value.petUnknown") }}
          </el-tag>
        </div>
      </el-form-item>

      <el-form-item :label="t('customer.transferForm.toCustomer')">
        <CustomerPickerSelect
          v-model="form.toCustomerId"
          :placeholder="t('customer.transferForm.placeholder')"
          :exclude-ids="excludeIds"
          @select="handlePick"
        />
      </el-form-item>

      <el-form-item :label="t('customer.transferForm.reason')">
        <el-input
          v-model="form.reason"
          type="textarea"
          :rows="2"
          maxlength="255"
          show-word-limit
          clearable
          :placeholder="t('customer.transferForm.reasonPlaceholder')"
        />
      </el-form-item>

      <p class="transfer-form__hint">{{ t("customer.transferForm.hint") }}</p>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">{{ t("customer.form.cancel") }}</el-button>
      <el-button type="primary" :loading="submitting" @click="handleSubmit">
        {{ t("customer.transferForm.entry") }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ElMessage } from "element-plus";

import CustomerAPI from "@/api/customer";
import type { CustomerItem } from "@/api/customer";
import CustomerPickerSelect from "./CustomerPickerSelect.vue";

/**
 * 发起宠物归属转移（MVP-WEB-04-03 · FR-2）
 *
 * 契约：`POST /pets/:id/transfer`（`{ toCustomerId, reason? }`，权限 `customer:transfer:create`）。
 * 只落一行 `status=1`（待审批），**不改归属**；归属变更须审批通过（唯一合法通道）。
 *
 * 入口：客户详情抽屉「宠物」页签每行的「转移」按钮（本任务内落地，宠物档案页归 05-01）。
 * 「当前主人」由服务端按宠物归属**快照**推导（不接受前端传入），故此处仅排除该客户，
 * 防呆「转移给当前主人」→ `A0518`。
 *
 * 失败语义原样透出：`A0601` 宠物不存在 / `A0518` 转给当前主人 / `A0517` 目标客户无效 /
 * `A0515` 该宠物已有在途申请。
 */
defineOptions({
  name: "PetTransferDialog",
  inheritAttrs: false,
});

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    /** 待转移的宠物 */
    pet?: { id: string; name: string } | null;
    /** 当前主人（转出方），用于排除选项 */
    fromCustomerId?: string;
  }>(),
  { pet: null, fromCustomerId: "" }
);

const emit = defineEmits<{ "update:modelValue": [value: boolean]; refresh: [] }>();

const { t } = useI18n();

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

const submitting = ref(false);
const pickedName = ref("");
/** 排除「当前主人」（服务端 fail-safe 亦拒绝 A0518，此处仅防呆） */
const excludeIds = computed(() => (props.fromCustomerId ? [props.fromCustomerId] : []));
const form = reactive<{ toCustomerId?: string; reason: string }>({
  toCustomerId: undefined,
  reason: "",
});

watch(
  () => props.modelValue,
  (opened) => {
    if (!opened) return;
    form.toCustomerId = undefined;
    form.reason = "";
    pickedName.value = "";
  }
);

function handlePick(item: CustomerItem | null): void {
  pickedName.value = item?.name ?? "";
}

async function handleSubmit(): Promise<void> {
  if (!props.pet) return;
  if (!form.toCustomerId) {
    ElMessage.warning(t("customer.transferForm.required"));
    return;
  }
  if (form.toCustomerId === props.fromCustomerId) {
    ElMessage.warning(t("customer.transferForm.sameError"));
    return;
  }

  submitting.value = true;
  try {
    const reason = form.reason.trim();
    await CustomerAPI.createTransfer(props.pet.id, {
      toCustomerId: form.toCustomerId,
      ...(reason ? { reason } : {}),
    });
    ElMessage.success(t("customer.transferForm.success"));
    visible.value = false;
    emit("refresh");
  } catch {
    // 业务失败（A0515/A0517/A0518/A0601）由请求层统一渲染可读原因
  } finally {
    submitting.value = false;
  }
}
</script>

<style lang="scss" scoped>
.transfer-form__fixed {
  display: flex;
  align-items: center;
  min-height: 24px;
}

.transfer-form__hint {
  margin: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
