import "vue-router";

declare module "vue-router" {
  /**
   * 项目路由元信息扩展
   */
  interface RouteMeta {
    title?: string;
    type?: string;
    icon?: string;
    hidden?: boolean;
    alwaysShow?: boolean;
    affix?: boolean;
    keepAlive?: boolean;
    breadcrumb?: boolean;
    activeMenu?: string;
    params?: Record<string, unknown>;
    externalUrl?: string;
    roles?: string[];
    /**
     * 页面级权限码（`module:page:view`，见 PRD《页面清单》清单维护规则 4）
     *
     * 单个或数组（任一命中即可）；路由守卫与 `v-has-perm` 指令同口径校验。
     */
    perm?: string | string[];
    /**
     * 工作区标签页模式（PRD《页面信息架构》§多标签页策略 第 6 条）
     *
     * - `"detail"`：详情类页面，按 `fullPath` 多实例开标签（同一对象复用、不同对象各一页）；
     * - `"none"`：显式声明不进标签区（与缺省行为一致，仅用于自文档化）。
     *
     * 缺省（`undefined`）视为列表页 / 配置页 —— **不进标签区**，始终单例显示。
     * 路由级常驻标签另由 `meta.affix` 声明（工作台）。
     */
    tabMode?: "detail" | "none";
  }
}
