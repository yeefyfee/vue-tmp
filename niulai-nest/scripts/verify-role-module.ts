/**
 * role 模块 Prisma 移植 · 真库验证（PEL-10c）
 *
 * 直接实例化 RoleService / RolePermService（不启 Nest、不需要登录），走真实 PostgreSQL + Redis，
 * 逐项校验「对外契约与 TypeORM 版本一致」，并覆盖静态检查查不出的语义：
 *   分页信封 / ROOT 角色排除 / 关键字大小写不敏感（name·code 两支）/ 排序（含 NULL 位序）/
 *   唯一性校验（含"排除自身"与逻辑删除后的行为）/ 表单回显 / 更新路径的 undefined 跳过 /
 *   updateRoleStatus 不刷 updateTime / updateMenus 的替换与幂等 / 会话失效（token 版本 + 会话键）/
 *   权限缓存的 Read-Through 与防穿透 / 数据权限（customDeptIds 为 number[]）/ 删除规则。
 *
 * 另外把**已知缺陷**与**有意偏差**固化成断言（改断言即可知行为被改动了）：
 *   ① `updateRoleStatus` **不刷新 `updateTime`**（原实现走 `repository.update()`，不触发 AuditSubscriber）；
 *   ② 更新角色时**未传 `dataScope` 也会判为「变了」**从而失效一次会话（原实现直接比较入参）；
 *   ③ `deleteRoles` 走 `update()` 逻辑删除、**不刷新 `updateTime`**；
 *   ④ 【已知缺陷】`sys_role.code` / `name` 上有**唯一索引**，而重复校验只看 `isDeleted = 0`
 *      ⇒ 逻辑删除后编码仍被占用，复用同一编码新建会抛**原始 P2002**（不是友好文案）；
 *   ⑤ 【有意偏差】非法 ID 不再落成 SQL 错误（`updateMenus` / `getRoleForm` 返回空值或 null）；
 *   ⑥ 【有意偏差】`updateMenus` 对重复 menuId 静默去重，且**返回值 = 实际写入集合**
 *      （原 TypeORM save 会撞复合主键报错；去重后 `返回行数 == 库里行数` 是契约不变式）；
 *   ⑦ 【跨库差异】`sys_role_code_key` 在 PG 下**大小写敏感**（MySQL 默认 CI 排序规则下不敏感）
 *      ⇒ 仅大小写不同的角色编码在 PG 下可以共存。
 *   ⑧ 【已修】非法 `id` 传给 `saveRole` 不再退化成新增（原 `toBigInt → null` 会走 create 路径）。
 *
 * 🔴 本脚本会重刷整张 `system:role:perms` 哈希（section 9 的 `refreshAllRolePermsCache`）——
 *    权限缓存是纯派生数据、可由库重建，属预期副作用。
 *
 * 安全约定：所有造数名称/编码都带 `VERIFYROLE` 前缀，脚本开始与结束各清理一次；
 * 只删自己造的数据；ROOT 角色仅在不存在时创建，且创建出的名字必然含前缀（清理不会误伤真实 ROOT）。
 *
 * 运行：
 *   node ./node_modules/ts-node/dist/bin.js -r tsconfig-paths/register scripts/verify-role-module.ts
 */
import { Redis } from "ioredis";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { RoleService } from "../src/system/role/role.service";
import { RolePermService } from "../src/system/role/role-permission.service";
import { RedisService } from "../src/common/redis/redis.service";
import { RequestContext } from "../src/common/context/request-context";
import { enableBigIntJsonSerialization } from "../src/common/prisma/bigint-json";
import { DataScopeEnum } from "../src/common/enums/data-scope.enum";
import type { CurrentUserInfo } from "../src/common/interfaces/current-user.interface";

enableBigIntJsonSerialization();

const CONNECTION =
  process.env.DATABASE_URL ?? "postgresql://admin:Pg%40123456@127.0.0.1:5432/peluvida_dev";

const base = new PrismaClient({ adapter: new PrismaPg({ connectionString: CONNECTION }) });

const redis = new Redis({
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
  db: Number(process.env.REDIS_DB ?? 7),
  password: process.env.REDIS_PASSWORD || undefined,
  lazyConnect: true,
});

const redisService = new RedisService({ getOrThrow: () => redis } as never);
const permService = new RolePermService(base as never, redisService);
const service = new RoleService(
  base as never,
  permService,
  { get: (key: string) => (key === "SESSION_TYPE" ? "jwt" : undefined) } as never,
  redisService
);

const MARK = "VERIFYROLE";

const CODES = {
  A: `${MARK}_A`,
  B: `${MARK}_B`,
  C: `${MARK}_C`,
  D: `${MARK}_D`,
  E: `${MARK}_E`,
  G: `${MARK}_G`,
  H: `${MARK}_H`,
  X: `${MARK}_X`,
  Y: `${MARK}_Y`,
  V: `${MARK}_V`,
  W: `${MARK}_W`,
  Z: `${MARK}_Z`,
  CTX: `${MARK}_CTX`,
  LOWERCASE_TEST: `${MARK}_case`,
  NOSUCH: `${MARK}_NOSUCH`,
};
const NAMES = {
  A: `${MARK}-甲角色`,
  B: `${MARK}-乙角色`,
  C: `${MARK}-丙角色`,
  D: `丁验证角色`, // 刻意不含 MARK，仅靠 code 命中
  E: `   `, // 仅空白，验证下拉过滤
  G: `${MARK}-庚角色`,
  H: `${MARK}-辛角色`,
  X: `${MARK}-停用角色`,
  Y: `${MARK}-混合删除角色`,
  V: `${MARK}-remove角色`,
  W: `${MARK}-逻辑删除角色`,
  Z: `${MARK}-待删除角色`,
};

const CACHE_KEY = "system:role:perms";

/** 刻意用高位 ID，避免与真实数据碰撞 */
const U1 = "990001";
const U2 = "990002";
const U3 = "990003";
const TEST_USERS = [U1, U2, U3];
const GHOST_ROLE_ID = 999999999n;

let failures = 0;
let checks = 0;

function check(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? "√" : "✗"} ${label}  → 实际 ${JSON.stringify(actual)}${
      ok ? "" : `（期望 ${JSON.stringify(expected)}）`
    }`
  );
}

function checkTrue(label: string, actual: unknown) {
  checks += 1;
  const ok = Boolean(actual);
  if (!ok) failures += 1;
  console.log(`  ${ok ? "√" : "✗"} ${label}  → 实际 ${JSON.stringify(actual)}`);
}

/**
 * 取异常里**真正的业务文案**。
 *
 * 坑：`BusinessException extends HttpException`，且构造时传的是**对象** `{ code, msg }`。
 * Nest 的 `HttpException#initMessage()` 只认字符串 response 或 `response.message`，
 * 对象里放的是 `msg` ⇒ `error.message` 退化成类名 `"Business Exception"`，真文案在
 * `error.response.msg`。（`config` 模块抛的是 `BadRequestException("…")`，字符串 response，不受影响。）
 */
function exceptionMessage(e: unknown): string {
  const err = e as { response?: unknown; message?: string; getResponse?: () => unknown };
  const resp = typeof err.getResponse === "function" ? err.getResponse() : err.response;
  if (typeof resp === "string") return resp;
  if (resp && typeof resp === "object") {
    const msg = (resp as { msg?: unknown }).msg;
    if (typeof msg === "string") return msg;
  }
  return err.message ?? "";
}

async function expectThrow(label: string, fn: () => Promise<unknown>, messagePart: string) {
  checks += 1;
  try {
    await fn();
    failures += 1;
    console.log(`  ✗ ${label}  → 未抛错（期望「${messagePart}」）`);
  } catch (e) {
    const msg = exceptionMessage(e);
    const ok = msg.includes(messagePart);
    if (!ok) failures += 1;
    console.log(`  ${ok ? "√" : "✗"} ${label}  → 抛出「${msg}」`);
  }
}

/** 断言抛出的是 Prisma 的某个错误码（用于验证「DB 层约束先于业务校验命中」） */
async function expectPrismaError(label: string, fn: () => Promise<unknown>, code: string) {
  checks += 1;
  try {
    await fn();
    failures += 1;
    console.log(`  ✗ ${label}  → 未抛错（期望 Prisma 错误 ${code}）`);
  } catch (e) {
    const err = e as { code?: string; message?: string };
    const ok = err.code === code;
    if (!ok) failures += 1;
    const firstLine =
      String(err.message ?? "")
        .split("\n")
        .filter(Boolean)
        .pop() ?? "";
    console.log(
      `  ${ok ? "√" : "✗"} ${label}  → code=${err.code ?? "(无)"}｜${firstLine.slice(0, 90)}`
    );
  }
}

async function expectNoThrow(label: string, fn: () => Promise<unknown>) {
  checks += 1;
  try {
    await fn();
    console.log(`  √ ${label}`);
  } catch (e) {
    failures += 1;
    console.log(`  ✗ ${label}  → 抛出「${exceptionMessage(e)}」`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 在带请求上下文（含操作用户）的环境里执行 —— 用于验证审计字段真的被填 */
function withUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return RequestContext.run(async () => {
    RequestContext.initUserContext({
      userId,
      deptId: "1",
      deptTreePath: "0",
      dataScopes: [],
      roles: [],
    } as CurrentUserInfo);
    return await fn();
  });
}

// ------------------------------------------------------------------ 清理

async function cleanup() {
  const roles = await base.sysRole.findMany({
    where: { OR: [{ name: { contains: MARK } }, { code: { contains: MARK } }] },
    select: { id: true },
  });
  const roleIds = roles.map((r) => r.id);

  const menus = await base.sysMenu.findMany({
    where: { name: { contains: MARK } },
    select: { id: true },
  });
  const menuIds = menus.map((m) => m.id);

  await base.sysRoleMenu.deleteMany({
    where: {
      OR: [{ roleId: { in: roleIds } }, { menuId: { in: menuIds } }, { roleId: GHOST_ROLE_ID }],
    },
  });
  await base.sysRoleDept.deleteMany({ where: { roleId: { in: roleIds } } });
  await base.sysUserRole.deleteMany({
    where: { OR: [{ roleId: { in: roleIds } }, { userId: { in: TEST_USERS.map(BigInt) } }] },
  });
  await base.sysRole.deleteMany({ where: { id: { in: roleIds } } });
  await base.sysMenu.deleteMany({ where: { id: { in: menuIds } } });

  await redis.del(
    ...TEST_USERS.map((u) => `auth:user:token_version:${u}`),
    ...TEST_USERS.map((u) => `auth:user:jwt_session:${u}`),
    ...TEST_USERS.map((u) => `auth:user:access:${u}`),
    ...TEST_USERS.map((u) => `auth:user:refresh:${u}`)
  );
  await redis.hdel(CACHE_KEY, ...Object.values(CODES));
}

// ------------------------------------------------------------------ 夹具

let idA = 0n;
let idB = 0n;
let idC = 0n;
let idD = 0n;
let idE = 0n;
let idG = 0n;
let idH = 0n;
let idX = 0n;
let idW = 0n;
let rootId = 0n;

let m1 = 0n; // type=B, perm MARK:a
let m2 = 0n; // type=B, perm MARK:b
let m3 = 0n; // type=B, perm NULL

async function roleIdOf(code: string): Promise<bigint> {
  const row = await base.sysRole.findFirst({ where: { code }, select: { id: true } });
  return row!.id;
}

async function ensureMenu(name: string, menuType: string, perm: string | null): Promise<bigint> {
  const row = await base.sysMenu.create({
    data: {
      parentId: 0n,
      name,
      menuType,
      perm,
      sort: 0,
      visible: 1,
      createTime: new Date(),
      updateTime: new Date(),
    },
    select: { id: true },
  });
  return row.id;
}

async function seed() {
  await service.saveRole({
    name: NAMES.A,
    code: CODES.A,
    sort: 1,
    status: 1,
    dataScope: DataScopeEnum.SELF,
  });
  // 刻意不传 sort ⇒ NULL，用于验证 "sort ASC 且 NULL 在前"（MySQL 语义）
  await service.saveRole({
    name: NAMES.B,
    code: CODES.B,
    status: 1,
    dataScope: DataScopeEnum.CUSTOM,
  });
  await service.saveRole({
    name: NAMES.C,
    code: CODES.C,
    sort: 3,
    status: 1,
    dataScope: DataScopeEnum.ALL,
  });
  await service.saveRole({
    name: NAMES.D,
    code: CODES.D,
    sort: 2,
    status: 0,
    dataScope: DataScopeEnum.DEPT,
  });
  await service.saveRole({
    name: NAMES.E,
    code: CODES.E,
    sort: 4,
    status: 1,
    dataScope: 99,
  });
  await service.saveRole({
    name: NAMES.G,
    code: CODES.G,
    sort: 7,
    status: 1,
    dataScope: DataScopeEnum.SELF,
  });
  await service.saveRole({
    name: NAMES.H,
    code: CODES.H,
    sort: 7,
    status: 1,
    dataScope: DataScopeEnum.SELF,
  });
  await service.saveRole({
    name: NAMES.X,
    code: CODES.X,
    sort: 8,
    status: 0,
    dataScope: DataScopeEnum.ALL,
  });
  await service.saveRole({
    name: NAMES.W,
    code: CODES.W,
    sort: 13,
    status: 1,
    dataScope: DataScopeEnum.ALL,
  });

  idA = await roleIdOf(CODES.A);
  idB = await roleIdOf(CODES.B);
  idC = await roleIdOf(CODES.C);
  idD = await roleIdOf(CODES.D);
  idE = await roleIdOf(CODES.E);
  idG = await roleIdOf(CODES.G);
  idH = await roleIdOf(CODES.H);
  idX = await roleIdOf(CODES.X);
  idW = await roleIdOf(CODES.W);

  // createTime 由 auditOnCreate 写成「现在」，sort 并列时无法拉开顺序 ⇒ 手工改成确定值。
  // 年份避开 1986–1991（中国夏令时，Intl 会按历史 tzdata 还原成 UTC+9）。
  await base.sysRole.update({
    where: { id: idG },
    data: { createTime: new Date("1998-03-01T02:00:00Z") },
  });
  await base.sysRole.update({
    where: { id: idH },
    data: { createTime: new Date("1999-03-01T02:00:00Z") },
  });

  // ROOT：仅在不存在时创建（真实库里通常已有），名字必然含前缀 ⇒ 清理不会误伤
  const rootBefore = await base.sysRole.findFirst({ where: { code: "ROOT" } });
  if (!rootBefore) {
    await base.sysRole.create({
      data: {
        name: `${MARK}-内置超管`,
        code: "ROOT",
        sort: 0,
        status: 1,
        dataScope: DataScopeEnum.ALL,
        isDeleted: 0,
        createTime: new Date(),
        updateTime: new Date(),
      },
    });
  }
  rootId = (await base.sysRole.findFirst({ where: { code: "ROOT" }, select: { id: true } }))!.id;

  // 菜单：三个 type=B（含一个 perm 为 NULL）+ 一个 type=C
  m1 = await ensureMenu(`${MARK}-按钮一`, "B", `${MARK}:a`);
  m2 = await ensureMenu(`${MARK}-按钮二`, "B", `${MARK}:b`);
  m3 = await ensureMenu(`${MARK}-按钮三`, "B", null);
  // 只创建、不挂给任何角色：用于验证 `getAllPerms` / 权限聚合的 `type = 'B'` 过滤
  await ensureMenu(`${MARK}-菜单一`, "C", `${MARK}:c`);

  // roleB(CUSTOM) 的自定义部门
  await base.sysRoleDept.createMany({
    data: [
      { roleId: idB, deptId: 901001n },
      { roleId: idB, deptId: 901002n },
    ],
  });

  // 用户 ↔ 角色绑定（无外键，无需真的建 sys_user 行）
  await base.sysUserRole.createMany({
    data: [
      { userId: BigInt(U1), roleId: idA },
      { userId: BigInt(U2), roleId: idC },
    ],
  });
}

// ------------------------------------------------------------------ 主流程

async function main() {
  await redis.connect();
  await cleanup();
  await seed();

  // ---------------------------------------------------------------- 1) 创建与审计
  console.log("\n=== 1) 创建角色：返回值形状与审计字段 ===");
  const rowA = (await base.sysRole.findFirst({ where: { id: idA } }))!;
  check("name 已落库", rowA.name, NAMES.A);
  check("code 已落库", rowA.code, CODES.A);
  check("sort 已落库", rowA.sort, 1);
  check("status 已落库", rowA.status, 1);
  check("dataScope 已落库", rowA.dataScope, DataScopeEnum.SELF);
  check("isDeleted 固定为 0", rowA.isDeleted, 0);
  checkTrue("createTime 已填充（替代原 AuditSubscriber）", rowA.createTime instanceof Date);
  checkTrue("updateTime 已填充（新建时也写）", rowA.updateTime instanceof Date);
  check("无请求上下文时 createBy 保持 NULL", rowA.createBy, null);
  check("无请求上下文时 updateBy 保持 NULL", rowA.updateBy, null);

  await withUser("1", () =>
    service.saveRole({
      name: `${MARK}-上下文角色`,
      code: CODES.CTX,
      sort: 10,
      status: 1,
      dataScope: DataScopeEnum.ALL,
    })
  );
  const ctxRow = (await base.sysRole.findFirst({ where: { code: CODES.CTX } }))!;
  check("有上下文时 createBy = 上下文用户", ctxRow.createBy?.toString(), "1");
  check("有上下文时 updateBy = 上下文用户", ctxRow.updateBy?.toString(), "1");
  await base.sysRole.deleteMany({ where: { code: CODES.CTX } });

  // ---------------------------------------------------------------- 2) 唯一性
  console.log("\n=== 2) 唯一性校验（code / name，排除自身） ===");
  await expectThrow(
    "重复 code 被拒",
    () =>
      service.saveRole({
        name: "另一个名字",
        code: CODES.A,
        sort: 1,
        status: 1,
        dataScope: 1,
      }),
    "角色名称或角色编码已存在"
  );
  await expectThrow(
    "重复 name 被拒",
    () =>
      service.saveRole({
        name: NAMES.A,
        code: `${MARK}_DUP`,
        sort: 1,
        status: 1,
        dataScope: 1,
      }),
    "角色名称或角色编码已存在"
  );
  check(
    "排除自身：更新时带上自己的 code/name 不报错",
    await service.saveRole({ id: idA.toString(), name: NAMES.A, code: CODES.A }),
    true
  );
  await expectThrow(
    "排除自身：改成别的角色已占用的 code 被拒",
    () => service.saveRole({ id: idA.toString(), code: CODES.C }),
    "角色名称或角色编码已存在"
  );
  check(
    "未传 code/name 的更新不会因 undefined 退化成恒真而误报冲突",
    await service.saveRole({ id: idA.toString(), sort: 1 }),
    true
  );

  // 【跨库差异】PG 的唯一索引对 varchar 大小写敏感；MySQL 默认 utf8mb4_general_ci 下不敏感
  await service.saveRole({
    name: `${MARK}-小写编码角色`,
    code: CODES.LOWERCASE_TEST,
    sort: 11,
    status: 1,
    dataScope: 1,
  });
  await service.saveRole({
    name: `${MARK}-小写编码角色2`,
    code: CODES.LOWERCASE_TEST.toUpperCase(),
    sort: 11,
    status: 1,
    dataScope: 1,
  });
  check(
    "【跨库差异】仅大小写不同的 code 在 PG 下可共存（MySQL CI 排序规则下会被拒）",
    await base.sysRole.count({
      where: { code: { in: [CODES.LOWERCASE_TEST, CODES.LOWERCASE_TEST.toUpperCase()] } },
    }),
    2
  );
  await base.sysRole.deleteMany({
    where: { code: { in: [CODES.LOWERCASE_TEST, CODES.LOWERCASE_TEST.toUpperCase()] } },
  });

  // 【已知缺陷】重复校验只看 isDeleted = 0，而唯一索引不看 ⇒ 逻辑删除后编码仍被占用
  await service.deleteRoles(idW.toString());
  check(
    "逻辑删除后行仍在物理表中",
    (await base.sysRole.findFirst({ where: { id: idW } }))!.isDeleted,
    1
  );
  await expectPrismaError(
    "【已知缺陷】复用已逻辑删除角色的 code 新建 → 命中 DB 唯一索引，抛原始 P2002（非友好文案）",
    () =>
      service.saveRole({
        name: `${MARK}-复用编码角色`,
        code: CODES.W,
        sort: 13,
        status: 1,
        dataScope: 1,
      }),
    "P2002"
  );

  // ---------------------------------------------------------------- 3) 分页
  console.log("\n=== 3) 角色分页：信封 / ROOT 排除 / 关键字 / 排序 ===");
  const page = await service.getRolePage(1, 500, MARK);
  check("分页信封形状", Object.keys(page).sort(), ["data", "page"]);
  check("page 子对象形状", Object.keys(page.page).sort(), ["pageNum", "pageSize", "total"]);
  check("关键字命中我造的 8 个角色（逻辑删除的 W 不计）", page.page.total, 8);
  check("pageNum/pageSize 回显", [page.page.pageNum, page.page.pageSize], [1, 500]);
  check("每行含全部角色字段 + dataScopeLabel", Object.keys(page.data[0] as object).sort(), [
    "code",
    "createBy",
    "createTime",
    "dataScope",
    "dataScopeLabel",
    "id",
    "isDeleted",
    "name",
    "sort",
    "status",
    "updateBy",
    "updateTime",
  ]);
  check(
    "排序：sort ASC（NULL 在前，对齐 MySQL 语义）+ createTime DESC",
    page.data.map((r) => r.code),
    [CODES.B, CODES.A, CODES.D, CODES.C, CODES.E, CODES.H, CODES.G, CODES.X]
  );

  const labelByCode: Record<string, string> = {};
  for (const r of page.data) labelByCode[r.code] = r.dataScopeLabel;
  check("dataScope=1 → 全部数据", labelByCode[CODES.C], "全部数据");
  check("dataScope=3 → 本部门数据", labelByCode[CODES.D], "本部门数据");
  check("dataScope=4 → 本人数据", labelByCode[CODES.A], "本人数据");
  check("dataScope=5 → 自定义部门数据", labelByCode[CODES.B], "自定义部门数据");
  check("未知 dataScope=99 → 空串（?? 兜底）", labelByCode[CODES.E], "");

  check(
    "关键字大小写不敏感（name 支）",
    (await service.getRolePage(1, 500, MARK.toLowerCase())).page.total,
    8
  );
  check(
    "关键字命中 code 支（角色名不含关键字也能搜到）",
    (await service.getRolePage(1, 500, CODES.D)).page.total,
    1
  );

  const allCount = await base.sysRole.count({ where: { isDeleted: 0 } });
  const rootCount = await base.sysRole.count({ where: { code: "ROOT", isDeleted: 0 } });
  const bigPage = await service.getRolePage(1, 500);
  check("无关键字分页总数 = 全部未删除角色 − ROOT 数量", bigPage.page.total, allCount - rootCount);
  check("返回行里没有任何 ROOT", bigPage.data.filter((r) => r.code === "ROOT").length, 0);
  checkTrue("ROOT 行确实存在（排除断言非空洞）", rootCount > 0);

  const p1 = await service.getRolePage(1, 3, MARK);
  check("第 1 页 3 条", p1.data.length, 3);
  check("翻页不影响 total", p1.page.total, 8);
  const p3 = await service.getRolePage(3, 3, MARK);
  check("第 3 页 2 条", p3.data.length, 2);
  check(
    "非法 pageNum/pageSize 回落为 1/10",
    [
      (await service.getRolePage(0, -5, MARK)).page.pageNum,
      (await service.getRolePage(0, -5, MARK)).page.pageSize,
    ],
    [1, 10]
  );
  const none = await service.getRolePage(1, 10, "绝不存在的角色ZZZ");
  check("无命中时 total 为 0", none.page.total, 0);
  check("无命中时 data 为空数组", none.data, []);

  // ---------------------------------------------------------------- 4) 下拉选项
  console.log("\n=== 4) 角色下拉选项 ===");
  const options = await service.getRoleOptions();
  const myIds = new Set([idA, idB, idC, idD, idE, idG, idH, idX].map((v) => v.toString()));
  const myOptions = options.filter((o) => myIds.has(o.value));
  check("空白名角色被过滤 ⇒ 我的 8 个角色只剩 7 个选项", myOptions.length, 7);
  check(
    "不含仅空白名的角色 E",
    myOptions.some((o) => o.value === idE.toString()),
    false
  );
  check(
    "含 status=0 的角色 D（下拉不按状态过滤）",
    myOptions.some((o) => o.value === idD.toString()),
    true
  );
  checkTrue(
    "value 全部为字符串",
    myOptions.every((o) => typeof o.value === "string")
  );
  check(
    "选项只含 label/value 两个键",
    [...new Set(myOptions.flatMap((o) => Object.keys(o)))].sort(),
    ["label", "value"]
  );
  check("label 取角色名", myOptions.find((o) => o.value === idA.toString())!.label, NAMES.A);
  check(
    "前 4 个按 sort ASC（NULL 在前）",
    myOptions.slice(0, 4).map((o) => o.value),
    [idB, idA, idD, idC].map((v) => v.toString())
  );
  check(
    "sort 并列（=7）的两个角色同时出现",
    myOptions
      .slice(4, 6)
      .map((o) => o.value)
      .sort(),
    [idG, idH].map((v) => v.toString()).sort()
  );
  check("最后一个是 sort=8 的角色 X", myOptions[6].value, idX.toString());
  check(
    "下拉不含 ROOT",
    options.some((o) => o.value === rootId.toString()),
    false
  );

  // ---------------------------------------------------------------- 5) 表单
  console.log("\n=== 5) 角色表单 ===");
  const formA = await service.getRoleForm(idA.toString());
  check("非自定义数据权限时返回完整角色字段", Object.keys(formA as object).sort(), [
    "code",
    "createBy",
    "createTime",
    "dataScope",
    "id",
    "isDeleted",
    "name",
    "sort",
    "status",
    "updateBy",
    "updateTime",
  ]);
  check("非自定义数据权限时不含 deptIds", "deptIds" in (formA as object), false);
  const formB = await service.getRoleForm(idB.toString());
  check("自定义数据权限时带 deptIds", (formB as { deptIds: string[] }).deptIds, [
    "901001",
    "901002",
  ]);
  check("不存在的 ID 返回 null", await service.getRoleForm("999999999"), null);
  check(
    "【有意偏差】非法 ID 返回 null（原实现把 'abc' 直接查库、由 MySQL 报错）",
    await service.getRoleForm("abc"),
    null
  );
  check("逻辑删除的角色取不到表单", await service.getRoleForm(idW.toString()), null);

  // ---------------------------------------------------------------- 6) 更新路径 + 会话失效
  console.log("\n=== 6) 更新角色：undefined 跳过 / 审计字段 / 会话失效 ===");
  // 前文多次更新 roleA 已按「已知缺陷②」递增过版本，这里显式复位，让下面的断言可精确计数
  await redis.del(`auth:user:token_version:${U1}`);
  await redisService.set(`auth:user:jwt_session:${U1}`, "verify-session");
  check("复位后无 token 版本", await redisService.get(`auth:user:token_version:${U1}`), null);
  checkTrue("预置的会话键存在", (await redisService.get(`auth:user:jwt_session:${U1}`)) !== null);

  const beforeA = (await base.sysRole.findFirst({ where: { id: idA } }))!;
  await sleep(30);
  check(
    "只传 name 的更新返回 true",
    await service.saveRole({ id: idA.toString(), name: `${MARK}-甲角色改` }),
    true
  );
  const afterA = (await base.sysRole.findFirst({ where: { id: idA } }))!;
  check("name 已更新", afterA.name, `${MARK}-甲角色改`);
  check("未传的 code 保持不变", afterA.code, CODES.A);
  check("未传的 sort 保持不变（undefined 被跳过，对齐 TypeORM 语义）", afterA.sort, 1);
  check("未传的 status 保持不变", afterA.status, 1);
  check("未传的 dataScope 保持不变", afterA.dataScope, DataScopeEnum.SELF);
  check("createTime 保持不变", afterA.createTime!.getTime(), beforeA.createTime!.getTime());
  checkTrue("updateTime 已刷新", afterA.updateTime!.getTime() > beforeA.updateTime!.getTime());
  check("createBy 仍为 NULL（更新不写 createBy）", afterA.createBy, null);

  // --- 会话失效（U1 绑定在 roleA 上）---
  check(
    "【已知缺陷】未传 dataScope 也判为「变了」⇒ token 版本被递增到 1",
    await redisService.get(`auth:user:token_version:${U1}`),
    1
  );
  check(
    "会话键 auth:user:jwt_session 被删除",
    await redisService.get(`auth:user:jwt_session:${U1}`),
    null
  );
  await service.saveRole({
    id: idA.toString(),
    name: `${MARK}-甲角色改2`,
    dataScope: DataScopeEnum.SELF,
  });
  check(
    "传入与旧值相同的 dataScope ⇒ 不再失效会话（版本保持 1）",
    await redisService.get(`auth:user:token_version:${U1}`),
    1
  );
  await service.saveRole({
    id: idA.toString(),
    name: `${MARK}-甲角色改3`,
    dataScope: DataScopeEnum.DEPT,
  });
  check(
    "dataScope 真的变化 ⇒ 版本递增到 2",
    await redisService.get(`auth:user:token_version:${U1}`),
    2
  );
  // 还原（顺带把 name 复位，后面的断言依赖它）
  await service.saveRole({
    id: idA.toString(),
    name: NAMES.A,
    code: CODES.A,
    sort: 1,
    status: 1,
    dataScope: DataScopeEnum.SELF,
  });

  await expectThrow(
    "更新不存在的角色抛「角色不存在」",
    () => service.saveRole({ id: "999999999", name: "x" }),
    "角色不存在"
  );
  await expectThrow(
    "【有意偏差】非法 ID 抛「角色不存在」（不落成 SQL 错误）",
    () => service.saveRole({ id: "abc", name: "x" }),
    "角色不存在"
  );
  check(
    "🔴 修复回归：非法 ID 绝不会退化成新增（原 toBigInt→null 会走 create 路径）",
    await base.sysRole.count({ where: { name: "x" } }),
    0
  );
  await expectThrow(
    "🔴 修复回归：非法 ID 即使带齐必填字段也不新增",
    () =>
      service.saveRole({ id: "abc", name: `${MARK}-不该被创建`, code: CODES.NOSUCH, status: 1 }),
    "角色不存在"
  );
  check(
    "🔴 修复回归：带齐字段的非法 ID 调用后库中无新行",
    await base.sysRole.count({ where: { code: CODES.NOSUCH } }),
    0
  );

  // ---------------------------------------------------------------- 7) 状态
  console.log("\n=== 7) 更新角色状态 ===");
  const beforeC = (await base.sysRole.findFirst({ where: { id: idC } }))!;
  await sleep(30);
  check("updateRoleStatus 返回 true", await service.updateRoleStatus(idC.toString(), 0), true);
  const afterC = (await base.sysRole.findFirst({ where: { id: idC } }))!;
  check("status 已改为 0", afterC.status, 0);
  check(
    "【已知缺陷】updateRoleStatus 不刷新 updateTime（原实现走 repository.update()）",
    afterC.updateTime!.getTime(),
    beforeC.updateTime!.getTime()
  );
  check(
    "停用后仍出现在下拉里（下拉不按状态过滤）",
    (await service.getRoleOptions()).some((o) => o.value === idC.toString()),
    true
  );
  check("改回启用", await service.updateRoleStatus(idC.toString(), 1), true);
  await expectThrow(
    "不存在的角色抛「角色不存在」",
    () => service.updateRoleStatus("999999999", 1),
    "角色不存在"
  );
  await expectThrow(
    "【有意偏差】非法 ID 抛「角色不存在」（不落成 SQL 错误）",
    () => service.updateRoleStatus("abc", 1),
    "角色不存在"
  );

  // ---------------------------------------------------------------- 8) 分配菜单
  console.log("\n=== 8) 分配菜单（替换 / 幂等 / 早退 / 会话失效） ===");
  const rel1 = await service.updateMenus(idC.toString(), [m1.toString(), m2.toString()]);
  check("返回 2 行", rel1.length, 2);
  check("返回行形状", Object.keys(rel1[0]).sort(), ["menuId", "roleId"]);
  check("roleId 是字符串", typeof rel1[0].roleId, "string");
  check("menuId 是字符串", typeof rel1[0].menuId, "string");
  check("关联已落库", await base.sysRoleMenu.count({ where: { roleId: idC } }), 2);
  check(
    "getRoleMenuIds 返回字符串数组（去重）",
    (await service.getRoleMenuIds(idC.toString())).sort(),
    [m1, m2].map((v) => v.toString()).sort()
  );

  const relDup = await service.updateMenus(idC.toString(), [
    m1.toString(),
    m1.toString(),
    m2.toString(),
  ]);
  check(
    "【有意偏差】重复 menuId 静默去重，返回值 = 实际写入集合（原 TypeORM save 会撞复合主键报错）",
    relDup.length,
    2
  );
  check("去重后库里也是 2 行", await base.sysRoleMenu.count({ where: { roleId: idC } }), 2);
  check(
    "契约不变式：返回行数 == 库里行数",
    relDup.length,
    await base.sysRoleMenu.count({ where: { roleId: idC } })
  );

  const relOne = await service.updateMenus(idC.toString(), [m3.toString()]);
  check("替换为 1 个菜单", relOne.length, 1);
  check("旧关联已被删除", await service.getRoleMenuIds(idC.toString()), [m3.toString()]);

  check("传空数组清空关联", await service.updateMenus(idC.toString(), []), []);
  check("关联已清空", await base.sysRoleMenu.count({ where: { roleId: idC } }), 0);

  await service.updateMenus(idC.toString(), [m1.toString()]);
  check(
    "【有意偏差】非法 roleId 返回 []（原实现会抛 SQL 错误）",
    await service.updateMenus("abc", [m3.toString()]),
    []
  );
  check("非法 roleId 未破坏已有结构", await service.getRoleMenuIds(idC.toString()), [
    m1.toString(),
  ]);

  const ghostRels = await service.updateMenus(GHOST_ROLE_ID.toString(), [m1.toString()]);
  check("角色不存在时仍写入关联（与原实现一致：先删后插，不校验角色存在）", ghostRels.length, 1);
  check("幽灵关联落库", await base.sysRoleMenu.count({ where: { roleId: GHOST_ROLE_ID } }), 1);
  await base.sysRoleMenu.deleteMany({ where: { roleId: GHOST_ROLE_ID } });

  await redis.del(`auth:user:token_version:${U2}`);
  await service.updateMenus(idC.toString(), [m1.toString(), m2.toString()]);
  check(
    "分配菜单使该角色下用户的会话失效（版本递增到 1）",
    await redisService.get(`auth:user:token_version:${U2}`),
    1
  );

  // ---------------------------------------------------------------- 9) 权限缓存
  console.log("\n=== 9) 权限缓存（Read-Through / 防穿透 / 过滤规则） ===");
  await redisService.hdel(CACHE_KEY, CODES.C);
  await permService.refreshRolePermsCache(CODES.C);
  check(
    "刷新后缓存该角色权限（仅 type='B' 且 perm 非空）",
    (await redisService.hget<string[]>(CACHE_KEY, CODES.C))!.sort(),
    [`${MARK}:a`, `${MARK}:b`]
  );
  check(
    "type='C' 的菜单权限不计入",
    (await redisService.hget<string[]>(CACHE_KEY, CODES.C))!.includes(`${MARK}:c`),
    false
  );
  check(
    "perm 为 NULL 的按钮不计入",
    (await redisService.hget<string[]>(CACHE_KEY, CODES.C))!.includes("null"),
    false
  );

  await redisService.hdel(CACHE_KEY, CODES.C);
  check("删掉缓存字段后 hget 为 null", await redisService.hget(CACHE_KEY, CODES.C), null);
  check(
    "getPermsByRoleCodes 未命中时回源并返回并集",
    (await permService.getPermsByRoleCodes([CODES.C])).sort(),
    [`${MARK}:a`, `${MARK}:b`]
  );
  check("回源后缓存已回填", (await redisService.hget<string[]>(CACHE_KEY, CODES.C))!.sort(), [
    `${MARK}:a`,
    `${MARK}:b`,
  ]);
  check("空入参返回 []", await permService.getPermsByRoleCodes([]), []);
  check(
    "多角色权限取并集且去重",
    (await permService.getPermsByRoleCodes([CODES.C, CODES.C])).sort(),
    [`${MARK}:a`, `${MARK}:b`]
  );

  const allPerms = await permService.getAllPerms();
  checkTrue(
    "getAllPerms 含全部按钮权限（超管口径）",
    allPerms.includes(`${MARK}:a`) && allPerms.includes(`${MARK}:b`)
  );
  check("getAllPerms 不含 type='C' 的权限", allPerms.includes(`${MARK}:c`), false);

  await service.updateMenus(idH.toString(), [m3.toString()]);
  await permService.refreshRolePermsCache(CODES.H);
  check(
    "perm 为 NULL 的按钮不计入（roleH 只挂了 perm=NULL 的按钮 ⇒ 空数组）",
    await redisService.hget(CACHE_KEY, CODES.H),
    []
  );
  await service.updateMenus(idH.toString(), []);

  await permService.refreshRolePermsCache(CODES.D);
  check("无权限角色也写空数组（防缓存穿透）", await redisService.hget(CACHE_KEY, CODES.D), []);
  check(
    "空数组缓存被 hmget 视为「已缓存」而非未命中",
    await redisService.hmget(CACHE_KEY, [CODES.D]),
    [[]]
  );

  await service.updateMenus(idX.toString(), [m1.toString()]);
  await permService.refreshAllRolePermsCache();
  check(
    "refreshAll 后 roleC 已回填",
    (await redisService.hget<string[]>(CACHE_KEY, CODES.C))!.sort(),
    [`${MARK}:a`, `${MARK}:b`]
  );
  check(
    "refreshAll 过滤 status=0 的角色（roleX 有菜单但状态停用）",
    await redisService.hget(CACHE_KEY, CODES.X),
    null
  );
  check(
    "refreshAll 不写空数组（roleA 无菜单 ⇒ 无字段）",
    await redisService.hget(CACHE_KEY, CODES.A),
    null
  );

  await permService.refreshRolePermsCacheOnCodeChange(CODES.C, CODES.A);
  check("编码变更后新编码字段被写入", await redisService.hget(CACHE_KEY, CODES.A), []);
  check("编码变更后旧编码字段被删除", await redisService.hget(CACHE_KEY, CODES.C), null);
  await redisService.hdel(CACHE_KEY, CODES.A, CODES.D);
  await permService.refreshRolePermsCache(CODES.C);

  // ---------------------------------------------------------------- 10) 数据权限
  console.log("\n=== 10) 数据权限（getRoleDataScopes / updateRoleDepts） ===");
  const scopes = await service.getRoleDataScopes([
    CODES.A,
    CODES.B,
    CODES.C,
    CODES.D,
    CODES.NOSUCH,
  ]);
  check(
    "按编码返回，status=0 的角色 D 与未知编码被排除",
    scopes.map((s) => s.roleCode).sort(),
    [CODES.A, CODES.B, CODES.C].sort()
  );
  const scopeByCode: Record<string, { dataScope: number; customDeptIds?: number[] }> = {};
  for (const s of scopes) scopeByCode[s.roleCode] = s as never;
  check(
    "CUSTOM 角色的 customDeptIds 为 number[]",
    scopeByCode[CODES.B].customDeptIds,
    [901001, 901002]
  );
  checkTrue(
    "customDeptIds 元素确实是 number（不是 string）",
    scopeByCode[CODES.B].customDeptIds!.every((v) => typeof v === "number")
  );
  check("非 CUSTOM 角色无 customDeptIds", scopeByCode[CODES.A].customDeptIds, undefined);
  check(
    "dataScope 原样返回",
    [
      scopeByCode[CODES.A].dataScope,
      scopeByCode[CODES.B].dataScope,
      scopeByCode[CODES.C].dataScope,
    ],
    [DataScopeEnum.SELF, DataScopeEnum.CUSTOM, DataScopeEnum.ALL]
  );
  check("空入参返回 []", await service.getRoleDataScopes([]), []);
  check("逻辑删除的角色不返回", await service.getRoleDataScopes([CODES.W]), []);

  await service.updateRoleDepts(idB.toString(), ["901003"]);
  check("updateRoleDepts 替换关联", await service.getRoleDeptIds(idB.toString()), ["901003"]);
  await service.updateRoleDepts(idB.toString(), []);
  check("updateRoleDepts 传空数组清空", await service.getRoleDeptIds(idB.toString()), []);
  await service.updateRoleDepts(idB.toString(), ["901004", "901001"]);
  check("重新写入（按库序返回）", (await service.getRoleDeptIds(idB.toString())).sort(), [
    "901001",
    "901004",
  ]);
  await expectNoThrow("【有意偏差】非法 roleId 直接返回、不落库（原实现会抛 SQL 错误）", () =>
    service.updateRoleDepts("abc", ["901009"])
  );
  check("非法调用的部门未落库", await base.sysRoleDept.count({ where: { deptId: 901009n } }), 0);
  await service.updateRoleDepts(idB.toString(), ["901001", "901002"]);

  // ---------------------------------------------------------------- 11) 删除
  console.log("\n=== 11) 删除角色（校验规则 / 逻辑删除 / 缓存刷新） ===");
  await expectThrow("空字符串被拒", () => service.deleteRoles(""), "删除的角色ID不能为空");
  await expectThrow("纯空白被拒", () => service.deleteRoles("   "), "删除的角色ID不能为空");
  await expectThrow(
    "系统内置角色禁止删除",
    () => service.deleteRoles(rootId.toString()),
    "系统内置角色"
  );

  await service.saveRole({ name: NAMES.Z, code: CODES.Z, sort: 9, status: 1, dataScope: 1 });
  const idZ = await roleIdOf(CODES.Z);
  await base.sysUserRole.create({ data: { userId: BigInt(U3), roleId: idZ } });
  await expectThrow(
    "已分配用户的角色禁止删除",
    () => service.deleteRoles(idZ.toString()),
    "已分配用户"
  );

  await base.sysUserRole.deleteMany({ where: { userId: BigInt(U3), roleId: idZ } });
  await service.updateMenus(idZ.toString(), [m1.toString()]);
  check("删除前存在菜单关联", await base.sysRoleMenu.count({ where: { roleId: idZ } }), 1);
  const beforeDeleteZ = (await base.sysRole.findFirst({ where: { id: idZ } }))!;
  await service.deleteRoles(idZ.toString());
  const deletedZ = (await base.sysRole.findFirst({ where: { id: idZ } }))!;
  checkTrue("逻辑删除：行仍在物理表中", deletedZ !== null);
  check("逻辑删除：isDeleted 置 1", deletedZ.isDeleted, 1);
  check("菜单关联被清理", await base.sysRoleMenu.count({ where: { roleId: idZ } }), 0);
  check(
    "【已知缺陷】删除不刷新 updateTime（原实现走 update()）",
    deletedZ.updateTime!.getTime(),
    beforeDeleteZ.updateTime!.getTime()
  );
  check("删除后不出现在分页", (await service.getRolePage(1, 500, CODES.Z)).page.total, 0);
  check(
    "删除后不出现在下拉",
    (await service.getRoleOptions()).some((o) => o.value === idZ.toString()),
    false
  );
  check("删除后表单返回 null", await service.getRoleForm(idZ.toString()), null);
  check(
    "删除后权限缓存被刷新（该编码字段为空数组）",
    await redisService.hget(CACHE_KEY, CODES.Z),
    []
  );

  await expectNoThrow("【有意偏差】列表里的非法 ID 被跳过而非报错（原实现会抛 SQL 错误）", () =>
    service.deleteRoles("abc")
  );
  await expectNoThrow("不存在的 ID 被静默跳过", () => service.deleteRoles("999999999"));
  await expectNoThrow("纯分隔符被跳过", () => service.deleteRoles(" , , "));

  await service.saveRole({ name: NAMES.Y, code: CODES.Y, sort: 12, status: 1, dataScope: 1 });
  const idY = await roleIdOf(CODES.Y);
  await service.deleteRoles(`abc, ${idY.toString()}, `);
  check(
    "混合列表中合法 ID 照常删除",
    (await base.sysRole.findFirst({ where: { id: idY } }))!.isDeleted,
    1
  );

  await service.saveRole({ name: NAMES.V, code: CODES.V, sort: 14, status: 1, dataScope: 1 });
  const idV = await roleIdOf(CODES.V);
  check("remove 返回 { affected: 1 }", await service.remove(idV.toString()), { affected: 1 });
  check(
    "remove 后 isDeleted 置 1",
    (await base.sysRole.findFirst({ where: { id: idV } }))!.isDeleted,
    1
  );
  check(
    "【有意偏差】非法 ID 的 remove 返回 { affected: 0 }（原实现会抛 SQL 错误）",
    await service.remove("abc"),
    { affected: 0 }
  );

  // ---------------------------------------------------------------- 12) 跨模块回归
  console.log("\n=== 12) findRolesByIds 修复回归（user.service 依赖） ===");
  const rolesByIds = await service.findRolesByIds([idA.toString(), idC.toString()]);
  check("返回 2 条", rolesByIds.length, 2);
  check("字段集合", Object.keys(rolesByIds[0] as object).sort(), [
    "code",
    "dataScope",
    "id",
    "name",
  ]);
  const byId: Record<string, { id: bigint; code: string; name: string; dataScope: number }> = {};
  for (const r of rolesByIds) byId[r.id.toString()] = r;
  check(
    "🔴 修复回归：name 有值（原实现 select 未取 name ⇒ roleNames 恒为空）",
    byId[idA.toString()].name,
    NAMES.A
  );
  check("code 有值", byId[idA.toString()].code, CODES.A);
  check("dataScope 有值", byId[idA.toString()].dataScope, DataScopeEnum.SELF);
  check("id 为 BigInt（进程内）", typeof byId[idA.toString()].id, "bigint");
  check(
    "id 经 JSON 序列化后为字符串（大整数不丢精度）",
    typeof JSON.parse(JSON.stringify(rolesByIds[0])).id,
    "string"
  );
  const roleNamesJoined = (await service.findRolesByIds([idA.toString(), idC.toString()]))
    .map((r) => r.name)
    .sort()
    .join(",");
  check(
    "还原 user.service 的用法：roleNames 拼接后有内容（修复前恒为空串）",
    roleNamesJoined,
    [NAMES.A, NAMES.C].sort().join(",")
  );
  check("不存在的 ID 被过滤", (await service.findRolesByIds(["999999999"])).length, 0);
  check(
    "非法 ID 被过滤（toBigIntArray）",
    (await service.findRolesByIds(["abc", idA.toString()])).length,
    1
  );
  check("空入参返回 []", await service.findRolesByIds([]), []);
  check("逻辑删除的角色不返回", await service.findRolesByIds([idW.toString()]), []);

  // ---------------------------------------------------------------- 13) 收尾
  console.log("\n=== 13) 清理与残留检查 ===");
  await cleanup();
  check(
    "MARK 角色已清理",
    await base.sysRole.count({
      where: { OR: [{ name: { contains: MARK } }, { code: { contains: MARK } }] },
    }),
    0
  );
  check("MARK 菜单已清理", await base.sysMenu.count({ where: { name: { contains: MARK } } }), 0);
  check(
    "幽灵角色关联已清理",
    await base.sysRoleMenu.count({ where: { roleId: GHOST_ROLE_ID } }),
    0
  );
  check(
    "测试用户绑定已清理",
    await base.sysUserRole.count({ where: { userId: { in: TEST_USERS.map(BigInt) } } }),
    0
  );
  check("Redis token 版本键已清理", await redis.exists(`auth:user:token_version:${U1}`), 0);
  check("Redis 权限缓存字段已清理", await redis.hexists(CACHE_KEY, CODES.A), 0);
}

main()
  .catch(async (e) => {
    console.error("VERIFY_FAILED", e);
    await cleanup().catch(() => {});
    process.exitCode = 1;
  })
  .finally(async () => {
    console.log(
      `\n================ role 模块验证：${checks - failures}/${checks} 通过 ================`
    );
    if (failures) {
      console.log(`失败 ${failures} 项`);
      process.exitCode = 1;
    }
    await base.$disconnect().catch(() => {});
    redis.disconnect();
  });
