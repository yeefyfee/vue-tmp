/**
 * 门店配置（P0-04-05 · FR-4）—— shared 层纯函数测试
 *
 * 覆盖：DEFAULT_STORE_CONFIG 完整性 / resolveStoreConfig 合并语义
 * （NULL / 脏数据 / 部分覆盖 / 非法值回落 / 未知键忽略 / 不污染常量）/
 * isValidStoreConfigValue 单键边界。
 *
 * 运行：node --test test/store-config.test.cjs（依赖先 tsc build 出 dist）
 */
const assert = require("node:assert");
const test = require("node:test");

const {
  STORE_CONFIG_KEYS,
  DEFAULT_STORE_CONFIG,
  cloneDefaultStoreConfig,
  resolveStoreConfig,
  isValidStoreConfigValue,
} = require("../dist/index.js");

test("配置键位与默认值完整（六键口径，改键名即破坏 API 契约）", () => {
  assert.deepStrictEqual([...STORE_CONFIG_KEYS].sort(), [
    "boardingCheckinTime",
    "boardingCheckoutTime",
    "bookingLeadHours",
    "cancelCutoffHours",
    "pushEnabled",
    "slotGranularityMin",
  ]);
  assert.deepStrictEqual({ ...DEFAULT_STORE_CONFIG }, {
    slotGranularityMin: 30,
    bookingLeadHours: 2,
    cancelCutoffHours: 24,
    boardingCheckinTime: "10:00",
    boardingCheckoutTime: "18:00",
    pushEnabled: true,
  });
});

test("resolveStoreConfig：NULL / 数组 / 字符串 / undefined → 全默认", () => {
  assert.deepStrictEqual(resolveStoreConfig(null), { ...DEFAULT_STORE_CONFIG });
  assert.deepStrictEqual(resolveStoreConfig(undefined), { ...DEFAULT_STORE_CONFIG });
  assert.deepStrictEqual(resolveStoreConfig([1, 2]), { ...DEFAULT_STORE_CONFIG });
  assert.deepStrictEqual(resolveStoreConfig("dirty"), { ...DEFAULT_STORE_CONFIG });
  assert.deepStrictEqual(resolveStoreConfig(42), { ...DEFAULT_STORE_CONFIG });
});

test("resolveStoreConfig：空对象 → 全默认；部分覆盖 → 逐键合并", () => {
  assert.deepStrictEqual(resolveStoreConfig({}), { ...DEFAULT_STORE_CONFIG });

  const merged = resolveStoreConfig({ slotGranularityMin: 15, pushEnabled: false });
  assert.strictEqual(merged.slotGranularityMin, 15);
  assert.strictEqual(merged.pushEnabled, false);
  // 未覆盖键回落默认
  assert.strictEqual(merged.bookingLeadHours, 2);
  assert.strictEqual(merged.cancelCutoffHours, 24);
  assert.strictEqual(merged.boardingCheckinTime, "10:00");
  assert.strictEqual(merged.boardingCheckoutTime, "18:00");
});

test("resolveStoreConfig：非法值逐键回落默认（fail-safe，不炸不透传）", () => {
  const raw = {
    slotGranularityMin: 20, // 不在 15/30/60 枚举
    bookingLeadHours: 721, // 超上限
    cancelCutoffHours: -1, // 负数
    boardingCheckinTime: "24:00", // 非 HH:mm
    boardingCheckoutTime: 900, // 非字符串
    pushEnabled: "yes", // 非布尔
  };
  assert.deepStrictEqual(resolveStoreConfig(raw), { ...DEFAULT_STORE_CONFIG });
});

test("resolveStoreConfig：未知键忽略 + 不污染 DEFAULT 常量", () => {
  const resolved = resolveStoreConfig({ evilKey: "x", pushEnabled: false });
  assert.strictEqual(resolved.pushEnabled, false);
  assert.strictEqual("evilKey" in resolved, false);

  // 常量本体不被运行期改写波及
  assert.strictEqual(DEFAULT_STORE_CONFIG.pushEnabled, true);
  // 恒返回新对象：改动返回值不影响后续调用
  resolved.slotGranularityMin = 999;
  assert.strictEqual(resolveStoreConfig(null).slotGranularityMin, 30);
});

test("cloneDefaultStoreConfig：返回可变副本且与常量互不影响", () => {
  const copy = cloneDefaultStoreConfig();
  copy.pushEnabled = false;
  assert.strictEqual(copy.pushEnabled, false);
  assert.strictEqual(DEFAULT_STORE_CONFIG.pushEnabled, true);
  assert.notStrictEqual(copy, DEFAULT_STORE_CONFIG);
});

test("isValidStoreConfigValue：slotGranularityMin 枚举边界", () => {
  assert.strictEqual(isValidStoreConfigValue("slotGranularityMin", 15), true);
  assert.strictEqual(isValidStoreConfigValue("slotGranularityMin", 30), true);
  assert.strictEqual(isValidStoreConfigValue("slotGranularityMin", 60), true);
  assert.strictEqual(isValidStoreConfigValue("slotGranularityMin", 20), false);
  assert.strictEqual(isValidStoreConfigValue("slotGranularityMin", 15.5), false);
  assert.strictEqual(isValidStoreConfigValue("slotGranularityMin", "30"), false);
  assert.strictEqual(isValidStoreConfigValue("slotGranularityMin", NaN), false);
});

test("isValidStoreConfigValue：bookingLeadHours / cancelCutoffHours 范围边界", () => {
  assert.strictEqual(isValidStoreConfigValue("bookingLeadHours", 0), true);
  assert.strictEqual(isValidStoreConfigValue("bookingLeadHours", 720), true);
  assert.strictEqual(isValidStoreConfigValue("bookingLeadHours", 721), false);
  assert.strictEqual(isValidStoreConfigValue("bookingLeadHours", -1), false);
  assert.strictEqual(isValidStoreConfigValue("cancelCutoffHours", 0), true);
  assert.strictEqual(isValidStoreConfigValue("cancelCutoffHours", 168), true);
  assert.strictEqual(isValidStoreConfigValue("cancelCutoffHours", 169), false);
});

test("isValidStoreConfigValue：墙钟 HH:mm 与 pushEnabled 布尔", () => {
  assert.strictEqual(isValidStoreConfigValue("boardingCheckinTime", "00:00"), true);
  assert.strictEqual(isValidStoreConfigValue("boardingCheckinTime", "23:59"), true);
  assert.strictEqual(isValidStoreConfigValue("boardingCheckinTime", "24:00"), false);
  assert.strictEqual(isValidStoreConfigValue("boardingCheckinTime", "9:00"), false);
  assert.strictEqual(isValidStoreConfigValue("boardingCheckoutTime", "18:00"), true);
  assert.strictEqual(isValidStoreConfigValue("boardingCheckoutTime", ""), false);

  assert.strictEqual(isValidStoreConfigValue("pushEnabled", true), true);
  assert.strictEqual(isValidStoreConfigValue("pushEnabled", false), true);
  assert.strictEqual(isValidStoreConfigValue("pushEnabled", 1), false);
  assert.strictEqual(isValidStoreConfigValue("pushEnabled", "true"), false);
});

test("isValidStoreConfigValue：未知键 fail-closed", () => {
  assert.strictEqual(isValidStoreConfigValue("nonexistent", 1), false);
});
