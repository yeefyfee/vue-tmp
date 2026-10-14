<template>
  <div class="pet-tab">
    <!-- 行为标签区（PRD《宠物管理》FR-1「行为标签」；全量替换语义，见 PUT /pets/:id/tags） -->
    <div class="pet-tab__section">
      <div class="pet-tab__section-head">
        <span class="pet-tab__section-title">{{ t("pet.detail.tagCloudTitle") }}</span>
        <el-button
          v-hasPerm="'pet:tag:assign'"
          type="primary"
          link
          size="small"
          @click="openTagEditor"
        >
          {{ t("pet.detail.editTags") }}
        </el-button>
      </div>

      <div v-if="pet.behaviorTags.length > 0" class="pet-tab__tags">
        <el-tag v-for="tag in pet.behaviorTags" :key="tag.id" effect="light" size="default">
          {{ tag.name }}
        </el-tag>
      </div>
      <p v-else class="pet-tab__empty-hint">{{ t("pet.detail.tagCloudEmpty") }}</p>
    </div>

    <!-- 基础档案（PRD《宠物管理》字段全表） -->
    <div class="pet-tab__section">
      <div class="pet-tab__section-head">
        <span class="pet-tab__section-title">{{ t("pet.detail.basicProfile") }}</span>
      </div>

      <el-descriptions :column="2" border size="small">
        <el-descriptions-item :label="t('pet.field.name')">{{ pet.name }}</el-descriptions-item>
        <el-descriptions-item :label="t('pet.field.petType')">
          <el-tag :type="petTypeTagType(pet.petType)" effect="plain" size="small">
            {{ t(petTypeLabelKey(pet.petType)) }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item :label="t('pet.field.breed')">
          {{ pet.breed || t("pet.value.unset") }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('pet.field.gender')">
          {{ t(petGenderLabelKey(pet.gender)) }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('pet.field.birthday')">
          {{ pet.birthday ? pet.birthday.slice(0, 10) : t("pet.value.unset") }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('pet.field.age')">{{ ageText }}</el-descriptions-item>
        <el-descriptions-item :label="t('pet.field.weightKg')">
          {{ pet.weightKg ? `${formatWeightKg(pet.weightKg)} kg` : t("pet.value.unset") }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('pet.field.coatColor')">
          {{ pet.coatColor || t("pet.value.unset") }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('pet.field.sterilized')">
          {{ sterilizedText }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('pet.field.chipNo')">
          {{ pet.chipNo || t("pet.value.unset") }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('pet.field.owner')">
          <el-button link type="primary" class="pet-tab__link" @click="emit('owner-link')">
            {{ ownerText }}
          </el-button>
        </el-descriptions-item>
        <el-descriptions-item :label="t('pet.field.store')">{{ storeText }}</el-descriptions-item>
        <el-descriptions-item :label="t('pet.detail.completeness')">
          {{ pet.profileCompleteness }} / 100
        </el-descriptions-item>
        <el-descriptions-item :label="t('pet.field.createdAt')">
          {{ formatTime(pet.createdAt) }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('pet.field.remark')" :span="2">
          {{ pet.remark || t("pet.value.unset") }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('pet.field.updatedAt')" :span="2">
          {{ formatTime(pet.updatedAt) }}
        </el-descriptions-item>
      </el-descriptions>
    </div>

    <!-- 体重曲线（PRD《宠物管理》FR-3 体重趋势图 + BR-4 环比预警；MVP-WEB-05-03） -->
    <div class="pet-tab__section">
      <PetWeightCurve :pet-id="pet.id" @changed="emit('refresh')" />
    </div>

    <!-- 行为标签编辑（全量替换：选中集合即最终集合） -->
    <el-dialog
      v-model="tagEditorVisible"
      :title="t('pet.detail.editTags')"
      width="480px"
      :close-on-click-modal="false"
      append-to-body
    >
      <el-select
        v-model="draftTagIds"
        class="w-full"
        multiple
        collapse-tags
        collapse-tags-tooltip
        :loading="tagLoading"
        :placeholder="t('pet.form.behaviorTagsPlaceholder')"
        data-testid="pet-tab-tag-editor"
      >
        <el-option v-for="tag in tagOptions" :key="tag.id" :label="tag.name" :value="tag.id" />
      </el-select>
      <template #footer>
        <el-button @click="tagEditorVisible = false">{{ t("pet.form.cancel") }}</el-button>
        <el-button type="primary" :loading="tagSubmitting" @click="submitTags">
          {{ t("pet.form.submit") }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ElMessage } from "element-plus";

import PetAPI from "@/api/pet";
import type { BehaviorTagItem, PetDetail } from "@/api/pet";
import { PetType } from "@/enums";
import { formatTableDateTime } from "@/utils/format";
import {
  calcPetAge,
  formatWeightKg,
  petAgeLabel,
  petGenderLabelKey,
  petTypeLabelKey,
} from "@/utils/pet";
import PetWeightCurve from "./PetWeightCurve.vue";

/**
 * 宠物档案 · 基本信息页签（MVP-WEB-05-01；05-03 增「体重曲线」区块）
 *
 * 展示 PRD《宠物管理》字段全表 + 行为标签摘要 + **体重曲线区块**；标签编辑走
 * `PUT /pets/:id/tags`（全量替换，空数组 = 清空），体重区块写路径走
 * `/pets/:id/weights`；两者成功后 emit `refresh` 由父页面重取详情（本组件不持有
 * 详情状态，避免与父组件双源）。
 */
defineOptions({ name: "PetBasicTab", inheritAttrs: false });

const props = defineProps<{ pet: PetDetail }>();

const emit = defineEmits<{ refresh: []; "owner-link": [] }>();

const { t } = useI18n();

function petTypeTagType(petType: number | null): "primary" | "success" | "info" {
  if (petType === PetType.DOG) return "primary";
  if (petType === PetType.CAT) return "success";
  return "info";
}

const ageText = computed(() => {
  const label = petAgeLabel(calcPetAge(props.pet.birthday));
  return t(label.key, label.params);
});

const sterilizedText = computed(() => {
  if (props.pet.sterilized === true) return t("pet.value.yes");
  if (props.pet.sterilized === false) return t("pet.value.no");
  return t("pet.value.unset");
});

const ownerText = computed(() => {
  if (!props.pet.ownerName) return t("pet.value.unset");
  return props.pet.ownerMobile
    ? `${props.pet.ownerName}（${props.pet.ownerMobile}）`
    : props.pet.ownerName;
});

const storeText = computed(() => {
  if (!props.pet.storeId) return t("pet.value.tenantLevel");
  return props.pet.storeName ?? `${String(props.pet.storeId).slice(0, 8)}…`;
});

function formatTime(value: unknown): string {
  return formatTableDateTime(value as string, {
    today: t("time.today"),
    yesterday: t("time.yesterday"),
    beforeYesterday: t("time.beforeYesterday"),
  });
}

// ── 行为标签编辑 ────────────────────────────────────────────────────────
const tagEditorVisible = ref(false);
const tagLoading = ref(false);
const tagSubmitting = ref(false);
const tagOptions = ref<BehaviorTagItem[]>([]);
const draftTagIds = ref<string[]>([]);
let tagLoaded = false;

async function fetchTagOptions(): Promise<void> {
  if (tagLoaded) return;
  tagLoading.value = true;
  try {
    const data = await PetAPI.getBehaviorTags({ pageNum: 1, pageSize: 100, status: 1 });
    tagOptions.value = data.list ?? [];
    tagLoaded = true;
  } catch {
    tagOptions.value = [];
  } finally {
    tagLoading.value = false;
  }
}

function openTagEditor(): void {
  draftTagIds.value = props.pet.behaviorTags.map((tag) => tag.id);
  tagEditorVisible.value = true;
  void fetchTagOptions();
}

async function submitTags(): Promise<void> {
  tagSubmitting.value = true;
  try {
    await PetAPI.replaceTags(props.pet.id, { behaviorTagIds: [...draftTagIds.value] });
    ElMessage.success(t("pet.detail.tagsUpdated"));
    tagEditorVisible.value = false;
    emit("refresh");
  } catch {
    // 失败提示由请求层统一渲染
  } finally {
    tagSubmitting.value = false;
  }
}
</script>

<style lang="scss" scoped>
.pet-tab {
  display: flex;
  flex-direction: column;
  gap: 20px;

  &__section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  &__section-head {
    display: flex;
    gap: 12px;
    align-items: baseline;
  }

  &__section-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  &__tags {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  &__empty-hint {
    margin: 0;
    font-size: 13px;
    color: var(--el-text-color-secondary);
  }

  &__link {
    height: auto;
    padding: 0;
  }
}
</style>
