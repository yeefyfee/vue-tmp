<template>
  <el-dialog
    v-model="visible"
    :title="t('customer.merge.title')"
    width="520px"
    append-to-body
    destroy-on-close
  >
    <el-alert
      class="merge-dialog__alert"
      :title="t('customer.merge.impactTitle')"
      type="warning"
      :closable="false"
      show-icon
    >
      <ul class="merge-dialog__list">
        <li>{{ t("customer.merge.impactPets") }}</li>
        <li>{{ t("customer.merge.impactReachLogs") }}</li>
        <li>{{ t("customer.merge.impactArchive") }}</li>
        <li>{{ t("customer.merge.impactMembership") }}</li>
      </ul>
    </el-alert>

    <el-form label-position="top" size="small" @submit.prevent>
      <!-- 被合并客户（将归档）：默认 = 当前行；交换后 = 检索选择 -->
      <el-form-item :label="t('customer.merge.formSource')">
        <div v-if="sourceLocked" class="merge-dialog__fixed" data-testid="merge-source-fixed">
          <el-tag type="danger" effect="plain">{{ rowName }}</el-tag>
          <span class="merge-dialog__mobile">{{ rowMobile }}</span>
        </div>
        <CustomerPickerSelect
          v-else
          v-model="pickedId"
          class="merge-dialog__picker"
          :placeholder="t('customer.merge.placeholder')"
          @select="handlePick"
        />
      </el-form-item>

      <!-- 保留客户：默认 = 检索选择；交换后 = 当前行 -->
      <el-form-item :label="t('customer.merge.formTarget')">
        <div v-if="!sourceLocked" class="merge-dialog__fixed" data-testid="merge-target-fixed">
          <el-tag type="success" effect="plain">{{ rowName }}</el-tag>
          <span class="merge-dialog__mobile">{{ rowMobile }}</span>
        </div>
        <div v-else class="merge-dialog__row">
          <CustomerPickerSelect
            v-model="pickedId"
            class="merge-dialog__picker"
            :placeholder="t('customer.merge.placeholder')"
            @select="handlePick"
          />
          <el-button class="page-icon-btn" :disabled="!pickedId" @click="handleSwap">
            <el-icon><Sort /></el-icon>
          </el-button>
        </div>
      </el-form-item>

      <p class="merge-dialog__hint">{{ t("customer.merge.hint") }}</p>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">{{ t("customer.form.cancel") }}</el-button>
      <el-button type="primary" :loading="submitting" @click="handleSubmit">
        {{ t("customer.merge.entry") }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ElMessage, ElMessageBox } from "element-plus";
import { Sort } from "@element-plus/icons-vue";

import CustomerAPI from "@/api/customer";
import type { CustomerItem } from "@/api/customer";
import CustomerPickerSelect from "./CustomerPickerSelect.vue";

/**
 * 客户合并对话框（MVP-WEB-04-03 · FR-7）
 *
 * 契约：`POST /customers/merge`（`{ sourceId, targetId }`，权限 `customer:merge`；
 * 请求层对写方法自动注入 `Idempotency-Key`）。语义：`sourceId`（被并入方）并入
 * `targetId`（保留方），源客户归档（软删 + 备注追加），宠物归属 / 关联 / 触达记录迁往 target。
 *
 * 入口：客户列表操作列「合并」。打开时**当前行默认作为「被合并客户」**（`sourceLocked`），
 * 可用「交换」翻转方向 —— 避免再叠一层方向下拉，同时保证语义无歧义。
 *
 * 强确认（PRD《交互规范》§确认与撤销 1）：合并 =「归档 + 数据迁移」且不可撤销，
 * 故要求输入**被合并客户姓名**才可执行；确认文案写明源 / 目标。
 *
 * 失败语义原样透出：`A0529` 自合并 / `A0530` 源客户无效 / `A0531` 目标客户无效 /
 * `A0528` 源客户存在在途转移申请 / `A0511` 版本冲突。
 *
 * 边界：会员卡冲突（保留等级更高者、余额累加）依赖未建模的会员体系 ⇒ 仅**文案提示**
 * 线下核对，不渲染任何会员卡字段（《Web规范》§权限与视图 1）。
 */
defineOptions({
  name: "CustomerMergeDialog",
  inheritAttrs: false,
});

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    /** 触发合并的当前行（默认作为「被合并客户」） */
    source?: CustomerItem | null;
  }>(),
  { source: null }
);

const emit = defineEmits<{ "update:modelValue": [value: boolean]; refresh: [] }>();

const { t } = useI18n();

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

const submitting = ref(false);
/** true = 当前行作为「被合并客户」（默认）；false = 当前行作为「保留客户」 */
const sourceLocked = ref(true);

/** 检索侧选中的另一个客户 */
const pickedId = ref<string | undefined>(undefined);
const pickedName = ref("");

const rowId = computed(() => props.source?.id ?? "");
const rowName = computed(() => props.source?.name ?? "");
const rowMobile = computed(() => props.source?.mobile ?? "");

/** 提交载荷：按方向组装 source / target */
const payload = computed(() => ({
  sourceId: sourceLocked.value ? rowId.value : (pickedId.value ?? ""),
  targetId: sourceLocked.value ? (pickedId.value ?? "") : rowId.value,
}));

/** 被合并方（将被归档）的姓名 —— 强确认要求输入的正是它 */
const archivedName = computed(() => (sourceLocked.value ? rowName.value : pickedName.value));

watch(
  () => props.modelValue,
  (opened) => {
    if (!opened) return;
    sourceLocked.value = true;
    pickedId.value = undefined;
    pickedName.value = "";
  }
);

function handlePick(item: CustomerItem | null): void {
  pickedName.value = item?.name ?? "";
}

/** 交换方向：当前行 ↔ 已选客户 */
function handleSwap(): void {
  if (!pickedId.value) return;
  sourceLocked.value = !sourceLocked.value;
}

async function handleSubmit(): Promise<void> {
  if (!pickedId.value) {
    ElMessage.warning(
      `${t("customer.merge.requiredPrefix")}${t(sourceLocked.value ? "customer.merge.formTarget" : "customer.merge.formSource")}`
    );
    return;
  }
  if (pickedId.value === rowId.value) {
    ElMessage.warning(t("customer.merge.sameError"));
    return;
  }

  const sourceName = sourceLocked.value
    ? rowName.value
    : pickedName.value || pickedId.value.slice(0, 8);
  const targetName = sourceLocked.value
    ? pickedName.value || pickedId.value.slice(0, 8)
    : rowName.value;

  try {
    await ElMessageBox.prompt(
      t("customer.merge.confirmText", { source: sourceName, target: targetName }),
      t("customer.merge.confirmTitle"),
      {
        confirmButtonText: t("customer.merge.entry"),
        cancelButtonText: t("customer.form.cancel"),
        inputPlaceholder: t("customer.merge.entry"),
        inputValidator: (input: string) => String(input ?? "").trim() === archivedName.value,
        inputErrorMessage: t("customer.delete.mismatch"),
        type: "warning",
      }
    );
  } catch {
    return;
  }

  submitting.value = true;
  try {
    const result = await CustomerAPI.mergeCustomers(payload.value);
    ElMessage.success(
      t("customer.merge.success", { pets: result.movedPets, logs: result.movedReachLogs })
    );
    visible.value = false;
    emit("refresh");
  } catch {
    // 业务失败由请求层统一渲染可读原因；此处不重复弹窗
  } finally {
    submitting.value = false;
  }
}
</script>

<style lang="scss" scoped>
.merge-dialog__alert {
  margin-bottom: 12px;
}

.merge-dialog__list {
  padding-left: 18px;
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.7;
}

.merge-dialog__row {
  display: flex;
  gap: 8px;
  align-items: center;
  width: 100%;
}

.merge-dialog__picker {
  flex: 1;
}

.merge-dialog__fixed {
  display: flex;
  gap: 8px;
  align-items: center;
  min-height: 24px;
}

.merge-dialog__mobile {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.merge-dialog__hint {
  margin: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
