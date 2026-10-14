<template>
  <div :class="['layout-toolbar', toolbarToneClass]">
    <template v-if="isDesktop">
      <!-- 门店切换器（多店账号）：无可用门店时不渲染（《Design Principles》体验底线） -->
      <StoreSwitcher class="layout-toolbar__store" />

      <div class="layout-toolbar__item layout-toolbar__item--search">
        <CommandPalette />
      </div>

      <div class="layout-toolbar__item">
        <Fullscreen />
      </div>

      <div class="layout-toolbar__item">
        <SizeSelect />
      </div>

      <div class="layout-toolbar__item">
        <LangSelect />
      </div>
    </template>

    <div class="layout-toolbar__item layout-toolbar__item--profile">
      <el-dropdown trigger="click">
        <div class="layout-user" :title="userTitle">
          <div class="layout-user__avatar">
            <img
              v-if="avatarUrl"
              :src="avatarUrl"
              class="layout-user__avatar-img"
              :alt="displayName"
            />
            <!-- 未设置头像时以首字母占位：空 src 会让浏览器渲染成破图 -->
            <span v-else class="layout-user__avatar-text">{{ avatarInitial }}</span>
          </div>
          <span class="layout-user__name">{{ displayName }}</span>
        </div>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item @click="handleProfileClick">
              {{ t("navbar.profile") }}
            </el-dropdown-item>
            <el-dropdown-item divided @click="logout">
              {{ t("navbar.logout") }}
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <div v-if="defaults.showSettings" class="layout-toolbar__item" @click="handleSettingsClick">
      <div class="i-svg:setting" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { defaults } from "@/settings";
import { DeviceEnum, SidebarColor, ThemeMode, LayoutMode } from "@/enums/settings";
import { useAppStore, useSettingsStore, useUserStore } from "@/stores";

import CommandPalette from "@/components/CommandPalette/index.vue";
import Fullscreen from "@/components/Fullscreen/index.vue";
import SizeSelect from "@/components/SizeSelect/index.vue";
import LangSelect from "@/components/LangSelect/index.vue";
import StoreSwitcher from "@/components/StoreSwitcher/index.vue";

const { t } = useI18n();
const appStore = useAppStore();
const settingStore = useSettingsStore();
const userStore = useUserStore();

const route = useRoute();
const router = useRouter();

const isDesktop = computed(() => appStore.device === DeviceEnum.DESKTOP);

/** 展示名：昵称优先、回退登录名（与工作台问候语、个人中心口径一致） */
const displayName = computed(
  () => userStore.userInfo.nickname || userStore.userInfo.username || ""
);

/** 头像地址；为空时不渲染 img，改由首字母占位 */
const avatarUrl = computed(() => userStore.userInfo.avatar || "");

/** 首字母占位（中文取首个字，英文取首字母大写） */
const avatarInitial = computed(() => {
  const name = displayName.value.trim();
  return name ? Array.from(name)[0].toUpperCase() : "?";
});

/** 悬浮提示：昵称 · 账号 · 角色 */
const userTitle = computed(() => {
  const { nickname, username, roleNames } = userStore.userInfo;
  return [nickname || username, nickname && username ? `@${username}` : "", roleNames]
    .filter(Boolean)
    .join(" · ");
});

/**
 * 打开个人中心页面
 */
function handleProfileClick() {
  router.push({ name: "Profile" });
}

const toolbarToneClass = computed(() => {
  const { resolvedTheme, sidebarColorScheme, layout } = settingStore;

  if (resolvedTheme === ThemeMode.DARK) {
    return "layout-toolbar--light";
  }

  const isHeaderMenuLayout = layout === LayoutMode.TOP || layout === LayoutMode.MIX;
  if (isHeaderMenuLayout && sidebarColorScheme === SidebarColor.CLASSIC_BLUE) {
    return "layout-toolbar--light";
  }

  return "layout-toolbar--dark";
});

/**
 * 退出登录
 */
function logout() {
  ElMessageBox.confirm("确定注销并退出系统吗？", "提示", {
    confirmButtonText: "确定",
    cancelButtonText: "取消",
    type: "warning",
    lockScroll: false,
  }).then(() => {
    userStore.logout().then(() => {
      // 登出接口 401 时拦截器已把用户送回登录页，此处不再重复导航
      // （否则会以登录页自身为 redirect 目标，产生嵌套参数）
      if (route.path === "/login") return;
      const redirect = ["/404", "/401"].includes(route.path) ? "/" : route.fullPath;
      router.push(`/login?redirect=${encodeURIComponent(redirect)}`);
    });
  });
}

/**
 * 打开系统设置页面
 */
function handleSettingsClick() {
  settingStore.settingsVisible = true;
}
</script>

<style lang="scss" scoped>
.layout-toolbar {
  --layout-toolbar-color: var(--el-text-color-secondary);
  --layout-toolbar-hover-color: var(--el-color-primary);
  --layout-toolbar-hover-bg: var(--el-fill-color-light);
  --layout-toolbar-divider: var(--el-border-color-lighter);

  display: flex;
  gap: 4px;
  align-items: center;
  min-height: 32px;

  /* 门店切换器与右侧工具项之间的分隔（01-03 顶部上下文栏） */
  &__store {
    padding-right: 8px;
    margin-right: 2px;
    border-right: 1px solid var(--layout-toolbar-divider);
  }

  &__item {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 32px;
    height: 32px;
    padding: 0 6px;
    color: var(--layout-toolbar-color);
    text-align: center;
    cursor: pointer;
    border-radius: 6px;
    transition:
      background-color 0.16s,
      color 0.16s;

    > [class*="i-svg:"] {
      display: flex;
      align-items: center;
      justify-content: center;
    }

    :deep(.el-dropdown),
    :deep(.el-tooltip) {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 32px;
      color: inherit !important;
    }

    :deep(.el-tooltip__trigger),
    :deep(.fullscreen-trigger),
    :deep(.size-trigger) {
      color: inherit;
    }

    :deep(.i-svg\:language) {
      flex-shrink: 0;
      width: 16px;
      height: 16px;
      font-size: 16px;
      line-height: 16px;
      background-size: 16px 16px;
    }

    :deep([class*="i-svg:"]),
    :deep(.el-icon) {
      --color: currentColor;

      font-size: 16px;
      line-height: 1;
      color: currentColor !important;
      transition: color 0.16s;
    }

    :deep([class*="i-svg:"]) {
      background-color: currentColor !important;
    }

    &:hover {
      color: var(--layout-toolbar-hover-color);
      background: var(--layout-toolbar-hover-bg);
    }
  }

  &__item--search {
    color: var(--el-text-color-secondary);

    &:hover {
      background: transparent;
    }
  }

  &__item--profile {
    padding-right: 4px;
    padding-left: 4px;

    &:hover {
      background: transparent;
    }
  }
}

.layout-user {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  padding: 0 6px 0 2px;

  &__avatar {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    overflow: hidden;
    background: var(--el-color-primary);
    border-radius: 50%;
  }

  &__avatar-text {
    font-size: 13px;
    font-weight: 600;
    line-height: 1;
    color: #fff;
    user-select: none;
  }

  &__avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
  }

  &__name {
    margin-left: 8px;
    font-size: 13px;
    color: currentColor;
    white-space: nowrap;
    transition: color 0.3s;
  }
}

.layout-toolbar--light {
  --layout-toolbar-color: var(--menu-text);
  --layout-toolbar-hover-color: var(--menu-active-text);
  --layout-toolbar-hover-bg: var(--menu-hover);
  --layout-toolbar-divider: rgb(255 255 255 / 24%);

  .layout-user__name {
    color: currentColor;
  }
}

.layout-toolbar--dark {
  --layout-toolbar-color: var(--el-text-color-secondary);
  --layout-toolbar-hover-color: var(--el-color-primary);
  --layout-toolbar-hover-bg: var(--el-fill-color-light);

  .layout-user__name {
    color: var(--el-text-color-regular);
  }
}

::v-deep(.el-dropdown-menu) {
  [class*="i-svg:"] {
    color: var(--el-text-color-regular) !important;

    &:hover {
      color: var(--el-color-primary) !important;
    }
  }
}
</style>
