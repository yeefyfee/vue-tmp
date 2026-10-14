<template>
  <el-dialog
    v-model="visible"
    :title="isEdit ? t('pet.tag.form.editTitle') : t('pet.tag.form.createTitle')"
    width="480px"
    append-to-body
    destroy-on-close
    data-testid="behavior-tag-form-dialog"
    @closed="handleClosed"
  >
    <el-form ref="formRef" :model="draft" :rules="rules" label-width="88px" label-position="right">
      <el-form-item :label="t('pet.tag.form.name')" prop="name">
        <el-input
          v-model="draft.name"
          maxlength="32"
          show-word-limit
          clearable
          :placeholder="t('pet.tag.form.namePlaceholder')"
          data-testid="behavior-tag-form-name"
        />
      </el-form-item>

      <el-form-item :label="t('pet.tag.form.sort')" prop="sort">
        <!-- el-input-number 内部为受控 input ⇒ 用容器承载自动化定位锚点（对齐踩坑 124 口径） -->
        <div data-testid="behavior-tag-form-sort">
          <el-input-number
            v-model="draft.sort"
            :min="0"
            :max="9999"
            :step="1"
            controls-position="right"
          />
        </div>
      </el-form-item>

      <el-form-item :label="t('pet.tag.form.status')" prop="status">
        <el-radio-group v-model="draft.status" data-testid="behavior-tag-form-status">
          <el-radio
            :value="BehaviorTagStatus.ENABLED"
            data-testid="behavior-tag-form-status-enabled"
          >
            {{ t("pet.value.statusEnabled") }}
          </el-radio>
          <el-radio
            :value="BehaviorTagStatus.DISABLED"
            data-testid="behavior-tag-form-status-disabled"
          >
            {{ t("pet.value.statusDisabled") }}
          </el-radio>
        </el-radio-group>
      </el-form-item>

      <div class="behavior-tag-dialog__hint">{{ t("pet.tag.form.statusHint") }}</div>
    </el-form>

    <template #footer>
      <el-button data-testid="behavior-tag-form-cancel" @click="visible = false">
        {{ t("pet.form.cancel") }}
      </el-button>
      <el-button
        type="primary"
        :loading="submitting"
        data-testid="behavior-tag-form-submit"
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
import type { BehaviorTagItem } from "@/api/pet";
import { BehaviorTagStatus } from "@/enums";
import { isApiError } from "@/utils/request";

/**
 * 行为标签新建 / 编辑对话框（MVP-WEB-05-05 · FR-4）
 *
 * 新建：`POST /behavior-tags`（`pet:tag:create`）；标签名租户内唯一 —— 存活同名抛
 * `A0610`，**同名已软删则复用其 id 复活**（后端语义，`behavior-tag.service`）。
 * 编辑：`PATCH /behavior-tags/:id`（`pet:tag:update`），**`version` 乐观锁必填**，
 * 版本不符抛 `A0612`；改名撞存活同名抛 `A0610`。
 *
 * ⚠️ 基准确认：行为标签列表行含全字段（含 `version`），故编辑**无需二次回查**
 * （不同于 05-01 宠物档案「列表行不带子集合」的写缺口，踩坑 123）。
 * `version` 取自打开对话框时的行快照；并发改动由服务端 `A0612` 拦下，
 * 失败时对话框**不关闭**，用户刷新列表后重试。
 *
 * 停用语义：`status=0` 仅阻断**新**挂载，存量宠物关联保留（`enums.BehaviorTagStatus`）。
 */
defineOptions({ name: "BehaviorTagFormDialog", inheritAttrs: false });

const props = defineProps<{
  /** 模式：新建 / 编辑 */
  mode: "create" | "edit";
  /** 编辑目标行（`mode="edit"` 必传；其 `version` 作乐观锁基准） */
  tag: BehaviorTagItem | null;
}>();

const emit = defineEmits<{
  (e: "success", payload: { mode: "create" | "edit" }): void;
}>();

const visible = defineModel("modelValue", {
  type: Boolean,
  required: true,
  default: false,
});

const { t } = useI18n();

const formRef = ref<FormInstance>();
const submitting = ref(false);

const isEdit = computed(() => props.mode === "edit");

const draft = reactive({
  name: "",
  sort: 0,
  status: BehaviorTagStatus.ENABLED as number,
});

const rules = computed<FormRules>(() => ({
  name: [
    { required: true, message: t("pet.tag.form.nameRequired"), trigger: "blur" },
    { min: 1, max: 32, message: t("pet.tag.form.nameLength"), trigger: "blur" },
  ],
  sort: [{ required: true, message: t("pet.tag.form.sortRequired"), trigger: "change" }],
}));

/** 打开时同步 draft（编辑取行快照；新建给缺省值：启用 + 排序 0） */
function syncDraft(): void {
  if (props.mode === "edit" && props.tag) {
    draft.name = props.tag.name;
    draft.sort = props.tag.sort ?? 0;
    draft.status = props.tag.status ?? BehaviorTagStatus.ENABLED;
    return;
  }
  draft.name = "";
  draft.sort = 0;
  draft.status = BehaviorTagStatus.ENABLED;
}

watch(
  () => [visible.value, props.tag, props.mode] as const,
  () => {
    if (!visible.value) return;
    syncDraft();
    // 打开瞬间清掉上一次的校验红字（表单被 destroy-on-close 重建，此处为幂等保险）
    nextTick(() => formRef.value?.clearValidate());
  }
);

/** 关闭动效结束后复位（避免下次打开闪现上一次的输入） */
function handleClosed(): void {
  formRef.value?.resetFields();
  syncDraft();
}

/**
 * 提交
 *
 * 校验通过后按模式调 create / update；**失败不关闭**（保留输入供修正，
 * 错误文案由请求层统一渲染，如 A0610「行为标签名称已存在」/ A0612 版本冲突）。
 */
async function handleSubmit(): Promise<void> {
  if (!formRef.value) return;
  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;

  const name = draft.name.trim();
  if (!name) return;

  submitting.value = true;
  try {
    if (props.mode === "edit") {
      const target = props.tag;
      if (!target) return;
      await PetAPI.updateBehaviorTag(target.id, {
        version: target.version,
        name,
        sort: Number(draft.sort) || 0,
        status: draft.status,
      });
    } else {
      await PetAPI.createBehaviorTag({
        name,
        sort: Number(draft.sort) || 0,
        status: draft.status,
      });
    }
    visible.value = false;
    emit("success", { mode: props.mode });
  } catch (error) {
    // 乐观锁冲突 / 重名：提示已在请求层渲染；此处仅在版本冲突时补一句操作指引
    if (isApiError(error) && error.code === "A0612") {
      ElMessage.warning(t("pet.tag.form.versionConflict"));
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<style lang="scss" scoped>
.behavior-tag-dialog__hint {
  padding-left: 88px;
  margin-top: -4px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}
</style>
