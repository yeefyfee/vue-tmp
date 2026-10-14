<template>
  <el-dialog
    v-model="visible"
    :title="t('pet.timeline.reviseTitle')"
    width="560px"
    append-to-body
    destroy-on-close
    data-testid="pet-timeline-revise-dialog"
    @closed="handleClosed"
  >
    <el-alert
      type="warning"
      :closable="false"
      show-icon
      class="pet-timeline-revise__note"
      :title="t('pet.timeline.reviseHint')"
    />

    <!-- 被冲正事件摘要（原事件**不变**，本操作只追加冲正事件） -->
    <div v-if="event" class="pet-timeline-revise__target" data-testid="pet-timeline-revise-target">
      <div class="pet-timeline-revise__target-head">
        <el-tag :type="timelineEventTagType(event.eventType)" effect="plain" size="small">
          {{ t(timelineEventTypeLabelKey(event.eventType)) }}
        </el-tag>
        <span class="pet-timeline-revise__target-time">{{ event.eventTime }}</span>
        <span class="pet-timeline-revise__target-id">#{{ event.id }}</span>
      </div>
      <p v-if="event.content" class="pet-timeline-revise__target-content">{{ event.content }}</p>
    </div>

    <el-form
      ref="formRef"
      :model="draft"
      :rules="rules"
      label-width="96px"
      label-position="right"
      class="pet-timeline-revise__form"
    >
      <el-form-item :label="t('pet.timeline.reviseReason')" prop="reason">
        <el-input
          v-model="draft.reason"
          type="textarea"
          :rows="3"
          maxlength="500"
          show-word-limit
          :placeholder="t('pet.timeline.reviseReasonPlaceholder')"
          data-testid="pet-timeline-revise-reason"
        />
      </el-form-item>

      <el-form-item :label="t('pet.timeline.reviseChanges')" prop="changes">
        <el-input
          v-model="draft.changes"
          type="textarea"
          :rows="3"
          :placeholder="t('pet.timeline.reviseChangesPlaceholder')"
          data-testid="pet-timeline-revise-changes"
        />
      </el-form-item>

      <el-form-item :label="t('pet.timeline.createVisibility')" prop="visibleToOwner">
        <el-switch
          v-model="draft.visibleToOwner"
          :active-text="t('pet.timeline.ownerVisible')"
          :inactive-text="t('pet.timeline.internalOnly')"
          data-testid="pet-timeline-revise-visible"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">{{ t("pet.form.cancel") }}</el-button>
      <el-button
        type="primary"
        :loading="submitting"
        data-testid="pet-timeline-revise-submit"
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
import type { TimelineEventItem } from "@/api/pet";
import { isApiError } from "@/utils/request";
import { timelineEventTagType, timelineEventTypeLabelKey } from "@/utils/pet";

/**
 * 冲正时间线事件对话框（MVP-WEB-05-04 · TR-4）
 *
 * PRD《宠物管理》TR-4：「时间线不可编辑与删除，纠错以新事件冲正，`event_type` 加
 * `corrected` 前缀并引用原事件」。本对话框只收集**冲正原因**与可选的**字段级差分**
 * （`changes`），提交走 `POST /pets/:petId/timeline/:eventId/revise` —— 服务端**不修改
 * 原事件**，只追加一条 `timeline.event.revised`（`refType=timeline_event`、
 * `refId=原事件 id`），原事件行保持字节级不变（DB 触发器亦禁止改删）。
 */
defineOptions({ name: "PetTimelineReviseDialog", inheritAttrs: false });

const props = defineProps<{
  /** 宠物 id（必传） */
  petId: string;
  /** 被冲正的原事件（打开前赋值） */
  event: TimelineEventItem | null;
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
const submitting = ref(false);

interface Draft {
  reason: string;
  changes: string;
  visibleToOwner: boolean;
}

const draft = reactive<Draft>({ reason: "", changes: "", visibleToOwner: true });

const rules = computed<FormRules>(() => ({
  reason: [{ required: true, message: t("pet.timeline.reviseReasonRequired"), trigger: "blur" }],
  changes: [
    {
      validator: (_rule, value, callback) => {
        const raw = String(value ?? "").trim();
        if (!raw) {
          callback();
          return;
        }
        try {
          const parsed = JSON.parse(raw);
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            callback(new Error(t("pet.timeline.reviseChangesInvalid")));
            return;
          }
        } catch {
          callback(new Error(t("pet.timeline.reviseChangesInvalid")));
          return;
        }
        callback();
      },
      trigger: "blur",
    },
  ],
}));

watch(visible, (open) => {
  if (open) {
    draft.reason = "";
    draft.changes = "";
    // 缺省继承原事件可见性（与后端 `dto.visibleToOwner ?? original.visibleToOwner` 同口径）
    draft.visibleToOwner = props.event?.visibleToOwner ?? true;
    nextTick(() => formRef.value?.clearValidate());
  }
});

async function handleSubmit(): Promise<void> {
  const target = props.event;
  if (!target) return;

  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;

  const rawChanges = draft.changes.trim();
  const changes = rawChanges ? (JSON.parse(rawChanges) as Record<string, unknown>) : undefined;

  submitting.value = true;
  try {
    await PetAPI.reviseTimelineEvent(props.petId, target.id, {
      reason: draft.reason.trim(),
      changes,
      visibleToOwner: draft.visibleToOwner,
    });
    visible.value = false;
    emit("saved");
    ElMessage.success(t("pet.timeline.reviseSuccess"));
  } catch (error) {
    ElMessage.error(isApiError(error) ? error.message : String(error ?? ""));
  } finally {
    submitting.value = false;
  }
}

function handleClosed(): void {
  draft.reason = "";
  draft.changes = "";
}
</script>

<style lang="scss" scoped>
.pet-timeline-revise {
  &__note {
    margin-bottom: 12px;

    :deep(.el-alert__title) {
      font-size: 12px;
      line-height: 1.6;
    }
  }

  &__target {
    padding: 8px 12px;
    margin-bottom: 12px;
    background: var(--el-fill-color-light);
    border-radius: 4px;
  }

  &__target-head {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  &__target-time {
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }

  &__target-id {
    margin-left: auto;
    font-size: 12px;
    color: var(--el-text-color-placeholder);
  }

  &__target-content {
    margin: 4px 0 0;
    font-size: 13px;
    line-height: 1.5;
    color: var(--el-text-color-regular);
    overflow-wrap: anywhere;
  }

  &__form {
    margin-top: 4px;
  }
}
</style>
