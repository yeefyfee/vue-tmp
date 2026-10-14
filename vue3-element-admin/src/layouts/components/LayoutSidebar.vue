<template>
  <el-menu
    ref="menuRef"
    class="layout-sidebar__menu"
    :class="{ 'is-collapsed': isCollapsed }"
    :default-active="activeMenuPath"
    :collapse="isCollapsed"
    :background-color="menuThemeProps.backgroundColor"
    :text-color="menuThemeProps.textColor"
    :active-text-color="menuThemeProps.activeTextColor"
    :popper-effect="theme"
    :unique-opened="false"
    :collapse-transition="false"
    :mode="menuMode"
    @open="onMenuOpen"
    @close="onMenuClose"
  >
    <!-- 六组一级导航（01-04）：分组由账号实际拿到的路由派生，无权限整组隐藏 -->
    <template v-if="useGroupedMenu">
      <el-menu-item-group v-for="group in navGroups" :key="group.key">
        <template #title>
          <span class="layout-sidebar__group-title">
            {{ translateRouteTitle(group.titleKey) }}
          </span>
        </template>
        <LayoutSidebarItem
          v-for="route in group.routes"
          :key="route.path"
          :item="route"
          :base-path="resolveFullPath(route.path)"
        />
      </el-menu-item-group>
    </template>

    <template v-else>
      <LayoutSidebarItem
        v-for="route in data"
        :key="route.path"
        :item="route"
        :base-path="resolveFullPath(route.path)"
      />
    </template>
  </el-menu>
</template>

<script lang="ts" setup>
import { useRoute } from "vue-router";
import path from "path-browserify";
import type { MenuInstance } from "element-plus";
import type { RouteRecordRaw } from "vue-router";
import { SidebarColor, ThemeMode } from "@/enums/settings";
import { useSettingsStore, useAppStore } from "@/stores";
import { isExternal } from "@/utils/index";
import { buildNavGroups } from "@/constants/navigation";
import { translateRouteTitle } from "@/lang/utils";
import LayoutSidebarItem from "./LayoutSidebarItem.vue";
import variables from "@/styles/variables.module.scss";
const props = defineProps({
  data: {
    type: Array as PropType<RouteRecordRaw[]>,
    default: () => [],
  },
  basePath: {
    type: String,
    required: true,
    example: "/system",
  },
  menuMode: {
    type: String as PropType<"vertical" | "horizontal">,
    default: "vertical",
    validator: (value: string) => ["vertical", "horizontal"].includes(value),
  },
  /** 强制展开，忽略全局 sidebar.opened 状态（DoubleLayout 第二列需要始终展开） */
  alwaysExpand: {
    type: Boolean,
    default: false,
  },
  /** 显式覆盖 collapse 状态，优先级高于 alwaysExpand 和全局 sidebar.opened */
  collapseOverride: {
    type: Boolean,
    default: null,
  },
  /**
   * 按「六组一级导航」分组渲染（MVP-WEB-01-04）
   *
   * 分组由账号实际拿到的路由派生（`buildNavGroups`），无路由的分组不渲染；
   * 关闭时保持原平铺行为（双列 / 顶部 / 混合布局的二级列沿用）。
   */
  grouped: {
    type: Boolean,
    default: false,
  },
});

const menuRef = ref<MenuInstance>();
const settingsStore = useSettingsStore();
const appStore = useAppStore();
const currentRoute = useRoute();

const expandedMenuIndexes = ref<string[]>([]);

/** 折叠态（图标态）：显式覆盖 > 强制展开 > 全局侧栏状态 */
const isCollapsed = computed(
  () => props.collapseOverride ?? (props.alwaysExpand ? false : !appStore.sidebar.opened)
);

/** 六组导航分组（按账号实际拿到的路由派生，空分组不产出） */
const navGroups = computed(() => buildNavGroups(props.data));

/** 是否启用分组渲染：显式开启且确有可渲染分组 */
const useGroupedMenu = computed(() => props.grouped && navGroups.value.length > 0);

const theme = computed(() => settingsStore.resolvedTheme);

const sidebarColorScheme = computed(() => settingsStore.sidebarColorScheme);

const menuThemeProps = computed(() => {
  const isDarkOrClassicBlue =
    theme.value === ThemeMode.DARK || sidebarColorScheme.value === SidebarColor.CLASSIC_BLUE;

  return {
    backgroundColor: isDarkOrClassicBlue ? variables["menu-background"] : undefined,
    textColor: isDarkOrClassicBlue ? variables["menu-text"] : undefined,
    activeTextColor: isDarkOrClassicBlue ? variables["menu-active-text"] : undefined,
  };
});

const activeMenuPath = computed((): string => {
  const { meta, path } = currentRoute;

  if (meta?.activeMenu && typeof meta.activeMenu === "string") {
    return meta.activeMenu;
  }

  return path;
});

/**
 * 解析菜单跳转路径
 */
function resolveFullPath(routePath: string) {
  if (isExternal(routePath)) {
    return routePath;
  }
  if (isExternal(props.basePath)) {
    return props.basePath;
  }

  if (!props.basePath || props.basePath === "") {
    return routePath;
  }

  return path.resolve(props.basePath, routePath);
}

/**
 * 记录展开的子菜单
 */
const onMenuOpen = (index: string) => {
  if (expandedMenuIndexes.value.includes(index)) return;
  expandedMenuIndexes.value.push(index);
};

/**
 * 移除已收起的子菜单
 */
const onMenuClose = (index: string) => {
  expandedMenuIndexes.value = expandedMenuIndexes.value.filter((item) => item !== index);
};

/**
 * 展开状态变化后同步父级菜单激活态
 */
watch(
  () => expandedMenuIndexes.value,
  () => {
    syncActiveParentMenus();
  }
);

/**
 * 水平菜单切换时收起弹出的垂直菜单
 */
watch(
  () => props.menuMode,
  (newMode) => {
    if (newMode === "horizontal" && menuRef.value) {
      expandedMenuIndexes.value.forEach((item) => menuRef.value!.close(item));
    }
  }
);

/**
 * 路由激活项变化后同步父级菜单激活态
 */
watch(
  () => activeMenuPath.value,
  () => {
    nextTick(() => {
      syncActiveParentMenus();
    });
  },
  { immediate: true }
);

/**
 * TagsView 切换时重新计算父级菜单激活态
 */
watch(
  () => currentRoute.path,
  () => {
    nextTick(() => {
      syncActiveParentMenus();
    });
  }
);

/**
 * 标记包含当前路由的父级菜单
 */
function syncActiveParentMenus() {
  if (!menuRef.value?.$el) return;

  nextTick(() => {
    try {
      const menuEl = menuRef.value?.$el as HTMLElement;
      if (!menuEl) return;

      const allSubMenus = menuEl.querySelectorAll(".el-sub-menu");
      allSubMenus.forEach((subMenu) => {
        subMenu.classList.remove("has-active-child");
      });

      const activeMenuItem = menuEl.querySelector(".el-menu-item.is-active");

      if (activeMenuItem) {
        let parent = activeMenuItem.parentElement;
        while (parent && parent !== menuEl) {
          if (parent.classList.contains("el-sub-menu")) {
            parent.classList.add("has-active-child");
          }
          parent = parent.parentElement;
        }
        return;
      }

      if (props.menuMode !== "horizontal") return;

      const currentPath = activeMenuPath.value;
      allSubMenus.forEach((subMenu) => {
        const subMenuEl = subMenu as HTMLElement;
        const subMenuPath =
          subMenuEl.getAttribute("data-path") ||
          subMenuEl.querySelector(".el-sub-menu__title")?.getAttribute("data-path");

        if (subMenuPath && currentPath.startsWith(subMenuPath)) {
          subMenuEl.classList.add("has-active-child");
        }
      });
    } catch (error) {
      console.error("Error updating parent menu styles:", error);
    }
  });
}

/**
 * 首次挂载后同步父级菜单激活态
 */
onMounted(() => {
  syncActiveParentMenus();
});
</script>

<style lang="scss" scoped>
/* ── 六组一级导航分组标题（MVP-WEB-01-04） ── */
.layout-sidebar__group-title {
  display: inline-block;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--el-text-color-secondary);
  letter-spacing: 0.04em;
}

:deep(.el-menu-item-group__title) {
  padding: 14px 12px 6px;
  line-height: 1.4;
}

/* 折叠为图标态时隐藏分组标题，避免与图标挤压 */
.layout-sidebar__menu.is-collapsed :deep(.el-menu-item-group__title) {
  display: none;
}

/* 相邻分组之间留白，形成六组的视觉层次 */
:deep(.el-menu-item-group + .el-menu-item-group) {
  margin-top: 2px;
}
</style>
