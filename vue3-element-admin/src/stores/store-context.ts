import { store } from "@/stores";
import AuthAPI from "@/api/auth";
import type { OrganizationItem } from "@/api/auth";
import { AuthStorage } from "@/utils/auth";
import { STORAGE_KEYS } from "@/constants";

/**
 * 门店上下文（01-03 顶部上下文栏·门店切换器）
 *
 * 数据源：`GET /api/v1/auth/organizations`（当前租户启用中的门店）
 * 切换：`POST /api/v1/auth/switch-context`（签发内嵌 activeStoreId 的新 access token，
 * refresh token 沿用原值、tokenVersion 语义不变）。
 *
 * 口径说明：登录 token 本身不含 activeStoreId，故「当前门店」由本地持久化
 * （切换时写入）为准，并在每次载入门店列表时与后端返回值校验，失效即清空。
 */
export const useStoreContextStore = defineStore("storeContext", () => {
  /** 当前租户可切换门店列表 */
  const organizations = ref<OrganizationItem[]>([]);
  /** 当前激活门店 ID（本地持久化） */
  const activeStoreId = useStorage<string>(STORAGE_KEYS.ACTIVE_STORE_ID, "");

  /** 门店列表加载中 */
  const loading = ref(false);
  /** 门店切换中 */
  const switching = ref(false);
  /** 门店列表是否已成功加载过一次 */
  const loaded = ref(false);

  /** 当前激活门店（列表加载后可得；未加载或已失效时为 null） */
  const activeStore = computed(
    () => organizations.value.find((item) => item.id === activeStoreId.value) ?? null
  );

  /** 是否需要展示门店切换器：可切换门店存在即可（单店也需展示当前门店名） */
  const canSwitchStore = computed(() => organizations.value.length > 0);

  /** 是否多店（仅多店时展示下拉可选项） */
  const isMultiStore = computed(() => organizations.value.length > 1);

  /**
   * 载入门店列表（幂等，默认命中缓存即返回）
   */
  async function loadOrganizations(force = false): Promise<void> {
    if (loading.value) return;
    if (!force && loaded.value) return;

    loading.value = true;
    try {
      const list = await AuthAPI.getOrganizations();
      organizations.value = Array.isArray(list) ? list : [];
      loaded.value = true;

      // 本地记录的门店若已停用/软删/跨租户，静默失效，避免展示不存在的门店名
      if (
        activeStoreId.value &&
        !organizations.value.some((item) => item.id === activeStoreId.value)
      ) {
        activeStoreId.value = "";
      }
    } catch {
      // 平台级账号（无租户上下文）会拿到 403 + A0302；错误提示由 request.ts 统一处理，
      // 此处仅保证上下文栏降级为「不展示切换器」，不阻断页面渲染。
      organizations.value = [];
      loaded.value = false;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 切换门店上下文
   *
   * @returns 是否真的发生了切换
   */
  async function switchStore(storeId: string): Promise<boolean> {
    if (switching.value || !storeId || storeId === activeStoreId.value) return false;

    const target = organizations.value.find((item) => item.id === storeId);
    if (!target) return false;

    switching.value = true;
    try {
      const { accessToken, activeStore: switched } = await AuthAPI.switchContext(storeId);

      // refresh token 与「记住我」偏好保持不变，仅替换 access token
      AuthStorage.setTokens(
        accessToken,
        AuthStorage.getRefreshToken(),
        AuthStorage.getRememberMe()
      );
      activeStoreId.value = switched.id;

      return true;
    } finally {
      switching.value = false;
    }
  }

  /** 清空门店上下文（登出/切换账号时调用） */
  function reset(): void {
    organizations.value = [];
    activeStoreId.value = "";
    loaded.value = false;
  }

  return {
    organizations,
    activeStoreId,
    activeStore,
    loading,
    switching,
    loaded,
    canSwitchStore,
    isMultiStore,
    loadOrganizations,
    switchStore,
    reset,
  };
});

export function useStoreContextStoreHook() {
  return useStoreContextStore(store);
}
