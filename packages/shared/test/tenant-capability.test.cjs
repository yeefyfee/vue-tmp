/**
 * 租户能力开关（P0-03-01，Q10）—— shared 层纯函数测试
 *
 * 运行：node --test test/tenant-capability.test.cjs（依赖先 tsc build 出 dist）
 */
const assert = require("node:assert");
const test = require("node:test");

const {
  TenantCapability,
  TENANT_CAPABILITY_KEYS,
  TenantPlan,
  TENANT_PLAN_PRESETS,
  tenantHasCapability,
} = require("../dist/index.js");

test("能力键全集为 6 个且键名稳定（契约键，改名著破坏 DB 存量数据）", () => {
  assert.deepStrictEqual([...TENANT_CAPABILITY_KEYS].sort(), [
    "foster",
    "headquarters",
    "marketing",
    "member",
    "multi_store",
    "open_api",
  ]);
});

test("套餐预设：Starter 空 / Professional 3 能力 / Business 6 能力", () => {
  assert.deepStrictEqual(TENANT_PLAN_PRESETS[TenantPlan.STARTER], {});
  assert.deepStrictEqual(TENANT_PLAN_PRESETS[TenantPlan.PROFESSIONAL], {
    foster: true,
    member: true,
    marketing: true,
  });
  assert.deepStrictEqual(TENANT_PLAN_PRESETS[TenantPlan.BUSINESS], {
    foster: true,
    member: true,
    marketing: true,
    multi_store: true,
    headquarters: true,
    open_api: true,
  });
});

test("预设中出现的键全部合法（是能力键全集的子集）", () => {
  for (const flags of Object.values(TENANT_PLAN_PRESETS)) {
    for (const key of Object.keys(flags)) {
      assert.ok(
        TENANT_CAPABILITY_KEYS.includes(key),
        `非法能力键: ${key}`
      );
    }
  }
});

test("tenantHasCapability：布尔 true 才算具备，其余一律不具备（fail-closed）", () => {
  assert.strictEqual(tenantHasCapability({ foster: true }, "foster"), true);
  assert.strictEqual(tenantHasCapability({ foster: false }, "foster"), false);
  assert.strictEqual(tenantHasCapability({ foster: "true" }, "foster"), false);
  assert.strictEqual(tenantHasCapability({}, "foster"), false);
  assert.strictEqual(tenantHasCapability(null, "foster"), false);
  assert.strictEqual(tenantHasCapability(undefined, "foster"), false);
  assert.strictEqual(tenantHasCapability("foster", "foster"), false);
  assert.strictEqual(tenantHasCapability(42, "foster"), false);
});
