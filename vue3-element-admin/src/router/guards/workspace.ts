import { ElMessageBox } from "element-plus";
import i18n from "@/lang";
import router from "@/router";
import { useTagsViewStore } from "@/stores";
import { resolveTabKey } from "@/stores/tags-view";

/**
 * 工作区标签页守卫（MVP-WEB-01-05）
 *
 * 「含未保存修改」的页面在应用内路由离开时二次确认，文案固定「当前有未保存的修改」
 * （PRD《页面信息架构》§多标签页策略 第 4 条：关闭含未保存修改的标签需二次确认）。
 *
 * 为什么用**全局守卫**而不是页面内的 `onBeforeRouteLeave`：
 * 本模板的 `LayoutMain` 会把路由组件再包一层本地包装组件（`wrapperMap`，用于
 * keep-alive 命名与渲染异常兜底），包装组件属于 `<router-view>` 的 slot 内容；
 * 而 provide/inject 不跨 slot 边界 ⇒ 包装组件及其子树拿不到 `<router-view>` 提供的
 * `matchedRouteKey`，vue-router 的 `onBeforeRouteLeave` 会把守卫注册到**外层记录**上，
 * 于是「永不触发」且不报错（实测：注册成功、离开时无任何回调）。
 * 全局守卫不依赖该注入链，对所有页面一致生效。
 */
export function setupWorkspaceGuard() {
  router.beforeEach(async (to, from) => {
    // 首次进入应用（无来源）不做拦截
    if (!from.name && from.matched.length === 0) return true;

    // 同一页面内仅查询参数变化（如详情页内页签 `?tab=`）不算离开，不拦截
    if (from.path === to.path) return true;

    const tagsViewStore = useTagsViewStore();
    const leavingKey = resolveTabKey(from);
    if (!tagsViewStore.isDirty(leavingKey)) return true;

    try {
      await ElMessageBox.confirm(
        i18n.global.t("tab.unsavedContent"),
        i18n.global.t("tab.unsavedTitle"),
        {
          confirmButtonText: i18n.global.t("tab.unsavedConfirm"),
          cancelButtonText: i18n.global.t("tab.unsavedCancel"),
          type: "warning",
        }
      );
    } catch {
      // 取消：放弃本次导航，停留在原页面
      return false;
    }

    // 确认放弃修改 → 清脏，避免后续再次拦截
    tagsViewStore.markClean(leavingKey);
    return true;
  });
}
