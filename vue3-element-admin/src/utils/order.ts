/**
 * 订单域纯函数工具（MVP-WEB-07-01 订单列表 / 07-02 订单详情四页签 / 07-04 优惠与权益分摊 /
 * 07-05 履约联动）
 *
 * 🔴 单源约束：状态值域与语义色**一律取 `@peluvida/shared`** 的
 * `OrderStatus` / `ORDER_STATUS_META`、`OrderItemType` / `OrderItemTypeMeta`、
 * `OrderItemDiscountSource` / `ORDER_ITEM_DISCOUNT_SOURCE_META`、
 * `OrderItemFulfillStatus` / `ORDER_ITEM_FULFILL_STATUS_META`、`AuditAction`，
 * 页面不得私写映射表（文案走 i18n key，与状态文案同范式）。
 */

import {
  AuditAction,
  ORDER_STATUS_META,
  OrderItemDiscountSource,
  OrderItemFulfillStatus,
  OrderItemType,
  OrderStatus,
  getOrderItemDiscountSourceMeta,
  getOrderItemFulfillStatusMeta,
  getOrderItemTypeMeta,
  getStatusMeta,
  type SemanticColorToken,
  type StatusMeta,
} from "@peluvida/shared";

const ORDER_STATUS_LABEL_KEYS: Record<OrderStatus, string> = {
  [OrderStatus.DRAFT]: "order.value.statusDraft",
  [OrderStatus.PENDING_PAYMENT]: "order.value.statusPendingPayment",
  [OrderStatus.PAID]: "order.value.statusPaid",
  [OrderStatus.IN_PROGRESS]: "order.value.statusInProgress",
  [OrderStatus.COMPLETED]: "order.value.statusCompleted",
  [OrderStatus.REFUNDED]: "order.value.statusRefunded",
  [OrderStatus.CLOSED]: "order.value.statusClosed",
};

export const ORDER_STATUS_OPTIONS: ReadonlyArray<{ value: OrderStatus; labelKey: string }> = (
  Object.values(OrderStatus) as OrderStatus[]
).map((value) => ({
  value,
  labelKey: ORDER_STATUS_LABEL_KEYS[value],
}));

const TAG_TYPE_BY_COLOR: Record<
  SemanticColorToken,
  "primary" | "success" | "info" | "warning" | "danger"
> = {
  info: "primary",
  success: "success",
  warning: "warning",
  danger: "danger",
  neutral: "info",
};

const DEFAULT_TAG_TYPE = TAG_TYPE_BY_COLOR.neutral;

export function orderStatusMeta(status: string | null | undefined): StatusMeta | undefined {
  if (!status) return undefined;
  return getStatusMeta(ORDER_STATUS_META, status);
}

export function orderStatusLabelKey(status: string | null | undefined): string {
  if (!status) return "order.value.unknownStatus";
  const key = ORDER_STATUS_LABEL_KEYS[status as OrderStatus];
  if (!key) return "order.value.unknownStatus";
  return key;
}

export function orderStatusTagType(
  status: string | null | undefined
): "primary" | "success" | "info" | "warning" | "danger" {
  const meta = orderStatusMeta(status);
  if (!meta) return DEFAULT_TAG_TYPE;
  return TAG_TYPE_BY_COLOR[meta.color] ?? DEFAULT_TAG_TYPE;
}

/**
 * 订单当前是否可编辑 / 可删除（MVP-WEB-07-03）
 *
 * 判据与后端 `ORDER_EDITABLE_STATUSES` 同源（shared `OrderStatus`）：
 * 仅 draft / pending_payment；paid 起进入履约闭环即冻结。
 */
export function isOrderEditable(status: string | null | undefined): boolean {
  return status === OrderStatus.DRAFT || status === OrderStatus.PENDING_PAYMENT;
}

/** 金额（分，字符串）→ 元（格式化展示） */
export function orderAmountLabel(value: string | null | undefined): string {
  if (!value) return "-";
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return `¥${(num / 100).toFixed(2)}`;
}

// ─────────────────────────── 订单明细（07-02 明细页签） ───────────────────────────

/**
 * 明细类型 → 文案 key（值域来自 shared `OrderItemType`，穷尽性由 `Record` 保证：
 * shared 增删类型时此处编译报错，杜绝静默漏项）。
 */
const ORDER_ITEM_TYPE_LABEL_KEYS: Record<OrderItemType, string> = {
  [OrderItemType.SERVICE]: "order.itemType.service",
  [OrderItemType.PRODUCT]: "order.itemType.product",
  [OrderItemType.PACKAGE]: "order.itemType.package",
};

export function orderItemTypeLabelKey(value: number | null | undefined): string {
  if (value === null || value === undefined) return "order.value.unknownItemType";
  const key = ORDER_ITEM_TYPE_LABEL_KEYS[value as OrderItemType];
  return key ?? "order.value.unknownItemType";
}

/** 明细类型标签的 el-tag 语义色 */
export function orderItemTypeTagType(
  value: number | null | undefined
): "primary" | "success" | "info" | "warning" | "danger" {
  const meta = getOrderItemTypeMeta(value ?? undefined);
  if (!meta) return DEFAULT_TAG_TYPE;
  return TAG_TYPE_BY_COLOR[meta.color] ?? DEFAULT_TAG_TYPE;
}

/**
 * 明细小计（分 → 展示串）
 *
 * 🔴 单价 × 数量在**分**域做整数运算（`Number(unitPrice) * quantity`），再统一除以 100
 * 展示；不引入「元」域浮点乘算（金额铁律，见 shared/money.ts）。
 * 单价在 wire 上可能是字符串（响应拦截器对非安全整数 number 的序列化口径，踩坑 126）
 * ⇒ 先 `Number()` 归一。
 */
export function orderItemSubtotalLabel(
  unitPrice: string | number | null | undefined,
  quantity: number | null | undefined
): string {
  const price = Number(unitPrice);
  const qty = Number(quantity);
  if (!Number.isFinite(price) || !Number.isFinite(qty) || qty <= 0) return "-";
  return `¥${((price * qty) / 100).toFixed(2)}`;
}

// ─────────────────────── 优惠与权益分摊（07-04 明细「折扣来源」列） ───────────────────────

/**
 * 折扣来源 → 文案 key（值域来自 shared `OrderItemDiscountSource`，
 * 穷尽性由 `Record` 保证：shared 增删来源时此处编译报错，杜绝静默漏项）。
 */
const ORDER_ITEM_DISCOUNT_SOURCE_LABEL_KEYS: Record<OrderItemDiscountSource, string> = {
  [OrderItemDiscountSource.NONE]: "order.discountSource.none",
  [OrderItemDiscountSource.MANUAL]: "order.discountSource.manual",
  [OrderItemDiscountSource.MEMBER_LEVEL]: "order.discountSource.memberLevel",
  [OrderItemDiscountSource.COUPON]: "order.discountSource.coupon",
};

export function orderItemDiscountSourceLabelKey(value: number | null | undefined): string {
  if (value === null || value === undefined) return "order.value.unknownDiscountSource";
  const key = ORDER_ITEM_DISCOUNT_SOURCE_LABEL_KEYS[value as OrderItemDiscountSource];
  return key ?? "order.value.unknownDiscountSource";
}

/** 折扣来源标签的 el-tag 语义色 */
export function orderItemDiscountSourceTagType(
  value: number | null | undefined
): "primary" | "success" | "info" | "warning" | "danger" {
  const meta = getOrderItemDiscountSourceMeta(value ?? undefined);
  if (!meta) return DEFAULT_TAG_TYPE;
  return TAG_TYPE_BY_COLOR[meta.color] ?? DEFAULT_TAG_TYPE;
}

/** 该行是否实际带优惠（分摊额 > 0）—— 为 0 的行不展示金额、来源也应为 NONE */
export function orderItemHasDiscount(value: string | number | null | undefined): boolean {
  const num = Number(value);
  return Number.isFinite(num) && num > 0;
}

/**
 * 行优惠额展示文案（分 → 元，带前导空格便于与来源标签同格拼接；0 返回空串）
 *
 * 金额在**分**域取值后统一 `/100`（不引「元」域浮点运算），与列表页金额同源。
 */
export function orderItemDiscountAmountText(value: string | number | null | undefined): string {
  if (!orderItemHasDiscount(value)) return "";
  return ` -${orderAmountLabel(String(value))}`;
}

// ─────────────────────── 履约联动（07-05 明细「履约状态」列 + 头部流转按钮） ───────────────────────

/**
 * 明细履约状态 → 文案 key（值域来自 shared `OrderItemFulfillStatus`，
 * 穷尽性由 `Record` 保证：shared 增删取值时此处编译报错，杜绝静默漏项）。
 */
const ORDER_ITEM_FULFILL_STATUS_LABEL_KEYS: Record<OrderItemFulfillStatus, string> = {
  [OrderItemFulfillStatus.PENDING]: "order.fulfillStatus.pending",
  [OrderItemFulfillStatus.IN_PROGRESS]: "order.fulfillStatus.inProgress",
  [OrderItemFulfillStatus.COMPLETED]: "order.fulfillStatus.completed",
};

export function orderItemFulfillStatusLabelKey(value: number | null | undefined): string {
  if (value === null || value === undefined) return "order.value.unknownFulfillStatus";
  const key = ORDER_ITEM_FULFILL_STATUS_LABEL_KEYS[value as OrderItemFulfillStatus];
  return key ?? "order.value.unknownFulfillStatus";
}

/** 明细履约状态标签的 el-tag 语义色 */
export function orderItemFulfillStatusTagType(
  value: number | null | undefined
): "primary" | "success" | "info" | "warning" | "danger" {
  const meta = getOrderItemFulfillStatusMeta(value ?? undefined);
  if (!meta) return DEFAULT_TAG_TYPE;
  return TAG_TYPE_BY_COLOR[meta.color] ?? DEFAULT_TAG_TYPE;
}

/**
 * 订单当前是否可「开始服务」（`paid`）—— 判据与后端 `startOrder` 守卫同源
 * （`OrderStatus.PAID` 唯一入口，其余状态服务端返 A0911）。
 */
export function isOrderStartable(status: string | null | undefined): boolean {
  return status === OrderStatus.PAID;
}

/**
 * 订单当前是否可「完成服务」（`in_progress`）—— 判据与后端 `completeOrder` 守卫同源
 * （`OrderStatus.IN_PROGRESS` 唯一入口，其余状态服务端返 A0911）。
 */
export function isOrderCompletable(status: string | null | undefined): boolean {
  return status === OrderStatus.IN_PROGRESS;
}

// ─────────────────────────── 操作日志（07-02 操作日志页签） ───────────────────────────

/**
 * 审计动作 → 文案 key（值域来自 shared `AuditAction`，穷尽性由 `Record` 保证）
 */
const ORDER_AUDIT_ACTION_LABEL_KEYS: Record<AuditAction, string> = {
  [AuditAction.CREATE]: "order.audit.actionCreate",
  [AuditAction.UPDATE]: "order.audit.actionUpdate",
  [AuditAction.DELETE]: "order.audit.actionDelete",
  [AuditAction.ENABLE]: "order.audit.actionEnable",
  [AuditAction.DISABLE]: "order.audit.actionDisable",
  [AuditAction.EXPORT]: "order.audit.actionExport",
  [AuditAction.GRANT]: "order.audit.actionGrant",
};

export function orderAuditActionLabelKey(action: number | null | undefined): string {
  if (action === null || action === undefined) return "order.audit.actionUnknown";
  const key = ORDER_AUDIT_ACTION_LABEL_KEYS[action as AuditAction];
  return key ?? "order.audit.actionUnknown";
}

/** 审计动作标签的 el-tag 语义色（按「破坏性 / 建设性」分组，非 per-value 私写映射表） */
export function orderAuditActionTagType(
  action: number | null | undefined
): "primary" | "success" | "info" | "warning" | "danger" {
  if (action === AuditAction.CREATE || action === AuditAction.ENABLE) return "success";
  if (action === AuditAction.DELETE || action === AuditAction.DISABLE) return "danger";
  if (action === AuditAction.EXPORT || action === AuditAction.GRANT) return "warning";
  if (action === AuditAction.UPDATE) return "primary";
  return "info";
}

/** 操作人展示名：`operatorName` 为空且 `operatorType === 0` ⇒ 系统动作（i18n 文案） */
export function orderAuditOperatorLabel(
  operatorName: string | null | undefined,
  operatorType: number | null | undefined
): { text: string | null; labelKey: string } {
  const name = (operatorName ?? "").trim();
  if (name !== "") return { text: name, labelKey: "" };
  if (operatorType === 0) return { text: null, labelKey: "order.audit.operatorSystem" };
  return { text: null, labelKey: "order.audit.operatorUnknown" };
}

/** 前后值快照 → 「字段: before → after」纯文本行（仅变更字段；值统一字符串化） */
export function orderAuditDiffLines(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): Array<{ field: string; before: string; after: string }> {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].sort();
  const text = (value: unknown): string => {
    if (value === null || value === undefined) return "-";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  };
  return keys.map((field) => ({
    field,
    before: text(before?.[field]),
    after: text(after?.[field]),
  }));
}
