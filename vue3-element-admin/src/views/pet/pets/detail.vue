<template>
  <div class="page-container">
    <el-card class="page-content" shadow="never">
      <!-- ── 头部（auto）：返回 / 标题 / 写操作入口 ─────────────────────── -->
      <div class="pet-detail__head">
        <div class="pet-detail__head-left">
          <el-button link class="pet-detail__back" @click="goBack">
            <el-icon><ArrowLeft /></el-icon>
            {{ t("pet.detail.back") }}
          </el-button>
          <span class="pet-detail__title">{{ detail?.name ?? t("pet.title") }}</span>
        </div>

        <div class="pet-detail__head-right">
          <el-button v-hasPerm="'pet:update'" :disabled="!detail" type="primary" @click="openEdit">
            {{ t("pet.action.edit") }}
          </el-button>
          <el-button
            v-hasPerm="'pet:delete'"
            :disabled="!detail"
            type="danger"
            @click="handleDelete"
          >
            {{ t("pet.action.delete") }}
          </el-button>
        </div>
      </div>

      <!-- ── 正文（1fr，独立滚动）：对象卡 + 预警条 + 5 页签 ──────────────── -->
      <div class="pet-detail__scroll">
        <TableSkeleton v-if="showSkeleton" :column-count="3" :row-count="6" />

        <DataState
          v-else-if="loadError"
          variant="error"
          :title="t('pet.detail.loadError')"
          :description="loadError"
          :action-text="t('pet.timeline.retry')"
          @action="loadDetail"
        />

        <DataState
          v-else-if="notFound && !detail"
          variant="empty"
          :title="t('pet.detail.notFound')"
          :action-text="t('pet.detail.back')"
          @action="goBack"
        />

        <template v-else-if="detail">
          <PetObjectCard :pet="detail" @owner-link="goOwner" />

          <!-- 档案头部红色预警（PRD《页面功能》：疫苗到期低于 14 天） -->
          <el-alert
            v-if="expireWarningCount > 0"
            type="error"
            :closable="false"
            show-icon
            class="pet-detail__alert"
            :title="t('pet.health.expireWarning', { count: expireWarningCount })"
          />
          <el-alert
            v-else-if="validity"
            type="success"
            :closable="false"
            show-icon
            class="pet-detail__alert"
            :title="t('pet.health.expireNone')"
          />

          <el-tabs v-model="activeTab" class="pet-detail__tabs">
            <el-tab-pane :label="t('pet.detail.tabBasic')" name="basic">
              <PetBasicTab :pet="detail" @refresh="loadDetail" @owner-link="goOwner" />
            </el-tab-pane>

            <el-tab-pane :label="t('pet.detail.tabHealth')" name="health" lazy>
              <PetHealthTab :pet-id="petId" :validity="validity" @changed="handleHealthChanged" />
            </el-tab-pane>

            <el-tab-pane :label="t('pet.detail.tabServices')" name="services" lazy>
              <PetUnavailableTab variant="services" />
            </el-tab-pane>

            <el-tab-pane :label="t('pet.detail.tabConsumption')" name="consumption" lazy>
              <PetUnavailableTab variant="consumption" />
            </el-tab-pane>

            <el-tab-pane :label="t('pet.detail.tabTimeline')" name="timeline" lazy>
              <div class="pet-detail__timeline-pane">
                <div class="pet-detail__timeline-open">
                  <el-button
                    link
                    type="primary"
                    size="small"
                    data-testid="pet-timeline-open-full"
                    @click="openTimelinePage"
                  >
                    <el-icon><TopRight /></el-icon>
                    {{ t("pet.timeline.openFullPage") }}
                  </el-button>
                </div>
                <PetTimelineTab :pet-id="petId" />
              </div>
            </el-tab-pane>
          </el-tabs>
        </template>
      </div>
    </el-card>

    <PetFormDialog
      v-model="formVisible"
      :pet="detail"
      :store-options="storeOptions"
      @refresh="loadDetail"
    />
  </div>
</template>

<script setup lang="ts">
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowLeft, TopRight } from "@element-plus/icons-vue";

import PetAPI from "@/api/pet";
import type { HealthValidityResult, PetDetail } from "@/api/pet";
import StoreAPI from "@/api/store";
import DataState from "@/components/DataState/DataState.vue";
import TableSkeleton from "@/components/DataState/TableSkeleton.vue";
import PetBasicTab from "./components/PetBasicTab.vue";
import PetFormDialog from "./components/PetFormDialog.vue";
import PetHealthTab from "./components/PetHealthTab.vue";
import PetObjectCard from "./components/PetObjectCard.vue";
import PetTimelineTab from "./components/PetTimelineTab.vue";
import PetUnavailableTab from "./components/PetUnavailableTab.vue";
import { isApiError } from "@/utils/request";
import { isExpiringSoon } from "@/utils/pet";
import { useTagsViewStore } from "@/stores";

/**
 * 宠物档案页（MVP-WEB-05-01）
 *
 * 路由：`/pets/:petId`（《页面清单》`pets/:pet_id`）。**跳页**而非抽屉 ——
 * 本页承载对象卡 + 5 页签（基本信息 / 健康 / 服务历史 / 消费记录 / Timeline），
 * 宽度需求超出 PRD《Web规范》§页面模式 1 的 480px 抽屉承载。
 *
 * 布局：严格遵循内容卡三段式 grid（`auto / 1fr / auto`）——本页只有两个直接子元素：
 *  `__head`（auto）+ `__scroll`（1fr，独立滚动），第三个 auto 行为空（高度 0），
 *  不会撑破 `.el-card__body` 的 `overflow: hidden`（见 PITFALLS 布局红线）。
 *
 * 地址栏：只同步**页签** `?tab=`（默认 `basic` 不写，保持地址干净），与 02-03 门店配置
 *  同范式；`petId` 是路由身份段。写入 `?tab=` 会改变 `route.fullPath` ⇒ 工作区按
 *  fullPath 重建组件（PITFALLS 95/122）。为消除重建带来的骨架闪烁，本页用
 *  **模块级详情缓存** `detailCache`：命中时先同步渲染旧详情，再后台刷新（编辑/删除
 *  成功后也会写回缓存），故切页签无闪烁、无重复白屏。
 */
defineOptions({ name: "PetDetail", inheritAttrs: false });

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const petId = computed(() => String(route.params.petId ?? ""));

/** 工作区标签（本页为详情类页面，按 PRD《多标签页策略》以标签打开） */
const tagsViewStore = useTagsViewStore();

/**
 * 详情缓存（模块级，跨组件重建存活）
 *
 * 仅用于「消除 `?tab=` 变化引起的重建闪烁」；写入时机为详情加载成功 / 本页编辑成功。
 * 删除成功后清除，避免返回列表再进来看到已删档案。
 */
const detailCache = new Map<string, PetDetail>();

const TABS = ["basic", "health", "services", "consumption", "timeline"] as const;
type TabName = (typeof TABS)[number];

/** 当前页签（初值由地址栏 `?tab=` 推导，非法值回落 `basic`） */
const activeTab = ref<TabName>(
  TABS.includes(route.query.tab as TabName) ? (route.query.tab as TabName) : "basic"
);

const detail = ref<PetDetail | null>(null);
const validity = ref<HealthValidityResult | null>(null);

const loading = ref(false);
const hasLoaded = ref(false);
const loadError = ref("");
const notFound = ref(false);

/** 首屏骨架：仅当没有缓存详情可即时渲染时才出现 */
const showSkeleton = computed(() => loading.value && !hasLoaded.value && !detail.value);

/** 需提示补种的项数（已过期 daysLeft<0 或 14 天内到期） */
const expireWarningCount = computed(() => {
  const items = validity.value?.items ?? [];
  return items.filter(
    (item) => item.hasRecord && item.daysLeft !== null && isExpiringSoon(item.daysLeft, 14)
  ).length;
});

// ── 加载 ────────────────────────────────────────────────────────────────
async function loadDetail(): Promise<void> {
  const id = petId.value;
  if (!id) {
    notFound.value = true;
    return;
  }

  // 命中缓存：立即渲染，避免 `?tab=` 变化重建时闪骨架
  const cached = detailCache.get(id);
  if (cached) detail.value = cached;

  loadError.value = "";
  loading.value = true;
  try {
    const [pet, valid] = await Promise.all([
      PetAPI.getDetail(id),
      PetAPI.getHealthValidity(id).catch(() => null),
    ]);
    detail.value = pet;
    validity.value = valid;
    detailCache.set(id, pet);
    notFound.value = false;
    // PRD《多标签页策略》第 5 条：标签标题动态生成（对象类型 + 名称），
    // 覆盖菜单名「宠物详情」，否则多只宠物的标签无法区分
    tagsViewStore.updateTagName(route.fullPath, `${pet.name} · ${t("pet.title")}`);
  } catch (error) {
    if (isApiError(error) && error.code === "A0601") {
      notFound.value = true;
      detailCache.delete(id);
    } else {
      loadError.value = isApiError(error) ? error.message : String(error ?? "");
    }
  } finally {
    loading.value = false;
    hasLoaded.value = true;
  }
}

// ── 导航 ────────────────────────────────────────────────────────────────
function goBack(): void {
  void router.push("/pets");
}

/**
 * 健康页签写入成功后的联动（MVP-WEB-05-02）
 *
 * 档案页头部预警条与本页 `validity` 同源（`GET /pets/:petId/health/validity`）⇒
 * 健康记录写路径（建档 / 更正 / 软删）落库后必须**回源重算**，否则「新增一条 3 天后
 * 到期的疫苗」而头部预警计数不动的假象会出现（PRD 验收「疫苗到期低于 14 天在宠物档案
 * 头部出现红色预警」依赖该联动）。仅重取 validity，不整页重载。
 */
function handleHealthChanged(): void {
  const id = petId.value;
  if (!id) return;
  void PetAPI.getHealthValidity(id)
    .then((valid) => {
      validity.value = valid;
    })
    .catch(() => {
      // 联动失败不影响已完成的写路径（下次进入页签/刷新会自愈）
    });
}

/** 跳客户列表并按主人姓名 / 手机号定位（客户列表筛选用 `keyword`） */
function goOwner(): void {
  const keyword = detail.value?.ownerMobile ?? detail.value?.ownerName;
  void router.push({ path: "/customers", query: keyword ? { keyword } : {} });
}

/**
 * 打开独立的 Pet Timeline 页（MVP-WEB-05-04）
 *
 * 档案页的 Timeline 页签嵌在 5 页签内、宽度受限；独立页 `/pets/:petId/timeline`
 * 提供全宽专注视图（完整筛选 / 按天分组 / 补录 / 冲正）。
 */
function openTimelinePage(): void {
  const id = petId.value;
  if (id) void router.push(`/pets/${id}/timeline`);
}

// ── 地址栏同步页签（默认 `basic` 不写）──────────────────────────────────
watch(activeTab, (tab) => {
  const query: Record<string, string> = {};
  if (tab !== "basic") query.tab = tab;
  void router.replace({ path: route.path, query }).then(
    () => undefined,
    () => undefined
  );
});

// ── 编辑 / 删除 ─────────────────────────────────────────────────────────
const formVisible = ref(false);
const storeOptions = ref<Array<{ id: string; name: string }>>([]);

function openEdit(): void {
  formVisible.value = true;
}

async function fetchStoreOptions(): Promise<void> {
  try {
    const data = await StoreAPI.getPage({
      pageNum: 1,
      pageSize: 100,
      sortBy: "createdAt",
      order: "ASC",
    });
    storeOptions.value = (data.list ?? []).map((item) => ({ id: item.id, name: item.name }));
  } catch {
    storeOptions.value = [];
  }
}

/** 删除（强确认：输入宠物名；PRD《交互规范》§确认与撤销 1/2） */
async function handleDelete(): Promise<void> {
  const pet = detail.value;
  if (!pet) return;

  try {
    const { value } = await ElMessageBox.prompt(
      t("pet.delete.confirmText", { name: pet.name, owner: pet.ownerName ?? t("pet.value.unset") }),
      t("pet.delete.title"),
      {
        confirmButtonText: t("pet.action.delete"),
        cancelButtonText: t("pet.form.cancel"),
        inputPlaceholder: t("pet.delete.inputPlaceholder"),
        inputValidator: (input: string) => String(input ?? "").trim() === pet.name,
        inputErrorMessage: t("pet.delete.mismatch"),
        type: "warning",
      }
    );
    if (String(value ?? "").trim() !== pet.name) return;
  } catch {
    return;
  }

  try {
    await PetAPI.deleteById(pet.id);
    detailCache.delete(pet.id);
    ElMessage.success(t("pet.delete.success"));
    goBack();
  } catch {
    // 失败提示由请求层统一渲染
  }
}

// ── 生命周期 ────────────────────────────────────────────────────────────
onMounted(() => {
  void loadDetail();
  void fetchStoreOptions();
});

/**
 * keep-alive 激活：`petId` 变化（从另一只宠物进来）或本页被复用（缓存键同）时，
 * 按地址栏重新对齐页签并刷新详情。
 */
let hadActivated = false;
onActivated(() => {
  if (!hadActivated) {
    hadActivated = true;
    return;
  }
  const tab = route.query.tab as TabName;
  activeTab.value = TABS.includes(tab) ? tab : "basic";
  void loadDetail();
});
</script>

<style lang="scss" scoped>
.pet-detail {
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

  &__head-right {
    display: flex;
    flex-shrink: 0;
    gap: 8px;
  }

  /* 1fr 滚动行：object 卡 + 预警条 + 页签在同一滚动容器内 */
  &__scroll {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
    overflow: auto;
  }

  &__alert {
    :deep(.el-alert__title) {
      font-size: 13px;
    }
  }

  &__tabs {
    :deep(.el-tabs__content) {
      padding-top: 4px;
    }
  }

  /** Timeline 页签：右对齐的「打开独立页」入口 + 时间线内容 */
  &__timeline-pane {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  &__timeline-open {
    display: flex;
    justify-content: flex-end;
  }
}
</style>
