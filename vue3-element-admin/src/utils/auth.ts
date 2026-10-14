import { Storage } from "./storage";
import { STORAGE_KEYS, ROLE_ROOT } from "@/constants";
import { useUserStoreHook } from "@/stores/user";
import router from "@/router";

// 负责本地凭证与偏好的读写
export const AuthStorage = {
  getAccessToken(): string {
    const isRememberMe = Storage.get<boolean>(STORAGE_KEYS.REMEMBER_ME, false);
    return isRememberMe
      ? Storage.get(STORAGE_KEYS.ACCESS_TOKEN, "")
      : Storage.sessionGet(STORAGE_KEYS.ACCESS_TOKEN, "");
  },

  getRefreshToken(): string {
    const isRememberMe = Storage.get<boolean>(STORAGE_KEYS.REMEMBER_ME, false);
    return isRememberMe
      ? Storage.get(STORAGE_KEYS.REFRESH_TOKEN, "")
      : Storage.sessionGet(STORAGE_KEYS.REFRESH_TOKEN, "");
  },

  setTokens(accessToken: string, refreshToken: string, rememberMe: boolean): void {
    // 先无条件清理两侧，避免「勾选/取消记住我」切换后读到上一次残留的 token
    Storage.remove(STORAGE_KEYS.ACCESS_TOKEN);
    Storage.remove(STORAGE_KEYS.REFRESH_TOKEN);
    Storage.sessionRemove(STORAGE_KEYS.ACCESS_TOKEN);
    Storage.sessionRemove(STORAGE_KEYS.REFRESH_TOKEN);

    Storage.set(STORAGE_KEYS.REMEMBER_ME, rememberMe);
    if (rememberMe) {
      Storage.set(STORAGE_KEYS.ACCESS_TOKEN, accessToken);
      Storage.set(STORAGE_KEYS.REFRESH_TOKEN, refreshToken);
    } else {
      Storage.sessionSet(STORAGE_KEYS.ACCESS_TOKEN, accessToken);
      Storage.sessionSet(STORAGE_KEYS.REFRESH_TOKEN, refreshToken);
    }
  },

  clearAuth(): void {
    Storage.remove(STORAGE_KEYS.ACCESS_TOKEN);
    Storage.remove(STORAGE_KEYS.REFRESH_TOKEN);
    Storage.sessionRemove(STORAGE_KEYS.ACCESS_TOKEN);
    Storage.sessionRemove(STORAGE_KEYS.REFRESH_TOKEN);
  },

  getRememberMe(): boolean {
    return Storage.get<boolean>(STORAGE_KEYS.REMEMBER_ME, false);
  },
};

/**
 * 权限判断
 */
export function hasPerm(value: string | string[], type: "button" | "role" = "button"): boolean {
  const { roles, perms } = useUserStoreHook().userInfo;

  if (!roles || !perms) {
    return false;
  }

  // 超级管理员拥有所有权限
  if (type === "button" && roles.includes(ROLE_ROOT)) {
    return true;
  }

  const auths = type === "button" ? perms : roles;
  return typeof value === "string"
    ? auths.includes(value)
    : value.some((perm) => auths.includes(perm));
}

let redirectingToLogin = false;

/**
 * 重定向到登录页面
 *
 * 会话失效（401）时的统一出口。两点硬约束（01-06 收敛）：
 * 1. **不重复跳转**：并发 401 只触发一次导航，避免「登出双跳」；
 * 2. **不嵌套 redirect**：已在登录页时不再跳转，否则会把
 *    `/login?redirect=%2Fsystem%2Fuser` 再次编码成
 *    `/login?redirect=%2Flogin%253Fredirect%253D...`（层层套娃且登录后回不到现场）。
 */
export async function redirectToLogin(
  message: string = "请重新登录",
  notify: boolean = true
): Promise<void> {
  if (redirectingToLogin) return;
  redirectingToLogin = true;

  if (notify) {
    ElNotification({
      title: "提示",
      message,
      type: "warning",
      duration: 3000,
    });
  }

  await useUserStoreHook().resetAllState();

  try {
    // 已在登录页：原地清理会话即可，不再导航（避免 redirect 参数嵌套）
    if (router.currentRoute.value.path !== "/login") {
      const currentPath = router.currentRoute.value.fullPath;
      await router.push(`/login?redirect=${encodeURIComponent(currentPath)}`);
    }
  } catch (error) {
    console.error("Redirect to login error:", error);
    // 强制跳转，即使路由重定向失败
    if (router.currentRoute.value.path !== "/login") {
      window.location.href = "/login";
    }
  } finally {
    redirectingToLogin = false;
  }
}
