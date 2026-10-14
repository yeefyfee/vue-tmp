<template>
  <div v-if="canSwitchStore" class="store-switcher">
    <el-dropdown v-if="isMultiStore" trigger="click" :disabled="switching" @command="handleSwitch">
      <button
        type="button"
        class="store-switcher__trigger"
        :class="{ 'is-busy': switching }"
        :aria-label="t('navbar.storeSwitch')"
      >
        <el-icon class="store-switcher__icon"><Shop /></el-icon>
        <span class="store-switcher__name">{{ displayName }}</span>
        <el-icon class="store-switcher__arrow"><ArrowDown /></el-icon>
      </button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item
            v-for="item in organizations"
            :key="item.id"
            :command="item.id"
            :class="{ 'is-active': item.id === activeStoreId }"
          >
            <span class="store-switcher__option">{{ item.name }}</span>
            <el-icon v-if="item.id === activeStoreId" class="store-switcher__check">
              <Check />
            </el-icon>
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>

    <div v-else class="store-switcher__trigger is-static" :title="displayName">
      <el-icon class="store-switcher__icon"><Shop /></el-icon>
      <span class="store-switcher__name">{{ displayName }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { Shop, ArrowDown, Check } from "@element-plus/icons-vue";
import { useStoreContextStore } from "@/stores";

const { t } = useI18n();
const storeContext = useStoreContextStore();
const { organizations, activeStoreId, switching, canSwitchStore, isMultiStore } =
  storeToRefs(storeContext);

/** 当前门店名；未选择门店时为「全部门店」（登录 token 不含 activeStoreId = 租户全域视图） */
const displayName = computed(() => {
  const active = organizations.value.find((item) => item.id === activeStoreId.value);
  return active?.name || t("navbar.storeAll");
});

/**
 * 切换门店
 *
 * 切换后 access token 已内嵌新的 activeStoreId；由于页面均为 keep-alive 且
 * 请求层尚未携带 x-store-id（归 01-06），此处触发一次整页重载，确保当前视图
 * 以新门店上下文重新拉取数据（《页面信息架构·视图个性化》#3）。
 */
async function handleSwitch(storeId: string) {
  try {
    const switched = await storeContext.switchStore(storeId);
    if (!switched) return;

    const name = organizations.value.find((item) => item.id === storeId)?.name ?? "";
    ElMessage.success(t("navbar.storeSwitched", { name }));
    // 留出成功提示的可读时间，再整页重载以新门店上下文重拉数据
    setTimeout(() => window.location.reload(), 900);
  } catch {
    // 错误提示由 request.ts 统一处理（如门店已停用 → A0212）
  }
}

onMounted(() => {
  storeContext.loadOrganizations();
});
</script>

<style lang="scss" scoped>
.store-switcher {
  display: flex;
  align-items: center;

  &__trigger {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    max-width: 200px;
    height: 32px;
    padding: 0 8px;
    font: inherit;
    font-size: 13px;
    color: var(--layout-toolbar-color, var(--el-text-color-secondary));
    cursor: pointer;
    background: transparent;
    border: 0;
    border-radius: 6px;
    transition:
      background-color 0.16s,
      color 0.16s;

    &:hover:not(.is-static):not(.is-busy) {
      color: var(--layout-toolbar-hover-color, var(--el-color-primary));
      background: var(--layout-toolbar-hover-bg, var(--el-fill-color-light));
    }

    &.is-static {
      cursor: default;
    }

    &.is-busy {
      cursor: progress;
      opacity: 0.7;
    }
  }

  &__icon {
    flex-shrink: 0;
    font-size: 15px;
  }

  &__name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__arrow {
    flex-shrink: 0;
    font-size: 12px;
    opacity: 0.7;
  }

  &__option {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__check {
    margin-left: 12px;
    color: var(--el-color-primary);
  }
}

:deep(.el-dropdown-menu__item) {
  display: flex;
  align-items: center;
  min-width: 160px;
  max-width: 240px;

  &.is-active {
    font-weight: 600;
    color: var(--el-color-primary);
  }
}
</style>
