/**
 * 金额格式化（三端统一，决策 Q6）
 *
 * 展示层唯一入口：把「分」渲染为「¥1,234.56」。
 * 三端（Web / 员工端 / 宠主端）必须复用本函数，禁止各自 `toFixed`。
 */

import { Money, type Cents, type Yuan, CENTS_PER_YUAN, yuanToCents } from "./money";

export interface FormatMoneyOptions {
  /** 货币符号，默认 "¥"；传空串则不显示符号 */
  symbol?: string;
  /** 小数位数，默认 2 */
  decimals?: number;
  /** 是否千分位分组，默认 true */
  grouping?: boolean;
  /** 是否显示符号，默认 true（symbol 为空串时自动不显示） */
  showSymbol?: boolean;
}

const DEFAULT_SYMBOL = "¥";

function groupDigits(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * 格式化「分」为展示字符串。
 *
 * @example
 * formatCents(123456)            // "¥1,234.56"
 * formatCents(123456, { showSymbol: false }) // "1,234.56"
 * formatCents(-50)               // "-¥0.50"
 */
export function formatCents(cents: Cents | number, options: FormatMoneyOptions = {}): string {
  const { symbol = DEFAULT_SYMBOL, decimals = 2, grouping = true, showSymbol = true } = options;

  const value = Number(cents);
  const negative = value < 0;
  const abs = Math.abs(value);

  const integerPart = Math.floor(abs / CENTS_PER_YUAN);
  const fractionPart = abs - integerPart * CENTS_PER_YUAN;

  let text: string;
  if (decimals <= 0) {
    // 无小数位时按四舍五入处理整体金额
    const rounded = Math.round(abs / CENTS_PER_YUAN);
    text = grouping ? groupDigits(String(rounded)) : String(rounded);
  } else {
    const intText = grouping ? groupDigits(String(integerPart)) : String(integerPart);
    const fractionText = (fractionPart / CENTS_PER_YUAN).toFixed(decimals).slice(1); // 去掉前导 "0"
    text = `${intText}${fractionText}`;
  }

  const prefix = showSymbol && symbol ? symbol : "";
  return `${negative ? "-" : ""}${prefix}${text}`;
}

/** 格式化 Money 实例 */
export function formatMoney(money: Money, options: FormatMoneyOptions = {}): string {
  return formatCents(money.cents, options);
}

/**
 * 格式化「元」数值（兼容既有 `formatCurrency(amount: number)` 的入参语义）。
 *
 * ⚠️ 入参是「元」。若手上是「分」，请直接用 {@link formatCents}，
 * 否则会放大 100 倍。
 */
export function formatYuan(yuan: Yuan | number, options: FormatMoneyOptions = {}): string {
  return formatCents(yuanToCents(Number(yuan)), options);
}

/**
 * 解析用户输入的金额文本为「分」。
 *
 * 支持 "12.34" / "1,234.5" / "￥12" / 数字 12.34，四舍五入到整分。
 * 非法输入返回 null（由调用方决定提示文案）。
 */
export function parseAmountToCents(input: string | number): Cents | null {
  try {
    if (typeof input === "number") {
      return Number.isFinite(input) ? yuanToCents(input) : null;
    }
    return Money.fromString(input).toCents();
  } catch {
    return null;
  }
}

/**
 * 编辑器用：把「分」还原为输入框文本（不带符号、不带千分位）。
 *
 * @example
 * centsToInputText(1234) // "12.34"
 */
export function centsToInputText(cents: Cents | number, decimals = 2): string {
  return (Number(cents) / CENTS_PER_YUAN).toFixed(decimals);
}
