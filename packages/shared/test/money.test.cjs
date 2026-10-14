/**
 * @peluvida/shared —— 自动化单测（零依赖，node:test）
 *
 * 运行：`pnpm --filter @peluvida/shared test`（pretest 会先构建 dist）
 * 说明：本文件用 CJS 语法直接 require 构建产物，避免 ESM 对 CJS 具名导出的解析差异。
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  Money,
  CENTS_PER_YUAN,
  asCents,
  isCents,
  yuanToCents,
  centsToYuan,
  formatCents,
  formatMoney,
  formatYuan,
  parseAmountToCents,
  centsToInputText,
} = require("../dist/index.js");

test("Money：从分 / 元 / 字符串构造", () => {
  assert.equal(Money.fromCents(1234).toCents(), 1234);
  assert.equal(Money.fromYuan(12.34).toCents(), 1234);
  assert.equal(Money.fromString("12.34").toCents(), 1234);
  assert.equal(Money.fromString("1,234.5").toCents(), 123450);
  assert.equal(Money.fromString("￥12").toCents(), 1200);
  assert.equal(CENTS_PER_YUAN, 100);
});

test("Money：非法输入抛错", () => {
  assert.throws(() => Money.fromString("abc"), RangeError);
  assert.throws(() => Money.fromString("12.3.4"), RangeError);
  assert.throws(() => asCents(1.5), RangeError);
  assert.throws(() => Money.fromCents(Number.MAX_SAFE_INTEGER + 1), RangeError);
});

test("Money.fromString：拒绝中间空格等非法形式，容忍首尾空白与货币符号", () => {
  assert.throws(() => Money.fromString("1 2"), RangeError);
  assert.throws(() => Money.fromString("1.2.3"), RangeError);
  assert.throws(() => Money.fromString("--1"), RangeError);
  assert.throws(() => Money.fromString("1e3"), RangeError);
  assert.throws(() => Money.fromString(""), RangeError);
  assert.equal(Money.fromString("  12.34  ").toCents(), 1234);
  assert.equal(Money.fromString("¥ 12.34").toCents(), 1234);
});

test("Money.fromString：只接受规范千分位，拒绝错位逗号", () => {
  assert.equal(Money.fromString("1,234,567").toCents(), 123456700);
  assert.equal(Money.fromString("1234567").toCents(), 123456700);
  assert.equal(Money.fromString("1,234.5").toCents(), 123450);
  assert.throws(() => Money.fromString("1,23,4"), RangeError);
  assert.throws(() => Money.fromString("12,34"), RangeError);
  assert.throws(() => Money.fromString(",123"), RangeError);
});

test("Money：类型锁基础函数", () => {
  assert.equal(yuanToCents(0.1), 10);
  assert.equal(yuanToCents(12.345), 1235); // 四舍五入到整分
  assert.equal(centsToYuan(asCents(1234)), 12.34);
  assert.equal(isCents(100), true);
  assert.equal(isCents(1.5), false);
  assert.equal(isCents("100"), false);
});

test("Money：加减乘除", () => {
  const a = Money.fromCents(1000);
  const b = Money.fromCents(250);
  assert.equal(a.add(b).toCents(), 1250);
  assert.equal(a.subtract(b).toCents(), 750);
  assert.equal(a.multiply(3).toCents(), 3000);
  assert.equal(a.multiply(0.9).toCents(), 900); // 九折
  assert.equal(a.divide(3).toCents(), 333); // 四舍五入
  assert.equal(a.divide(3, "floor").toCents(), 333);
  assert.equal(Money.fromCents(1000).divide(3, "ceil").toCents(), 334);
  assert.equal(a.negate().toCents(), -1000);
  assert.equal(a.negate().abs().toCents(), 1000);
  assert.equal(Money.ZERO.isZero(), true);
  assert.equal(Money.sum([a, b, Money.fromCents(1)]).toCents(), 1251);
  assert.equal(Money.sum([]).toCents(), 0);
});

test("Money：divide 除零与非法乘数抛错", () => {
  assert.throws(() => Money.fromCents(100).divide(0), RangeError);
  assert.throws(() => Money.fromCents(100).multiply(Infinity), RangeError);
});

test("Money.allocate：各份之和恒等于原额（零误差）", () => {
  const cases = [
    { cents: 100, ratios: [1, 1, 1] },
    { cents: 1000, ratios: [1, 2, 3] },
    { cents: 1, ratios: [1, 1, 1] },
    { cents: -100, ratios: [1, 1, 1] },
    { cents: 99999, ratios: [7, 11, 13, 17] },
    { cents: 0, ratios: [1, 1] },
  ];

  for (const { cents, ratios } of cases) {
    const parts = Money.fromCents(cents).allocate(ratios);
    const sum = parts.reduce((acc, m) => acc + m.toCents(), 0);
    assert.equal(sum, cents, `cents=${cents} ratios=${ratios} 分摊合计应为 ${cents}，实为 ${sum}`);
    assert.equal(parts.length, ratios.length);
  }
});

test("Money.allocate：典型优惠分摊", () => {
  // 100 元优惠分摊到 3 条明细（60 / 30 / 10）
  const parts = Money.fromCents(10000).allocate([60, 30, 10]);
  assert.deepEqual(
    parts.map((m) => m.toCents()),
    [6000, 3000, 1000]
  );

  // 10 元优惠按 1:1:1 分摊 → 334 / 333 / 333
  const uneven = Money.fromCents(1000).allocate([1, 1, 1]);
  assert.deepEqual(
    uneven.map((m) => m.toCents()),
    [334, 333, 333]
  );
});

test("Money.allocate：非法入参抛错", () => {
  assert.throws(() => Money.fromCents(100).allocate([]), RangeError);
  assert.throws(() => Money.fromCents(100).allocate([0, 0]), RangeError);
  assert.throws(() => Money.fromCents(100).allocate([1, -1]), RangeError);
});

test("Money.allocateEvenly：均分", () => {
  const parts = Money.fromCents(1000).allocateEvenly(4);
  assert.deepEqual(
    parts.map((m) => m.toCents()),
    [250, 250, 250, 250]
  );
  assert.throws(() => Money.fromCents(100).allocateEvenly(0), RangeError);
});

test("Money：比较与序列化", () => {
  const a = Money.fromCents(1000);
  const b = Money.fromCents(2000);
  assert.equal(a.compareTo(b), -1);
  assert.equal(b.compareTo(a), 1);
  assert.equal(a.compareTo(Money.fromCents(1000)), 0);
  assert.equal(a.lessThan(b), true);
  assert.equal(b.greaterThanOrEqual(a), true);
  assert.equal(a.equals(Money.fromCents(1000)), true);
  assert.equal(a.toYuan(), 10);
  assert.equal(a.toString(), "10.00");
  assert.equal(JSON.stringify({ amount: a }), '{"amount":1000}');
});

test("formatCents：三端统一格式化", () => {
  assert.equal(formatCents(123456), "¥1,234.56");
  assert.equal(formatCents(0), "¥0.00");
  assert.equal(formatCents(50), "¥0.50");
  assert.equal(formatCents(-50), "-¥0.50");
  assert.equal(formatCents(123456, { showSymbol: false }), "1,234.56");
  assert.equal(formatCents(123456, { grouping: false }), "¥1234.56");
  assert.equal(formatCents(123456, { decimals: 0 }), "¥1,235");
  assert.equal(formatCents(123456, { symbol: "$" }), "$1,234.56");
  assert.equal(formatMoney(Money.fromCents(999)), "¥9.99");
});

test("formatYuan：以「元」为入参", () => {
  assert.equal(formatYuan(12.34), "¥12.34");
  assert.equal(formatYuan(0.1), "¥0.10");
});

test("parseAmountToCents：解析与容错", () => {
  assert.equal(parseAmountToCents("12.34"), 1234);
  assert.equal(parseAmountToCents("￥1,234.5"), 123450);
  assert.equal(parseAmountToCents(12.34), 1234);
  assert.equal(parseAmountToCents("abc"), null);
  assert.equal(parseAmountToCents(""), null);
  assert.equal(parseAmountToCents(NaN), null);
});

test("centsToInputText：编辑器回填", () => {
  assert.equal(centsToInputText(1234), "12.34");
  assert.equal(centsToInputText(0), "0.00");
  assert.equal(centsToInputText(1000, 0), "10");
});

test("金额域：往返转换不丢精度", () => {
  for (const yuan of [0, 0.01, 1, 12.34, 999.99, 123456.78]) {
    const cents = yuanToCents(yuan);
    assert.equal(centsToYuan(cents), yuan, `元 ${yuan} → 分 ${cents} → 元应还原`);
  }
});
