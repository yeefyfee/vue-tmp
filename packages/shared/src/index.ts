/**
 * @peluvida/shared —— PeluVida OS 三端与后端共享的唯一常量来源
 *
 * 覆盖：
 * - 状态机枚举与状态映射（Booking / Order / Payment / Stay / CareTask / Room）
 * - 金额 Money 值对象与统一格式化（分）
 * - 分页契约（list / total / page / page_size）
 * - 设计令牌（语义色板、字号、布局）
 * - RBAC 权限码与数据范围
 *
 * 约束：本包只放「纯常量 + 纯函数」，不得引入任何运行时依赖与 IO。
 */

export * from "./tokens";
export * from "./status/index";
export * from "./pagination";
export * from "./money";
export * from "./format";
export * from "./rbac";
export * from "./redis-key";
export * from "./tenant-capability";
export * from "./audit";
export * from "./store-config";
export * from "./customer";
export * from "./timeline";
export * from "./media";
export * from "./notification";
