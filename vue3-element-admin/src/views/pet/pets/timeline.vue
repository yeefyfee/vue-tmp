<template>
  <div class="page-container">
    <el-card class="page-content" shadow="never">
      <!-- ── 头部（auto）：返回 / 标题 ─────────────────────────────────── -->
      <div class="pet-timeline-page__head">
        <div class="pet-timeline-page__head-left">
          <el-button link class="pet-timeline-page__back" @click="goBack">
            <el-icon><ArrowLeft /></el-icon>
            {{ t("pet.timeline.backToProfile") }}
          </el-button>
          <span class="pet-timeline-page__title" data-testid="pet-timeline-page-title">
            {{ titleText }}
          </span>
        </div>
      </div>

      <!-- ── 正文（1fr，独立滚动）：时间线组件（按天分组 + 筛选 + 补录/冲正）── -->
      <div class="pet-timeline-page__scroll" data-testid="pet-timeline-page">
        <DataState
          v-if="notFound"
          variant="empty"
          :title="t('pet.detail.notFound')"
          :action-text="t('pet.timeline.backToList')"
          @action="goList"
        />
        <PetTimelineTab v-else :pet-id="petId" />
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ArrowLeft } from "@element-plus/icons-vue";

import PetAPI from "@/api/pet";
import type { PetDetail } from "@/api/pet";
import DataState from "@/components/DataState/DataState.vue";
import { isApiError } from "@/utils/request";
import { useTagsViewStore } from "@/stores";
import PetTimelineTab from "./components/PetTimelineTab.vue";

/**
 * 宠物时间线独立页（MVP-WEB-05-04）
 *
 * 路由：`/pets/:petId/timeline`（PRD《页面清单》`Pet Timeline | pets/:pet_id/timeline |
 * 全部角色`）。与档案页 `?tab=timeline` 并存 —— 后者嵌在 5 页签内、宽度受限；本页是
 * **全宽专注视图**，承载完整的筛选 / 按天分组 / 补录 / 冲正交互（复用同一
 * `PetTimelineTab` 组件，逻辑单源）。
 *
 * 布局：严格遵循内容卡三段式 grid（`auto / 1fr / auto`）—— 本页只有两个直接子元素
 * （`__head` + `__scroll`），无第三块撑破 `.el-card__body` 的 `overflow: hidden`
 * （见 PITFALLS 布局红线）。
 *
 * 注册方式：`sys_menu` 中为「宠物」目录（600）下的**隐藏跳页路由**（`visible=0`，
 * `routePath: ":petId/timeline"`），不进侧边栏。
 */
defineOptions({ name: "PetTimeline", inheritAttrs: false });

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const petId = computed(() => String(route.params.petId ?? ""));

const pet = ref<PetDetail | null>(null);
const notFound = ref(false);

/** 工作区标签（详情类页面，按 PRD《多标签页策略》以标签打开） */
const tagsViewStore = useTagsViewStore();

const titleText = computed(() =>
  pet.value ? `${pet.value.name} · ${t("pet.timeline.pageTitle")}` : t("pet.timeline.pageTitle")
);

async function loadPet(): Promise<void> {
  const id = petId.value;
  if (!id) {
    notFound.value = true;
    return;
  }
  try {
    pet.value = await PetAPI.getDetail(id);
    notFound.value = false;
    // PRD《多标签页策略》第 5 条：标签标题动态生成（对象类型 + 名称）
    tagsViewStore.updateTagName(
      route.fullPath,
      `${pet.value.name} · ${t("pet.timeline.pageTitle")}`
    );
  } catch (error) {
    if (isApiError(error) && error.code === "A0601") {
      notFound.value = true;
    }
  }
}

/** 返回档案页（本页是「宠物档案 → 时间线」的下钻视图） */
function goBack(): void {
  if (petId.value) void router.push(`/pets/${petId.value}`);
}

/** 档案不存在时回落宠物列表 */
function goList(): void {
  void router.push("/pets");
}

let hadActivated = false;

onMounted(() => {
  void loadPet();
});

/** keep-alive 复用（同路由换 `petId` 时刷新头部） */
onActivated(() => {
  if (!hadActivated) {
    hadActivated = true;
    return;
  }
  void loadPet();
});
</script>

<style lang="scss" scoped>
.pet-timeline-page {
  &__head {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  &__head-left {
    display: flex;
    gap: 12px;
    align-items: center;
    min-width: 0;
  }

  &__back {
    height: auto;
    padding: 0;
    font-size: 13px;
  }

  &__title {
    font-size: 16px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  &__scroll {
    min-height: 0;
    overflow: auto;
  }
}
</style>
