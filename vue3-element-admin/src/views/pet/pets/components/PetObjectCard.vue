<template>
  <div class="pet-card">
    <!-- 头像：`photoUrl` 就绪后展示真图；未登记 / 加载失败回退「物种图标占位」
         （不渲染破图，也不渲染假图）。媒体域上传链路就绪前（05-01 边界）
         不会有 `photoUrl`，故占位是常态表现。 -->
    <div class="pet-card__avatar">
      <img
        v-if="pet.photoUrl && !photoBroken"
        :src="pet.photoUrl"
        :alt="t('pet.detail.photoAlt')"
        class="pet-card__avatar-img"
        @error="photoBroken = true"
      />
      <el-icon v-else class="pet-card__avatar-ph"><component :is="avatarIcon" /></el-icon>
    </div>

    <div class="pet-card__main">
      <div class="pet-card__title-row">
        <span class="pet-card__name">{{ pet.name }}</span>
        <el-tag :type="petTypeTagType(pet.petType)" effect="plain" size="small">
          {{ t(petTypeLabelKey(pet.petType)) }}
        </el-tag>
        <el-tag
          v-if="pet.gender !== null"
          :type="genderTagType(pet.gender)"
          effect="plain"
          size="small"
        >
          {{ t(petGenderLabelKey(pet.gender)) }}
        </el-tag>
        <el-tag v-if="pet.sterilized === true" type="info" effect="plain" size="small">
          {{ t("pet.field.sterilized") }}
        </el-tag>
      </div>

      <div class="pet-card__sub-row">
        <span>{{ pet.breed || t("pet.value.unset") }}</span>
        <span class="pet-card__dot">·</span>
        <span>{{ ageText }}</span>
        <span class="pet-card__dot">·</span>
        <span>{{ birthdayText }}</span>
      </div>

      <!-- 关键身份字段：芯片号 / 体重 / 归属门店 / 主人 -->
      <div class="pet-card__fields">
        <div class="pet-card__field">
          <span class="pet-card__field-label">{{ t("pet.field.chipNo") }}</span>
          <span class="pet-card__field-value">{{ pet.chipNo || t("pet.value.unset") }}</span>
        </div>
        <div class="pet-card__field">
          <span class="pet-card__field-label">{{ t("pet.field.weightKg") }}</span>
          <span class="pet-card__field-value">{{ weightText }}</span>
        </div>
        <div class="pet-card__field">
          <span class="pet-card__field-label">{{ t("pet.field.store") }}</span>
          <span class="pet-card__field-value">{{ storeText }}</span>
        </div>
        <div class="pet-card__field">
          <span class="pet-card__field-label">{{ t("pet.field.owner") }}</span>
          <span class="pet-card__field-value">
            <el-button link type="primary" class="pet-card__owner" @click="emit('owner-link')">
              {{ ownerText }}
            </el-button>
          </span>
        </div>
      </div>

      <!-- 完整度：PRD《宠物管理》字段全表的 `profileCompleteness`（服务端按权重表算） -->
      <div class="pet-card__completeness">
        <span class="pet-card__field-label">{{ t("pet.detail.completeness") }}</span>
        <el-progress
          :percentage="pet.profileCompleteness"
          :stroke-width="8"
          :status="pet.profileCompleteness >= 80 ? 'success' : undefined"
          class="pet-card__progress"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Star } from "@element-plus/icons-vue";

import type { PetDetail } from "@/api/pet";
import { PetType } from "@/enums";
import {
  calcPetAge,
  formatWeightKg,
  petAgeLabel,
  petGenderLabelKey,
  petTypeLabelKey,
} from "@/utils/pet";

/**
 * 宠物档案对象卡（MVP-WEB-05-01）
 *
 * PRD《页面功能》§宠物档案页：「页头为对象卡（头像、名字、品种、性别、生日与年龄、
 * 体重、芯片号、档案完整度）」。
 *
 * 纯展示件：不发请求、不改状态；主人跳转由父页面处理（`owner-link`）。
 */
defineOptions({ name: "PetObjectCard", inheritAttrs: false });

const props = defineProps<{ pet: PetDetail }>();

const emit = defineEmits<{ "owner-link": [] }>();

const { t } = useI18n();

/** 头像加载失败降级标记（图片 404 时切占位图标） */
const photoBroken = ref(false);
watch(
  () => props.pet.photoUrl,
  () => {
    photoBroken.value = false;
  }
);

/**
 * 头像占位图标
 *
 * Element Plus 图标集**不含**物种图标（Cat / Dog 均未导出），故统一用中性的
 * `Star` 占位，不做「用食物图标冒充物种」的牵强映射。
 */
const avatarIcon = Star;

function petTypeTagType(petType: number | null): "primary" | "success" | "info" {
  if (petType === PetType.DOG) return "primary";
  if (petType === PetType.CAT) return "success";
  return "info";
}

function genderTagType(gender: number | null): "primary" | "success" | "info" {
  if (gender === 1) return "primary";
  if (gender === 2) return "success";
  return "info";
}

/** 年龄（不满 1 岁只报月；无生日 = 年龄未知） */
const ageText = computed(() => {
  const label = petAgeLabel(calcPetAge(props.pet.birthday));
  return t(label.key, label.params);
});

const birthdayText = computed(() =>
  props.pet.birthday ? String(props.pet.birthday).slice(0, 10) : t("pet.value.ageUnknown")
);

/**
 * 体重展示：统一两位小数
 *
 * `pet.weight_kg` 为 `decimal(5,2)`，序列化后尾零会被省略（`"12.5"`）、且**写入快照后**
 * 与种子初始值（`"12.50"`）不一致 ⇒ 一律经 `formatWeightKg` 归一为 `12.50 kg`。
 */
const weightText = computed(() => {
  const text = formatWeightKg(props.pet.weightKg);
  return text ? `${text} kg` : t("pet.value.unset");
});

/** 归属门店：`storeId` 为空 = 租户级档案（`storeName` 恒 null） */
const storeText = computed(() => {
  if (!props.pet.storeId) return t("pet.value.tenantLevel");
  return props.pet.storeName ?? `${String(props.pet.storeId).slice(0, 8)}…`;
});

/** 主人：姓名（手机号）；关联缺失回退「未登记」不渲染裸 UUID */
const ownerText = computed(() => {
  if (!props.pet.ownerName) return t("pet.value.unset");
  return props.pet.ownerMobile
    ? `${props.pet.ownerName}（${props.pet.ownerMobile}）`
    : props.pet.ownerName;
});
</script>

<style lang="scss" scoped>
.pet-card {
  display: flex;
  gap: 20px;
  align-items: flex-start;
  padding: 16px 20px;
  background: var(--content-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--card-radius);

  &__avatar {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: 88px;
    height: 88px;
    overflow: hidden;
    background: var(--el-fill-color-light);
    border: 1px solid var(--card-border);
    border-radius: 12px;
  }

  &__avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  &__avatar-ph {
    font-size: 36px;
    color: var(--el-text-color-placeholder);
  }

  &__main {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }

  &__title-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  &__name {
    font-size: 20px;
    font-weight: 600;
    line-height: 1.2;
    color: var(--el-text-color-primary);
  }

  &__sub-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    font-size: 13px;
    color: var(--el-text-color-secondary);
  }

  &__dot {
    color: var(--el-text-color-placeholder);
  }

  &__fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 6px 24px;
  }

  &__field {
    display: flex;
    gap: 8px;
    align-items: baseline;
    min-width: 0;
    font-size: 13px;
  }

  &__field-label {
    flex-shrink: 0;
    color: var(--el-text-color-secondary);
  }

  &__field-value {
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--el-text-color-primary);
    white-space: nowrap;
  }

  &__owner {
    height: auto;
    padding: 0;
    font-size: 13px;
  }

  &__completeness {
    display: flex;
    gap: 12px;
    align-items: center;
    max-width: 360px;
  }

  &__progress {
    flex: 1 1 auto;
  }
}
</style>
