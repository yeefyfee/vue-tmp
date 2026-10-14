import { useRoute } from "vue-router";
import { resolveTabKey, useTagsViewStore } from "@/stores/tags-view";

/**
 * 未保存修改守卫（MVP-WEB-01-05）
 *
 * 详情 / 表单页显式上报「存在未保存修改」，工作区标签栏据此：
 *  1. 关闭该标签前二次确认（文案「当前有未保存的修改」，PRD §多标签页策略 第 4 条）；
 *  2. LRU 淘汰时优先避开该标签（第 2 条：含未保存表单的标签不自动关闭）。
 *
 * 用法（页面内）：
 * ```ts
 * const { isDirty, markDirty, markClean } = useUnsavedGuard();
 * watch(form, () => markDirty());          // 表单变更 → 置脏
 * const submit = async () => { await save(); markClean(); };  // 保存成功 → 清脏
 * ```
 *
 * 另提供一道兜底：浏览器刷新 / 关闭（`beforeunload`）。标签栏关闭流程与「应用内路由离开」
 * 由 `router/guards/workspace.ts` 的全局守卫统一处理（原因见该文件注释：
 * 本模板 `LayoutMain` 的包装组件会让页面内的 `onBeforeRouteLeave` 静默失效）。
 */
export function useUnsavedGuard() {
  const route = useRoute();
  const tagsViewStore = useTagsViewStore();

  /** 当前页面对应的标签键 */
  const currentKey = () => resolveTabKey(route);

  /** 当前页面是否存在未保存修改 */
  const isDirty = computed(() => tagsViewStore.isDirty(currentKey()));

  /** 标记存在未保存修改 */
  function markDirty() {
    tagsViewStore.markDirty(currentKey());
  }

  /** 清除未保存修改标记（保存成功 / 放弃修改后调用） */
  function markClean() {
    tagsViewStore.markClean(currentKey());
  }

  // 兜底一：浏览器刷新 / 关闭标签页
  const handleBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!tagsViewStore.isDirty(currentKey())) return;
    event.preventDefault();
    event.returnValue = "";
  };

  onMounted(() => window.addEventListener("beforeunload", handleBeforeUnload));
  onBeforeUnmount(() => window.removeEventListener("beforeunload", handleBeforeUnload));

  return { isDirty, markDirty, markClean };
}
