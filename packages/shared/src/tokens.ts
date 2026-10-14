/**
 * 设计令牌（Design Tokens）
 *
 * 三端（Web / 员工端 / 宠主端）唯一常量来源。
 *
 * 约束（决策 A5 / 08｜UI 章节）：
 * - 语义色板是「唯一来源」，状态色值禁止在业务代码里私有定义；
 * - 08｜UI 章节原文将此文件标注为「待 UI 设计阶段细化」，此处先落地已定版部分，
 *   后续细化只需改本文件，三端同步生效。
 */

/** 语义色板 —— 全站唯一来源，禁止私有定义状态色 */
export const SEMANTIC_COLORS = {
  /** 信息 / 进行中 */
  info: "#2563EB",
  /** 成功 / 已完成 */
  success: "#16A34A",
  /** 警示 / 待处理 / 待支付 */
  warning: "#D97706",
  /** 危险 / 失败 / 异常 */
  danger: "#DC2626",
  /** 中性 / 已结束 / 已关闭 */
  neutral: "#6B7280",
} as const;

/** 语义色令牌名 */
export type SemanticColorToken = keyof typeof SEMANTIC_COLORS;
/** 语义色十六进制值 */
export type SemanticColorValue = (typeof SEMANTIC_COLORS)[SemanticColorToken];

/**
 * 字号（Web）
 * - 正文 14px / 辅助 12px / 区块标题 16px / 页面标题 20px
 */
export const FONT_SIZE_WEB = {
  pageTitle: 20,
  sectionTitle: 16,
  body: 14,
  helper: 12,
} as const;

/**
 * 字号（Mobile）
 * - 正文 15pt / 辅助 13pt / 下限 12pt
 */
export const FONT_SIZE_MOBILE = {
  body: 15,
  helper: 13,
  minimum: 12,
} as const;

/** 布局常量（三段式：左固定导航 + 顶部上下文栏 + 中央工作区） */
export const LAYOUT = {
  /** 左导航展开宽度（px） */
  NAV_WIDTH_EXPANDED: 240,
  /** 左导航折叠宽度（px） */
  NAV_WIDTH_COLLAPSED: 64,
  /** 中央工作区最大宽度（px），居中 */
  WORKSPACE_MAX_WIDTH: 1440,
} as const;

/** Web 多标签页（Workspace Tab）上限 */
export const WORKSPACE_TAB = {
  /** 同时打开上限，超出按 LRU 淘汰 */
  MAX: 12,
  /** 可钉住数量上限 */
  PINNED_MAX: 3,
} as const;

/** 时间与格式化约定（API 时间为 ISO 8601 带时区，展示按此本地化） */
export const DATE_TIME = {
  TIME_ZONE: "Asia/Shanghai",
  DATE: "YYYY-MM-DD",
  DATE_TIME: "YYYY-MM-DD HH:mm:ss",
  TIME: "HH:mm",
} as const;
