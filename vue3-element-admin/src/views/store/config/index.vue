<template>
  <div class="page-container">
    <!-- 门店上下文条：本页所有配置都归属「当前门店」，故先固定上下文再编辑 -->
    <el-card class="page-search" shadow="never">
      <div class="store-config__bar">
        <div class="store-config__bar-left">
          <span class="store-config__bar-label">{{ t("storeConfig.picker.label") }}</span>
          <el-tag v-if="currentStore" size="large" effect="plain" type="primary">
            {{ currentStore.name }}
          </el-tag>
          <span v-else class="store-config__bar-empty">
            {{ t("storeConfig.picker.placeholder") }}
          </span>
        </div>

        <div class="store-config__bar-right">
          <el-tag v-if="storeId && !canUpdate" type="info" effect="plain">
            {{ t("storeConfig.readonlyTip") }}
          </el-tag>
          <el-button :disabled="!storeId" :loading="loading" @click="loadAll(true)">
            {{ t("storeConfig.action.reload") }}
          </el-button>
          <el-dropdown
            v-if="isMultiStore"
            trigger="click"
            :disabled="switching"
            @command="handleSwitchStore"
          >
            <el-button :disabled="!storeId">
              {{ t("storeConfig.picker.switch") }}
              <el-icon class="el-icon--right"><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item
                  v-for="item in organizations"
                  :key="item.id"
                  :command="item.id"
                  :disabled="item.id === storeId"
                >
                  {{ item.name }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <span v-else-if="storeId" class="store-config__bar-tip">
            {{ t("storeConfig.picker.singleTip") }}
          </span>
        </div>
      </div>
    </el-card>

    <el-card class="page-content" shadow="never">
      <!-- 未选定门店：区分「账号下无门店」与「有门店但未选择」两种空态 -->
      <DataState
        v-if="!storeId"
        class="store-config__state"
        variant="empty"
        :title="emptyState.title"
        :description="emptyState.description"
      />

      <!-- 加载失败：给出可读原因 + 重试入口 -->
      <DataState
        v-else-if="loadError"
        class="store-config__state"
        variant="error"
        :title="t('storeConfig.loadError.title')"
        :description="t('storeConfig.loadError.desc')"
        :action-text="t('storeConfig.loadError.retry')"
        @action="loadAll(true)"
      />

      <!-- 骨架屏：形状对齐「7 天时段行」真实结构（PRD《Web规范》§空态/加载/错误态） -->
      <div v-else-if="loading" class="store-config__skeleton" aria-busy="true">
        <div v-for="row in 7" :key="row" class="store-config__skeleton-row">
          <span class="store-config__skeleton-cell is-label" />
          <span class="store-config__skeleton-cell" />
          <span class="store-config__skeleton-cell is-short" />
        </div>
      </div>

      <div v-else class="store-config__scroll">
        <el-tabs v-model="activeTab" :before-leave="handleTabBeforeLeave">
          <el-tab-pane :label="t('storeConfig.tab.hours')" name="hours">
            <BusinessHoursEditor v-model="businessHours" :readonly="!canUpdate" />
          </el-tab-pane>

          <el-tab-pane :label="t('storeConfig.tab.config')" name="config">
            <StoreConfigForm v-model="config" :readonly="!canUpdate" />
          </el-tab-pane>
        </el-tabs>
      </div>
    </el-card>

    <!-- 操作条固定底部（PRD《Web规范》§布局与栅格 3） -->
    <div v-if="storeId && !loading && !loadError" class="store-config__footer">
      <span class="store-config__footer-status">
        <template v-if="activeDirty">
          <el-icon class="is-dirty"><WarningFilled /></el-icon>
          {{ t("storeConfig.action.unsavedTip") }}
        </template>
        <template v-else>
          <el-icon class="is-clean"><CircleCheck /></el-icon>
          {{ t("storeConfig.action.savedTip") }}
        </template>
      </span>

      <el-button :disabled="!activeDirty || saving" @click="handleReset">
        {{ t("storeConfig.action.reset") }}
      </el-button>
      <el-button
        v-hasPerm="'store:update'"
        type="primary"
        :loading="saving"
        :disabled="!canSave"
        @click="handleSave"
      >
        {{ t("storeConfig.action.save") }}
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ArrowDown, CircleCheck, WarningFilled } from "@element-plus/icons-vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import {
  DEFAULT_STORE_CONFIG,
  STORE_CONFIG_KEYS,
  type StoreConfig,
  type StoreConfigKey,
} from "@peluvida/shared";
import StoreAPI from "@/api/store";
import type { UpdateStoreConfigForm, WeeklyBusinessHours } from "@/api/store";
import DataState from "@/components/DataState/DataState.vue";
import { WEEKDAY_KEYS } from "@/constants";
import { useStoreContextStore } from "@/stores";
import { hasPerm } from "@/utils/auth";
import { cloneWeeklyHours, hasInvalidSegment, normalizeWeeklyHours } from "@/utils/business-hours";
import BusinessHoursEditor from "./components/BusinessHoursEditor.vue";
import StoreConfigForm from "./components/StoreConfigForm.vue";

/**
 * 营业时间与门店配置页（MVP-WEB-02-03 · 后端 P0-04-04 FR-3 / P0-04-05 FR-4）
 *
 * 页面承载两类**门店级**运营配置（均需先确定「当前门店」）：
 *  ① 每周营业时段：`GET/PUT /stores/:id/business-hours`，7 天键整存整取；
 *  ② 结构化配置：`GET/PATCH /stores/:id/config`，浅 merge 部分更新。
 *
 * 关键口径：
 *  · 门店上下文**复用全局**（01-03 顶部切换器 `useStoreContextStore`）——切换门店会
 *    重签 access token 并整页重载，天然满足「门店切换后所有页面携新 store_id 重拉」；
 *  · 两个写接口**共用 `store.version` 乐观锁**：保存任一后本地 version 同步为返回值，
 *    否则紧接着的另一项保存必然撞 `A0423`；
 *  · 未保存修改在「切 Tab / 切门店 / 离开路由」三处都会二次确认（PRD《交互规范》）；
 *  · 只读账号（无 `store:update`）隐藏保存入口并整体禁用控件（PRD：隐藏优于报错）。
 */
defineOptions({ name: "StoreConfig" });

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const storeContext = useStoreContextStore();
const { activeStoreId, organizations, switching, isMultiStore } = storeToRefs(storeContext);

/** 当前门店 ID（来自全局门店上下文；为空表示「全部门店」视图，本页无门店可配） */
const storeId = computed(() => activeStoreId.value);

const currentStore = computed(
  () => organizations.value.find((item) => item.id === storeId.value) ?? null
);

const canUpdate = computed(() => hasPerm("store:update"));

const loading = ref(false);
const saving = ref(false);
const loadError = ref(false);

/** 每周营业时段：当前编辑值 + 上次保存基线（脏检查用） */
const businessHours = ref<WeeklyBusinessHours>(normalizeWeeklyHours(null));
const hoursBaseline = ref<WeeklyBusinessHours>(normalizeWeeklyHours(null));

/** 门店配置：当前编辑值 + 上次保存基线 */
const config = ref<StoreConfig>({ ...DEFAULT_STORE_CONFIG });
const configBaseline = ref<StoreConfig>({ ...DEFAULT_STORE_CONFIG });

/** 门店共用乐观锁版本（两侧保存都读写它） */
const version = ref(0);

/** 已成功加载过配置的门店 ID（用于避免 watch 与 onMounted 重复拉取） */
const loadedStoreId = ref("");

/** 当前 Tab（`hours` / `config`；与地址栏 `?tab=` 双向同步） */
const activeTab = ref<string>(route.query.tab === "config" ? "config" : "hours");

/** 未选门店时的空态文案：区分「无门店可配」与「有门店但未选择」 */
const emptyState = computed(() =>
  organizations.value.length === 0
    ? {
        title: t("storeConfig.picker.emptyOrgTitle"),
        description: t("storeConfig.picker.emptyOrgDesc"),
      }
    : {
        title: t("storeConfig.picker.noStoreTitle"),
        description: t("storeConfig.picker.noStoreDesc"),
      }
);

/** 门店配置中发生变更的键（PATCH 只提交这些键，符合浅 merge 语义） */
const changedConfigKeys = computed<StoreConfigKey[]>(() =>
  STORE_CONFIG_KEYS.filter((key) => config.value[key] !== configBaseline.value[key])
);

/** 营业时段中被改动的「天」数（脏检查粒度到天，便于给用户可读的变更量） */
const hoursChangeCount = computed(() => {
  let count = 0;
  for (const day of WEEKDAY_KEYS) {
    if (JSON.stringify(businessHours.value[day]) !== JSON.stringify(hoursBaseline.value[day])) {
      count += 1;
    }
  }
  return count;
});

const hoursDirty = computed(() => hoursChangeCount.value > 0);
const configDirty = computed(() => changedConfigKeys.value.length > 0);

/** 当前 Tab 是否有未保存修改 */
const activeDirty = computed(() =>
  activeTab.value === "hours" ? hoursDirty.value : configDirty.value
);

/** 当前 Tab 的变更处数（用于离开确认文案） */
const activeChangeCount = computed(() =>
  activeTab.value === "hours" ? hoursChangeCount.value : changedConfigKeys.value.length
);

/** 保存按钮可用性：有权限 + 有变更 + 当前 Tab 无非法值 */
const canSave = computed(() => {
  if (!canUpdate.value || saving.value) return false;
  if (activeTab.value === "hours") {
    return hoursDirty.value && !hasInvalidSegment(businessHours.value);
  }
  return configDirty.value;
});

/**
 * 载入当前门店的营业时段与配置
 *
 * 两接口共用门店乐观锁，正常并发返回同一 `version`；取较大值仅为防御
 * （避免极端情况下因响应乱序把本地版本回退到旧值）。
 */
async function loadAll(force = false): Promise<void> {
  const id = storeId.value;
  if (!id) return;
  if (!force && loadedStoreId.value === id) return;

  loading.value = true;
  loadError.value = false;
  try {
    const [hoursResult, configResult] = await Promise.all([
      StoreAPI.getBusinessHours(id),
      StoreAPI.getConfig(id),
    ]);

    businessHours.value = normalizeWeeklyHours(hoursResult.businessHours);
    hoursBaseline.value = cloneWeeklyHours(businessHours.value);

    config.value = { ...configResult.config };
    configBaseline.value = { ...configResult.config };

    version.value = Math.max(hoursResult.version, configResult.version);
    loadedStoreId.value = id;
  } catch {
    // 具体错误文案由请求层统一渲染；此处只切换到错误态给出重试入口
    loadError.value = true;
  } finally {
    loading.value = false;
  }
}

/** 保存当前 Tab 的修改 */
async function handleSave(): Promise<void> {
  const id = storeId.value;
  if (!id || !canSave.value) return;

  saving.value = true;
  try {
    if (activeTab.value === "hours") {
      const result = await StoreAPI.saveBusinessHours(id, {
        version: version.value,
        businessHours: businessHours.value,
      });
      businessHours.value = normalizeWeeklyHours(result.businessHours);
      hoursBaseline.value = cloneWeeklyHours(businessHours.value);
      version.value = result.version;
      ElMessage.success(t("storeConfig.action.saveSuccess", { tab: t("storeConfig.tab.hours") }));
      return;
    }

    // 浅 merge：只提交发生变更的键
    const payload: UpdateStoreConfigForm = { version: version.value };
    for (const key of changedConfigKeys.value) {
      (payload as Record<string, unknown>)[key] = config.value[key];
    }
    const result = await StoreAPI.updateConfig(id, payload);
    config.value = { ...result.config };
    configBaseline.value = { ...result.config };
    version.value = result.version;
    ElMessage.success(t("storeConfig.action.saveSuccess", { tab: t("storeConfig.tab.config") }));
  } catch {
    // A0423 版本冲突 / A0436 / A0437 校验失败等均由请求层统一提示（含「怎么办」）
  } finally {
    saving.value = false;
  }
}

/** 放弃当前 Tab 的修改，回到上次保存的内容 */
function handleReset(): void {
  if (activeTab.value === "hours") {
    businessHours.value = cloneWeeklyHours(hoursBaseline.value);
  } else {
    config.value = { ...configBaseline.value };
  }
  ElMessage.success(t("storeConfig.action.resetSuccess"));
}

/** 未保存离开确认（PRD《交互规范》：写清影响范围与对象数量） */
async function confirmDiscard(title: string, message: string): Promise<boolean> {
  try {
    await ElMessageBox.confirm(message, title, {
      type: "warning",
      confirmButtonText: t("storeConfig.action.discardConfirm"),
      cancelButtonText: t("storeConfig.action.keepEditing"),
    });
    return true;
  } catch {
    return false;
  }
}

/** Tab 切换前拦截（有未保存修改先确认） */
async function handleTabBeforeLeave(): Promise<boolean> {
  if (!activeDirty.value) return true;
  const tabName = t(
    activeTab.value === "hours" ? "storeConfig.tab.hours" : "storeConfig.tab.config"
  );
  return await confirmDiscard(
    t("storeConfig.action.leaveTitle"),
    t("storeConfig.action.leaveMessage", { tab: tabName, count: activeChangeCount.value })
  );
}

/**
 * 切换门店
 *
 * 走全局 `switchStore`：重签 access token 后整页重载，所有页面随即以新
 * store_id 重新拉取（《页面信息架构·视图个性化》#3）。有未保存修改先确认。
 */
async function handleSwitchStore(targetId: string): Promise<void> {
  if (!targetId || targetId === storeId.value) return;

  if (activeDirty.value) {
    const tabName = t(
      activeTab.value === "hours" ? "storeConfig.tab.hours" : "storeConfig.tab.config"
    );
    const confirmed = await confirmDiscard(
      t("storeConfig.action.switchStoreTitle"),
      t("storeConfig.action.switchStoreMessage", {
        store: currentStore.value?.name ?? "",
        tab: tabName,
        count: activeChangeCount.value,
      })
    );
    if (!confirmed) return;
  }

  await storeContext.switchStore(targetId);
}

/** 离开本页前拦截（PRD：未保存二次确认） */
onBeforeRouteLeave(async () => {
  if (!activeDirty.value) return true;
  const tabName = t(
    activeTab.value === "hours" ? "storeConfig.tab.hours" : "storeConfig.tab.config"
  );
  return await confirmDiscard(
    t("storeConfig.action.leaveTitle"),
    t("storeConfig.action.leaveMessage", { tab: tabName, count: activeChangeCount.value })
  );
});

/** 地址栏同步当前 Tab（`hours` 为默认值时不写入，保持地址干净） */
function syncUrl(): void {
  const query: Record<string, string> = {};
  if (activeTab.value === "config") query.tab = "config";
  router.replace({ query }).then(
    () => undefined,
    () => undefined
  );
}

watch(activeTab, syncUrl);

/** 门店上下文就绪后（或门店变更时）拉取配置 */
watch(
  storeId,
  (id) => {
    if (id) void loadAll();
  },
  { immediate: true }
);

onMounted(async () => {
  await storeContext.loadOrganizations();
  // 门店列表可能在页面挂载后才返回（登录首屏），此处兜底触发一次加载
  if (storeId.value) void loadAll();
});
</script>

<style lang="scss" scoped>
.store-config {
  &__bar {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
  }

  &__bar-left {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  &__bar-label {
    font-size: 13px;
    color: var(--el-text-color-secondary);
  }

  &__bar-empty {
    font-size: 13px;
    color: var(--el-text-color-placeholder);
  }

  &__bar-right {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  &__bar-tip {
    font-size: 12px;
    color: var(--el-text-color-placeholder);
  }

  /* ⚠️ 内容卡 .el-card__body 是**三段式 grid**（page.scss：auto / minmax(0,1fr) / auto）：
     只有第 2 个直接子元素会落在 1fr 滚动行。此前 el-tabs 是唯一子元素 ⇒ 落进
     row1(auto) 撑到 772px，超出 body 后 147px 被 overflow:hidden 裁掉且无法滚动
     （踩坑 96）。故这里显式把滚动区钉在 row2，空态/骨架跨满整行。 */
  &__scroll {
    grid-row: 2 / 3;
    min-height: 0;
    padding-right: 4px;
    overflow: auto;
  }

  &__state {
    grid-row: 1 / -1;
    min-height: 0;
    overflow: auto;
  }

  &__skeleton {
    display: flex;
    flex-direction: column;
    grid-row: 1 / -1;
    gap: 16px;
    padding: 8px 0;

    &-row {
      display: grid;
      grid-template-columns: 96px 1fr 132px;
      gap: 16px;
      align-items: center;
    }

    &-cell {
      height: 32px;
      background: var(--el-fill-color-light);
      border-radius: 4px;
      animation: store-config-skeleton 1.4s ease-in-out infinite;

      &.is-label {
        height: 20px;
      }

      &.is-short {
        justify-self: end;
        width: 96px;
      }
    }
  }

  &__footer {
    position: sticky;
    bottom: 0;
    z-index: 1;
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: flex-end;
    padding: 12px 16px;
    margin-top: 12px;
    background: var(--el-bg-color);
    border-top: 1px solid var(--el-border-color-lighter);
  }

  &__footer-status {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    margin-right: auto;
    font-size: 13px;
    color: var(--el-text-color-secondary);

    .is-dirty {
      color: var(--el-color-warning);
    }

    .is-clean {
      color: var(--el-color-success);
    }
  }
}

@keyframes store-config-skeleton {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.5;
  }
}

@media (prefers-reduced-motion: reduce) {
  .store-config__skeleton-cell {
    animation: none;
  }
}
</style>
