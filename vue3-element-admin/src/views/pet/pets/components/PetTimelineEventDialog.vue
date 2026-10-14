<template>
  <el-dialog
    v-model="visible"
    :title="t('pet.timeline.createTitle')"
    width="560px"
    append-to-body
    destroy-on-close
    data-testid="pet-timeline-create-dialog"
    @closed="handleClosed"
  >
    <el-form ref="formRef" :model="draft" :rules="rules" label-width="96px" label-position="right">
      <el-form-item :label="t('pet.timeline.createEventName')" prop="eventName">
        <el-select
          v-model="draft.eventName"
          class="pet-timeline-dialog__field"
          filterable
          allow-create
          default-first-option
          :reserve-keyword="false"
          :placeholder="t('pet.timeline.createEventNamePlaceholder')"
          data-testid="pet-timeline-create-name"
          @change="handleNameChange"
        >
          <el-option
            v-for="opt in eventNameOptions"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>
      </el-form-item>

      <el-form-item :label="t('pet.timeline.createEventType')" prop="eventType">
        <el-select
          v-model="draft.eventType"
          class="pet-timeline-dialog__field"
          clearable
          :placeholder="t('pet.timeline.createEventTypePlaceholder')"
          data-testid="pet-timeline-create-type"
        >
          <el-option
            v-for="opt in eventTypeOptions"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>
      </el-form-item>

      <el-form-item :label="t('pet.timeline.createContent')" prop="content">
        <el-input
          v-model="draft.content"
          type="textarea"
          :rows="3"
          maxlength="500"
          show-word-limit
          :placeholder="t('pet.timeline.createContentPlaceholder')"
          data-testid="pet-timeline-create-content"
        />
      </el-form-item>

      <el-form-item :label="t('pet.timeline.createEventTime')" prop="eventTime">
        <!-- el-date-picker 不把未知属性透传到 DOM ⇒ 用一层容器承载自动化定位锚点 -->
        <div class="pet-timeline-dialog__field" data-testid="pet-timeline-create-time">
          <el-date-picker
            v-model="draft.eventTime"
            class="pet-timeline-dialog__field"
            type="datetime"
            value-format="YYYY-MM-DD HH:mm:ss"
            :placeholder="t('pet.timeline.createEventTimePlaceholder')"
          />
        </div>
      </el-form-item>

      <el-form-item :label="t('pet.timeline.createVisibility')" prop="visibleToOwner">
        <el-switch
          v-model="draft.visibleToOwner"
          :active-text="t('pet.timeline.ownerVisible')"
          :inactive-text="t('pet.timeline.internalOnly')"
          data-testid="pet-timeline-create-visible"
        />
      </el-form-item>

      <div class="pet-timeline-dialog__hint">{{ t("pet.timeline.createHint") }}</div>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">{{ t("pet.form.cancel") }}</el-button>
      <el-button
        type="primary"
        :loading="submitting"
        data-testid="pet-timeline-create-submit"
        @click="handleSubmit"
      >
        {{ t("pet.form.submit") }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ElMessage, type FormInstance, type FormRules } from "element-plus";
import {
  TIMELINE_EVENT_NAMES,
  TIMELINE_EVENT_TYPE_VALUES,
  TIMELINE_REVISION_EVENT_NAME,
} from "@peluvida/shared";

import PetAPI from "@/api/pet";
import { isApiError } from "@/utils/request";
import { timelineEventTypeLabelKey } from "@/utils/pet";

/**
 * 补录时间线事件对话框（MVP-WEB-05-04 · TR-2/TR-3「失败重试三次后告警并支持人工补录」）
 *
 * 事件名下拉取自 `@peluvida/shared` 的 `TIMELINE_EVENT_NAMES`（**唯一事实源**），
 * 并允许自定义（`allow-create`）：自定义名未登记 ⇒ 必须显式选「事件类型」，否则服务端
 * 抛 `A0614`（`EVENT_NAME_INVALID`）。已登记名会在选中时**自动带出**默认事件类型与
 * 可见性（与写侧 `resolveTimeline*` 回落口径一致），减少人工犯错。
 *
 * 冲正事件名 `timeline.event.revised` 由系统在冲正路径写入，**不在补录选项中**
 * （避免手工伪造冲正链）。
 */
defineOptions({ name: "PetTimelineEventDialog", inheritAttrs: false });

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
const submitting = ref(false);

/** 已登记事件名选项（排除系统冲正事件名） */
const eventNameOptions = Object.entries(TIMELINE_EVENT_NAMES)
  .filter(([name]) => name !== TIMELINE_REVISION_EVENT_NAME)
  .map(([name, meta]) => ({ value: name, label: `${name} · ${meta.description}` }));

/** 事件类型选项（1~8，文案与列表标签同源） */
const eventTypeOptions = computed(() =>
  TIMELINE_EVENT_TYPE_VALUES.map((value) => ({
    value,
    label: t(timelineEventTypeLabelKey(value)),
  }))
);

function isKnownEventName(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(TIMELINE_EVENT_NAMES, name);
}

interface Draft {
  eventName: string;
  eventType: number | undefined;
  content: string;
  eventTime: string;
  visibleToOwner: boolean;
}

const draft = reactive<Draft>({
  eventName: "",
  eventType: undefined,
  content: "",
  eventTime: "",
  visibleToOwner: true,
});

const rules = computed<FormRules>(() => ({
  eventName: [
    { required: true, message: t("pet.timeline.createEventNameRequired"), trigger: "change" },
  ],
  eventType: [
    {
      validator: (_rule, value, callback) => {
        // 已登记事件名可省略类型（服务端按名回落）；自定义名必须显式给出
        if (value === undefined || value === null || value === "") {
          if (!isKnownEventName(draft.eventName)) {
            callback(new Error(t("pet.timeline.createEventTypeRequired")));
            return;
          }
        }
        callback();
      },
      trigger: "change",
    },
  ],
}));

/** 选中已登记事件名 ⇒ 自动带出默认事件类型与可见性 */
function handleNameChange(name: string): void {
  const meta = (
    TIMELINE_EVENT_NAMES as Record<string, { eventType: number; visibleToOwner: boolean }>
  )[String(name ?? "")];
  if (!meta) return;
  draft.eventType = meta.eventType;
  draft.visibleToOwner = meta.visibleToOwner;
}

/** 默认事件时间 = 现在（`yyyy-MM-dd HH:mm:ss`，与后端 `parseWallClock` 兼容） */
function nowString(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes()
  )}:${p(d.getSeconds())}`;
}

function resetDraft(): void {
  draft.eventName = "";
  draft.eventType = undefined;
  draft.content = "";
  draft.eventTime = nowString();
  draft.visibleToOwner = true;
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
    await PetAPI.createTimelineEvent(props.petId, {
      eventName: draft.eventName.trim(),
      eventType: draft.eventType ?? undefined,
      content: draft.content.trim() || undefined,
      eventTime: draft.eventTime || undefined,
      visibleToOwner: draft.visibleToOwner,
    });
    visible.value = false;
    emit("saved");
    ElMessage.success(t("pet.timeline.createSuccess"));
  } catch (error) {
    ElMessage.error(isApiError(error) ? error.message : String(error ?? ""));
  } finally {
    submitting.value = false;
  }
}

function handleClosed(): void {
  draft.content = "";
}
</script>

<style lang="scss" scoped>
.pet-timeline-dialog {
  &__field {
    width: 100%;
  }

  &__hint {
    padding-left: 96px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--el-text-color-secondary);
  }
}
</style>
