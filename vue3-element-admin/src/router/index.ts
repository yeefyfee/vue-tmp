import type { App } from "vue";
import { createRouter, createWebHashHistory, type RouteRecordRaw } from "vue-router";

export const Layout = () => import("@/layouts/index.vue");

// 静态路由
export const constantRoutes: RouteRecordRaw[] = [
  {
    path: "/redirect",
    component: Layout,
    meta: { hidden: true },
    children: [
      {
        path: "/redirect/:path(.*)",
        component: () => import("@/views/redirect.vue"),
      },
    ],
  },

  {
    path: "/login",
    component: () => import("@/views/login/index.vue"),
    meta: { hidden: true },
  },

  {
    path: "/",
    name: "/",
    component: Layout,
    redirect: "/dashboard",
    children: [
      {
        path: "dashboard",
        component: () => import("@/views/dashboard/index.vue"),
        // 用于 keep-alive 功能，需要与 SFC 中自动推导或显式声明的组件名称一致
        // 参考文档: https://cn.vuejs.org/guide/built-ins/keep-alive.html#include-exclude
        name: "Dashboard",
        meta: {
          title: "dashboard",
          icon: "homepage",
          affix: true,
          keepAlive: true,
        },
      },
      {
        path: "401",
        component: () => import("@/views/error/401.vue"),
        meta: { hidden: true },
      },
      {
        path: "404",
        component: () => import("@/views/error/404.vue"),
        meta: { hidden: true },
      },
      {
        path: "profile",
        name: "Profile",
        component: () => import("@/views/profile/index.vue"),
        meta: { title: "个人中心", icon: "user", hidden: true },
      },
      {
        path: "profile/notice",
        name: "MyNotice",
        component: () => import("@/views/profile/notice/index.vue"),
        meta: { title: "我的通知", icon: "user", hidden: true },
      },
    ],
  },

  // Suno 音乐模块（独立业务域）
  // 说明：该分组的显示由后端菜单控制（SUNO 角色仅绑定 Suno 菜单），
  // 这里以常量路由兜底，保证后端菜单未初始化时功能可直接访问。
  {
    path: "/suno",
    component: Layout,
    redirect: "/suno/studio",
    meta: { title: "Suno 音乐", icon: "microphone" },
    children: [
      {
        path: "studio",
        name: "SunoStudio",
        component: () => import("@/views/suno/studio/index.vue"),
        meta: { title: "创作台", icon: "magic-stick", keepAlive: true },
      },
      {
        path: "task",
        name: "SunoTask",
        component: () => import("@/views/suno/task/index.vue"),
        meta: { title: "任务中心", icon: "list", keepAlive: true },
      },
      {
        path: "asset",
        name: "SunoAsset",
        component: () => import("@/views/suno/asset/index.vue"),
        meta: { title: "我的作品", icon: "headset", keepAlive: true },
      },
      {
        path: "config",
        name: "SunoConfig",
        component: () => import("@/views/suno/config/index.vue"),
        meta: { title: "接入配置", icon: "setting" },
      },
    ],
  },
];

/**
 * 创建路由
 */
const router = createRouter({
  history: createWebHashHistory(),
  routes: constantRoutes,
  // 刷新时，滚动条位置还原
  scrollBehavior: () => ({ left: 0, top: 0 }),
});

// 全局注册 router
export function setupRouter(app: App<Element>) {
  app.use(router);
}

export default router;
