/** 应用存储前缀 */
export const APP_PREFIX = "vea";

/**
 * 超级管理员角色标识
 *
 * @description
 * 拥有系统最高权限，可以访问所有资源
 */
export const ROLE_ROOT = "ROOT";

/**
 * 平台租户ID
 *
 * @description
 * 用于前端识别平台租户（不参与套餐/菜单配置）
 */
export const PLATFORM_TENANT_ID = 0;

/**
 * 存储键名常量
 *
 * @description
 * 统一管理所有 localStorage/sessionStorage 的键名
 * 命名规则：{APP_PREFIX}:{分类}:{具体名称}
 */
export const STORAGE_KEYS = {
  // 认证
  ACCESS_TOKEN: `${APP_PREFIX}:auth:access_token`,
  REFRESH_TOKEN: `${APP_PREFIX}:auth:refresh_token`,
  REMEMBER_ME: `${APP_PREFIX}:auth:remember_me`,

  // 租户
  TENANT_ID: `${APP_PREFIX}:tenant:id`,
  TENANT_INFO: `${APP_PREFIX}:tenant:info`,

  // 门店上下文（01-03 顶部上下文栏·门店切换器）
  ACTIVE_STORE_ID: `${APP_PREFIX}:store:active_id`,

  // 系统
  DICT_CACHE: `${APP_PREFIX}:system:dict_cache`,

  // UI
  SHOW_TAGS_VIEW: `${APP_PREFIX}:ui:show_tags_view`,
  TAGS_VIEW_STYLE: `${APP_PREFIX}:ui:tags_view_style`,
  /** 工作区标签页·钉住标签（01-05：刷新后只恢复钉住项） */
  PINNED_TAGS: `${APP_PREFIX}:ui:pinned_tags`,
  /**
   * 列表页列配置前缀（02-01）
   *
   * 实际键 = `{前缀}:{账号}:{命名空间}`，按账号隔离（PRD《Web规范》§表格规范 1）。
   */
  TABLE_COLUMNS: `${APP_PREFIX}:ui:table_columns`,
  SHOW_APP_LOGO: `${APP_PREFIX}:ui:show_app_logo`,
  SHOW_WATERMARK: `${APP_PREFIX}:ui:show_watermark`,
  PAGE_SWITCHING_ANIMATION: `${APP_PREFIX}:ui:page_switching_animation`,
  LAYOUT: `${APP_PREFIX}:ui:layout`,
  SIDEBAR_COLOR_SCHEME: `${APP_PREFIX}:ui:sidebar_color_scheme`,
  THEME: `${APP_PREFIX}:ui:theme`,
  THEME_PALETTE: `${APP_PREFIX}:ui:theme_palette`,
  THEME_COLORS: `${APP_PREFIX}:ui:theme_colors`,
  GRAY_MODE: `${APP_PREFIX}:ui:gray_mode`,
  COLOR_WEAK: `${APP_PREFIX}:ui:color_weak`,

  // 应用
  DEVICE: `${APP_PREFIX}:app:device`,
  SIZE: `${APP_PREFIX}:app:size`,
  LANGUAGE: `${APP_PREFIX}:app:language`,
  SIDEBAR_STATUS: `${APP_PREFIX}:app:sidebar_status`,
  ACTIVE_TOP_MENU_PATH: `${APP_PREFIX}:app:active_top_menu_path`,
} as const;

/** 存储键名类型 */
export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/**
 * 每周营业时段键位（MVP-WEB-02-03）
 *
 * @description
 * 与后端 `niulai-nest/src/store/business-hours.service.ts` 的 `WEEKDAY_KEYS`
 * 同口径（周一~周日，两字母小写 slug）。后端 `assertValidWeekly` 为**白名单
 * 收敛**口径：键集合必须恰好等于这 7 项（多余键一律拒绝，A0436），
 * 且空天也必须显式给出 `[]` 而不能省略键。
 */
export const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/**
 * 每天最多的营业时段段数（MVP-WEB-02-03）
 *
 * @description
 * 与后端 `MAX_SEGMENTS_PER_DAY` 对齐；超出后端报 A0436，前端先于提交拦截。
 */
export const MAX_SEGMENTS_PER_DAY = 3;
