<template>
  <div :class="['layout-tabs', tabsStyleClass]">
    <el-scrollbar
      ref="scrollbarRef"
      class="layout-tabs__scroll"
      :view-style="{ height: '100%' }"
      @wheel="handleScroll"
    >
      <!-- 拖拽排序（PRD §多标签页策略 第 3 条）：常驻标签（affix）锁定在最前，不可被拖出首位 -->
      <VueDraggable
        v-model="orderedViews"
        class="layout-tabs__list"
        :animation="160"
        filter=".is-affix"
        ghost-class="layout-tabs__item--ghost"
        drag-class="layout-tabs__item--drag"
        :on-move="handleDragMove"
      >
        <div
          v-for="tag in orderedViews"
          :key="tag.key"
          class="layout-tabs__item"
          :class="{
            'is-active': tagsViewStore.isActive(tag),
            'is-affix': tag.affix,
            'is-pinned': tag.pinned,
            'is-dirty': tagsViewStore.isDirty(tag.key),
          }"
          @click="openTag(tag)"
          @click.middle="handleMiddleClick(tag)"
          @contextmenu.prevent="openContextMenu(tag, $event)"
        >
          <template v-if="tag.icon">
            <el-icon v-if="isEpIcon(tag.icon)" :size="14">
              <component :is="toEpIconName(tag.icon)" />
            </el-icon>
            <span v-else class="layout-tabs__item-icon" :class="`i-svg:${tag.icon}`" />
          </template>
          <!-- 钉住标记（≤3，PRD 第 3 条） -->
          <el-icon v-if="tag.pinned" class="layout-tabs__item-pin" :size="12">
            <StarFilled />
          </el-icon>
          <span class="layout-tabs__item-text">
            {{ translateRouteTitle(tag.title) }}
          </span>
          <!-- 未保存修改标记（PRD 第 4 条）：点击关闭时会二次确认 -->
          <span
            v-if="tagsViewStore.isDirty(tag.key)"
            class="layout-tabs__item-dot"
            :title="t('tab.dirty')"
          />
          <span
            v-if="!tag.affix"
            class="layout-tabs__item-close"
            @click.stop="closeSelectedTag(tag)"
          >
            <div class="i-svg:close" />
          </span>
        </div>
      </VueDraggable>
    </el-scrollbar>

    <div class="layout-tabs__actions">
      <button
        type="button"
        class="layout-tabs__action"
        :aria-label="t('tab.refresh')"
        :title="t('tab.refresh')"
        @click="refreshSelectedTag(currentTag)"
      >
        <el-icon :size="16"><Refresh /></el-icon>
      </button>
      <button
        type="button"
        class="layout-tabs__action"
        aria-label="内容全屏"
        title="内容全屏"
        @click="appStore.toggleContentFullscreen()"
      >
        <div v-if="!appStore.contentFullscreen" class="i-svg:fullscreen icon-16" />
        <div v-else class="i-svg:fullscreen-exit icon-16" />
      </button>
      <el-dropdown trigger="click" @command="handleActionCommand">
        <button type="button" class="layout-tabs__action" aria-label="页签操作" title="页签操作">
          <el-icon :size="16"><ArrowDown /></el-icon>
        </button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="refresh">
              <el-icon :size="14" class="icon-14"><Refresh /></el-icon>
              <span>{{ t("tab.refresh") }}</span>
            </el-dropdown-item>
            <el-dropdown-item v-if="currentTag && !currentTag.affix" command="togglePin">
              <el-icon :size="14" class="icon-14">
                <StarFilled v-if="currentTag.pinned" />
                <Star v-else />
              </el-icon>
              <span>{{ currentTag.pinned ? t("tab.unpin") : t("tab.pin") }}</span>
            </el-dropdown-item>
            <el-dropdown-item v-if="currentTag && !currentTag.affix" command="closeCurrent">
              <div class="i-svg:close icon-14" />
              <span>{{ t("tab.closeCurrent") }}</span>
            </el-dropdown-item>
            <el-dropdown-item divided command="closeOtherTags">
              <div class="i-svg:close_other icon-14" />
              <span>{{ t("tab.closeOther") }}</span>
            </el-dropdown-item>
            <el-dropdown-item command="closeLeftTags">
              <div class="i-svg:close_left icon-14" />
              <span>{{ t("tab.closeLeft") }}</span>
            </el-dropdown-item>
            <el-dropdown-item command="closeRightTags">
              <div class="i-svg:close_right icon-14" />
              <span>{{ t("tab.closeRight") }}</span>
            </el-dropdown-item>
            <el-dropdown-item divided command="closeAllTags">
              <div class="i-svg:close_all icon-14" />
              <span>{{ t("tab.closeAll") }}</span>
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <Teleport to="body">
      <ul v-show="contextMenu.visible" class="layout-tabs-menu" :style="contextMenuStyle">
        <li @click="refreshSelectedTag(selectedTag)">
          <el-icon :size="16" class="layout-tabs-menu__icon"><Refresh /></el-icon>
          <span>{{ t("tab.refresh") }}</span>
        </li>
        <li v-if="selectedTag && !selectedTag.affix" @click="togglePin(selectedTag)">
          <el-icon :size="16" class="layout-tabs-menu__icon">
            <StarFilled v-if="selectedTag.pinned" />
            <Star v-else />
          </el-icon>
          <span>{{ selectedTag.pinned ? t("tab.unpin") : t("tab.pin") }}</span>
        </li>
        <li
          v-if="selectedTag && !selectedTag.affix"
          class="layout-tabs-menu__danger"
          @click="closeSelectedTag(selectedTag)"
        >
          <div class="i-svg:close layout-tabs-menu__icon" />
          <span>{{ t("tab.closeCurrent") }}</span>
        </li>
        <li class="layout-tabs-menu__divider" />
        <li @click="closeOtherTags">
          <div class="i-svg:close_other layout-tabs-menu__icon" />
          <span>{{ t("tab.closeOther") }}</span>
        </li>
        <li v-if="hasClosableLeft" @click="closeLeftTags">
          <div class="i-svg:close_left layout-tabs-menu__icon" />
          <span>{{ t("tab.closeLeft") }}</span>
        </li>
        <li v-if="hasClosableRight" @click="closeRightTags">
          <div class="i-svg:close_right layout-tabs-menu__icon" />
          <span>{{ t("tab.closeRight") }}</span>
        </li>
        <li class="layout-tabs-menu__divider" />
        <li @click="closeAllTags(selectedTag)">
          <div class="i-svg:close_all layout-tabs-menu__icon" />
          <span>{{ t("tab.closeAll") }}</span>
        </li>
      </ul>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { useRoute, useRouter, type RouteRecordRaw } from "vue-router";
import { useI18n } from "vue-i18n";
import { resolve } from "path-browserify";
import { VueDraggable } from "vue-draggable-plus";
import { ArrowDown, Refresh, Star, StarFilled } from "@element-plus/icons-vue";
import type { MoveEvent } from "sortablejs";
import { TagsViewStyle } from "@/enums";
import { translateRouteTitle } from "@/lang/utils";
import { useAppStore, usePermissionStore, useSettingsStore, useTagsViewStore } from "@/stores";
import { resolveTabKey, type TagView } from "@/stores/tags-view";
import { isExternal } from "@/utils";

interface ContextMenu {
  visible: boolean;
  x: number;
  y: number;
}

const router = useRouter();
const route = useRoute();
const { t } = useI18n();

const appStore = useAppStore();
const permissionStore = usePermissionStore();
const settingsStore = useSettingsStore();
const tagsViewStore = useTagsViewStore();

const { visitedViews } = storeToRefs(tagsViewStore);

/** 拖拽排序的可写视图（直接落到 store） */
const orderedViews = computed<TagView[]>({
  get: () => visitedViews.value,
  set: (value) => tagsViewStore.setOrder(value),
});

const selectedTag = ref<TagView | null>(null);

const contextMenu = reactive<ContextMenu>({
  visible: false,
  x: 0,
  y: 0,
});

const scrollbarRef = ref();

const currentTag = computed(() => {
  return visitedViews.value.find((tag) => tagsViewStore.isActive(tag)) || null;
});

const tabsStyleClass = computed(() => {
  switch (settingsStore.tagsViewStyle) {
    case TagsViewStyle.CARD:
      return "layout-tabs--card";
    case TagsViewStyle.LINE:
    default:
      return "layout-tabs--line";
  }
});

const isEpIcon = (icon: string) => icon.startsWith("el-icon");

const toEpIconName = (icon: string) =>
  icon.replace("el-icon-", "").replace(/(^|-)\w/g, (s) => s.slice(-1).toUpperCase());

const contextMenuStyle = computed(() => {
  const menuWidth = 160;
  const menuHeight = 260;
  const padding = 8;

  let x = contextMenu.x;
  let y = contextMenu.y;

  if (x + menuWidth > window.innerWidth) {
    x = window.innerWidth - menuWidth - padding;
  }
  if (y + menuHeight > window.innerHeight) {
    y = window.innerHeight - menuHeight - padding;
  }

  return {
    left: `${Math.max(padding, x)}px`,
    top: `${Math.max(padding, y)}px`,
  };
});

/** 常驻 / 钉住标签豁免批量关闭（与 store 侧同口径） */
const isProtectedTag = (tag: TagView) => Boolean(tag.affix || tag.pinned);

const selectedIndex = computed(() =>
  selectedTag.value
    ? orderedViews.value.findIndex((item) => item.key === selectedTag.value?.key)
    : -1
);

const hasClosableLeft = computed(() =>
  orderedViews.value.slice(0, Math.max(selectedIndex.value, 0)).some((tag) => !isProtectedTag(tag))
);

const hasClosableRight = computed(() =>
  selectedIndex.value < 0
    ? false
    : orderedViews.value.slice(selectedIndex.value + 1).some((tag) => !isProtectedTag(tag))
);

/** 待关闭集合中是否存在未保存修改 */
const collectDirty = (targets: TagView[]) =>
  targets.filter((tag) => tagsViewStore.isDirty(tag.key));

/**
 * 关闭前守卫（PRD 第 4 条）
 *
 * 待关闭集合中含未保存修改的标签时，弹二次确认（文案固定「当前有未保存的修改」）；
 * 用户确认放弃 → 先清脏（避免随后的路由离开再弹一次），取消 → 整体中止关闭。
 */
const ensureCloseAllowed = async (targets: TagView[]): Promise<boolean> => {
  const dirty = collectDirty(targets);
  if (dirty.length === 0) return true;

  try {
    await ElMessageBox.confirm(t("tab.unsavedContent"), t("tab.unsavedTitle"), {
      confirmButtonText: t("tab.unsavedConfirm"),
      cancelButtonText: t("tab.unsavedCancel"),
      type: "warning",
    });
  } catch {
    return false;
  }

  dirty.forEach((tag) => tagsViewStore.markClean(tag.key));
  return true;
};

/** 钉住 / 取消钉住（上限 3，超出给提示） */
const togglePin = (tag: TagView | null) => {
  if (!tag || tag.affix) return;
  if (tag.pinned) {
    tagsViewStore.unpinView(tag);
    return;
  }
  const result = tagsViewStore.pinView(tag);
  if (!result.ok && result.reason === "limit") {
    ElMessage.warning(t("tab.pinLimit"));
  }
};

const handleDragMove = (event: MoveEvent) => {
  const draggedAffix = event.dragged?.classList?.contains("is-affix");
  const relatedAffix = event.related?.classList?.contains("is-affix");
  // 常驻标签可互相换位，但普通标签不得落到常驻标签之前
  if (draggedAffix) return Boolean(relatedAffix);
  return !relatedAffix;
};

const handleActionCommand = async (command: string) => {
  switch (command) {
    case "refresh":
      refreshSelectedTag(currentTag.value);
      break;
    case "togglePin":
      togglePin(currentTag.value);
      break;
    case "closeCurrent":
      await closeSelectedTag(currentTag.value);
      break;
    case "closeOtherTags":
      await closeOtherTagsForActive();
      break;
    case "closeLeftTags":
      await closeLeftTagsForActive();
      break;
    case "closeRightTags":
      await closeRightTagsForActive();
      break;
    case "closeAllTags":
      await closeAllTags(currentTag.value);
      break;
  }
};

const extractAffixTags = (routes: RouteRecordRaw[], basePath = "/"): TagView[] => {
  const affixTags: TagView[] = [];

  const traverse = (routeList: RouteRecordRaw[], currentBasePath: string) => {
    routeList.forEach((item) => {
      const fullPath = resolve(currentBasePath, item.path);

      if (item.meta?.affix) {
        affixTags.push({
          key: resolveTabKey({ path: fullPath, fullPath, meta: item.meta }),
          path: fullPath,
          fullPath,
          name: String(item.name || ""),
          title: item.meta.title || "no-name",
          icon: item.meta.icon,
          affix: true,
          keepAlive: item.meta.keepAlive || false,
        });
      }

      if (item.children?.length) {
        traverse(item.children, fullPath);
      }
    });
  };

  traverse(routes, basePath);
  return affixTags;
};

const initAffixTags = () => {
  const affixTags = extractAffixTags(permissionStore.routes);

  affixTags.forEach((tag) => {
    if (tag.name) {
      tagsViewStore.addVisitedView(tag);
    }
  });
};

const addCurrentTag = () => {
  if (!route.meta?.title) return;
  if (isExternal(route.path) || isExternal(route.fullPath)) return;

  const result = tagsViewStore.addView({
    key: resolveTabKey(route),
    name: route.name as string,
    title: route.meta.title,
    path: route.path,
    fullPath: route.fullPath,
    icon: route.meta.icon,
    affix: route.meta.affix || false,
    keepAlive: route.meta.keepAlive || false,
    multi: route.meta.tabMode === "detail",
    query: route.query,
  });

  // LRU 淘汰提示（PRD 第 2 条：超出上限按最久未访问提示关闭）
  if (result?.evicted) {
    ElMessage.warning(t("tab.limitEvicted", { name: translateRouteTitle(result.evicted.title) }));
  }
};

const openTag = (tag: TagView) => {
  if (isExternal(tag.fullPath)) {
    window.open(tag.fullPath, "_blank", "noopener,noreferrer");
    return;
  }

  router.push({
    path: tag.fullPath,
    query: tag.query,
  });
};

const updateCurrentTag = () => {
  nextTick(() => {
    const current = orderedViews.value.find((tag) => tag.key === resolveTabKey(route));

    if (current && current.fullPath !== route.fullPath) {
      tagsViewStore.updateVisitedView({
        key: resolveTabKey(route),
        name: route.name as string,
        title: route.meta?.title || "",
        path: route.path,
        fullPath: route.fullPath,
        icon: route.meta?.icon,
        affix: route.meta?.affix || false,
        keepAlive: route.meta?.keepAlive || false,
        multi: route.meta?.tabMode === "detail",
        query: route.query,
      });
    }
  });
};

const handleMiddleClick = (tag: TagView) => {
  if (!tag.affix) {
    closeSelectedTag(tag);
  }
};

const openContextMenu = (tag: TagView, event: MouseEvent) => {
  contextMenu.x = event.clientX;
  contextMenu.y = event.clientY;
  contextMenu.visible = true;
  selectedTag.value = tag;
};

const closeContextMenu = () => {
  contextMenu.visible = false;
};

const handleScroll = (event: WheelEvent) => {
  closeContextMenu();

  const scrollWrapper = scrollbarRef.value?.wrapRef;
  if (!scrollWrapper) return;

  const hasHorizontalScroll = scrollWrapper.scrollWidth > scrollWrapper.clientWidth;
  if (!hasHorizontalScroll) return;

  const legacyEvent = event as WheelEvent & { wheelDelta?: number };
  const deltaY = event.deltaY || -(legacyEvent.wheelDelta ?? 0);
  const newScrollLeft = scrollWrapper.scrollLeft + deltaY;

  scrollbarRef.value.setScrollLeft(newScrollLeft);
};

const refreshSelectedTag = (tag: TagView | null) => {
  if (!tag) return;

  tagsViewStore.delCachedView(tag);
  nextTick(() => {
    router.replace("/redirect" + tag.fullPath);
  });
};

const closeSelectedTag = async (tag: TagView | null) => {
  if (!tag) return;
  if (!(await ensureCloseAllowed([tag]))) return;

  tagsViewStore.delView(tag).then((result) => {
    if (tagsViewStore.isActive(tag)) {
      tagsViewStore.toLastView(result.visitedViews, tag);
    }
  });
};

/**
 * 关闭指定方向的标签
 */
async function closeDirectionalTags(
  source: Ref<TagView | null>,
  batchFn: (tag: TagView) => Promise<{ visitedViews: TagView[] }>,
  pickTargets: (tag: TagView) => TagView[]
) {
  const tag = source.value;
  if (!tag) return;
  if (!(await ensureCloseAllowed(pickTargets(tag)))) return;

  batchFn(tag).then(({ visitedViews: rest }) => {
    const stillVisible = rest.some((item) => item.key === resolveTabKey(route));
    if (!stillVisible) {
      tagsViewStore.toLastView(rest);
    }
  });
}

/** 关闭当前激活标签之外的其它标签 */
const closeOtherTagsForActive = async () => {
  if (!currentTag.value) return;
  if (!(await ensureCloseAllowed(pickOtherTargets(currentTag.value)))) return;
  tagsViewStore.delOtherViews(currentTag.value).then(() => {
    updateCurrentTag();
  });
};

const pickLeftTargets = (tag: TagView) => {
  const index = orderedViews.value.findIndex((item) => item.key === tag.key);
  if (index < 0) return [];
  return orderedViews.value.slice(0, index).filter((item) => !isProtectedTag(item));
};

const pickRightTargets = (tag: TagView) => {
  const index = orderedViews.value.findIndex((item) => item.key === tag.key);
  if (index < 0) return [];
  return orderedViews.value.slice(index + 1).filter((item) => !isProtectedTag(item));
};

const pickOtherTargets = (tag: TagView) =>
  orderedViews.value.filter((item) => item.key !== tag.key && !isProtectedTag(item));

const closeLeftTagsForActive = () =>
  closeDirectionalTags(currentTag, tagsViewStore.delLeftViews, pickLeftTargets);
const closeRightTagsForActive = () =>
  closeDirectionalTags(currentTag, tagsViewStore.delRightViews, pickRightTargets);
const closeLeftTags = () =>
  closeDirectionalTags(selectedTag, tagsViewStore.delLeftViews, pickLeftTargets);
const closeRightTags = () =>
  closeDirectionalTags(selectedTag, tagsViewStore.delRightViews, pickRightTargets);

const closeOtherTags = async () => {
  if (!selectedTag.value) return;
  if (!(await ensureCloseAllowed(pickOtherTargets(selectedTag.value)))) return;
  router.push(selectedTag.value);
  tagsViewStore.delOtherViews(selectedTag.value).then(() => {
    updateCurrentTag();
  });
};

const closeAllTags = async (tag: TagView | null) => {
  const targets = orderedViews.value.filter((item) => !isProtectedTag(item));
  if (!(await ensureCloseAllowed(targets))) return;

  tagsViewStore.delAllViews().then((result) => {
    tagsViewStore.toLastView(result.visitedViews, tag || undefined);
  });
};

const useContextMenuManager = () => {
  const handleOutsideClick = () => {
    closeContextMenu();
  };

  watchEffect(() => {
    if (contextMenu.visible) {
      document.addEventListener("click", handleOutsideClick);
    } else {
      document.removeEventListener("click", handleOutsideClick);
    }
  });

  onBeforeUnmount(() => {
    document.removeEventListener("click", handleOutsideClick);
  });
};

watch(
  route,
  () => {
    addCurrentTag();
    updateCurrentTag();
  },
  { immediate: true }
);

onMounted(() => {
  initAffixTags();
  // 刷新后只恢复钉住标签（PRD 第 7 条）；已失效 / 无权限的历史钉住项直接丢弃
  tagsViewStore.restorePinned((view) => {
    try {
      return router.resolve(view.fullPath).matched.length > 0;
    } catch {
      return false;
    }
  });
});

useContextMenuManager();
</script>

<style lang="scss" scoped>
.layout-tabs {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  width: 100%;
  height: $tags-view-height;
  padding: 0 12px;
  background-color: var(--content-bg);
  border-bottom: 1px solid var(--card-border);
}

.layout-tabs__scroll {
  flex: 1;
  min-width: 0;
  height: 100%;

  :deep(.el-scrollbar__wrap) {
    overflow-y: hidden;
  }
}

.layout-tabs__list {
  display: flex;
  gap: 4px;
  align-items: center;
  height: 100%;
}

.layout-tabs__item {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
  gap: 6px;
  align-items: center;
  height: 26px;
  padding: 0 12px;
  font-size: 13px;
  color: var(--el-text-color-regular);
  cursor: pointer;
  user-select: none;
  background: #f8fafc;
  border: 1px solid var(--card-border);
  border-radius: 2px;
  transition:
    color 0.15s ease,
    background-color 0.15s ease,
    border-color 0.15s ease;

  &-icon {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    opacity: 0.5;
    transition: opacity 0.15s ease;
  }

  /* 钉住标记 */
  &-pin {
    flex-shrink: 0;
    color: var(--el-color-primary);
  }

  &-text {
    white-space: nowrap;
  }

  /* 未保存修改标记（状态点，非功能性图标） */
  &-dot {
    flex-shrink: 0;
    width: 6px;
    height: 6px;
    background: var(--el-color-warning);
    border-radius: 50%;
  }

  &-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    margin-left: 1px;
    font-size: 0;
    border-radius: 4px;
    opacity: 0;
    transition:
      opacity 0.12s ease,
      background-color 0.12s ease;

    :deep(div) {
      width: 12px;
      height: 12px;
    }

    &:hover {
      background-color: rgb(0 0 0 / 10%);
    }
  }

  &:hover {
    color: var(--el-text-color-primary);
    background-color: var(--content-bg);
    border-color: var(--el-border-color);

    .layout-tabs__item-close {
      opacity: 1;
    }

    .layout-tabs__item-icon {
      opacity: 0.7;
    }
  }

  &.is-active {
    font-weight: 500;
    color: var(--el-color-primary);
    background-color: var(--content-bg);
    border-color: var(--el-color-primary-light-5);

    .layout-tabs__item-icon {
      color: var(--el-color-primary);
      opacity: 1;
    }

    .layout-tabs__item-close {
      opacity: 0.6;

      &:hover {
        background-color: var(--el-color-primary-light-7);
        opacity: 1;
      }
    }
  }

  &.is-affix {
    .layout-tabs__item-text {
      font-weight: 500;
    }
  }

  &.is-pinned .layout-tabs__item-text {
    font-weight: 500;
  }

  /* 拖拽反馈 */
  &--ghost {
    background: var(--el-color-primary-light-9);
    border-color: var(--el-color-primary-light-5);
    opacity: 0.6;
  }

  &--drag {
    box-shadow: var(--el-box-shadow-light);
  }
}

.layout-tabs--line {
  .layout-tabs__list {
    gap: 8px;
  }

  .layout-tabs__item {
    height: 100%;
    padding: 0 8px;
    color: var(--el-text-color-secondary);
    background: transparent;
    border: 0;
    border-radius: 0;

    &::after {
      position: absolute;
      right: 6px;
      bottom: 0;
      left: 6px;
      height: 2px;
      content: "";
      background: var(--el-color-primary);
      transform: scaleX(0);
      transform-origin: center;
      transition: transform 0.16s ease;
    }

    &:hover {
      color: var(--el-text-color-primary);
      background: var(--el-fill-color-lighter);
      border-color: transparent;
      border-radius: 4px 4px 0 0;
    }

    &.is-active {
      color: var(--el-color-primary);
      background: transparent;
      border-color: transparent;

      &::after {
        transform: scaleX(1);
      }
    }
  }
}

.layout-tabs--card {
  .layout-tabs__list {
    gap: 8px;
  }

  .layout-tabs__item {
    height: 28px;
    padding: 0 10px;
    color: var(--el-text-color-secondary);
    background: transparent;
    border-color: transparent;
    border-radius: 4px;

    &:hover {
      color: var(--el-text-color-primary);
      background: var(--el-fill-color-lighter);
      border-color: transparent;
    }

    &.is-active {
      color: var(--el-color-primary);
      background: var(--el-color-primary-light-9);
      border-color: var(--el-color-primary-light-6);
    }
  }
}

.layout-tabs__actions {
  display: flex;
  flex-shrink: 0;
  gap: 4px;
  align-items: center;
  height: 100%;
  padding-left: 8px;

  .layout-tabs__action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    padding: 0;
    font: inherit;
    color: var(--el-text-color-regular);
    appearance: none;
    cursor: pointer;
    background: transparent;
    border: 0;
    border-radius: 6px;
    transition:
      color 0.15s ease,
      background-color 0.15s ease;

    &:hover {
      color: var(--el-color-primary);
      background-color: color-mix(in srgb, var(--el-color-primary) 10%, transparent);
    }

    &:focus-visible {
      outline: 2px solid var(--el-color-primary-light-5);
      outline-offset: 1px;
    }

    :deep(.el-icon) {
      color: currentcolor;
      --color: currentcolor;
    }

    .icon-16 {
      color: currentcolor;
      background-color: currentcolor;
    }
  }
}

.icon-16 {
  width: 16px;
  height: 16px;
}

.icon-14 {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  margin-right: 6px;
  opacity: 0.55;

  &.el-icon {
    width: 14px;
    height: 14px;
  }
}

.layout-tabs-menu {
  position: fixed;
  z-index: 3000;
  min-width: 150px;
  padding: 6px;
  margin: 0;
  font-size: 13px;
  color: var(--el-text-color-primary);
  list-style-type: none;
  background: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  box-shadow: var(--el-box-shadow);

  li {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 7px 10px;
    margin: 1px 0;
    cursor: pointer;
    border-radius: 6px;
    transition: background-color 0.15s ease;

    &:hover {
      background: var(--el-fill-color-light);
    }
  }

  &__icon {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    opacity: 0.55;
  }

  &__danger {
    &:hover {
      color: var(--el-color-danger);
      background-color: var(--el-color-danger-light-9);

      .layout-tabs-menu__icon {
        opacity: 1;
      }
    }
  }

  &__divider {
    height: 1px;
    padding: 0 !important;
    margin: 5px 8px !important;
    pointer-events: none;
    cursor: default !important;
    background-color: var(--el-border-color-lighter);

    &:hover {
      background-color: var(--el-border-color-lighter) !important;
    }
  }
}
</style>
