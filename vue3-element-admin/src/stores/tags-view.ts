import type { LocationQuery } from "vue-router";
import { isExternal } from "@/utils";
import { Storage } from "@/utils/storage";
import { STORAGE_KEYS } from "@/constants";

/**
 * 工作区标签页（Workspace Tab）状态
 *
 * 规格来源：PRD《页面信息架构》§多标签页策略，八条规则与本文档一一对应：
 *  1. 复用置前 —— {@link useTagsViewStore.addVisitedView} 按 key 去重，命中即复用；
 *  2. 上限 12 + LRU —— {@link MAX_WORKSPACE_TABS} + {@link useTagsViewStore.addVisitedView} 内淘汰；
 *  3. 拖拽排序 + 钉住 ≤3 —— {@link MAX_PINNED_TABS} + pin/unpin（拖拽在 UI 侧）；
 *  4. 关闭含未保存修改的标签需二次确认 —— {@link useTagsViewStore.isDirty} 驱动的脏键注册表；
 *  5. 标题动态生成 —— 由页面调用 `updateTagName(fullPath, title)` 覆盖；
 *  6. 列表页与配置页不进标签区 —— {@link isTabEligible}（仅 affix 与 `tabMode=detail` 进）；
 *  7. 刷新后只恢复钉住标签 —— {@link useTagsViewStore.restorePinned}（localStorage 持久化）；
 *  8. 直开 URL 还原 —— 详情页按 fullPath 建标签，query 原样保留。
 */

/** 标签区上限（PRD §多标签页策略 第 2 条） */
export const MAX_WORKSPACE_TABS = 12;

/** 钉住标签上限（PRD §多标签页策略 第 3 条） */
export const MAX_PINNED_TABS = 3;

/** 路由 meta 中与标签区相关的字段 */
interface TabRouteMeta {
  tabMode?: string;
}

/** 标签身份解析所需的极小路由面 */
interface TabRouteLike {
  path: string;
  fullPath: string;
  meta?: TabRouteMeta;
}

export interface TagView {
  /**
   * 标签唯一标识 = `resolveTabKey(route)` = `route.path`
   *
   * 动态参数段解析后天然按对象区分（`/pets/aaa` ≠ `/pets/bbb`），同一对象的
   * query 变化（如档案页 `?tab=`）复用同一标签，fullPath 由 `updateCurrentTag`
   * 同步（点标签还原最后访问位置）。
   */
  key: string;
  name: string;
  title: string;
  path: string;
  fullPath: string;
  icon?: string;
  /** 路由级常驻标签（如工作台）：不可关闭、不参与 LRU 淘汰、不占用钉住配额 */
  affix?: boolean;
  /** 用户钉住（≤3）：localStorage 持久化、刷新恢复、批量关闭时豁免 */
  pinned?: boolean;
  keepAlive?: boolean;
  query?: LocationQuery;
  /** 多实例详情页（`meta.tabMode === "detail"`） */
  multi?: boolean;
  /** 最近访问时间戳（LRU 淘汰依据） */
  lastVisitedAt?: number;
}

export interface TagsViewResult {
  visitedViews: TagView[];
  cachedViews: string[];
}

export interface DirectionalTagsViewResult {
  visitedViews: TagView[];
}

/** 新增标签的结果（超限时带出被 LRU 淘汰的标签，供 UI 提示与跳转） */
export interface AddViewResult {
  /** 本次新增 / 复用的标签 */
  view?: TagView;
  /** 因超出上限被淘汰的标签 */
  evicted?: TagView;
}

/**
 * 解析路由对应的标签唯一键
 *
 * 详情页（`meta.tabMode === "detail"`）按 `fullPath` 建标签，同一对象复用同一标签、
 * 不同对象各自成页（PRD §多标签页策略 第 1 条）；其余页面按 `path` 单例。
 */
export function resolveTabKey(route: TabRouteLike): string {
  // 标签身份 = 路由路径（含动态段解析结果）：同一对象（同 path）复用同一标签
  // （PRD《多标签页策略》第 1 条）。query 不是对象身份 —— 如宠物档案 `?tab=`
  // 切页签时 fullPath 变化，经 `updateCurrentTag` 同步到既有标签的 fullPath，
  // 点标签还原最后访问位置；若以 fullPath 为 key 会把同一对象炸成多标签。
  return route.path;
}

/**
 * 是否可以进入标签区
 *
 * PRD §多标签页策略 第 6 条：「列表页与配置页不进入标签区，始终单例显示，避免标签爆炸」。
 * 因此**默认不进**，只有两类例外：
 *  · 路由级常驻标签（`meta.affix`，如工作台）；
 *  · 详情页（`meta.tabMode === "detail"`，按对象多实例开标签）。
 */
export function isTabEligible(view: Pick<TagView, "affix" | "multi">): boolean {
  return view.affix === true || view.multi === true;
}

/** 常驻（affix）或钉住（pinned）的标签不参与 LRU 淘汰、批量关闭时豁免 */
function isProtected(view: TagView): boolean {
  return view.affix === true || view.pinned === true;
}

export const useTagsViewStore = defineStore("tagsView", () => {
  const visitedViews = ref<TagView[]>([]);
  const cachedViews = ref<string[]>([]);
  /**
   * 存在未保存修改的标签键集合
   *
   * 由详情 / 表单页通过 `useUnsavedGuard()` 的 `markDirty` / `markClean` 显式上报；
   * 标签栏据此在关闭前二次确认，LRU 淘汰时也优先避开这些标签。
   * 不持久化：未保存的修改本身随刷新丢失，脏标记没有跨会话意义。
   */
  const dirtyKeys = ref<string[]>([]);
  const router = useRouter();
  const route = useRoute();

  // ---------------------------------------------------------------- 脏状态

  /** 标记指定标签存在未保存修改（幂等） */
  function markDirty(key: string) {
    if (!key || dirtyKeys.value.includes(key)) return;
    dirtyKeys.value.push(key);
  }

  /** 清除指定标签的未保存修改标记（幂等） */
  function markClean(key: string) {
    const index = dirtyKeys.value.indexOf(key);
    if (index > -1) dirtyKeys.value.splice(index, 1);
  }

  /** 指定标签是否存在未保存修改 */
  function isDirty(key: string): boolean {
    return dirtyKeys.value.includes(key);
  }

  /** 清理已不存在标签的脏标记（批量关闭 / 登出后收尾） */
  function pruneDirtyKeys() {
    const alive = new Set(visitedViews.value.map((view) => view.key));
    dirtyKeys.value = dirtyKeys.value.filter((key) => alive.has(key));
  }

  // ---------------------------------------------------------------- 钉住持久化

  /** 把当前钉住标签写入 localStorage（PRD 第 7 条：刷新后恢复） */
  function persistPinned() {
    const pinned = visitedViews.value.filter((view) => view.pinned).map((view) => ({ ...view }));
    Storage.set(STORAGE_KEYS.PINNED_TAGS, pinned);
  }

  /**
   * 恢复上次会话钉住的标签
   *
   * @param isValid 可选的可用性校验（路由是否仍存在且当前账号有权限）；
   *                校验不通过的历史钉住标签会被丢弃并回写存储。
   */
  function restorePinned(isValid?: (view: TagView) => boolean) {
    const saved = Storage.get<TagView[]>(STORAGE_KEYS.PINNED_TAGS, []);
    const list = Array.isArray(saved) ? saved : [];
    const restored: TagView[] = [];

    list.forEach((item) => {
      if (!item?.key || restored.length >= MAX_PINNED_TABS) return;
      if (visitedViews.value.some((view) => view.key === item.key)) return;
      const view: TagView = { ...item, pinned: true, affix: false, lastVisitedAt: Date.now() };
      if (isValid && !isValid(view)) return;
      restored.push(view);
    });

    if (restored.length > 0) {
      visitedViews.value = [...visitedViews.value, ...restored];
      sortPinnedNext();
    }
    // 存储里可能有已失效的历史项，回写一次保持与内存一致
    if (restored.length !== list.length) persistPinned();
  }

  /** 重建排序：常驻（affix）在前，其次钉住（pinned），最后普通标签（组内保持原相对顺序） */
  function sortPinnedNext() {
    const rank = (view: TagView) => (view.affix ? 0 : view.pinned ? 1 : 2);
    visitedViews.value = [...visitedViews.value].sort((a, b) => rank(a) - rank(b));
  }

  /**
   * 钉住标签（≤3）
   *
   * @returns `ok=false` 且带 `reason`：`affix`（常驻标签无需钉住）/ `limit`（已达上限）/ `missing`
   */
  function pinView(view: TagView): { ok: boolean; reason?: "affix" | "limit" | "missing" } {
    const target = visitedViews.value.find((item) => item.key === view.key);
    if (!target) return { ok: false, reason: "missing" };
    if (target.affix) return { ok: false, reason: "affix" };
    if (target.pinned) return { ok: true };
    if (visitedViews.value.filter((item) => item.pinned).length >= MAX_PINNED_TABS) {
      return { ok: false, reason: "limit" };
    }

    target.pinned = true;
    // 移到钉住区末位（即 affix 与普通标签之间），保持钉住集合的稳定顺序
    const rest = visitedViews.value.filter((item) => item.key !== target.key);
    let insertAt = 0;
    rest.forEach((item, index) => {
      if (item.affix || item.pinned) insertAt = index + 1;
    });
    rest.splice(insertAt, 0, target);
    visitedViews.value = rest;
    persistPinned();
    return { ok: true };
  }

  /** 取消钉住（保留标签本身与当前位置） */
  function unpinView(view: TagView) {
    const target = visitedViews.value.find((item) => item.key === view.key);
    if (!target || !target.pinned) return;
    target.pinned = false;
    persistPinned();
  }

  /** 按拖拽结果重写标签顺序（拖拽排序，PRD 第 3 条） */
  function setOrder(views: TagView[]) {
    visitedViews.value = [...views];
  }

  // ---------------------------------------------------------------- 视图增删

  /**
   * 添加已访问视图到标签区
   *
   * 命中已有标签（同 key）时复用并刷新访问时间；超出 {@link MAX_WORKSPACE_TABS} 时
   * 按 LRU 淘汰一个标签（跳过常驻 / 钉住，优先淘汰非脏标签），并通过返回值告知调用方。
   */
  function addVisitedView(view: TagView): AddViewResult {
    if (view.path.startsWith("/redirect")) return {};
    if (isExternal(view.path) || isExternal(view.fullPath)) return {};
    // PRD 第 6 条：列表页与配置页不进标签区
    if (!isTabEligible(view)) return {};

    const existed = visitedViews.value.find((item) => item.key === view.key);
    if (existed) {
      existed.lastVisitedAt = Date.now();
      existed.title = view.title || existed.title;
      existed.icon = view.icon ?? existed.icon;
      existed.query = view.query;
      return { view: existed };
    }

    const created: TagView = { ...view, lastVisitedAt: Date.now() };
    if (created.affix) {
      visitedViews.value.unshift(created);
      return { view: created };
    }
    visitedViews.value.push(created);
    return { view: created, evicted: enforceTabLimit(created) };
  }

  /**
   * 标签区容量控制（PRD 第 2 条：上限 12，超出按 LRU 提示关闭；含未保存表单的不自动关闭）
   *
   * 淘汰顺序：非常驻且非钉住的标签中，先取「无未保存修改」的最久未访问者；
   * 若候选中全部有未保存修改，则退回其最久未访问者（保证上限硬性生效）。
   */
  function enforceTabLimit(incoming: TagView): TagView | undefined {
    if (visitedViews.value.length <= MAX_WORKSPACE_TABS) return;

    const candidates = visitedViews.value.filter(
      (item) => !isProtected(item) && item.key !== incoming.key
    );
    if (candidates.length === 0) return;

    const byLru = [...candidates].sort((a, b) => (a.lastVisitedAt ?? 0) - (b.lastVisitedAt ?? 0));
    const victim = byLru.find((item) => !isDirty(item.key)) ?? byLru[0];
    if (!victim) return;

    // 被淘汰标签若持有未保存修改，视为用户已通过提示放弃修改（避免路由离开时二次弹窗）
    removeVisitedByKey(victim.key);
    return victim;
  }

  function removeVisitedByKey(key: string) {
    const index = visitedViews.value.findIndex((item) => item.key === key);
    if (index > -1) visitedViews.value.splice(index, 1);
    markClean(key);
  }

  /** 添加缓存视图到缓存视图列表中 */
  function addCachedView({ fullPath, keepAlive }: TagView) {
    // 如果缓存视图名称已经存在于缓存视图列表中，则不再添加
    if (cachedViews.value.includes(fullPath)) {
      return;
    }

    // 如果视图需要缓存（keepAlive），则将其路由名称添加到缓存视图列表中
    if (keepAlive) {
      cachedViews.value.push(fullPath);
    }
  }

  /** 从标签区移除指定视图 */
  function delVisitedView(view: TagView) {
    return new Promise<TagView[]>((resolve) => {
      const index = visitedViews.value.findIndex((item) => item.key === view.key);
      if (index > -1) visitedViews.value.splice(index, 1);
      // 关闭钉住标签时同步回写存储（钉住项已不在列表）
      if (view.pinned) persistPinned();
      markClean(view.key);
      resolve([...visitedViews.value]);
    });
  }

  function delCachedView(view: TagView) {
    const { fullPath } = view;
    return new Promise<string[]>((resolve) => {
      const index = cachedViews.value.indexOf(fullPath);
      if (index > -1) {
        cachedViews.value.splice(index, 1);
      }
      resolve([...cachedViews.value]);
    });
  }

  function delOtherVisitedViews(view: TagView) {
    return new Promise<TagView[]>((resolve) => {
      // 常驻与钉住标签豁免（钉住 = 用户显式常驻）
      visitedViews.value = visitedViews.value.filter((item) => {
        return isProtected(item) || item.key === view.key;
      });
      pruneDirtyKeys();
      resolve([...visitedViews.value]);
    });
  }

  function delOtherCachedViews(view: TagView) {
    const { fullPath } = view;
    return new Promise<string[]>((resolve) => {
      const index = cachedViews.value.indexOf(fullPath);
      if (index > -1) {
        cachedViews.value = cachedViews.value.slice(index, index + 1);
      } else {
        // if index = -1, there is no cached tags
        cachedViews.value = [];
      }
      resolve([...cachedViews.value]);
    });
  }

  function updateVisitedView(view: TagView) {
    for (const item of visitedViews.value) {
      if (item.key === view.key) {
        Object.assign(item, view);
        break;
      }
    }
  }

  /**
   * 根据路径更新标签标题（PRD 第 5 条：标题动态生成）
   *
   * 详情页在数据加载完成后调用，覆盖为「对象类型 + 名称 + 状态」。
   */
  function updateTagName(fullPath: string, title: string) {
    const tag = visitedViews.value.find((item) => item.fullPath === fullPath);
    if (tag) {
      tag.title = title;
    }
  }

  /** 添加视图（缓存与标签区解耦：缓存按 meta.keepAlive，标签区按 {@link isTabEligible}） */
  function addView(view: TagView): AddViewResult {
    addCachedView(view);
    return addVisitedView(view);
  }

  function delView(view: TagView): Promise<TagsViewResult> {
    return new Promise((resolve) => {
      delVisitedView(view);
      delCachedView(view);
      resolve({
        visitedViews: [...visitedViews.value],
        cachedViews: [...cachedViews.value],
      });
    });
  }

  function delOtherViews(view: TagView): Promise<TagsViewResult> {
    return new Promise((resolve) => {
      delOtherVisitedViews(view);
      delOtherCachedViews(view);
      resolve({
        visitedViews: [...visitedViews.value],
        cachedViews: [...cachedViews.value],
      });
    });
  }

  function delLeftViews(view: TagView): Promise<DirectionalTagsViewResult> {
    return new Promise((resolve) => {
      const currIndex = visitedViews.value.findIndex((item) => item.key === view.key);
      if (currIndex === -1) {
        resolve({ visitedViews: [...visitedViews.value] });
        return;
      }
      visitedViews.value = visitedViews.value.filter((item, index) => {
        if (index >= currIndex || isProtected(item)) {
          return true;
        }
        delCachedView(item);
        markClean(item.key);
        return false;
      });
      resolve({ visitedViews: [...visitedViews.value] });
    });
  }

  function delRightViews(view: TagView): Promise<DirectionalTagsViewResult> {
    return new Promise((resolve) => {
      const currIndex = visitedViews.value.findIndex((item) => item.key === view.key);
      if (currIndex === -1) {
        resolve({ visitedViews: [...visitedViews.value] });
        return;
      }
      visitedViews.value = visitedViews.value.filter((item, index) => {
        if (index <= currIndex || isProtected(item)) {
          return true;
        }
        delCachedView(item);
        markClean(item.key);
        return false;
      });
      resolve({ visitedViews: [...visitedViews.value] });
    });
  }

  /**
   * 关闭所有（一键全部关闭）
   *
   * 常驻（affix）与钉住（pinned）标签豁免 —— 二者语义同为「用户的工作区常驻集合」，
   * 也因此刷新后仍能恢复（PRD 第 3、7 条）。
   */
  function delAllViews(): Promise<TagsViewResult> {
    return new Promise((resolve) => {
      visitedViews.value = visitedViews.value.filter((item) => isProtected(item));
      cachedViews.value = [];
      pruneDirtyKeys();
      resolve({
        visitedViews: [...visitedViews.value],
        cachedViews: [...cachedViews.value],
      });
    });
  }

  function delAllVisitedViews() {
    return new Promise<TagView[]>((resolve) => {
      visitedViews.value = visitedViews.value.filter((item) => isProtected(item));
      pruneDirtyKeys();
      resolve([...visitedViews.value]);
    });
  }

  function delAllCachedViews() {
    return new Promise<string[]>((resolve) => {
      cachedViews.value = [];
      resolve([...cachedViews.value]);
    });
  }

  /** 登出收尾：清空标签区与钉住持久化（钉住属于会话内工作区，不跨账号残留） */
  function resetWorkspace() {
    visitedViews.value = [];
    cachedViews.value = [];
    dirtyKeys.value = [];
    Storage.remove(STORAGE_KEYS.PINNED_TAGS);
  }

  /** 关闭当前标签 */
  function closeCurrentView() {
    const tags: TagView = {
      key: resolveTabKey(route),
      name: route.name as string,
      title: route.meta.title as string,
      path: route.path,
      fullPath: route.fullPath,
      icon: route.meta?.icon as string | undefined,
      affix: route.meta?.affix,
      keepAlive: route.meta?.keepAlive,
      multi: route.meta?.tabMode === "detail",
      query: route.query,
    };
    delView(tags).then((res) => {
      if (isActive(tags)) {
        toLastView(res.visitedViews, tags);
      }
    });
  }

  function isActive(tag: TagView) {
    return tag.key === resolveTabKey(route);
  }

  function toLastView(visitedViewsList: TagView[], view?: TagView) {
    const latestView = visitedViewsList.slice(-1)[0];
    if (latestView && latestView.fullPath) {
      router.push(latestView.fullPath);
    } else {
      // now the default is to redirect to the home page if there is no tags-view,
      // you can adjust it according to your needs.
      if (view?.name === "Dashboard") {
        // to reload home page
        router.replace("/redirect" + view.fullPath);
      } else {
        router.push("/");
      }
    }
  }

  return {
    visitedViews,
    cachedViews,
    dirtyKeys,
    markDirty,
    markClean,
    isDirty,
    restorePinned,
    persistPinned,
    pinView,
    unpinView,
    setOrder,
    addVisitedView,
    addCachedView,
    delVisitedView,
    delCachedView,
    delOtherVisitedViews,
    delOtherCachedViews,
    updateVisitedView,
    addView,
    delView,
    delOtherViews,
    delLeftViews,
    delRightViews,
    delAllViews,
    delAllVisitedViews,
    delAllCachedViews,
    resetWorkspace,
    closeCurrentView,
    isActive,
    toLastView,
    updateTagName,
  };
});
