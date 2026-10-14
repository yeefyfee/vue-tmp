/**
 * @peluvida/shared —— Redis 键规范单测（CROSS-10）
 *
 * 运行：`pnpm --filter @peluvida/shared test`（pretest 会先构建 dist）
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  redisKey,
  withTenantPrefix,
  DEFAULT_TTL_SECONDS,
  REDIS_KEY_SEPARATOR,
  TENANT_REDIS_KEY_PREFIX,
} = require("../dist/redis-key.js");

test("redisKey：业务:对象:标识 拼接", () => {
  assert.equal(redisKey("auth", "token", "access"), "auth:token:access");
  assert.equal(redisKey("captcha", "image", "abc123"), "captcha:image:abc123");
  assert.equal(redisKey("order", "detail", 10001), "order:detail:10001");
});

test("redisKey：分段非法字符抛错（大写/空/冒号/空白）", () => {
  assert.throws(() => redisKey("Auth", "token"), /非法/);
  assert.throws(() => redisKey("auth", "", "x"), /非法/);
  assert.throws(() => redisKey("auth:token"), /非法/);
  assert.throws(() => redisKey("auth ", "token"), /非法/);
  assert.throws(() => redisKey(), /至少需要/);
});

test("withTenantPrefix：有租户加前缀、无租户原样", () => {
  assert.equal(withTenantPrefix("900042", "auth:token:access"), "tenant:900042:auth:token:access");
  assert.equal(withTenantPrefix(null, "platform:key"), "platform:key");
  assert.equal(withTenantPrefix("  ", "platform:key"), "platform:key");
});

test("常量锚点：分隔符 / 租户前缀 / 默认 TTL 1h", () => {
  assert.equal(REDIS_KEY_SEPARATOR, ":");
  assert.equal(TENANT_REDIS_KEY_PREFIX, "tenant:");
  assert.equal(DEFAULT_TTL_SECONDS, 3600);
});
