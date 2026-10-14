/**
 * 支付状态机（Payment）
 *
 * 支付链路：created → paying → success / failed / expired
 * 退款链路：refunding → refunded
 * 规则：回调幂等入账；业务单据驱动账务，流水只增不改。
 */

import type { StatusMeta } from "./meta";

export const PaymentStatus = {
  CREATED: "created",
  PAYING: "paying",
  SUCCESS: "success",
  FAILED: "failed",
  EXPIRED: "expired",
  REFUNDING: "refunding",
  REFUNDED: "refunded",
} as const;

export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const PAYMENT_STATUS_META: Readonly<Record<PaymentStatus, StatusMeta>> = {
  [PaymentStatus.CREATED]: { value: "created", label: "已创建", color: "neutral" },
  [PaymentStatus.PAYING]: { value: "paying", label: "支付中", color: "warning" },
  [PaymentStatus.SUCCESS]: { value: "success", label: "支付成功", color: "success" },
  [PaymentStatus.FAILED]: { value: "failed", label: "支付失败", color: "danger" },
  [PaymentStatus.EXPIRED]: { value: "expired", label: "已过期", color: "neutral" },
  [PaymentStatus.REFUNDING]: { value: "refunding", label: "退款中", color: "warning" },
  [PaymentStatus.REFUNDED]: { value: "refunded", label: "已退款", color: "danger" },
};

/**
 * 支付方式（MVP：微信 V3 主推 / 支付宝二期 / 现金 / 储值 / 套餐；组合支付最多 3 种）
 */
export const PaymentMethod = {
  WECHAT: "wechat",
  ALIPAY: "alipay",
  CASH: "cash",
  STORED_VALUE: "stored_value",
  PACKAGE: "package",
} as const;

export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const PAYMENT_METHOD_META: Readonly<Record<PaymentMethod, StatusMeta>> = {
  [PaymentMethod.WECHAT]: { value: "wechat", label: "微信支付", color: "success" },
  [PaymentMethod.ALIPAY]: { value: "alipay", label: "支付宝", color: "info" },
  [PaymentMethod.CASH]: { value: "cash", label: "现金", color: "neutral" },
  [PaymentMethod.STORED_VALUE]: { value: "stored_value", label: "储值余额", color: "info" },
  [PaymentMethod.PACKAGE]: { value: "package", label: "套餐扣次", color: "info" },
};

/** 组合支付最多支持的支付方式数量 */
export const MAX_COMBINED_PAYMENT_METHODS = 3;

/** 支付形态（全额 / 订金 / 多次 / 挂账） */
export const PaymentMode = {
  FULL: "full",
  DEPOSIT: "deposit",
  INSTALLMENT: "installment",
  ON_ACCOUNT: "on_account",
} as const;

export type PaymentMode = (typeof PaymentMode)[keyof typeof PaymentMode];

export const PAYMENT_MODE_META: Readonly<Record<PaymentMode, StatusMeta>> = {
  [PaymentMode.FULL]: { value: "full", label: "全额支付", color: "info" },
  [PaymentMode.DEPOSIT]: { value: "deposit", label: "订金", color: "warning" },
  [PaymentMode.INSTALLMENT]: { value: "installment", label: "多次支付", color: "info" },
  [PaymentMode.ON_ACCOUNT]: { value: "on_account", label: "挂账", color: "danger" },
};
