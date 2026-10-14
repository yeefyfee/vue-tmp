/**
 * 订单状态机（Order）
 *
 * 主链路：draft → pending_payment → paid → in_progress → completed
 * 分支：refunded / closed
 * 规则：一单一宠一闭环；全部明细履约完成且款项结清才可 completed；
 *      completed 触发时间线 / 提成 / 积分 / 套餐扣次。
 */

import type { SemanticColorToken } from "../tokens";
import type { StatusMeta } from "./meta";

export const OrderStatus = {
  DRAFT: "draft",
  PENDING_PAYMENT: "pending_payment",
  PAID: "paid",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  REFUNDED: "refunded",
  CLOSED: "closed",
} as const;

export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const ORDER_STATUS_META: Readonly<Record<OrderStatus, StatusMeta>> = {
  [OrderStatus.DRAFT]: { value: "draft", label: "草稿", color: "neutral" },
  [OrderStatus.PENDING_PAYMENT]: { value: "pending_payment", label: "待支付", color: "warning" },
  [OrderStatus.PAID]: { value: "paid", label: "已支付", color: "info" },
  [OrderStatus.IN_PROGRESS]: { value: "in_progress", label: "进行中", color: "info" },
  [OrderStatus.COMPLETED]: { value: "completed", label: "已完成", color: "success" },
  [OrderStatus.REFUNDED]: { value: "refunded", label: "已退款", color: "danger" },
  [OrderStatus.CLOSED]: { value: "closed", label: "已关闭", color: "neutral" },
};

export const ORDER_STATUS_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  [OrderStatus.DRAFT]: [OrderStatus.PENDING_PAYMENT, OrderStatus.CLOSED],
  [OrderStatus.PENDING_PAYMENT]: [OrderStatus.PAID, OrderStatus.CLOSED, OrderStatus.REFUNDED],
  [OrderStatus.PAID]: [OrderStatus.IN_PROGRESS, OrderStatus.REFUNDED],
  [OrderStatus.IN_PROGRESS]: [OrderStatus.COMPLETED, OrderStatus.REFUNDED],
  [OrderStatus.COMPLETED]: [OrderStatus.REFUNDED],
  [OrderStatus.REFUNDED]: [],
  [OrderStatus.CLOSED]: [],
};

/** 终态集合 */
export const ORDER_TERMINAL_STATUSES: readonly OrderStatus[] = [
  OrderStatus.REFUNDED,
  OrderStatus.CLOSED,
];

/**
 * closed 分支的关闭原因枚举（作废 / 超时未支付 / 手工关闭）—— MVP-WEB-07-06
 *
 * − **值域单源**：本枚举是 DB 列 `order.close_reason`、服务端写入、三端渲染的**唯一来源**；
 *   页面不得私写映射表（文案走 i18n key，与状态文案同范式）。
 * − 可达路径：`payment_timeout` = 超时未支付自动关闭（扫描脚本 + worker 消费）；
 *   `customer_cancel` = 待支付态手动「取消」（`PUT /orders/:id/close`）；
 *   `manual` 为后台手动关闭预留（本期无写入口，值域预留、数据侧诚实降级）。
 */
export const ORDER_CLOSE_REASON = {
  MANUAL: "manual",
  PAYMENT_TIMEOUT: "payment_timeout",
  CUSTOMER_CANCEL: "customer_cancel",
} as const;

export type OrderCloseReason = (typeof ORDER_CLOSE_REASON)[keyof typeof ORDER_CLOSE_REASON];

export interface OrderCloseReasonMeta {
  /** 原因值（与 DB `order.close_reason` 一致） */
  readonly value: OrderCloseReason;
  /** 中文文案（三端唯一） */
  readonly label: string;
  /** 语义色令牌 */
  readonly color: SemanticColorToken;
}

export const ORDER_CLOSE_REASON_META: Readonly<Record<OrderCloseReason, OrderCloseReasonMeta>> = {
  [ORDER_CLOSE_REASON.MANUAL]: { value: "manual", label: "手动关闭", color: "neutral" },
  [ORDER_CLOSE_REASON.PAYMENT_TIMEOUT]: {
    value: "payment_timeout",
    label: "超时未支付",
    color: "warning",
  },
  [ORDER_CLOSE_REASON.CUSTOMER_CANCEL]: {
    value: "customer_cancel",
    label: "客户取消",
    color: "neutral",
  },
};

/** 全部关闭原因值（校验与遍历用；后端 DTO / 渲染层共用） */
export const ORDER_CLOSE_REASON_VALUES: readonly OrderCloseReason[] =
  Object.values(ORDER_CLOSE_REASON);

/** 按原因值取元信息；未知值返回 undefined（调用方需处理未知值，勿静默兜底） */
export function getOrderCloseReasonMeta(
  value: string | null | undefined
): OrderCloseReasonMeta | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  return (ORDER_CLOSE_REASON_META as Readonly<Record<string, OrderCloseReasonMeta>>)[value];
}

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * 订单明细类型（`order_item.item_type`，SmallInt）
 *
 * 1 服务 / 2 商品 / 3 套餐（PRD《订单管理》字段设计）。
 * 三端渲染明细类型文案的**唯一来源**——页面不得私写 `1 → '服务'` 这类映射。
 *
 * ⚠️ 与 `StatusMeta` 的差别：`item_type` 是数字列（非 snake_case 字符串状态），
 * 故单列 `OrderItemTypeMeta`（value 为 number），不复用 `StatusMeta`。
 */
export const OrderItemType = {
  /** 服务项（`ref_id` → service_category 叶子） */
  SERVICE: 1,
  /** 商品（`ref_id` → 商品 id） */
  PRODUCT: 2,
  /** 套餐 / 次卡（`ref_id` → 套餐 id） */
  PACKAGE: 3,
} as const;

export type OrderItemType = (typeof OrderItemType)[keyof typeof OrderItemType];

export interface OrderItemTypeMeta {
  /** 类型值（与 DB `order_item.item_type` 一致） */
  readonly value: OrderItemType;
  /** 中文文案（三端唯一） */
  readonly label: string;
  /** 语义色令牌 */
  readonly color: SemanticColorToken;
}

export const ORDER_ITEM_TYPE_META: Readonly<Record<OrderItemType, OrderItemTypeMeta>> = {
  [OrderItemType.SERVICE]: { value: 1, label: "服务", color: "info" },
  [OrderItemType.PRODUCT]: { value: 2, label: "商品", color: "neutral" },
  [OrderItemType.PACKAGE]: { value: 3, label: "套餐", color: "warning" },
};

/** 全部类型值（校验与遍历用；后端 DTO / 渲染层共用） */
export const ORDER_ITEM_TYPE_VALUES: readonly number[] = Object.values(OrderItemType);

/** 按类型值取元信息；未知值返回 undefined（调用方需处理未知类型，勿静默兜底） */
export function getOrderItemTypeMeta(
  value: number | null | undefined
): OrderItemTypeMeta | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  return (ORDER_ITEM_TYPE_META as Readonly<Record<number, OrderItemTypeMeta>>)[value];
}

/**
 * 明细折扣来源（`order_item.discount_source`，SmallInt）—— MVP-WEB-07-04 优惠与权益分摊
 *
 * − 0 无优惠 / 1 手动改价 / 2 会员等级 / 3 优惠券。
 * − **值域单源**：本枚举是 DB 列、服务端写入、三端渲染的**唯一来源**；页面不得私写映射。
 * − ⚠️ 当前**只有 1（手动改价）可达**：`PUT /orders/:id/discount` 是本期唯一的折扣写入端点，
 *   服务端固定落 `MANUAL`。会员等级（`MVP-WEB-11-07`）与优惠券（营销域尚未建模）
 *   的自动优惠上线后由服务端写入同一列位 —— **值域预留、数据侧诚实降级**（不造假数据）。
 */
export const OrderItemDiscountSource = {
  /** 无优惠 */
  NONE: 0,
  /** 手动改价折扣（店长权限 `order:discount`） */
  MANUAL: 1,
  /** 会员等级折扣（11-07 上线后由服务端写入） */
  MEMBER_LEVEL: 2,
  /** 优惠券抵扣（营销域上线后由服务端写入） */
  COUPON: 3,
} as const;

export type OrderItemDiscountSource =
  (typeof OrderItemDiscountSource)[keyof typeof OrderItemDiscountSource];

export interface OrderItemDiscountSourceMeta {
  /** 来源值（与 DB `order_item.discount_source` 一致） */
  readonly value: OrderItemDiscountSource;
  /** 中文文案（三端唯一） */
  readonly label: string;
  /** 语义色令牌 */
  readonly color: SemanticColorToken;
}

export const ORDER_ITEM_DISCOUNT_SOURCE_META: Readonly<
  Record<OrderItemDiscountSource, OrderItemDiscountSourceMeta>
> = {
  [OrderItemDiscountSource.NONE]: { value: 0, label: "无优惠", color: "neutral" },
  [OrderItemDiscountSource.MANUAL]: { value: 1, label: "手动改价", color: "warning" },
  [OrderItemDiscountSource.MEMBER_LEVEL]: { value: 2, label: "会员等级", color: "success" },
  [OrderItemDiscountSource.COUPON]: { value: 3, label: "优惠券", color: "info" },
};

/** 全部来源值（校验与遍历用；后端 DTO / 渲染层共用） */
export const ORDER_ITEM_DISCOUNT_SOURCE_VALUES: readonly number[] =
  Object.values(OrderItemDiscountSource);

/** 按来源值取元信息；未知值返回 undefined（调用方需处理未知值，勿静默兜底） */
export function getOrderItemDiscountSourceMeta(
  value: number | null | undefined
): OrderItemDiscountSourceMeta | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  return (ORDER_ITEM_DISCOUNT_SOURCE_META as Readonly<Record<number, OrderItemDiscountSourceMeta>>)[
    value
  ];
}

/**
 * 明细履约状态（`order_item.fulfill_status`，SmallInt）—— MVP-WEB-07-05 履约联动
 *
 * − 0 未开始 / 1 进行中 / 2 已完成。
 * − **值域单源**：本枚举是 DB 列、服务端写入、三端渲染的**唯一来源**；页面不得私写映射。
 * − **联动语义**：订单 `paid → in_progress`（开始服务）时全部明细行置 `IN_PROGRESS`；
 *   `in_progress → completed`（完成服务）时全部明细行置 `COMPLETED`。行级独立履约
 *   （按行开始 / 完成）当前未建模 ⇒ 本期只随订单整体流转联动，不做行级粒度。
 */
export const OrderItemFulfillStatus = {
  /** 未开始 */
  PENDING: 0,
  /** 进行中 */
  IN_PROGRESS: 1,
  /** 已完成 */
  COMPLETED: 2,
} as const;

export type OrderItemFulfillStatus =
  (typeof OrderItemFulfillStatus)[keyof typeof OrderItemFulfillStatus];

export interface OrderItemFulfillStatusMeta {
  /** 履约状态值（与 DB `order_item.fulfill_status` 一致） */
  readonly value: OrderItemFulfillStatus;
  /** 中文文案（三端唯一） */
  readonly label: string;
  /** 语义色令牌 */
  readonly color: SemanticColorToken;
}

export const ORDER_ITEM_FULFILL_STATUS_META: Readonly<
  Record<OrderItemFulfillStatus, OrderItemFulfillStatusMeta>
> = {
  [OrderItemFulfillStatus.PENDING]: { value: 0, label: "未开始", color: "neutral" },
  [OrderItemFulfillStatus.IN_PROGRESS]: { value: 1, label: "进行中", color: "info" },
  [OrderItemFulfillStatus.COMPLETED]: { value: 2, label: "已完成", color: "success" },
};

/** 全部履约状态值（校验与遍历用；后端 DTO / 渲染层共用） */
export const ORDER_ITEM_FULFILL_STATUS_VALUES: readonly number[] =
  Object.values(OrderItemFulfillStatus);

/** 按履约状态值取元信息；未知值返回 undefined（调用方需处理未知值，勿静默兜底） */
export function getOrderItemFulfillStatusMeta(
  value: number | null | undefined
): OrderItemFulfillStatusMeta | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  return (ORDER_ITEM_FULFILL_STATUS_META as Readonly<Record<number, OrderItemFulfillStatusMeta>>)[
    value
  ];
}
