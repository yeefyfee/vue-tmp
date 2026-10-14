import type { RouteRecordRaw } from "vue-router";

/**
 * 一级导航权威注册表（MVP-WEB-01-04 · 六组导航）
 *
 * 唯一来源：PRD《页面信息架构》§5.1「Web 一级导航」与《页面清单》「页面清单总表」。
 * 本表是 **6 组 / 16 模块** 的唯一事实来源，供三处消费：
 *
 *  1. **左侧导航分组渲染**（`LayoutSidebar` → `buildNavGroups`）—— 无模块权限整组隐藏；
 *  2. **路由守卫 403 判定**（`router/guards/permission` → `isKnownNavPath`）——
 *     直链访问「清单内但未授权」的页面 → 403，未知路径 → 404，
 *     保证「导航隐藏」与「403」行为一致（PRD §空态、无权限态与加载态 第 2 条）；
 *  3. **模块默认落地页**（面包屑首层回跳、角色默认落地页）。
 *
 * 设计口径（重要）：
 *  · 导航是**派生**的，不是写死的 —— 分组由「本次账号真实拿到的路由」推导，
 *    没有路由的模块/分组一律不渲染（避免出现"看得到入口但打不开"的死链，这是 PRD 硬红线）；
 *  · 业务模块的路由由后端 `GET /menus/routes` 按权限下发，随各页面任务（MVP-WEB-02+）落地后
 *    自动归入对应分组，本表无需改动；
 *  · 维护规则：新增页面必须先登记《页面清单》，再补本表（清单维护规则 1）。
 */

/** 模块注册项 */
export interface NavModuleDef {
  /** 模块 key（= 路由路径首段；商品模块含 products / inventory 两段） */
  key: string;
  /** 路径前缀（首段精确匹配，避免 orders 误匹配 order-xxx） */
  pathPrefixes: string[];
  /** 默认落地页（绝对路径，PRD §导航布局与结构 第三列） */
  landing: string;
  /** 归属分组 key（对应 {@link NAV_GROUPS}） */
  group: string;
}

/** 分组注册项 */
export interface NavGroupDef {
  /** 分组 key */
  key: string;
  /** i18n key（走 `translateRouteTitle("navGroup.xxx")` → `route.navGroup.xxx`） */
  titleKey: string;
  /** 组内模块（数组顺序 = 导航展示顺序） */
  modules: string[];
}

/** 未登记模块的兜底分组（仅在出现注册表外模块时渲染，正常情形下为空） */
export const NAV_GROUP_OTHER = "other";

/**
 * 六组一级导航（PRD《页面信息架构》§导航布局与结构）
 *
 * | 分组 | 模块 | 默认落地页 |
 * | 工作台 | 首页 | dashboard |
 * | 经营线 | 经营、数据 | analytics/overview |
 * | 业务线 | 预约、订单、寄养 | bookings/calendar |
 * | 对象中心 | 宠物、客户 | pets |
 * | 管理线 | 服务、门店、员工、会员、商品、营销、财务 | services |
 * | 系统 | 设置 | settings/roles |
 */
export const NAV_GROUPS: NavGroupDef[] = [
  { key: "workbench", titleKey: "navGroup.workbench", modules: ["dashboard"] },
  { key: "operation", titleKey: "navGroup.operation", modules: ["analytics", "data"] },
  { key: "business", titleKey: "navGroup.business", modules: ["bookings", "orders", "boarding"] },
  { key: "object", titleKey: "navGroup.object", modules: ["pets", "customers"] },
  {
    key: "management",
    titleKey: "navGroup.management",
    modules: ["services", "stores", "staff", "memberships", "products", "marketing", "finance"],
  },
  { key: "system", titleKey: "navGroup.system", modules: ["settings"] },
];

/**
 * 16 个模块注册项（路径前缀取自《页面清单》「页面清单总表」）
 *
 * 注：`settings` 额外登记 `system` 前缀 —— 存量 sys_menu 的系统管理域（用户/角色/菜单/部门/
 * 字典/日志/配置）落在 `/system` 下，语义上同属「系统」组；待 02+ 页面任务按 PRD
 * `settings/*` 命名补充新页面后，两者并存不冲突。
 */
export const NAV_MODULES: NavModuleDef[] = [
  { key: "dashboard", pathPrefixes: ["dashboard"], landing: "/dashboard", group: "workbench" },
  {
    key: "analytics",
    pathPrefixes: ["analytics"],
    landing: "/analytics/overview",
    group: "operation",
  },
  { key: "data", pathPrefixes: ["data"], landing: "/data/board", group: "operation" },
  { key: "bookings", pathPrefixes: ["bookings"], landing: "/bookings/calendar", group: "business" },
  { key: "orders", pathPrefixes: ["orders"], landing: "/orders", group: "business" },
  { key: "boarding", pathPrefixes: ["boarding"], landing: "/boarding/rooms", group: "business" },
  { key: "pets", pathPrefixes: ["pets"], landing: "/pets", group: "object" },
  { key: "customers", pathPrefixes: ["customers"], landing: "/customers", group: "object" },
  { key: "services", pathPrefixes: ["services"], landing: "/services", group: "management" },
  { key: "stores", pathPrefixes: ["stores"], landing: "/stores", group: "management" },
  { key: "staff", pathPrefixes: ["staff"], landing: "/staff", group: "management" },
  {
    key: "memberships",
    pathPrefixes: ["memberships"],
    landing: "/memberships",
    group: "management",
  },
  // 商品模块：商品/SKU 与库存（含入库出库、盘点）同属《页面清单》「商品」模块
  {
    key: "products",
    pathPrefixes: ["products", "inventory"],
    landing: "/products",
    group: "management",
  },
  {
    key: "marketing",
    pathPrefixes: ["marketing"],
    landing: "/marketing/rules",
    group: "management",
  },
  { key: "finance", pathPrefixes: ["finance"], landing: "/finance/payments", group: "management" },
  {
    key: "settings",
    pathPrefixes: ["settings", "system"],
    landing: "/settings/roles",
    group: "system",
  },
];

/** 模块 key → 模块注册项 */
const MODULE_BY_KEY = new Map(NAV_MODULES.map((item) => [item.key, item]));

/** 路径首段 → 模块注册项 */
const MODULE_BY_PREFIX = new Map<string, NavModuleDef>();
NAV_MODULES.forEach((item) => {
  item.pathPrefixes.forEach((prefix) => MODULE_BY_PREFIX.set(prefix, item));
});

/**
 * 拆分路径为段（去掉 query / hash、忽略前导与尾随斜杠）
 *
 * `/system/user?tab=1` → `["system", "user"]`；`/` → `[]`；`dashboard` → `["dashboard"]`
 */
export function splitPathSegments(path: string): string[] {
  return String(path ?? "")
    .split(/[?#]/)[0]
    .split("/")
    .filter((segment) => segment.length > 0);
}

/** 按路径首段解析所属模块（精确匹配首段，找不到返回 undefined） */
export function findNavModuleByPath(path: string): NavModuleDef | undefined {
  const [first] = splitPathSegments(path);
  return first ? MODULE_BY_PREFIX.get(first) : undefined;
}

/**
 * 目标路径是否属于「页面清单内的已知模块」
 *
 * 用于把 404（路径不存在）与 403（路径存在但当前账号无权限）区分开：
 * 已知模块路径 + 路由表未注册 ⇒ 该账号无此模块权限 ⇒ 403。
 */
export function isKnownNavPath(path: string): boolean {
  const segments = splitPathSegments(path);
  // 根路径即工作台
  if (segments.length === 0) return true;
  return MODULE_BY_PREFIX.has(segments[0]);
}

/** 模块默认落地页（未登记模块返回 undefined） */
export function getModuleLanding(moduleKey: string): string | undefined {
  return MODULE_BY_KEY.get(moduleKey)?.landing;
}

/** 侧栏分组（渲染用） */
export interface NavGroupRoutes {
  /** 分组 key（{@link NAV_GROUP_OTHER} 为兜底分组） */
  key: string;
  /** i18n key */
  titleKey: string;
  /** 分组内的顶层路由（顺序 = 注册表模块顺序） */
  routes: RouteRecordRaw[];
}

/**
 * 把「账号实际拿到的路由」按六组分桶
 *
 * - 顶层路由按路径首段归入模块，再按模块归入分组；`/` 这类壳路由取其首个可见子路由的首段；
 * - **空分组不产出**（无权限整组隐藏，PRD 硬要求）；
 * - 注册表之外的模块统一进兜底分组，排在最末，保证不丢入口。
 */
export function buildNavGroups(routes: RouteRecordRaw[]): NavGroupRoutes[] {
  const visible = (routes ?? []).filter((route) => !route.meta?.hidden);
  const buckets = new Map<string, RouteRecordRaw[]>();

  visible.forEach((route) => {
    const groupKey = resolveRouteGroupKey(route);
    const list = buckets.get(groupKey);
    if (list) {
      list.push(route);
    } else {
      buckets.set(groupKey, [route]);
    }
  });

  const groups: NavGroupRoutes[] = [];

  NAV_GROUPS.forEach((group) => {
    const bucket = buckets.get(group.key);
    if (!bucket || bucket.length === 0) return;
    groups.push({
      key: group.key,
      titleKey: group.titleKey,
      routes: sortRoutesByModuleOrder(bucket, group.modules),
    });
  });

  const others = buckets.get(NAV_GROUP_OTHER);
  if (others && others.length > 0) {
    groups.push({ key: NAV_GROUP_OTHER, titleKey: "navGroup.other", routes: others });
  }

  return groups;
}

/** 解析顶层路由所属分组（未登记 → 兜底分组） */
function resolveRouteGroupKey(route: RouteRecordRaw): string {
  const module = resolveRouteModule(route);
  return module?.group ?? NAV_GROUP_OTHER;
}

/** 解析顶层路由所属模块 */
function resolveRouteModule(route: RouteRecordRaw): NavModuleDef | undefined {
  const own = findNavModuleByPath(route.path);
  if (own) return own;

  // 根路由（"/"）等壳路由：取首个可见子路由的首段（如 / → dashboard）
  const child = (route.children ?? []).find((item) => !item.meta?.hidden);
  return child ? findNavModuleByPath(child.path) : undefined;
}

/** 组内路由按模块在分组定义中的顺序排序（保持稳定） */
function sortRoutesByModuleOrder(
  routes: RouteRecordRaw[],
  moduleOrder: string[]
): RouteRecordRaw[] {
  const rank = (route: RouteRecordRaw) => {
    const key = resolveRouteModule(route)?.key;
    const index = key ? moduleOrder.indexOf(key) : -1;
    return index < 0 ? moduleOrder.length : index;
  };

  return [...routes].sort((a, b) => rank(a) - rank(b));
}
