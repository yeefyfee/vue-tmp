/**
 * 审计日志枚举与校验（P0-02-08）—— shared 层纯函数测试
 *
 * 运行：node --test test/audit.test.cjs（依赖先 tsc build 出 dist）
 */
const assert = require("node:assert");
const test = require("node:test");

const {
  AuditEntityType,
  AUDIT_ENTITY_TYPE_KEYS,
  AuditAction,
  AUDIT_ACTION_KEYS,
  AuditOperatorType,
  AUDIT_TENANT_ID_PLATFORM,
  isAuditEntityType,
  isAuditAction,
} = require("../dist/index.js");

test("实体类型为业务表名 slug，最小集 12 个且值稳定（入库值，改名即破坏存量数据）", () => {
  assert.deepStrictEqual([...AUDIT_ENTITY_TYPE_KEYS].sort(), [
    "booking",
    "customer",
    "room",
    "service_category",
    "staff",
    "store",
    "store_calendar",
    "sys_config",
    "sys_menu",
    "sys_role",
    "sys_user",
    "tenant",
  ]);
});

test("动作枚举 SmallInt 数字唯一且与文档语义一致", () => {
  const values = [...AUDIT_ACTION_KEYS];
  assert.strictEqual(new Set(values).size, values.length, "动作值存在重复");
  assert.deepStrictEqual(values.sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7]);
  assert.strictEqual(AuditAction.CREATE, 1);
  assert.strictEqual(AuditAction.UPDATE, 2);
  assert.strictEqual(AuditAction.DELETE, 3);
  assert.strictEqual(AuditAction.ENABLE, 4);
  assert.strictEqual(AuditAction.DISABLE, 5);
  assert.strictEqual(AuditAction.EXPORT, 6);
  assert.strictEqual(AuditAction.GRANT, 7);
});

test("操作人类型：0=system / 1=user（Q4：operatorId 可空 + operatorType 区分）", () => {
  assert.strictEqual(AuditOperatorType.SYSTEM, 0);
  assert.strictEqual(AuditOperatorType.USER, 1);
});

test("平台哨兵 tenant_id = 0n（Q6：平台级对象记 0，租户查询不可见）", () => {
  assert.strictEqual(AUDIT_TENANT_ID_PLATFORM, 0n);
  assert.strictEqual(typeof AUDIT_TENANT_ID_PLATFORM, "bigint");
});

test("isAuditEntityType：合法 slug 通过，非法值 / 非字符串 / 前缀近似值拒绝", () => {
  assert.strictEqual(isAuditEntityType(AuditEntityType.STORE), true);
  assert.strictEqual(isAuditEntityType(AuditEntityType.STORE_CALENDAR), true);
  assert.strictEqual(isAuditEntityType("sys_role"), true);
  assert.strictEqual(isAuditEntityType("member_card"), false); // 未登记的业务表
  assert.strictEqual(isAuditEntityType("sys_"), false);
  assert.strictEqual(isAuditEntityType(""), false);
  assert.strictEqual(isAuditEntityType(null), false);
  assert.strictEqual(isAuditEntityType(42), false);
  assert.strictEqual(isAuditEntityType(undefined), false);
});

test("isAuditAction：合法整数通过，越界 / 非整数 / 非数字拒绝（fail-closed）", () => {
  assert.strictEqual(isAuditAction(AuditAction.CREATE), true);
  assert.strictEqual(isAuditAction(AuditAction.GRANT), true);
  assert.strictEqual(isAuditAction(0), false);
  assert.strictEqual(isAuditAction(8), false);
  assert.strictEqual(isAuditAction(1.5), false);
  assert.strictEqual(isAuditAction("1"), false);
  assert.strictEqual(isAuditAction(null), false);
  assert.strictEqual(isAuditAction(NaN), false);
});

test("枚举键与值一一对应（键名漂移即 API 契约破坏）", () => {
  assert.deepStrictEqual(Object.keys(AuditEntityType), [
    "STORE",
    "SERVICE_CATEGORY",
    "ROOM",
    "STORE_CALENDAR",
    "STAFF",
    "CUSTOMER",
    "ROLE",
    "MENU",
    "CONFIG",
    "USER",
    "TENANT",
    "BOOKING",
  ]);
  assert.deepStrictEqual(Object.keys(AuditAction), [
    "CREATE",
    "UPDATE",
    "DELETE",
    "ENABLE",
    "DISABLE",
    "EXPORT",
    "GRANT",
  ]);
});
