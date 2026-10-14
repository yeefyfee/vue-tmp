import type { RouteRecordRaw } from "vue-router";
import NProgress from "@/plugins/nprogress";
import router from "@/router";
import { usePermissionStore, useUserStore } from "@/stores";
import { translateRouteTitle } from "@/lang/utils";
import { appConfig } from "@/settings";
import { isKnownNavPath } from "@/constants/navigation";
import { ROLE_ROOT } from "@/constants";
// PeluVida 基座（PEL-05）：原多租户上下文装配（stores/tenant + utils/tenant）
// 随业务模块一并归档；待 P0-03（tenant 模块）重建后再在此处接入。

/**
 * 当前账号是否可访问目标路由（路由级权限兜底）
 *
 * 判定口径（与 `v-has-perm` 指令、后端 PermissionGuard 一致）：
 *  · ROOT 角色直放；`*:*:*` 通配权限直放；
 *  · `meta.roles` 声明了角色白名单 → 需命中其一；
 *  · `meta.perm` 声明了权限码（单个或数组，任一命中即可）→ 需命中其一。
 */
function hasRouteAccess(to: RouteRecordRaw | { meta: RouteRecordRaw["meta"] }): boolean {
  const { roles = [], perms = [] } = useUserStore().userInfo ?? {};
  if (roles.includes(ROLE_ROOT) || perms.includes("*:*:*")) return true;

  const meta = to.meta ?? {};
  if (meta.roles?.length && !meta.roles.some((role) => roles.includes(role))) {
    return false;
  }

  const requiredPerms = Array.isArray(meta.perm) ? meta.perm : meta.perm ? [meta.perm] : [];
  if (requiredPerms.length > 0 && !requiredPerms.some((perm) => perms.includes(perm))) {
    return false;
  }

  return true;
}

/**
 * 路由权限守卫
 *
 * 处理登录验证、动态路由生成、404检测等
 */
export function setupPermissionGuard() {
  const whiteList = ["/login"];

  router.beforeEach(async (to, _from) => {
    NProgress.start();

    try {
      const isLoggedIn = useUserStore().isLoggedIn();

      // 未登录处理
      if (!isLoggedIn) {
        if (whiteList.includes(to.path)) {
          return;
        }
        NProgress.done();
        return `/login?redirect=${encodeURIComponent(to.fullPath)}`;
      }

      // 已登录访问登录页，重定向到首页
      if (to.path === "/login") {
        return { path: "/" };
      }

      const permissionStore = usePermissionStore();
      const userStore = useUserStore();

      // 动态路由生成
      if (!permissionStore.isRouteGenerated) {
        if (!userStore.userInfo?.roles?.length) {
          await userStore.getUserInfo();
        }

        const dynamicRoutes = await permissionStore.generateRoutes();
        dynamicRoutes.forEach((route: RouteRecordRaw) => {
          router.addRoute(route);
        });

        return { ...to, replace: true };
      }

      // 路由 404 检查
      if (to.matched.length === 0) {
        // 从登录页跳转且目标路径无效，回退首页（避免不同用户权限不同导致的 404）
        if (_from.path === "/login") {
          return { path: "/", replace: true };
        }
        // 权限不足 ≠ 路径不存在（PRD《页面信息架构》§空态、无权限态与加载态 第 2 条：
        // 「导航隐藏与 403 行为必须一致，不允许出现看得到入口但打不开的体验」）：
        //  · 目标落在《页面清单》已知模块内、但本次账号未被下发该路由 ⇒ 无权限 ⇒ 403；
        //  · 完全未知的路径 ⇒ 404。
        return isKnownNavPath(to.path) ? "/403" : "/404";
      }

      // 权限兜底（防御性）：路由 meta 声明了 perm / roles 但当前账号不满足 → 403
      // 正常情况下后端已按角色过滤 GET /menus/routes（无权限模块不下发，导航也不渲染），
      // 此处仅覆盖「直链访问」与后续按页面声明权限码 `module:page:view` 的场景。
      if (!hasRouteAccess(to)) {
        return "/403";
      }

      // 动态标题
      const title = (to.params.title as string) || (to.query.title as string);
      if (title) {
        to.meta.title = title;
      }
    } catch (error) {
      console.error("Route guard error:", error);
      await useUserStore().resetAllState();
      NProgress.done();
      // 携带原目标，保证「续期失败 → 重新登录」后能回到原操作现场（01-02 验收 #6）
      return `/login?redirect=${encodeURIComponent(to.fullPath)}`;
    }
  });

  router.afterEach((to) => {
    NProgress.done();

    // 动态设置浏览器标签页标题：`页面标题 - 站点名`
    // 标题沿用仓库既有约定 translateRouteTitle（支持 i18n key 与普通文案），
    // 站点名复用 @/settings 的 appConfig.title，无 meta.title 时仅显示站点名。
    const pageTitle = translateRouteTitle(to.meta.title ?? "");
    document.title = pageTitle ? `${pageTitle} - ${appConfig.title}` : appConfig.title;
  });
}
