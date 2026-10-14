import { store } from "@/stores";

import AuthAPI from "@/api/auth";
import UserAPI from "@/api/system/user";
import type { LoginRequest } from "@/api/auth";
import type { UserInfo } from "@/api/system/user";

import { AuthStorage } from "@/utils/auth";
import { usePermissionStoreHook } from "@/stores/permission";
import { useDictStoreHook } from "@/stores/dict";
import { useTagsViewStore } from "@/stores";
import { useStoreContextStoreHook } from "@/stores/store-context";
import { cleanupSseServices } from "@/composables";

export const useUserStore = defineStore("user", () => {
  // 用户信息
  const userInfo = ref<UserInfo>({} as UserInfo);
  // 记住我状态
  const rememberMe = ref(AuthStorage.getRememberMe());

  /**
   * 登录
   */
  async function login(loginRequest: LoginRequest): Promise<void> {
    const { accessToken, refreshToken } = await AuthAPI.login(loginRequest);
    rememberMe.value = loginRequest.rememberMe ?? false;
    AuthStorage.setTokens(accessToken, refreshToken, rememberMe.value);
  }

  let refreshPromise: Promise<void> | null = null;

  /**
   * 刷新 token（单飞模式）
   *
   * 多个并发请求遇到 token 过期时，共享同一次 refresh 请求。
   */
  function refreshTokenOnce(): Promise<void> {
    if (refreshPromise) return refreshPromise;

    refreshPromise = doRefreshToken().finally(() => {
      refreshPromise = null;
    });

    return refreshPromise;
  }

  /**
   * 获取用户信息
   */
  async function getUserInfo(): Promise<UserInfo> {
    const data = await UserAPI.getInfo();
    if (!data) {
      throw new Error("Verification failed, please Login again.");
    }
    Object.assign(userInfo.value, data);
    return data;
  }

  /**
   * 登出
   *
   * 无论登出接口是否成功，都必须清空本地会话状态：
   * 否则接口异常时本地 token 会残留，界面看似仍处于登录态。
   *
   * 同时吞掉接口异常、让 Promise 正常 resolve，保证调用方
   * （如 LayoutToolbar 的 `.then(() => router.push('/login?...'))`）
   * 在登出接口失败时仍能跳转登录页（验收 #7）。
   */
  async function logout(): Promise<void> {
    try {
      await AuthAPI.logout();
    } catch {
      // 登出接口失败（网络异常 / 服务端错误 / token 已失效）不应阻断登出流程：
      // 1) 错误提示已由 request.ts 响应拦截器统一处理，此处无需重复提示；
      // 2) 下方 finally 保证本地会话状态一定被清空；
      // 3) 吞掉异常使 Promise 正常 resolve，调用方的后续「跳转登录页」才会执行。
    } finally {
      resetAllState();
    }
  }

  /**
   * 重置所有系统状态
   *
   * 统一处理所有清理工作，包括用户凭证、路由、缓存等
   */
  function resetAllState(): void {
    // 1. 重置用户状态
    resetUserState();

    // 2. 重置其他模块状态
    usePermissionStoreHook().resetRouter();
    useDictStoreHook().clearDictCache();
    useTagsViewStore().resetWorkspace();
    useStoreContextStoreHook().reset();

    // 3. 清理 SSE 连接
    cleanupSseServices();
  }

  /**
   * 重置用户状态
   *
   * 仅处理用户模块内的状态
   */
  function resetUserState(): void {
    AuthStorage.clearAuth();
    userInfo.value = {} as UserInfo;
  }

  /**
   * 刷新 token
   */
  async function doRefreshToken(): Promise<void> {
    const currentRefreshToken = AuthStorage.getRefreshToken();

    if (!currentRefreshToken) {
      throw new Error("没有有效的刷新令牌");
    }

    const { accessToken, refreshToken: newRefreshToken } =
      await AuthAPI.refreshToken(currentRefreshToken);
    AuthStorage.setTokens(accessToken, newRefreshToken, AuthStorage.getRememberMe());
  }

  return {
    userInfo,
    rememberMe,
    isLoggedIn: () => !!AuthStorage.getAccessToken(),
    login,
    logout,
    getUserInfo,
    resetAllState,
    resetUserState,
    refreshToken: doRefreshToken,
    refreshTokenOnce,
  };
});

/**
 * 在组件外部使用 UserStore 的钩子函数
 *
 * @see https://pinia.vuejs.org/core-concepts/outside-component-usage.html
 */
export function useUserStoreHook() {
  return useUserStore(store);
}
