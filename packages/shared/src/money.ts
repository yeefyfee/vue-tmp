/**
 * 金额值对象 Money（决策 A1 / Q6）
 *
 * 全链路金额统一以「分」为最小单位（DB `BIGINT` / Prisma `BigInt` / API 传 integer）。
 * 目的：彻底消除「元 / 分」混用导致的 100 倍误差。
 *
 * 类型锁死策略：
 * - `Cents` 与 `Yuan` 都是 branded type，二者不可互相赋值；
 * - 需要跨单位时只能走 `yuanToCents()` / `centsToYuan()` 显式转换；
 * - 因此「把元当成分传进接口」会在编译期直接报错。
 *
 * ⚠️ 金额一律不参与浮点运算：内部以整数分存放，乘除后按指定舍入策略回到整数分。
 */

/** 一分（branded，禁止与「元」混用） */
export type Cents = number & { readonly __brand: "Cents" };
/** 一元（branded，仅用于展示层与用户输入入口） */
export type Yuan = number & { readonly __brand: "Yuan" };

/** 1 元 = 100 分 */
export const CENTS_PER_YUAN = 100;

/** 舍入策略 */
export type RoundingMode = "round" | "floor" | "ceil";

function applyRounding(value: number, mode: RoundingMode): number {
  switch (mode) {
    case "floor":
      return Math.floor(value);
    case "ceil":
      return Math.ceil(value);
    default:
      return Math.round(value);
  }
}

/** 金额（分）是否在安全整数范围内 */
export function isSafeCents(value: number): boolean {
  return Number.isInteger(value) && Number.isSafeInteger(value);
}

/** 断言一个数可安全表示「分」，返回 branded 值 */
export function asCents(value: number): Cents {
  if (!isSafeCents(value)) {
    throw new RangeError(`金额（分）必须是安全整数，收到：${value}`);
  }
  return value as Cents;
}

/** 运行时判定（用于校验外部输入，如反序列化） */
export function isCents(value: unknown): value is Cents {
  return typeof value === "number" && isSafeCents(value);
}

/** 元 → 分（四舍五入到整分） */
export function yuanToCents(yuan: number): Cents {
  if (!Number.isFinite(yuan)) {
    throw new RangeError(`金额（元）必须是有限数，收到：${yuan}`);
  }
  return asCents(Math.round(yuan * CENTS_PER_YUAN));
}

/** 分 → 元（仅用于展示层，运算请留在「分」域） */
export function centsToYuan(cents: Cents): Yuan {
  return (cents / CENTS_PER_YUAN) as Yuan;
}

/**
 * 金额值对象。不可变，所有运算返回新实例。
 */
export class Money {
  /** 金额（分） */
  readonly cents: Cents;

  private constructor(cents: Cents) {
    this.cents = cents;
  }

  /** 零元 */
  static get ZERO(): Money {
    return new Money(asCents(0));
  }

  /** 从「分」构造（主要入口：API / DB 值） */
  static fromCents(cents: number): Money {
    return new Money(asCents(cents));
  }

  /** 从「元」构造（仅用户输入 / 展示场景，会自动 ×100） */
  static fromYuan(yuan: number): Money {
    return new Money(yuanToCents(yuan));
  }

  /**
   * 从用户输入的字符串构造，如 "12.34"、"1,234.5"、"￥12"。
   * 非法输入抛 RangeError。
   */
  static fromString(input: string): Money {
    // 只容忍首尾空白、前置货币符号与**规范千分位**逗号。
    // 不接受数字中间的空格（如 "1 2"）与错位逗号（如 "1,23,4"），
    // 避免把非法输入静默解析成一个看起来合理的错误金额。
    const trimmed = input.trim().replace(/^[￥¥]\s*/, "");
    if (!/^-?(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d+)?$/.test(trimmed)) {
      throw new RangeError(`无法解析的金额：${input}`);
    }
    return new Money(yuanToCents(Number(trimmed.replace(/,/g, ""))));
  }

  /** 求和（空数组返回 0） */
  static sum(items: readonly Money[]): Money {
    return items.reduce((acc, item) => acc.add(item), Money.ZERO);
  }

  add(other: Money): Money {
    return new Money(asCents(this.cents + other.cents));
  }

  subtract(other: Money): Money {
    return new Money(asCents(this.cents - other.cents));
  }

  negate(): Money {
    return new Money(asCents(-this.cents));
  }

  abs(): Money {
    return new Money(asCents(Math.abs(this.cents)));
  }

  /**
   * 乘以系数（如数量、折扣率）。结果按 `mode` 回到整分，默认四舍五入。
   */
  multiply(factor: number, mode: RoundingMode = "round"): Money {
    if (!Number.isFinite(factor)) {
      throw new RangeError(`乘数必须是有限数，收到：${factor}`);
    }
    return new Money(asCents(applyRounding(this.cents * factor, mode)));
  }

  /**
   * 除以除数，结果按 `mode` 回到整分，默认四舍五入。
   */
  divide(divisor: number, mode: RoundingMode = "round"): Money {
    if (!Number.isFinite(divisor) || divisor === 0) {
      throw new RangeError(`除数必须是非 0 有限数，收到：${divisor}`);
    }
    return new Money(asCents(applyRounding(this.cents / divisor, mode)));
  }

  /**
   * 按比例分摊到多份，**保证各份之和恰好等于原金额**（余数按顺序逐分派发）。
   *
   * 用于「订单优惠按明细分摊」「组合支付拆分」等必须零误差的场景。
   *
   * @param ratios 非负权重数组，长度 ≥ 1，总和 > 0
   * @param mode   单份基础值的舍入策略，默认向下取整（余数随后补齐）
   *
   * @example
   * Money.fromCents(100).allocate([1, 1, 1]) // [34c, 33c, 33c]，合计 100c
   */
  allocate(ratios: readonly number[], mode: RoundingMode = "floor"): Money[] {
    if (ratios.length === 0) {
      throw new RangeError("分摊比例不能为空");
    }
    if (ratios.some((r) => !Number.isFinite(r) || r < 0)) {
      throw new RangeError("分摊比例必须是非负有限数");
    }

    const totalRatio = ratios.reduce((a, b) => a + b, 0);
    if (totalRatio <= 0) {
      throw new RangeError("分摊比例之和必须大于 0");
    }

    const shares = ratios.map((r) => applyRounding((this.cents * r) / totalRatio, mode));
    let remainder = this.cents - shares.reduce((a, b) => a + b, 0);

    const step = remainder >= 0 ? 1 : -1;
    let i = 0;
    while (remainder !== 0) {
      shares[i % shares.length] += step;
      remainder -= step;
      i += 1;
    }

    return shares.map((c) => new Money(asCents(c)));
  }

  /** 均分为 n 份（等价的 allocate 特例） */
  allocateEvenly(n: number): Money[] {
    if (!Number.isInteger(n) || n < 1) {
      throw new RangeError(`份数必须是 ≥1 的整数，收到：${n}`);
    }
    return this.allocate(new Array(n).fill(1));
  }

  equals(other: Money): boolean {
    return this.cents === other.cents;
  }

  /** 比较：this > other 返回 1，相等 0，小于 -1 */
  compareTo(other: Money): -1 | 0 | 1 {
    if (this.cents > other.cents) {
      return 1;
    }
    if (this.cents < other.cents) {
      return -1;
    }
    return 0;
  }

  greaterThan(other: Money): boolean {
    return this.cents > other.cents;
  }

  greaterThanOrEqual(other: Money): boolean {
    return this.cents >= other.cents;
  }

  lessThan(other: Money): boolean {
    return this.cents < other.cents;
  }

  lessThanOrEqual(other: Money): boolean {
    return this.cents <= other.cents;
  }

  isZero(): boolean {
    return this.cents === 0;
  }

  isPositive(): boolean {
    return this.cents > 0;
  }

  isNegative(): boolean {
    return this.cents < 0;
  }

  /** 转为「分」整数（API / DB 出口） */
  toCents(): Cents {
    return this.cents;
  }

  /** 转为「元」数值（仅展示层） */
  toYuan(): number {
    return this.cents / CENTS_PER_YUAN;
  }

  /** 人类可读字符串（元，不带符号），用于日志 */
  toString(): string {
    return this.toYuan().toFixed(2);
  }

  /** 序列化为「分」整数（JSON / API 出口） */
  toJSON(): number {
    return this.cents;
  }
}
