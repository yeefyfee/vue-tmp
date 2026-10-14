/**
 * user 模块 Prisma 移植 · 真库验证（PEL-10c · 最后一个模块）
 *
 * 直接实例化 `UserService`（不启 Nest、不走 HTTP），走真实 PostgreSQL + 真实 Redis，
 * 逐项校验「对外契约与 TypeORM 版本一致」，并覆盖静态检查查不出的语义：
 *   分页信封 / ROOT 用户排除 / 关键字三支且大小写不敏感 / 部门·状态·日期区间筛选 /
 *   角色名与部门名回填 / 创建（用户名查重·密码哈希·审计字段·角色关联·非法 ID 不留半成品）/
 *   更新（undefined 跳过 · 角色替换 · 会话失效 · 非法主键） / 状态与密码 / 手机·邮箱绑定解绑 /
 *   三个认证入口 / Excel 导入 / 下拉选项 / 用户菜单 ID / 删除（事务 + ROOT 保护）/ 数据权限端到端。
 *
 * 依赖装配：`RolePermService` / `RoleService` / `DeptService` 全部用**真实实例**（不打桩），
 * 这样 `findMe` 的权限分支、`deptName` 回填、`getUserMenuIds` 都是真库真代码链路。
 * 唯一"人造"的地方是 `PrismaService`：
 *   `PrismaService` 的构造函数需要一个 `ConfigService`，这里给一个只认 `database.url` /
 *   `database.logging` 的最小替身；`scoped` 用**真实的 `dataScopeExtension`** 扩展视图，
 *   所以数据权限注入路径是真的（见第 16 节）。
 *
 * ─────────────────────────────────────────────────────────────
 * 固化下述**已修 / 已记录**的行为（未来若要改，改断言即可）：
 *
 *  【已修 ①】`status` 筛选的空串语义（清单约定 12）
 *    `UserQueryDto.status` 原 `@Transform` 是 `Number(value)`，而 `Number('') === 0`
 *    ⇒ 前端筛选栏 `el-select clearable` 清空时 emit `''`，会变成「只看禁用用户」。
 *    本脚本用 `plainToInstance()` 直接断言 DTO 层已把 `''` 归一到 `undefined`
 *    （这是**唯一**能在 service 之外验到该修复的位置）。
 *
 *  【已修 ②】`mobile` / `email` 占用判定大小写不敏感
 *    旧库 `utf8mb4_general_ci` 下 `A@x.com` 与 `a@x.com` 同值，PG 区分 ⇒ 换库后
 *    会允许同一邮箱绑到两个账号。已用 `mode: "insensitive"` 补偿。
 *
 *  【保持原行为·固定成断言】见 `user.service.ts` 类注释「保持原行为的记录项」①~⑨：
 *    ① `update` 未传 `deptId` ⇒ 写 NULL（清空部门）
 *    ② `update` 会把 DTO 里的 `isDeleted` / `createTime` / `createBy` 一并落库
 *    ③ `updateUserStatus` / `resetUserPassword` / `changeCurrentUserPassword` /
 *       `bindOrChangeMobile` / `bindOrChangeEmail` **不刷新 `updateTime`**
 *       （对照：`unbindMobile` / `unbindEmail` 走 `save()` ⇒ **会**刷新）
 *    ④ 导入无整体事务、逐行独立提交
 *    ⑤ 导入的 `createTime` 由 `auditOnCreate()` 承接
 *    ⑥ `create` / `update` 的返回值**含 `password` 哈希**
 *    ⑦ `mobile` 无唯一索引（`findByMobile` 可能命中多行中的任意一行）
 *    ⑧ 日期区间已按应用时区（`Asia/Shanghai`）整日解释（对照旧实现按进程时区/UTC 混合）
 *    ⑨ 原 `getUserForm()`（死代码）已删除
 *
 *  ⭐ 两个「同族查询口径不一致」也固化成断言，避免后来者误当成 bug 顺手统一：
 *    · 「ROOT 用户排除」那条子查询**不过滤 `r.is_deleted`**，而「回填角色名」那条
 *      **过滤** `r.is_deleted = 0` ⇒ 角色被逻辑删除后：成员仍在用户列表中隐藏，但角色名不再回填。
 *    · `roleNames` 原 SQL 无 `ORDER BY`；本移植显式 `roleId ASC` 让顺序确定。
 *
 * 安全约定：所有造数（用户名 / 昵称 / 邮箱 / 角色 code·name / 部门 code·name）都带
 * `VERIFYUSER` 前缀，脚本开始与结束各清理一次，只删自己造的数据。
 *
 * 运行：
 *   node ./node_modules/ts-node/dist/bin.js -r tsconfig-paths/register scripts/verify-user-module.ts
 */
import { Redis } from "ioredis";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { plainToInstance } from "class-transformer";
import * as bcrypt from "bcrypt";
import * as XLSX from "xlsx";
import { UserService } from "../src/system/user/user.service";
import { UserQueryDto } from "../src/system/user/dto/user-query.dto";
import { RoleService } from "../src/system/role/role.service";
import { RolePermService } from "../src/system/role/role-permission.service";
import { DeptService } from "../src/system/dept/dept.service";
import { RedisService } from "../src/common/redis/redis.service";
import { dataScopeExtension } from "../src/common/prisma/data-scope.extension";
import { RequestContext } from "../src/common/context/request-context";
import { RoleDataScope } from "../src/common/models/role-data-scope.model";
import { DataScopeEnum } from "../src/common/enums/data-scope.enum";
import { DEFAULT_PASSWORD } from "../src/common/constants/system.constant";
import { ROOT_ROLE_CODE } from "../src/common/constants/role.constant";
import { enableBigIntJsonSerialization } from "../src/common/prisma/bigint-json";
import { formatDateTimeInZone } from "../src/common/utils/date.util";

enableBigIntJsonSerialization();

const CONNECTION =
  process.env.DATABASE_URL ?? "postgresql://admin:Pg%40123456@127.0.0.1:5432/peluvida_dev";

const base = new PrismaClient({ adapter: new PrismaPg({ connectionString: CONNECTION }) });
/** 真实的数据权限扩展视图 —— 业务读路径必须走它 */
const scoped = base.$extends(dataScopeExtension);
/** 与 `PrismaService` 同形的替身：原型链给出各 model delegate，另挂真实的 `scoped` */
const prismaLike = Object.assign(Object.create(base), { scoped });

const redis = new Redis({
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
  db: Number(process.env.REDIS_DB ?? 7),
  password: process.env.REDIS_PASSWORD || undefined,
  lazyConnect: true,
});

const redisService = new RedisService({ getOrThrow: () => redis } as never);

/** 可切换的 `SESSION_TYPE`，用于分别验证 jwt / redis-token 两条失效分支 */
let sessionType = "jwt";
const configStub = {
  get: (key: string) => (key === "SESSION_TYPE" ? sessionType : undefined),
};

const permService = new RolePermService(prismaLike as never, redisService);
const roleService = new RoleService(
  prismaLike as never,
  permService,
  configStub as never,
  redisService
);
const deptService = new DeptService(prismaLike as never);
const service = new UserService(
  roleService,
  deptService,
  permService,
  prismaLike as never,
  configStub as never,
  redisService
);

const MARK = "VERIFYUSER";
/** 造数用固定瞬时（刻意避开 1986–1991：中国那几年有夏令时，`Intl` 会按历史 tzdata 差 1 小时） */
const T_0310 = new Date("2026-03-10T10:20:30+08:00");
const T_0405 = new Date("2026-04-05T11:22:33+08:00");
const T_D1_EARLY = new Date("2026-03-01T06:00:00+08:00"); // 当日 06:00（旧实现会漏掉它）
const T_D1_LATE = new Date("2026-03-31T23:30:00+08:00"); // 当日 23:30
const T_NEXT_DAY = new Date("2026-04-01T00:30:00+08:00"); // 次日 00:30（应被排除）

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

/** 集合比较（顺序无关） */
function checkSet(label: string, actual: unknown, expected: unknown) {
  const norm = (v: unknown) => (Array.isArray(v) ? [...v].map(String).sort() : v);
  check(label, norm(actual), norm(expected));
}

/**
 * 取异常里**真正的业务文案**。两级读取缺一不可：
 *  · `BusinessException` 构造时传的是**对象** `{ code, msg }`（`extends HttpException`），
 *    Nest 的 `initMessage()` 只认字符串 response 或 `response.message`，
 *    对象里放的是 `msg` ⇒ `error.message` 退化成类名 `"Business Exception"`，真文案在 `response.msg`；
 *  · `getUserFormData()` 抛的是 `NotFoundException("用户不存在")`（字符串 response）⇒ 走 `message`。
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

/** 按 id 读**原始行**（绕过 service，直接看落库结果） */
async function raw(id: string | bigint) {
  return await base.sysUser.findFirst({ where: { id: BigInt(id.toString()) } });
}

/** 读某用户的角色 ID（升序字符串数组） */
async function rawRoleIds(userId: string | bigint): Promise<string[]> {
  const rows = await base.sysUserRole.findMany({
    where: { userId: BigInt(userId.toString()) },
    orderBy: { roleId: "asc" },
    select: { roleId: true },
  });
  return rows.map((r) => r.roleId.toString());
}

/** Redis 里的 token 版本号（`RedisService.set` 是 JSON 序列化的，这里读原始值再解析） */
async function tokenVersion(userId: string | bigint): Promise<number> {
  const v = await redis.get(`auth:user:token_version:${userId.toString()}`);
  return v === null ? 0 : Number(JSON.parse(v));
}

/** 按 id 读原始行的指定列，便于断言「未被改动」 */
async function updateTimeOf(userId: string | bigint) {
  const row = await base.sysUser.findFirst({
    where: { id: BigInt(userId.toString()) },
    select: { updateTime: true },
  });
  return row?.updateTime ?? null;
}

/** 造一个用户（直接落库，绕开 service，便于精确控制 createTime / createBy 等） */
async function seedUser(input: {
  username: string;
  nickname?: string;
  createTime?: Date | null;
  createBy?: bigint | null;
  deptId?: bigint | null;
  status?: number;
  password?: string;
}) {
  return await base.sysUser.create({
    data: {
      username: input.username,
      nickname: input.nickname ?? `${MARK}昵称`,
      password: input.password ?? (await bcrypt.hash(DEFAULT_PASSWORD, 10)),
      gender: 1,
      status: input.status ?? 1,
      deptId: input.deptId ?? null,
      createBy: input.createBy ?? null,
      createTime: input.createTime === undefined ? T_0310 : input.createTime,
      updateTime: T_0310,
    },
  });
}

/**
 * 「用户列表应当可见的 ID 集合」——用**独立的直查**复刻 service 语义，
 * 作为分页 `total` 的对照基准，避免把断言写成「期望一个写死的数字」。
 * 刻意不过滤 `r.is_deleted`（与实现一致，见文件头 ⭐）。
 */
async function visibleUserIds(): Promise<string[]> {
  const rootRoles = await base.sysRole.findMany({
    where: { code: ROOT_ROLE_CODE },
    select: { id: true },
  });
  let notIn: bigint[] = [];
  if (rootRoles.length) {
    const rows = await base.sysUserRole.findMany({
      where: { roleId: { in: rootRoles.map((r) => r.id) } },
      select: { userId: true },
    });
    notIn = [...new Set(rows.map((r) => r.userId))];
  }
  const users = await base.sysUser.findMany({
    where: { isDeleted: 0, ...(notIn.length ? { id: { notIn } } : {}) },
    select: { id: true },
  });
  return users.map((u) => u.id.toString());
}

/** 本脚本造出来的用户 id 集合（按用户名/昵称/邮箱前缀识别） */
async function myUserIds(): Promise<bigint[]> {
  const users = await base.sysUser.findMany({
    where: {
      OR: [
        { username: { contains: MARK } },
        { nickname: { contains: MARK } },
        { email: { contains: MARK } },
      ],
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

const REDIS_KEYS: string[] = [];
function trackRedisKey(key: string) {
  REDIS_KEYS.push(key);
  return key;
}

async function cleanup() {
  if (REDIS_KEYS.length) {
    await redis.del(...REDIS_KEYS);
    REDIS_KEYS.length = 0;
  }

  const ids = await myUserIds();
  if (ids.length) {
    await base.sysUserRole.deleteMany({ where: { userId: { in: ids } } });
  }
  await base.sysUser.deleteMany({ where: { username: { contains: MARK } } });
  await base.sysUser.deleteMany({ where: { nickname: { contains: MARK } } });
  await base.sysUser.deleteMany({ where: { email: { contains: MARK } } });

  const roles = await base.sysRole.findMany({
    where: { OR: [{ code: { contains: MARK } }, { name: { contains: MARK } }] },
    select: { id: true },
  });
  const roleIds = roles.map((r) => r.id);
  if (roleIds.length) {
    await base.sysRoleMenu.deleteMany({ where: { roleId: { in: roleIds } } });
    await base.sysRoleDept.deleteMany({ where: { roleId: { in: roleIds } } });
    await base.sysUserRole.deleteMany({ where: { roleId: { in: roleIds } } });
    await base.sysRole.deleteMany({ where: { id: { in: roleIds } } });
  }

  // 菜单造数（第 14 节造了 3 条，用于让「角色 → 菜单」链路的比较不是空集对空集）
  const menus = await base.sysMenu.findMany({
    where: { OR: [{ name: { contains: MARK } }, { routeName: { contains: MARK } }] },
    select: { id: true },
  });
  const menuIds = menus.map((m) => m.id);
  if (menuIds.length) {
    await base.sysRoleMenu.deleteMany({ where: { menuId: { in: menuIds } } });
    await base.sysMenu.deleteMany({ where: { id: { in: menuIds } } });
  }

  const depts = await base.sysDept.findMany({
    where: { OR: [{ code: { contains: MARK } }, { name: { contains: MARK } }] },
    select: { id: true },
  });
  const deptIds = depts.map((d) => d.id);
  if (deptIds.length) {
    // 先解绑（本脚本造的部门可能仍被用户引用），再删
    await base.sysUser.updateMany({
      where: { deptId: { in: deptIds } },
      data: { deptId: null },
    });
    await base.sysDept.deleteMany({ where: { id: { in: deptIds } } });
  }
}

async function main() {
  await cleanup();
  console.log(`\n================ user 模块验证开始（MARK=${MARK}）================`);

  // ─────────────────────────────────────────────
  console.log("\n=== 1) 环境与基线清点 ===");
  const baseUserCount = await base.sysUser.count();
  const baseDeptCount = await base.sysDept.count();
  const baseRoleCount = await base.sysRole.count();
  const baseMenuCount = await base.sysMenu.count();
  const baseVisible = await visibleUserIds();
  const realRoot = await base.sysUser.findFirst({ where: { username: "root" } });
  console.log(`  · 库中用户总数 ${baseUserCount}，其中列表可见 ${baseVisible.length}`);
  console.log(`  · 库中部门 ${baseDeptCount} / 角色 ${baseRoleCount} / 菜单 ${baseMenuCount}`);
  console.log(
    "  · 注意：本机开发库 `peluvida_dev` 只迁移了 schema、**未灌种子数据**（曾实测 0 行），" +
      "因此本脚本自带全部造数（含临时 ROOT 角色），并在结尾断言各项计数回到基线。"
  );

  // ROOT 角色：开发库里**可能是空的**（种子数据未灌），因此「有就复用、没有就临时造一个」，
  // 临时造的那个名称带 MARK 前缀，会被 cleanup() 回收；真实存在的那个绝不删。
  let rootRole = await base.sysRole.findFirst({ where: { code: ROOT_ROLE_CODE } });
  const rootRolePreexisting = rootRole !== null;
  console.log(
    `  · ROOT 角色：${rootRolePreexisting ? "库中已存在（复用）" : "库中不存在（临时创建，结束时回收）"}`
  );
  if (!rootRole) {
    rootRole = await base.sysRole.create({
      data: {
        name: `${MARK}临时超管角色`,
        code: ROOT_ROLE_CODE,
        sort: 999,
        dataScope: DataScopeEnum.ALL,
        status: 1,
        isDeleted: 0,
        createTime: T_0310,
        updateTime: T_0310,
      },
    });
  }
  checkTrue("ROOT 角色可用（复用或临时创建）", rootRole !== null);
  if (realRoot) {
    checkTrue(
      "库中真实的 root 用户不在可见集合里（ROOT 角色排除生效）",
      !baseVisible.includes(realRoot.id.toString())
    );
  } else {
    console.log("  · 库中没有名为 root 的用户（开发库为空），ROOT 排除改由第 3 节的临时超管验证");
  }

  // 菜单：第 14 节要验证「角色 → 菜单 ID 集合」的真链路，空库下必须自己造几条，
  // 否则断言会退化成「空集 == 空集」而失去意义。
  for (const idx of [1, 2, 3]) {
    await base.sysMenu.create({
      data: {
        parentId: 0n,
        treePath: "0",
        name: `${MARK}菜单${idx}`,
        menuType: "C",
        routeName: `${MARK}Menu${idx}`,
        visible: 1,
        sort: idx,
        createTime: T_0310,
        updateTime: T_0310,
      },
    });
  }
  check(
    "已准备 3 条临时菜单（供第 14 节使用）",
    await base.sysMenu.count({ where: { name: { contains: MARK } } }),
    3
  );

  // ─────────────────────────────────────────────
  console.log("\n=== 2) 造数：部门 / 角色 / 用户 ===");
  const d1 = await base.sysDept.create({
    data: {
      name: `${MARK}门店A`,
      code: `${MARK}_D1`,
      parentId: 0n,
      treePath: "0",
      sort: 1,
      status: 1,
      createTime: T_0310,
      updateTime: T_0310,
    },
  });
  const d2 = await base.sysDept.create({
    data: {
      name: `${MARK}门店B`,
      code: `${MARK}_D2`,
      parentId: d1.id,
      treePath: `0/${d1.id.toString()}`,
      sort: 2,
      status: 1,
      createTime: T_0310,
      updateTime: T_0310,
    },
  });
  console.log(`  · 部门 D1=${d1.id} D2=${d2.id}`);

  const r1 = await base.sysRole.create({
    data: {
      name: `${MARK}角色甲`,
      code: `${MARK}_R1`,
      sort: 1,
      dataScope: DataScopeEnum.ALL,
      status: 1,
      isDeleted: 0,
      createTime: T_0310,
      updateTime: T_0310,
    },
  });
  const r2 = await base.sysRole.create({
    data: {
      name: `${MARK}角色乙`,
      code: `${MARK}_R2`,
      sort: 2,
      dataScope: DataScopeEnum.SELF,
      status: 1,
      isDeleted: 0,
      createTime: T_0310,
      updateTime: T_0310,
    },
  });
  console.log(`  · 角色 R1=${r1.id} R2=${r2.id}（dataScope ALL / SELF）`);

  const u1 = await seedUser({ username: `${MARK}_u1`, nickname: `${MARK}甲`, deptId: d2.id });
  const u2 = await seedUser({
    username: `${MARK}_u2`,
    nickname: `${MARK}乙`,
    deptId: d1.id,
    createTime: T_0405,
  });
  const u3 = await seedUser({
    username: `${MARK}_u3`,
    nickname: `${MARK}丙`,
    deptId: d1.id,
    status: 0,
    createTime: T_D1_EARLY,
  });
  const u4 = await seedUser({
    username: `${MARK}_u4`,
    nickname: `${MARK}丁`,
    createTime: T_D1_LATE,
  });
  const u5 = await seedUser({
    username: `${MARK}_u5`,
    nickname: `${MARK}戊`,
    createTime: T_NEXT_DAY,
  });
  /** createTime 为 NULL —— 专门用来验证 `createTime DESC` 的 NULL 位序 */
  const uNull = await seedUser({
    username: `${MARK}_unull`,
    nickname: `${MARK}无时间`,
    createTime: null,
  });
  /** 专门用于 ROOT 语义验证 */
  const uRoot = await seedUser({ username: `${MARK}_uroot`, nickname: `${MARK}临时超管` });

  await base.sysUserRole.createMany({
    data: [
      { userId: u1.id, roleId: r1.id },
      { userId: u2.id, roleId: r1.id },
      { userId: u2.id, roleId: r2.id },
      { userId: u3.id, roleId: r2.id },
    ],
    skipDuplicates: true,
  });
  console.log(`  · 用户 u1=${u1.id} … u5=${u5.id} unull=${uNull.id} uroot=${uRoot.id}`);

  // ─────────────────────────────────────────────
  console.log("\n=== 3) ROOT 语义：用户列表排除 + findMe 全量权限 ===");
  await base.sysUserRole.create({ data: { userId: uRoot.id, roleId: rootRole!.id } });

  const pageWithRoot = await service.getUserPage(1, 200);
  checkTrue(
    "被授予 ROOT 角色的用户从用户列表中消失",
    !pageWithRoot.data.some((r) => r.id === uRoot.id.toString())
  );
  check(
    "total 与「独立直查复刻语义」的可见数一致（含本次临时超管被排除）",
    pageWithRoot.page.total,
    (await visibleUserIds()).length
  );

  const meRoot = await service.findMe({
    userId: uRoot.id.toString(),
    deptId: "",
    deptTreePath: "",
    roles: [ROOT_ROLE_CODE],
    dataScopes: [],
  });
  check("findMe：ROOT 用户的 roles 含 ROOT 角色编码", meRoot.roles.includes(ROOT_ROLE_CODE), true);
  checkTrue("findMe：ROOT 用户 perms 走 getAllPerms() 且为数组", Array.isArray(meRoot.perms));
  check("findMe：ROOT 用户 roleNames 回填为角色名", meRoot.roleNames, rootRole!.name);

  // 撤掉 ROOT 角色，恢复普通身份
  await base.sysUserRole.deleteMany({ where: { userId: uRoot.id, roleId: rootRole!.id } });
  checkSet("撤掉 ROOT 角色后该用户的角色为空", await rawRoleIds(uRoot.id), []);

  // ─────────────────────────────────────────────
  console.log("\n=== 4) create：用户名查重 / 密码哈希 / 审计字段 / 角色关联 / 非法 ID ===");
  const beforeCreate = await base.sysUser.count();
  await expectThrow(
    "用户名重复（完全相同）⇒ 抛「用户名已存在」",
    () => service.create({ username: `${MARK}_u1`, nickname: `${MARK}重复` }),
    "用户名已存在"
  );
  await expectThrow(
    "用户名重复（仅大小写不同）⇒ 也判重（旧库 utf8mb4_general_ci 语义）",
    () => service.create({ username: `${MARK}_U1`, nickname: `${MARK}重复` }),
    "用户名已存在"
  );
  check("两次重复创建都未插入任何行", await base.sysUser.count(), beforeCreate);

  const created = await service.create({
    username: `${MARK}_new`,
    nickname: `${MARK}新建`,
    password: "abc12345",
    gender: 2,
    deptId: d1.id.toString(),
    mobile: "13900000001",
    email: `${MARK}new@example.com`,
    status: 0,
    roleIds: [r1.id.toString(), r2.id.toString()],
  });
  const createdRaw = await raw(created.id);
  checkTrue("返回 id 是字符串", typeof created.id === "string");
  check(
    "密码已 bcrypt 哈希（≠ 明文）且可校验",
    await bcrypt.compare("abc12345", created.password),
    true
  );
  check("落库密码与返回值一致", createdRaw!.password, created.password);
  check("gender 落库", createdRaw!.gender, 2);
  check("status 落库", createdRaw!.status, 0);
  check("deptId 落库（BigInt）", createdRaw!.deptId?.toString(), d1.id.toString());
  check("email 落库", createdRaw!.email, `${MARK}new@example.com`);
  check("isDeleted 默认 0", createdRaw!.isDeleted, 0);
  checkTrue("createTime 由 auditOnCreate 填充（非空）", createdRaw!.createTime !== null);
  checkTrue("updateTime 由 auditOnCreate 填充（非空）", createdRaw!.updateTime !== null);
  checkSet("角色关联已写入 sys_user_role", await rawRoleIds(created.id), [r1.id, r2.id]);
  checkTrue("【记录项 ⑥】返回值含 password 哈希（既有契约缺陷，已固化）", "password" in created);

  const createdDefault = await service.create({
    username: `${MARK}_def`,
    nickname: `${MARK}默认值`,
  });
  const createdDefaultRaw = await raw(createdDefault.id);
  check("未传 gender ⇒ 列默认值 1", createdDefaultRaw!.gender, 1);
  check("未传 status ⇒ 列默认值 1", createdDefaultRaw!.status, 1);
  check("未传 deptId ⇒ NULL", createdDefaultRaw!.deptId, null);
  check("未传 roleIds ⇒ 不写关联表", (await rawRoleIds(createdDefault.id)).length, 0);

  const beforeIllegal = await base.sysUser.count();
  await expectThrow(
    "非法 deptId ⇒ 抛「部门ID格式不正确」",
    () =>
      service.create({
        username: `${MARK}_baddept`,
        nickname: `${MARK}坏部门`,
        deptId: "abc",
      }),
    "部门ID格式不正确"
  );
  await expectThrow(
    "非法 roleIds ⇒ 抛「角色ID格式不正确」",
    () =>
      service.create({
        username: `${MARK}_badrole`,
        nickname: `${MARK}坏角色`,
        roleIds: ["abc"],
      }),
    "角色ID格式不正确"
  );
  check("非法入参未插入任何用户（不留半成品）", await base.sysUser.count(), beforeIllegal);
  check(
    "非法 roleIds 的名称也未被占用（下次可正常创建）",
    await base.sysUser.count({
      where: { username: { in: [`${MARK}_baddept`, `${MARK}_badrole`] } },
    }),
    0
  );

  const dupRoleIds = await service.create({
    username: `${MARK}_duprole`,
    nickname: `${MARK}重复角色`,
    roleIds: [r1.id.toString(), r1.id.toString(), r2.id.toString()],
  });
  checkSet("重复 roleIds 被去重（原实现会撞复合主键报错）", await rawRoleIds(dupRoleIds.id), [
    r1.id,
    r2.id,
  ]);

  // ─────────────────────────────────────────────
  console.log("\n=== 5) getUserPage：信封 / 筛选 / 排序 / 分页 / 回填 / 约定 12 ===");
  const pageAll = await service.getUserPage(1, 200);
  check("返回信封的形状 keys（data / page）", Object.keys(pageAll).sort(), ["data", "page"]);
  check("page 的形状 keys（pageNum / pageSize / total）", Object.keys(pageAll.page).sort(), [
    "pageNum",
    "pageSize",
    "total",
  ]);
  check("total 与独立直查复刻语义一致", pageAll.page.total, (await visibleUserIds()).length);

  check("pageNum 非法（0）⇒ 归一为 1", (await service.getUserPage(0, 10)).page.pageNum, 1);
  check("pageSize 非法（0）⇒ 归一为 10", (await service.getUserPage(1, 0)).page.pageSize, 10);

  const pageByMark = await service.getUserPage(1, 200, undefined, MARK);
  checkTrue(
    "关键字命中本脚本造的全部用户（每个造出的 id 都能在结果里找到）",
    (await myUserIds()).every((id) => pageByMark.data.some((r) => r.id === id.toString())) &&
      pageByMark.data.length > 0
  );

  // 关键字三支：username / nickname / mobile
  const byUsername = await service.getUserPage(1, 50, undefined, `${MARK}_u1`);
  check(
    "关键字命中 username（大小写不敏感：小写查大写用户名）",
    byUsername.data.some((r) => r.username === `${MARK}_u1`),
    true
  );
  const upperCaseQuery = await service.getUserPage(1, 50, undefined, `${MARK}_U1`);
  check(
    "关键字大小写不敏感回归：大写关键字仍能命中",
    upperCaseQuery.data.some((r) => r.username === `${MARK}_u1`),
    true
  );
  const byNickname = await service.getUserPage(1, 50, undefined, `${MARK}乙`);
  check(
    "关键字命中 nickname",
    byNickname.data.some((r) => r.nickname === `${MARK}乙`),
    true
  );
  const byMobile = await service.getUserPage(1, 50, undefined, "13900000001");
  check(
    "关键字命中 mobile",
    byMobile.data.some((r) => r.mobile === "13900000001"),
    true
  );

  // 部门筛选
  const byDept1 = await service.getUserPage(1, 50, d1.id.toString(), MARK);
  checkTrue(
    "deptId 筛选只返回该部门的用户",
    byDept1.data.length > 0 && byDept1.data.every((r) => r.deptId === d1.id.toString())
  );
  const byDeptAll = await service.getUserPage(1, 200, "0", MARK);
  const byDeptEmpty = await service.getUserPage(1, 200, "", MARK);
  check("deptId='0' ⇒ 不筛选（对齐原实现）", byDeptAll.page.total, pageByMark.page.total);
  check("deptId='' ⇒ 不筛选（对齐原实现）", byDeptEmpty.page.total, pageByMark.page.total);
  await expectThrow(
    "deptId 非法（非空且非数字）⇒ 抛「部门ID格式不正确」（原为 SQL 级 500）",
    () => service.getUserPage(1, 10, "abc"),
    "部门ID格式不正确"
  );

  // 状态筛选 + 约定 12
  const byStatus0 = await service.getUserPage(1, 200, undefined, MARK, 0);
  checkTrue(
    "status=0 只返回禁用用户",
    byStatus0.data.length > 0 && byStatus0.data.every((r) => r.status === 0)
  );
  const byStatusUndefined = await service.getUserPage(1, 200, undefined, MARK, undefined);
  check(
    "status=undefined ⇒ 不筛选（与传 0 的结果不同，证明 status=0 是真的在筛选）",
    byStatusUndefined.page.total !== byStatus0.page.total,
    true
  );
  const dtoEmptyStatus = plainToInstance(UserQueryDto, { status: "" });
  check(
    "【已修 ①】DTO 层把 status='' 归一到 undefined（清空筛选不再变成 status=0）",
    dtoEmptyStatus.status,
    undefined
  );
  const dtoValueStatus = plainToInstance(UserQueryDto, { status: "0" });
  check("【已修 ①】DTO 仍保留 status='0' 的语义（真的筛禁用）", dtoValueStatus.status, 0);

  // 日期区间（约定 9：按应用时区整日解释）
  const dayRange = await service.getUserPage(1, 200, undefined, MARK, undefined, [
    "2026-03-01",
    "2026-03-01",
  ]);
  check(
    "区间 [03-01, 03-01] 命中当日 06:00 的记录（旧实现按 UTC/本地混合会漏掉它）",
    dayRange.data.some((r) => r.id === u3.id.toString()),
    true
  );
  const monthRange = await service.getUserPage(1, 200, undefined, MARK, undefined, [
    "2026-03-01",
    "2026-03-31",
  ]);
  check(
    "区间 [03-01, 03-31] 命中 03-31 23:30 的记录",
    monthRange.data.some((r) => r.id === u4.id.toString()),
    true
  );
  check(
    "区间 [03-01, 03-31] 排除 04-01 00:30 的记录",
    monthRange.data.some((r) => r.id === u5.id.toString()),
    false
  );
  check(
    "区间 [03-01, 03-31] 排除 04-05 的记录",
    monthRange.data.some((r) => r.id === u2.id.toString()),
    false
  );
  const openRange = await service.getUserPage(1, 200, undefined, MARK, undefined, ["2026-04-01"]);
  checkTrue(
    "只给起始日 ⇒ 只加下界（03-10 的记录被排除，04-05 的命中）",
    openRange.data.some((r) => r.id === u2.id.toString()) &&
      !openRange.data.some((r) => r.id === u4.id.toString())
  );

  // 排序：createTime DESC + NULL 排最后
  const sortedPage = await service.getUserPage(1, 200, undefined, MARK);
  const sortedTimes = sortedPage.data.map((r) => r.createTime);
  const nonNullTimes = sortedTimes.filter((t): t is string => t !== null);
  checkTrue(
    "createTime DESC：非空时间列严格非递增",
    nonNullTimes.every((t, i) => i === 0 || nonNullTimes[i - 1] >= t)
  );
  // 期望值用「独立直查 + 同样的排序语义」算出来，而不是写死某个用户的 id
  // （第 4 / 12 节也造了用户，其 createTime 是「当前时刻」，必然是最大的那个）
  const newestByDb = await base.sysUser.findFirst({
    where: {
      isDeleted: 0,
      OR: [
        { username: { contains: MARK } },
        { nickname: { contains: MARK } },
        { email: { contains: MARK } },
      ],
    },
    orderBy: { createTime: { sort: "desc", nulls: "last" } },
    select: { id: true },
  });
  check(
    "createTime DESC 首条 == 独立直查按同一语义取到的最新行",
    sortedPage.data[0].id,
    newestByDb!.id.toString()
  );
  check(
    "【PG 语义】createTime 为 NULL 的行排在**最后**（MySQL 相反，故显式 nulls:'last'）",
    sortedPage.data[sortedPage.data.length - 1].id,
    uNull.id.toString()
  );
  checkTrue(
    "行内 createTime 全部是 yyyy-MM-dd HH:mm:ss 形态（14 位 + 空格）",
    nonNullTimes.every((t) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(t))
  );
  const u2Row = await base.sysUser.findFirst({
    where: { id: u2.id },
    select: { createTime: true },
  });
  check(
    "createTime 按 Asia/Shanghai 格式化（u2 的 2026-04-05T11:22:33+08:00 ⇒ 11:22:33）",
    formatDateTimeInZone(u2Row!.createTime!),
    "2026-04-05 11:22:33"
  );

  // 分页切片
  const p1 = await service.getUserPage(1, 1, undefined, MARK);
  const p2 = await service.getUserPage(2, 1, undefined, MARK);
  check("pageSize=1 ⇒ data.length=1", p1.data.length, 1);
  check("分页 total 不随 pageSize 变化", p1.page.total, p2.page.total);
  checkTrue("第 2 页拿到的是不同的行", p1.data[0].id !== p2.data[0].id);

  // 回填
  const rowU1 = pageByMark.data.find((r) => r.id === u1.id.toString());
  const rowU2 = pageByMark.data.find((r) => r.id === u2.id.toString());
  check("deptName 回填（u1 在 D2）", rowU1?.deptName, `${MARK}门店B`);
  check("deptName 回填（u2 在 D1）", rowU2?.deptName, `${MARK}门店A`);
  checkSet("roleNames 回填（u2 有两个角色，按 roleId 升序拼接）", rowU2?.roleNames.split(","), [
    `${MARK}角色甲`,
    `${MARK}角色乙`,
  ]);
  check("roleNames 回填（u1 只有一个角色）", rowU1?.roleNames, `${MARK}角色甲`);
  check(
    "无角色用户的 roleNames 为空串（不是 null / undefined）",
    (await service.getUserPage(1, 50, undefined, `${MARK}_unull`)).data[0].roleNames,
    ""
  );
  check(
    "无部门用户的 deptName 为 null",
    (await service.getUserPage(1, 50, undefined, `${MARK}_unull`)).data[0].deptName,
    null
  );
  check(
    "无邮箱用户的 email 为空串（对齐原实现 `u.email || ''`）",
    (await service.getUserPage(1, 50, undefined, `${MARK}_unull`)).data[0].email,
    ""
  );

  // ─────────────────────────────────────────────
  console.log("\n=== 6) listExportUsers：不分页 + 与分页同口径 ===");
  const exportRows = await service.listExportUsers(undefined, MARK);
  check(
    "导出条数 == 分页 total（同口径筛选）",
    exportRows.length,
    (await service.getUserPage(1, 200, undefined, MARK)).page.total
  );
  check(
    "导出行的形状 keys 与分页行一致",
    Object.keys(exportRows[0]).sort(),
    Object.keys(pageByMark.data[0]).sort()
  );
  const exportStatus0 = await service.listExportUsers(undefined, MARK, 0);
  checkTrue(
    "导出同样支持 status 筛选",
    exportStatus0.length > 0 && exportStatus0.every((r) => r.status === 0)
  );
  const exportDept = await service.listExportUsers(d1.id.toString(), MARK);
  checkTrue(
    "导出同样支持 deptId 筛选",
    exportDept.length > 0 && exportDept.every((r) => r.deptId === d1.id.toString())
  );

  // ─────────────────────────────────────────────
  console.log("\n=== 7) getUserFormData：回显 / 异常 ===");
  const form = await service.getUserFormData(u1.id.toString());
  check("回显 id 为字符串", form.id, u1.id.toString());
  check("回显 username", form.username, `${MARK}_u1`);
  check("回显 deptId 为字符串", form.deptId, d2.id.toString());
  checkSet("回显 roleIds", form.roleIds, [r1.id]);
  check(
    "无邮箱时回显为空串（不是 null）",
    (await service.getUserFormData(uNull.id.toString())).email,
    ""
  );
  check(
    "无部门时回显为空串（不是 null）",
    (await service.getUserFormData(uNull.id.toString())).deptId,
    ""
  );
  await expectThrow(
    "不存在的用户 ⇒ NotFoundException「用户不存在」",
    () => service.getUserFormData("999999999"),
    "用户不存在"
  );
  await expectThrow(
    "非法 id ⇒ 同样是「用户不存在」（原为 SQL 静默无匹配）",
    () => service.getUserFormData("abc"),
    "用户不存在"
  );
  await expectThrow(
    "空 id ⇒ 抛「用户ID不能为空」",
    () => service.getUserFormData(""),
    "用户ID不能为空"
  );

  // ─────────────────────────────────────────────
  console.log("\n=== 8) update：undefined 跳过 / 角色替换 / 会话失效 / 记录项 ①② ===");
  await expectThrow(
    "roleIds 为空 ⇒ 抛「角色不能为空」",
    () => service.update(u1.id.toString(), { nickname: `${MARK}不应生效` }),
    "角色不能为空"
  );
  check(
    "上一条抛错后昵称未被改动（校验发生在写入之前）",
    (await raw(u1.id))!.nickname,
    `${MARK}甲`
  );

  await expectThrow(
    "用户名与他人重复 ⇒ 抛「用户名已存在」",
    () =>
      service.update(u1.id.toString(), {
        username: `${MARK}_u2`,
        roleIds: [r1.id.toString()],
      }),
    "用户名已存在"
  );
  await expectThrow(
    "用户名与他人重复（仅大小写不同）⇒ 也判重",
    () =>
      service.update(u1.id.toString(), {
        username: `${MARK}_U2`,
        roleIds: [r1.id.toString()],
      }),
    "用户名已存在"
  );

  const updated = await service.update(u1.id.toString(), {
    username: `${MARK}_u1renamed`,
    nickname: `${MARK}甲改`,
    gender: 2,
    status: 0,
    email: `${MARK}u1@example.com`,
    deptId: d1.id.toString(),
    password: "newpass123",
    roleIds: [r2.id.toString()],
  });
  const updatedRaw = await raw(u1.id);
  check("username 已更新", updatedRaw!.username, `${MARK}_u1renamed`);
  check("nickname 已更新", updatedRaw!.nickname, `${MARK}甲改`);
  check("gender 已更新", updatedRaw!.gender, 2);
  check("status 已更新", updatedRaw!.status, 0);
  check("email 已更新", updatedRaw!.email, `${MARK}u1@example.com`);
  check("deptId 已更新", updatedRaw!.deptId?.toString(), d1.id.toString());
  check(
    "password 已重新哈希且可校验",
    await bcrypt.compare("newpass123", updatedRaw!.password),
    true
  );
  checkSet("角色关联已被替换（不是追加）", await rawRoleIds(u1.id), [r2.id]);
  checkTrue("返回值含 password（既有契约缺陷 ⑥）", "password" in updated!);
  checkTrue("updateTime 已刷新", (updatedRaw!.updateTime?.getTime() ?? 0) > T_0310.getTime());

  const noPwd = await service.update(u1.id.toString(), { roleIds: [r2.id.toString()] });
  check("未传 password ⇒ 原密码保留（不是空串 / NULL）", noPwd!.password, updatedRaw!.password);

  const beforeUnchanged = await raw(u1.id);
  await service.update(u1.id.toString(), { roleIds: [r2.id.toString()] });
  const afterUnchanged = await raw(u1.id);
  check(
    "未传的业务字段保持原值（nickname 不被写成 NULL）",
    afterUnchanged!.nickname,
    beforeUnchanged!.nickname
  );
  check("未传 avatar ⇒ 保持 NULL", afterUnchanged!.avatar, null);

  const beforeDeptOmitted = await raw(u2.id);
  check("（前置）u2 本来有部门", beforeDeptOmitted!.deptId?.toString(), d1.id.toString());
  await service.update(u2.id.toString(), { roleIds: [r1.id.toString(), r2.id.toString()] });
  const afterDeptOmitted = await raw(u2.id);
  check(
    "【记录项 ①】未传 deptId ⇒ 被写成 NULL（清空部门）—— 原行为，已固化",
    afterDeptOmitted!.deptId,
    null
  );

  const u2TokenBefore = await tokenVersion(u2.id);
  await service.update(u2.id.toString(), {
    roleIds: [r1.id.toString()],
    deptId: d1.id.toString(),
  });
  checkSet("角色从 2 个减为 1 个", await rawRoleIds(u2.id), [r1.id]);
  check("角色集合变化 ⇒ token 版本 +1（会话失效）", await tokenVersion(u2.id), u2TokenBefore + 1);

  const u2TokenBefore2 = await tokenVersion(u2.id);
  await service.update(u2.id.toString(), { roleIds: [r1.id.toString()] });
  check("角色集合未变 ⇒ 不失效会话（token 版本不变）", await tokenVersion(u2.id), u2TokenBefore2);

  const beforeIsDeleted = await raw(uNull.id);
  check("（前置）isDeleted 为 0", beforeIsDeleted!.isDeleted, 0);
  await service.update(uNull.id.toString(), {
    roleIds: [r1.id.toString()],
    isDeleted: 1,
  });
  check(
    "【记录项 ②】DTO 里的 isDeleted 会被落库（越权面）—— 原行为，已固化",
    (await raw(uNull.id))!.isDeleted,
    1
  );
  await base.sysUser.update({ where: { id: uNull.id }, data: { isDeleted: 0 } });

  const beforeCreateTime = await raw(u5.id);
  await service.update(u5.id.toString(), {
    roleIds: [r1.id.toString()],
    createTime: new Date("2020-01-02T03:04:05+08:00"),
  });
  check(
    "【记录项 ②】DTO 里的 createTime 会被落库 —— 原行为，已固化",
    (await raw(u5.id))!.createTime?.toISOString(),
    new Date("2020-01-02T03:04:05+08:00").toISOString()
  );
  check(
    "（对照）上一次读到的 createTime 与改后不同",
    beforeCreateTime!.createTime?.toISOString() !== (await raw(u5.id))!.createTime?.toISOString(),
    true
  );
  await base.sysUser.update({ where: { id: u5.id }, data: { createTime: T_NEXT_DAY } });

  await expectThrow(
    "非法主键 ⇒ 抛「用户不存在」（不再静默走错分支，见清单约定 13）",
    () => service.update("abc", { roleIds: [r1.id.toString()] }),
    "用户不存在"
  );
  await expectThrow(
    "不存在的主键 ⇒ 抛「用户不存在」",
    () => service.update("999999999", { roleIds: [r1.id.toString()] }),
    "用户不存在"
  );
  await expectThrow(
    "非法 roleIds ⇒ 抛「角色ID格式不正确」",
    () => service.update(u3.id.toString(), { roleIds: ["abc"] }),
    "角色ID格式不正确"
  );
  checkSet("非法 roleIds 调用后角色关联未被破坏", await rawRoleIds(u3.id), [r2.id]);

  // ─────────────────────────────────────────────
  console.log(
    "\n=== 9) updateUserStatus / resetUserPassword / changeCurrentUserPassword / 会话失效 ==="
  );
  const u4Before = await raw(u4.id);
  check("updateUserStatus 成功 → true", await service.updateUserStatus(u4.id.toString(), 0), true);
  check("status 已落库", (await raw(u4.id))!.status, 0);
  check(
    "【记录项 ③】updateUserStatus 不刷新 updateTime（原走 repository.update()）",
    (await updateTimeOf(u4.id))!.toISOString(),
    u4Before!.updateTime!.toISOString()
  );
  check(
    "updateUserStatus 不存在的主键 → false",
    await service.updateUserStatus("999999999", 1),
    false
  );
  check("updateUserStatus 非法主键 → false", await service.updateUserStatus("abc", 1), false);

  await expectThrow(
    "resetUserPassword 空密码 ⇒ 抛「密码不能为空」",
    () => service.resetUserPassword(u4.id.toString(), "   "),
    "密码不能为空"
  );
  const u4TokenBefore = await tokenVersion(u4.id);
  const u4UpdateTimeBefore = await updateTimeOf(u4.id);
  check(
    "resetUserPassword 成功 → true",
    await service.resetUserPassword(u4.id.toString(), "reset12345"),
    true
  );
  check(
    "重置后的密码可校验",
    await bcrypt.compare("reset12345", (await raw(u4.id))!.password),
    true
  );
  check("重置密码 ⇒ token 版本 +1", await tokenVersion(u4.id), u4TokenBefore + 1);
  check(
    "【记录项 ③】resetUserPassword 不刷新 updateTime",
    (await updateTimeOf(u4.id))!.toISOString(),
    u4UpdateTimeBefore!.toISOString()
  );
  check(
    "resetUserPassword 不存在的主键 → false",
    await service.resetUserPassword("999999999", "x1234567"),
    false
  );

  // 当前用户改密码（u4 的密码此时是 reset12345）
  await expectThrow(
    "原密码错误 ⇒ 抛「原密码错误」",
    () =>
      service.changeCurrentUserPassword(u4.id.toString(), {
        oldPassword: "wrongpwd",
        newPassword: "next12345",
        confirmPassword: "next12345",
      }),
    "原密码错误"
  );
  await expectThrow(
    "新密码与原密码相同 ⇒ 抛「新密码不能与原密码相同」",
    () =>
      service.changeCurrentUserPassword(u4.id.toString(), {
        oldPassword: "reset12345",
        newPassword: "reset12345",
        confirmPassword: "reset12345",
      }),
    "新密码不能与原密码相同"
  );
  await expectThrow(
    "两次输入不一致 ⇒ 抛「新密码和确认密码不一致」",
    () =>
      service.changeCurrentUserPassword(u4.id.toString(), {
        oldPassword: "reset12345",
        newPassword: "next12345",
        confirmPassword: "other12345",
      }),
    "新密码和确认密码不一致"
  );
  const u4TokenBefore2 = await tokenVersion(u4.id);
  const u4UpdateTimeBefore2 = await updateTimeOf(u4.id);
  check(
    "changeCurrentUserPassword 成功 → true",
    await service.changeCurrentUserPassword(u4.id.toString(), {
      oldPassword: "reset12345",
      newPassword: "next12345",
      confirmPassword: "next12345",
    }),
    true
  );
  check("新密码可校验", await bcrypt.compare("next12345", (await raw(u4.id))!.password), true);
  check("改密码 ⇒ token 版本 +1", await tokenVersion(u4.id), u4TokenBefore2 + 1);
  check(
    "【记录项 ③】changeCurrentUserPassword 不刷新 updateTime",
    (await updateTimeOf(u4.id))!.toISOString(),
    u4UpdateTimeBefore2!.toISOString()
  );
  await expectThrow(
    "不存在的用户 ⇒ 抛「用户不存在」",
    () =>
      service.changeCurrentUserPassword("999999999", {
        oldPassword: "a",
        newPassword: "b",
        confirmPassword: "b",
      }),
    "用户不存在"
  );

  // redis-token 分支：会额外清理 access/refresh 映射
  sessionType = "redis-token";
  const accKey = trackRedisKey(`auth:user:access:${u4.id.toString()}`);
  const refKey = trackRedisKey(`auth:user:refresh:${u4.id.toString()}`);
  const accTok = trackRedisKey("auth:token:access:VERIFYUSER-ACC");
  const refTok = trackRedisKey("auth:token:refresh:VERIFYUSER-REF");
  await redisService.set(accKey, "VERIFYUSER-ACC");
  await redisService.set(refKey, "VERIFYUSER-REF");
  await redisService.set(accTok, { x: 1 });
  await redisService.set(refTok, { x: 1 });
  await service.resetUserPassword(u4.id.toString(), "jwtmode123");
  check("redis-token 模式：access 映射被清", await redis.get(accKey), null);
  check("redis-token 模式：refresh 映射被清", await redis.get(refKey), null);
  check("redis-token 模式：token→会话映射被清（access）", await redis.get(accTok), null);
  check("redis-token 模式：token→会话映射被清（refresh）", await redis.get(refTok), null);
  await redisService.del(`auth:user:jwt_session:${u4.id.toString()}`);
  sessionType = "jwt";

  // ─────────────────────────────────────────────
  console.log("\n=== 10) 手机号 / 邮箱：验证码 / 占用 / 解绑 ===");
  await expectThrow(
    "sendMobileCode 空手机号 ⇒ 抛「手机号不能为空」",
    () => service.sendMobileCode("  "),
    "手机号不能为空"
  );
  check("sendMobileCode 成功 → true", await service.sendMobileCode("13900000010"), true);
  const captchaKey = trackRedisKey("captcha:mobile:13900000010");
  check(
    '验证码已写入 Redis（JSON 形态的 "1234"）',
    await redis.get(captchaKey),
    JSON.stringify("1234")
  );
  checkTrue("验证码带 TTL", (await redis.ttl(captchaKey)) > 0);

  await expectThrow(
    "绑定手机号：密码错误 ⇒ 抛「当前密码错误」",
    () =>
      service.bindOrChangeMobile(u1.id.toString(), {
        mobile: "13900000011",
        code: "1234",
        password: "wrong",
      }),
    "当前密码错误"
  );
  await redis.del(captchaKey);
  await expectThrow(
    "绑定手机号：验证码已过期 ⇒ 抛「验证码已过期」",
    () =>
      service.bindOrChangeMobile(u1.id.toString(), {
        mobile: "13900000010",
        code: "1234",
        password: "newpass123",
      }),
    "验证码已过期"
  );
  await redisService.set(trackRedisKey("captcha:mobile:13900000010"), "9999", 300);
  await expectThrow(
    "绑定手机号：验证码错误 ⇒ 抛「验证码错误」",
    () =>
      service.bindOrChangeMobile(u1.id.toString(), {
        mobile: "13900000010",
        code: "1234",
        password: "newpass123",
      }),
    "验证码错误"
  );
  await redisService.set(trackRedisKey("captcha:mobile:13900000010"), "1234", 300);
  check(
    "绑定手机号成功 → true",
    await service.bindOrChangeMobile(u1.id.toString(), {
      mobile: "13900000010",
      code: "1234",
      password: "newpass123",
    }),
    true
  );
  check("手机号已落库", (await raw(u1.id))!.mobile, "13900000010");
  check("绑定成功后验证码键被删除", await redis.get(captchaKey), null);

  // 占用判定（他人已绑）
  await redisService.set(trackRedisKey("captcha:mobile:13900000010"), "1234", 300);
  await expectThrow(
    "手机号已被他人绑定 ⇒ 抛「手机号已被其他账号绑定」",
    () =>
      service.bindOrChangeMobile(u2.id.toString(), {
        mobile: "13900000010",
        code: "1234",
        password: DEFAULT_PASSWORD,
      }),
    "手机号已被其他账号绑定"
  );
  // 自己绑自己（占用的行是自己）⇒ 不应被误判
  await redisService.set(trackRedisKey("captcha:mobile:13900000010"), "1234", 300);
  check(
    "自己已绑同一手机号时不算「他人占用」（id: { not: 自己 }）",
    await service.bindOrChangeMobile(u1.id.toString(), {
      mobile: "13900000010",
      code: "1234",
      password: "newpass123",
    }),
    true
  );

  await expectThrow(
    "解绑手机号：未绑定的账号 ⇒ 抛「当前账号未绑定手机号」",
    () => service.unbindMobile(u3.id.toString(), DEFAULT_PASSWORD),
    "当前账号未绑定手机号"
  );
  await expectThrow(
    "解绑手机号：密码错误 ⇒ 抛「当前密码错误」",
    () => service.unbindMobile(u1.id.toString(), "wrong"),
    "当前密码错误"
  );
  const u1UpdateTimeBeforeUnbind = await updateTimeOf(u1.id);
  await new Promise((r) => setTimeout(r, 5));
  check("解绑手机号成功 → true", await service.unbindMobile(u1.id.toString(), "newpass123"), true);
  check("手机号被清空", (await raw(u1.id))!.mobile, null);
  check(
    "⭐ 解绑走 save() ⇒ **会**刷新 updateTime（对照记录项 ③）",
    (await updateTimeOf(u1.id))!.getTime() > u1UpdateTimeBeforeUnbind!.getTime(),
    true
  );

  await expectThrow(
    "sendEmailCode 空邮箱 ⇒ 抛「邮箱不能为空」",
    () => service.sendEmailCode(" "),
    "邮箱不能为空"
  );
  await service.sendEmailCode(`${MARK}mail@example.com`);
  const emailKey = trackRedisKey(`captcha:email:${MARK}mail@example.com`);
  check("邮箱验证码已写入 Redis", await redis.get(emailKey), JSON.stringify("1234"));

  // 大小写不敏感的占用判定（【已修 ②】）
  await redisService.set(trackRedisKey(`captcha:email:${MARK}UPPER@example.com`), "1234", 300);
  check(
    "绑定邮箱成功 → true（先给 u2 绑一个）",
    await service.bindOrChangeEmail(u2.id.toString(), {
      email: `${MARK}UPPER@example.com`,
      code: "1234",
      password: DEFAULT_PASSWORD,
    }),
    true
  );
  await redisService.set(trackRedisKey(`captcha:email:${MARK}upper@example.com`), "1234", 300);
  await expectThrow(
    "【已修 ②】仅大小写不同的邮箱视为「已被他人绑定」（PG 默认区分大小写，必须补偿）",
    () =>
      service.bindOrChangeEmail(u3.id.toString(), {
        email: `${MARK}upper@example.com`,
        code: "1234",
        password: DEFAULT_PASSWORD,
      }),
    "邮箱已被其他账号绑定"
  );
  await redisService.set(trackRedisKey(`captcha:email:${MARK}MAIL@example.com`), "1234", 300);
  check(
    "邮箱绑定成功（自己绑自己也算通过）",
    await service.bindOrChangeEmail(u3.id.toString(), {
      email: `${MARK}MAIL@example.com`,
      code: "1234",
      password: DEFAULT_PASSWORD,
    }),
    true
  );
  check("邮箱已落库", (await raw(u3.id))!.email, `${MARK}MAIL@example.com`);

  await expectThrow(
    "解绑邮箱：未绑定的账号 ⇒ 抛「当前账号未绑定邮箱」",
    () => service.unbindEmail(u4.id.toString(), "jwtmode123"),
    "当前账号未绑定邮箱"
  );
  await expectThrow(
    "解绑邮箱：密码错误 ⇒ 抛「当前密码错误」",
    () => service.unbindEmail(u3.id.toString(), "wrong"),
    "当前密码错误"
  );
  const u3UpdateTimeBeforeUnbind = await updateTimeOf(u3.id);
  await new Promise((r) => setTimeout(r, 5));
  check("解绑邮箱成功 → true", await service.unbindEmail(u3.id.toString(), DEFAULT_PASSWORD), true);
  check("邮箱被清空", (await raw(u3.id))!.email, null);
  check(
    "⭐ 解绑邮箱同样刷新 updateTime",
    (await updateTimeOf(u3.id))!.getTime() > u3UpdateTimeBeforeUnbind!.getTime(),
    true
  );

  // ─────────────────────────────────────────────
  console.log("\n=== 11) 认证入口：findMe / getAuthCredentialsByUsername / findByMobile ===");
  await expectThrow(
    "findMe：无 userId（空）⇒ 抛 ACCESS_TOKEN_INVALID（A0230「访问令牌无效或已过期」）",
    () => service.findMe({ userId: "", deptId: "", deptTreePath: "", roles: [], dataScopes: [] }),
    "访问令牌无效或已过期"
  );
  await expectThrow(
    "findMe：不存在的用户 ⇒ 抛「用户不存在」",
    () =>
      service.findMe({
        userId: "999999999",
        deptId: "",
        deptTreePath: "",
        roles: [],
        dataScopes: [],
      }),
    "用户不存在"
  );
  const me2 = await service.findMe({
    userId: u2.id.toString(),
    deptId: d1.id.toString(),
    deptTreePath: "0",
    roles: [`${MARK}_R1`],
    dataScopes: [],
  });
  check("findMe：userId 为字符串且等于入参", me2.userId, u2.id.toString());
  check("findMe：username", me2.username, `${MARK}_u2`);
  check("findMe：roles 为角色 code", me2.roles, [`${MARK}_R1`]);
  check(
    "⭐ findMe：roleNames 真正有值（回归 `findRolesByIds` 补 name 的修复）",
    me2.roleNames,
    `${MARK}角色甲`
  );
  checkTrue("findMe：perms 为数组（无菜单角色 ⇒ 空数组）", Array.isArray(me2.perms));
  check("findMe：createTime 按 Asia/Shanghai 格式化", me2.createTime, "2026-04-05 11:22:33");
  // ⭐ 这里正好是「记录项 ①」的现场：第 8 节最后一次 update 未传 deptId ⇒ u2 的部门已被写成 NULL，
  //    于是 `deptName` 与 `getAuthCredentialsByUsername().deptTreePath` 都拿不到值。
  check(
    "【记录项 ① 现场】u2 的部门已被「未传 deptId」清空 ⇒ findMe 的 deptName 为 undefined",
    me2.deptName,
    undefined
  );

  // 用一个**仍有部门**的用户再验一次回填（u3 全程未被 update 过）
  const me3 = await service.findMe({
    userId: u3.id.toString(),
    deptId: d1.id.toString(),
    deptTreePath: "0",
    roles: [`${MARK}_R2`],
    dataScopes: [],
  });
  check("findMe：deptName 回填（u3 在 D1）", me3.deptName, `${MARK}门店A`);
  check("findMe：deptId 为字符串", me3.deptId, d1.id.toString());
  check("findMe：roles 为角色 code（u3 只有 R2）", me3.roles, [`${MARK}_R2`]);
  check("findMe：roleNames 回填", me3.roleNames, `${MARK}角色乙`);

  const cred = await service.getAuthCredentialsByUsername(`${MARK}_u2`);
  checkTrue("getAuthCredentialsByUsername 命中", cred !== null);
  check("认证信息 id 为字符串", cred!.id, u2.id.toString());
  check(
    "认证信息含 password 哈希",
    typeof cred!.password === "string" && cred!.password.startsWith("$2"),
    true
  );
  check("认证信息 roles = 角色 code", cred!.roles, [`${MARK}_R1`]);
  checkTrue("认证信息 dataScopes 非空（R1 的 ALL 范围）", cred!.dataScopes.length === 1);
  check("【记录项 ① 现场】u2 无部门 ⇒ deptId 回落为空串", cred!.deptId, "");
  check("【记录项 ① 现场】u2 无部门 ⇒ deptTreePath 回落为空串", cred!.deptTreePath, "");

  const cred3 = await service.getAuthCredentialsByUsername(`${MARK}_u3`);
  check("认证信息 deptId（u3 属于 D1）", cred3!.deptId, d1.id.toString());
  check('认证信息 deptTreePath（D1 的 treePath 为 "0"）', cred3!.deptTreePath, "0");
  check("认证信息 nickname 已带上", cred3!.nickname, `${MARK}丙`);
  check("认证信息 status 已带上", cred3!.status, 0);
  const credUpper = await service.getAuthCredentialsByUsername(`${MARK}_U2`);
  checkTrue(
    "⭐ 用户名大小写不敏感（旧库 general_ci 语义）：大写也能查到同一个人",
    credUpper !== null && credUpper.id === u2.id.toString()
  );
  check(
    "不存在的用户名 ⇒ null",
    await service.getAuthCredentialsByUsername(`${MARK}_nobody`),
    null
  );

  check("findByMobile：空串 ⇒ null", await service.findByMobile("   "), null);
  check("findByMobile：未命中 ⇒ null", await service.findByMobile("13700000000"), null);
  const byMob = await service.findByMobile("13900000001");
  checkTrue("findByMobile 命中（create 时绑的号）", byMob !== null);
  check("findByMobile 返回 id 为字符串", byMob!.id, created.id);
  check("findByMobile 不含 password 字段", "password" in byMob!, false);

  // ─────────────────────────────────────────────
  console.log("\n=== 12) importUsersFromBuffer：逐行校验 + 落库 ===");
  const sheetRows = [
    ["用户名", "昵称", "性别", "手机号码", "邮箱", "角色", "部门"],
    [
      `${MARK}_imp1`,
      `${MARK}导入男`,
      "男",
      "13900000021",
      `${MARK}imp1@example.com`,
      `${MARK}_R1`,
      `${MARK}_D1`,
    ],
    [`${MARK}_imp2`, `${MARK}导入女`, "女", "", "", `${MARK}角色乙`, `${MARK}门店B`],
    ["", `${MARK}缺用户名`, "男", "", "", `${MARK}_R1`, ""],
    [`${MARK}_imp3`, "", "男", "", "", `${MARK}_R1`, ""],
    [`${MARK}_u1renamed`, `${MARK}用户名已存在`, "男", "", "", `${MARK}_R1`, ""],
    [`${MARK}_imp4`, `${MARK}角色不存在`, "男", "", "", "不存在的角色", ""],
    [`${MARK}_imp5`, `${MARK}部门不存在`, "男", "", "", `${MARK}_R1`, "不存在的部门"],
    [`${MARK}_imp6`, `${MARK}未填性别`, "", "", "", `${MARK}_R1`, ""],
  ];
  const ws = XLSX.utils.aoa_to_sheet(sheetRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "用户");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const impResult = await service.importUsersFromBuffer(buf);
  check("导入返回 code = SUCCESS（00000）", impResult.code, "00000");
  check("有效行数 = 3（imp1 / imp2 / imp6）", impResult.validCount, 3);
  check("无效行数 = 5", impResult.invalidCount, 5);
  checkTrue(
    "messageList 含「用户名或昵称不能为空」",
    impResult.messageList.some((m) => m.includes("用户名或昵称不能为空"))
  );
  checkTrue(
    "messageList 含「用户名已存在」",
    impResult.messageList.some((m) => m.includes("用户名已存在"))
  );
  checkTrue(
    "messageList 含「角色不存在或为空」",
    impResult.messageList.some((m) => m.includes("角色不存在或为空"))
  );
  checkTrue(
    "messageList 含「部门不存在」",
    impResult.messageList.some((m) => m.includes("部门不存在"))
  );

  const imp1 = await base.sysUser.findFirst({ where: { username: `${MARK}_imp1` } });
  const imp2 = await base.sysUser.findFirst({ where: { username: `${MARK}_imp2` } });
  const imp6 = await base.sysUser.findFirst({ where: { username: `${MARK}_imp6` } });
  check("导入行已落库", imp1 !== null && imp2 !== null && imp6 !== null, true);
  check("性别「男」映射为 1", imp1!.gender, 1);
  check("性别「女」映射为 2", imp2!.gender, 2);
  check("性别留空映射为 0", imp6!.gender, 0);
  check("状态固定为 1", imp1!.status, 1);
  check("isDeleted 固定为 0", imp1!.isDeleted, 0);
  check("手机号留空 ⇒ NULL", imp2!.mobile, null);
  check("邮箱留空 ⇒ NULL", imp2!.email, null);
  check("角色按「名称」匹配（imp2 用的是角色乙的名称）", await rawRoleIds(imp2!.id), [
    r2.id.toString(),
  ]);
  check("部门按「名称」匹配（imp2 用的是门店B的名称）", imp2!.deptId?.toString(), d2.id.toString());
  checkTrue("默认密码 = 123456（可校验）", await bcrypt.compare(DEFAULT_PASSWORD, imp1!.password));
  check(
    "【记录项 ⑤】导入行 updateTime 非空（auditOnCreate 承接）",
    imp1!.updateTime !== null,
    true
  );
  check("【记录项 ④】导入不写 createBy（无上下文，auditOnCreate 留空）", imp1!.createBy, null);

  // ⚠️ 「导入文件为空」（`!sheet`）那个分支**从真实 buffer 触发不到**：
  //    `XLSX.write` 拒绝空工作簿（抛 `Workbook is empty`），而任何能写出来的文件都至少有一个 sheet；
  //    实测把垃圾字节喂给 `XLSX.read` 也会得到一个名为 Sheet1 的空表。
  //    故这里只能断言「空表 ⇒ 0 有效 0 无效、不抛错」这个**可达**行为。
  const emptySheetBuf = (() => {
    const wb0 = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb0, XLSX.utils.aoa_to_sheet([]), "空表");
    return XLSX.write(wb0, { type: "buffer", bookType: "xlsx" }) as Buffer;
  })();
  const emptyResult = await service.importUsersFromBuffer(emptySheetBuf);
  check(
    "空表（无数据行）⇒ 0 有效 / 0 无效，且不抛错",
    [emptyResult.validCount, emptyResult.invalidCount],
    [0, 0]
  );
  check("空表 ⇒ code 仍为 SUCCESS", emptyResult.code, "00000");

  // ─────────────────────────────────────────────
  console.log("\n=== 13) listUserOptions：只含启用用户 + label 回落 ===");
  const options = await service.listUserOptions();
  const optionIds = options.map((o) => o.value);
  checkTrue("只包含 status=1 且未删除的用户", !optionIds.includes(u3.id.toString()));
  checkTrue(
    "已禁用用户不在下拉里（u1 上一节被改成 status=0）",
    !optionIds.includes(u1.id.toString())
  );
  checkTrue("启用用户在下拉里（u2）", optionIds.includes(u2.id.toString()));
  const opt2 = options.find((o) => o.value === u2.id.toString());
  check("label 取 nickname", opt2?.label, `${MARK}乙`);
  const nicknameBlank = await seedUser({ username: `${MARK}_blank`, nickname: "   " });
  const options2 = await service.listUserOptions();
  check(
    "label 回落：nickname 为空白时取 username",
    options2.find((o) => o.value === nicknameBlank.id.toString())?.label,
    `${MARK}_blank`
  );
  checkTrue(
    "value 一律是字符串",
    options2.every((o) => typeof o.value === "string")
  );
  const numIds = options2.map((o) => Number(o.value));
  checkTrue(
    "按 id 升序",
    numIds.every((v, i) => i === 0 || numIds[i - 1] <= v)
  );

  // ─────────────────────────────────────────────
  console.log("\n=== 14) getUserMenuIds：关联表 → 角色 → 菜单 ===");
  checkSet("无角色的用户 ⇒ 空数组", await service.getUserMenuIds(u4.id.toString()), []);
  checkSet("非法 id ⇒ 空数组", await service.getUserMenuIds("abc"), []);
  checkSet("空 id ⇒ 空数组", await service.getUserMenuIds(""), []);

  const menusOfR1 = await base.sysRoleMenu.findMany({
    where: { roleId: r1.id },
    select: { menuId: true },
  });
  const anyMenu = await base.sysMenu.findMany({
    where: { name: { contains: MARK } },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  check("前置：本轮造了 3 条菜单（避免「空集 == 空集」的伪断言）", anyMenu.length, 3);
  await base.sysRoleMenu.deleteMany({ where: { roleId: r1.id } });
  await base.sysRoleMenu.createMany({
    data: anyMenu.map((m) => ({ roleId: r1.id, menuId: m.id })),
    skipDuplicates: true,
  });
  const expectedMenus = anyMenu.map((m) => m.id.toString());
  checkSet(
    "有角色的用户 ⇒ 返回其角色的菜单 ID 集合",
    await service.getUserMenuIds(u2.id.toString()),
    expectedMenus
  );
  check(
    "与 RoleService.getMenuIdsByRoleIds 结果一致（同一条真链路）",
    JSON.stringify((await service.getUserMenuIds(u2.id.toString())).slice().sort()),
    JSON.stringify((await roleService.getMenuIdsByRoleIds([r1.id.toString()])).slice().sort())
  );
  // 还原该角色的菜单关联
  await base.sysRoleMenu.deleteMany({ where: { roleId: r1.id } });
  if (menusOfR1.length) {
    await base.sysRoleMenu.createMany({
      data: menusOfR1.map((m) => ({ roleId: r1.id, menuId: m.menuId })),
      skipDuplicates: true,
    });
  }

  // ─────────────────────────────────────────────
  console.log("\n=== 15) deleteUser：ROOT 保护 / 事务 / 会话失效 ===");
  await expectThrow("空 id ⇒ 抛「用户ID不能为空」", () => service.deleteUser(""), "用户ID不能为空");
  check("非法 id ⇒ true（对齐原实现：查不到即视为已删）", await service.deleteUser("abc"), true);
  check("不存在的 id ⇒ true", await service.deleteUser("999999999"), true);

  await base.sysUserRole.create({ data: { userId: u2.id, roleId: rootRole!.id } });
  await expectThrow(
    "ROOT 用户 ⇒ 抛「系统管理员禁止删除」",
    () => service.deleteUser(u2.id.toString()),
    "系统管理员禁止删除"
  );
  check("拦截后用户仍在", (await raw(u2.id))!.isDeleted, 0);
  checkSet("拦截后 ROOT 角色关联未被误删", await rawRoleIds(u2.id), [r1.id, rootRole!.id]);
  await base.sysUserRole.deleteMany({ where: { userId: u2.id, roleId: rootRole!.id } });

  const u2TokenBeforeDelete = await tokenVersion(u2.id);
  const u2UpdateTimeBeforeDelete = await updateTimeOf(u2.id);
  await new Promise((r) => setTimeout(r, 5));
  check("正常删除 → true", await service.deleteUser(u2.id.toString()), true);
  check("逻辑删除：isDeleted = 1", (await raw(u2.id))!.isDeleted, 1);
  checkSet("角色关联被清空", await rawRoleIds(u2.id), []);
  check("删除 ⇒ token 版本 +1（会话失效）", await tokenVersion(u2.id), u2TokenBeforeDelete + 1);
  check(
    "删除显式刷新 updateTime",
    (await updateTimeOf(u2.id))!.getTime() > u2UpdateTimeBeforeDelete!.getTime(),
    true
  );
  check(
    "已删除的用户再删 ⇒ true（查不到即视为已删）",
    await service.deleteUser(u2.id.toString()),
    true
  );
  const pageAfterDelete = await service.getUserPage(1, 200, undefined, MARK);
  checkTrue(
    "已删除用户不再出现在列表",
    !pageAfterDelete.data.some((r) => r.id === u2.id.toString())
  );

  // ─────────────────────────────────────────────
  console.log("\n=== 16) 数据权限端到端（真实 dataScopeExtension + RequestContext） ===");
  // 用专用关键字把结果集收窄到本节的两个人，避免与前面造的 u1/u3/… 混杂
  const SCOPE_KW = `${MARK}_scope`;
  const a = await seedUser({
    username: `${MARK}_scopeA`,
    nickname: `${MARK}权限甲`,
    deptId: d1.id,
  });
  const b = await seedUser({
    username: `${MARK}_scopeB`,
    nickname: `${MARK}权限乙`,
    deptId: d2.id,
  });
  // 「仅本人」范围看的是 `ownerField`（=`createBy`），分别指向自己
  await base.sysUser.update({ where: { id: a.id }, data: { createBy: a.id } });
  await base.sysUser.update({ where: { id: b.id }, data: { createBy: b.id } });

  const CFG = { model: "SysUser", deptField: "deptId", ownerField: "createBy" };
  const idsOf = (rows: { id: string }[]) =>
    rows
      .map((r) => r.id)
      .sort()
      .map(String);

  const both = [a.id, b.id].map(String).sort();

  // ① 无上下文（脚本默认态）：扩展不注入
  const noCtx = await service.getUserPage(1, 200, undefined, SCOPE_KW);
  check("无数据权限配置 ⇒ 两行都可见（基准）", idsOf(noCtx.data), both);
  check("无数据权限配置 ⇒ total = 2", noCtx.page.total, 2);

  await RequestContext.run(async () => {
    RequestContext.setDataPermissionConfig(CFG as never);
    const ctx = (dataScopes: RoleDataScope[], deptId = "", isRoot = false) =>
      RequestContext.initUserContext({
        userId: a.id.toString(),
        deptId,
        deptTreePath: "0",
        roles: [`${MARK}_R2`],
        dataScopes,
        isRoot,
      });
    // 用 `RoleDataScope` 真实实例（类上带 `toJSON`，纯字面量在结构上不满足该类型）
    const scope = (dataScope: number, customDeptIds?: number[]) => [
      new RoleDataScope(`${MARK}_R2`, dataScope, customDeptIds),
    ];

    // ② 仅本人
    ctx(scope(DataScopeEnum.SELF));
    const self = await service.getUserPage(1, 200, undefined, SCOPE_KW);
    check("SELF 范围（ownerField=createBy）⇒ 只看得到自己的行", idsOf(self.data), [String(a.id)]);
    check("SELF 范围 ⇒ total 同步受限", self.page.total, 1);

    // ③ 无任何数据范围 ⇒ 恒假（fail-closed）
    ctx([]);
    const empty = await service.getUserPage(1, 200, undefined, SCOPE_KW);
    check("无任何数据范围 ⇒ 0 行（fail-closed）", empty.page.total, 0);

    // ④ 全部数据
    ctx(scope(DataScopeEnum.ALL));
    const allScope = await service.getUserPage(1, 200, undefined, SCOPE_KW);
    check("ALL 范围 ⇒ 两行都可见", allScope.page.total, 2);

    // ⑤ 本部门
    ctx(scope(DataScopeEnum.DEPT), d1.id.toString());
    const deptScoped = await service.getUserPage(1, 200, undefined, SCOPE_KW);
    check("DEPT 范围（自己属于 D1）⇒ 只见 D1 的用户", idsOf(deptScoped.data), [String(a.id)]);

    // ⑥ 本部门及子部门 —— 这里踩到一个**跨模块的真实缺陷**，故断言「现状 + 机制自证」两条：
    //    · `data-scope.extension.ts#resolveSubtreeDeptIds` 按 **逗号**匹配 tree_path
    //      （`startsWith('父,')` / `endsWith(',父')` / `contains(',父,')`，继承自原 MySQL `FIND_IN_SET`）；
    //    · 而 `DeptService.buildTreePath()` 写的是 **斜杠**（`0/父/子`，原实现即如此）。
    //    ⇒ 生产数据下 DEPT_AND_SUB **退化成「仅本部门」**，子部门永远匹配不上（历史缺陷，非本次移植引入）。
    ctx(scope(DataScopeEnum.DEPT_AND_SUB), d1.id.toString());
    const subSlash = await service.getUserPage(1, 200, undefined, SCOPE_KW);
    check(
      "【已知缺陷·固化】tree_path 用 `/` 分隔时，DEPT_AND_SUB 退化成「仅本部门」（子部门匹配不上）",
      idsOf(subSlash.data),
      [String(a.id)]
    );
    // 把 D2 的 treePath 临时改成逗号形态 ⇒ 子部门立刻能被匹配上，证明机制本身没问题、问题在分隔符口径
    await base.sysDept.update({
      where: { id: d2.id },
      data: { treePath: `0,${d1.id.toString()}` },
    });
    const subComma = await service.getUserPage(1, 200, undefined, SCOPE_KW);
    check(
      "机制自证：tree_path 改成 `,` 分隔后，DEPT_AND_SUB 立刻能命中子部门（a + b）",
      idsOf(subComma.data),
      both
    );
    check(
      "数据权限同样作用于 count（total == data.length）",
      subComma.page.total,
      subComma.data.length
    );
    await base.sysDept.update({
      where: { id: d2.id },
      data: { treePath: `0/${d1.id.toString()}` },
    });

    // ⑦ 自定义部门
    ctx(scope(DataScopeEnum.CUSTOM, [Number(d2.id)]), "");
    const customScoped = await service.getUserPage(1, 200, undefined, SCOPE_KW);
    check("CUSTOM 范围（只勾 D2）⇒ 只见 D2 的用户", idsOf(customScoped.data), [String(b.id)]);

    ctx(scope(DataScopeEnum.CUSTOM, []), "");
    const customNone = await service.getUserPage(1, 200, undefined, SCOPE_KW);
    check("CUSTOM 范围但一个部门都没勾 ⇒ 0 行", customNone.page.total, 0);

    // ⑧ 导出走同一个扩展
    ctx(scope(DataScopeEnum.DEPT), d1.id.toString());
    const exportScoped = await service.listExportUsers(undefined, SCOPE_KW);
    check("listExportUsers 用同一个 scoped 客户端 ⇒ 同样受限", idsOf(exportScoped), [String(a.id)]);

    // ⑨ 超管
    ctx([], "", true);
    const rootCtx = await service.getUserPage(1, 200, undefined, SCOPE_KW);
    check("isRoot=true ⇒ 不注入数据权限", rootCtx.page.total, 2);

    // ⑩ 单条受限读同样被拦（`findFirst` 在扩展的作用集内）
    ctx(scope(DataScopeEnum.SELF));
    const formA = await service.getUserFormData(a.id.toString());
    check("受限上下文中读自己的表单 ⇒ 正常", formA.id, a.id.toString());
    await expectThrow(
      "受限上下文中读他人的表单 ⇒ 被数据权限挡成「用户不存在」",
      () => service.getUserFormData(b.id.toString()),
      "用户不存在"
    );

    // ⑪ 写操作不受影响（扩展只作用于读操作白名单）
    check(
      "写操作不受数据权限限制（扩展只作用于读）",
      await service.updateUserStatus(b.id.toString(), 0),
      true
    );
  });
  await base.sysUser.update({ where: { id: b.id }, data: { status: 1 } });

  // ─────────────────────────────────────────────
  console.log("\n=== 17) 清理与残留 ===");
  const idsBeforeCleanup = (await myUserIds()).map(String);
  checkTrue("清理前确实有造数（否则下面的残留断言是空跑）", idsBeforeCleanup.length > 0);
  const menusBeforeCleanup = await base.sysMenu.count({ where: { name: { contains: MARK } } });
  check("清理前确实有菜单造数", menusBeforeCleanup, 3);

  await cleanup();

  check(
    "用户造数已清理干净",
    await base.sysUser.count({
      where: {
        OR: [
          { username: { contains: MARK } },
          { nickname: { contains: MARK } },
          { email: { contains: MARK } },
        ],
      },
    }),
    0
  );
  check(
    "用户角色绑定已清理干净",
    await base.sysUserRole.count({ where: { userId: { in: idsBeforeCleanup.map(BigInt) } } }),
    0
  );
  check("角色造数已清理干净", await base.sysRole.count({ where: { code: { contains: MARK } } }), 0);
  check("部门造数已清理干净", await base.sysDept.count({ where: { code: { contains: MARK } } }), 0);
  check("菜单造数已清理干净", await base.sysMenu.count({ where: { name: { contains: MARK } } }), 0);
  check(
    "临时 ROOT 角色已回收（名称带 MARK）",
    await base.sysRole.count({ where: { name: { contains: MARK } } }),
    0
  );
  if (rootRolePreexisting) {
    checkTrue(
      "库中原本就有的 ROOT 角色**未被删除**（只复用不删）",
      (await base.sysRole.findFirst({ where: { code: ROOT_ROLE_CODE } })) !== null
    );
  }
  check("库中用户总数回到基线", await base.sysUser.count(), baseUserCount);
  check("库中部门总数回到基线", await base.sysDept.count(), baseDeptCount);
  check("库中角色总数回到基线", await base.sysRole.count(), baseRoleCount);
  check("库中菜单总数回到基线", await base.sysMenu.count(), baseMenuCount);

  await base.$disconnect();
  await redis.quit();
}

main()
  .catch(async (e) => {
    console.error("VERIFY_FAILED", e);
    await cleanup().catch(() => {});
    await base.$disconnect().catch(() => {});
    await redis.quit().catch(() => {});
    process.exitCode = 1;
  })
  .finally(() => {
    console.log(
      `\n================ user 模块验证：${checks - failures}/${checks} 通过 ================`
    );
    if (failures) {
      console.log(`失败 ${failures} 项`);
      process.exitCode = 1;
    }
  });
