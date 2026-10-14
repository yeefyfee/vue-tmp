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
        path: "403",
        component: () => import("@/views/error/403.vue"),
        meta: { hidden: true },
      },
      {
        path: "profile",
        name: "Profile",
        component: () => import("@/views/profile/index.vue"),
        meta: { title: "个人中心", icon: "user", hidden: true },
      },
    ],
  },
];

/**
 * 开发期脚手架：工作区标签页（Workspace Tab）演示详情页
 *
 * 仅 DEV 注册 —— 生产构建下 `import.meta.env.DEV` 为常量 false，整段（含动态 import）
 * 会被摇树移除，不会进入产物。用于验证 01-05 的「多实例详情页」相关规则
 * （复用 / 上限 12 / LRU / 钉住 3 / 未保存二次确认 / 刷新只恢复钉住）。
 */
const devOnlyRoutes: RouteRecordRaw[] = import.meta.env.DEV
  ? [
      {
        path: "demo/workspace-tab/:id",
        name: "DemoWorkspaceTab",
        component: () => import("@/views/demo/workspace-tab.vue"),
        meta: {
          title: "标签演示",
          icon: "table",
          hidden: true,
          keepAlive: true,
          tabMode: "detail",
        },
      },
    ]
  : [];

const homeRoute = constantRoutes.find((route) => route.name === "/");
if (homeRoute?.children) {
  homeRoute.children.push(...devOnlyRoutes);
}

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
