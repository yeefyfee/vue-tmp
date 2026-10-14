/**
 * menu 模块 Prisma 移植 · 真库验证（PEL-10c）
 *
 * 直接实例化 MenuService（不启 Nest、不需要登录），走真实 PostgreSQL + Redis，
 * 逐项校验「对外契约与 TypeORM 版本一致」，并覆盖静态检查查不出的语义：
 *   两段式 treePath 落库 / 一级目录补斜杠 / 外链 component 置空 / 祖先补全式关键字搜索 /
 *   路由树（含 hidden 与 children 删除）/ 下拉选项树 / 表单 params 回显 /
 *   更新路径的 undefined 跳过与父级变更级联 / 物理级联删除 / 代码生成菜单批量建按钮。
 *
 * `MenuService` 的两个跨模块依赖在脚本里这样处理：
 *  · `RolePermService` —— 用**真实**实例（真 Redis）。`update` / `deleteMenu` 里那句
 *    `refreshAllRolePermsCache()` 是本模块契约的一部分，桩掉就验不到；
 *    🔴 副作用：它会重刷整张 `system:role:perms` 哈希（纯派生数据，可由库重建，属预期）。
 *  · `UserService` —— 本模块只用它的 `getUserMenuIds()`（`user` 尚未迁移）。
 *    这里给一个**与 `UserService.getUserMenuIds()` 逐行等价**的替身：读真实 `sys_user_role`
 *    再调真实的 `RoleService.getMenuIdsByRoleIds()`，因此「关联表 → 菜单 ID 集合 → 路由树」
 *    整条链路仍是真库真代码，只有那一层转发是替身。
 *
 * 另外把**已知缺陷**、**有意偏差**与**本次修复**固化成断言：
 *  ① 【已修】请求体不带 `parentId` 不再把子菜单上提到根节点
 *     （`PATCH /menus/:id?visible=0` 曾会把整棵子树搬到根、并冲掉 `treePath`）；
 *  ② 【已修】请求体带上表里不存在的 DTO 字段（`permissionType` 等 5 个）不再让 `update` 抛 500；
 *  ③ 【有意偏差】非法 ID 在 `getMenuForm` / `update` 返回 null、在 `deleteMenu` 返回 true（原本都是 SQL 级 500）；
 *  ④ 【有意偏差】非法 `parentId` 抛业务异常「父菜单ID格式不正确」（原为 MySQL `Incorrect integer value` 500）；
 *  ⑤ 【有意偏差】`deleteMenu` 的递归加了环保护（原实现遇到「自己的父级是自己」会无限递归）；
 *  ⑥ 【已知缺陷·保持原行为】`deleteMenu` 不清理 `sys_role_menu` 的孤儿关联行
 *     （原库 `sql/mysql/niulai_admin.sql` 零外键，故为既有行为，不是移植引入的）；
 *  ⑦ 【已知缺陷·保持原行为】`params` 表单往返失真：前端提交 `[{key,value}]` 数组，
 *     而 `getMenuForm` 按普通对象用 `Object.entries()` 解码；
 *  ⑧ 【已知缺陷·保持原行为】`findButtons` 既不过滤 `visible` 也不 trim，空白权限标识会原样返回；
 *  ⑨ 【已知缺陷·保持原行为】`getRoutes` 非管理员分支不补祖先链 —— 只授权子菜单时路由会断；
 *  ⑩ 【已知偏差·保持原行为】`addMenuForCodegen` 的 `treePath` 会把父 ID 重复一次（如 `"5,5"`），
 *     且父 `treePath` 为 NULL 时会拼出字面量 `"null,5"`；
 *  ⑪ 【保持原行为】`create` 不校验父节点**存在性**：ID 合法但不存在时 `treePath` 落 `"0,自身ID"`，
 *     而 `parentId` 仍按传入值落库；
 *  ⑫ 【易误读的入参语义】`findButtons` / `findPermsByMenuIds` 的 SQL 是 `id IN (入参) AND type='B'`，
 *     要传**按钮菜单自身的 ID**；传父菜单 ID 只会得到空数组（方法名读起来像「查这些菜单下的按钮」，
 *     实际不是 —— 调用方传错就是静默返回空，属最难查的一类）；
 *  ⑬ 【已知不一致·保持原行为】`treePath` 的「是否含自身 ID」两处口径不同：
 *     `create()` 写「父路径,自身ID」（含自身），而 `update()` 只写 `generateMenuTreePath(新父)`
 *     （不含自身）、`updateChildrenTreePath()` 写「新父路径,父自身ID」（含父不含子）；
 *     且 `update()` 把菜单提为顶层（`parentId="0"`）时 `treePath` 落 `"0"`，而 `create()` 落自身 ID。
 *     影响有限：**祖先链始终完整**，`getMenus()` 的祖先补全不受影响；但「treePath 以自身 ID 结尾」
 *     只对 create 出来的树成立。
 *
 * 安全约定：所有造数名称/权限标识都带 `VERIFYMENU` 前缀（按钮的 `perm` 也带），
 * 脚本开始与结束各清理一次；清理用「前缀匹配 + 按 parentId 向下收敛到定点」的方式，
 * 只删自己造的那几棵子树。
 *
 * 运行：
 *   node ./node_modules/ts-node/dist/bin.js -r tsconfig-paths/register scripts/verify-menu-module.ts
 */
import { Redis } from "ioredis";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { MenuService } from "../src/system/menu/menu.service";
import { RoleService } from "../src/system/role/role.service";
import { RolePermService } from "../src/system/role/role-permission.service";
import { RedisService } from "../src/common/redis/redis.service";
import { enableBigIntJsonSerialization } from "../src/common/prisma/bigint-json";
import { toBigInt } from "../src/common/prisma/prisma-ids";

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
const roleService = new RoleService(
  base as never,
  permService,
  { get: (key: string) => (key === "SESSION_TYPE" ? "jwt" : undefined) } as never,
  redisService
);

/** 与 `UserService.getUserMenuIds()` 等价的替身（见文件头说明） */
const userServiceStub = {
  async getUserMenuIds(userId: string): Promise<string[]> {
    const id = toBigInt(userId);
    if (id === null) return [];
    const userRoles = await base.sysUserRole.findMany({ where: { userId: id } });
    const roleIds = userRoles.map((ur) => ur.roleId.toString());
    if (!roleIds.length) return [];
    return roleService.getMenuIdsByRoleIds(roleIds);
  },
};

const service = new MenuService(base as never, userServiceStub as never, permService);

const MARK = "VERIFYMENU";
/** 刻意用高位 ID，避免与真实 user 数据碰撞 */
const U1 = "980001";
const U2 = "980002";
const TEST_USERS = [U1, U2];
const GHOST_ID = "999999999";

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
 * 取异常里**真正的业务文案**。两级读取缺一不可：
 *  · `BusinessException` 构造时传的是**对象** `{ code, msg }`（`extends HttpException`），
 *    Nest 的 `initMessage()` 只认字符串 response 或 `response.message`，
 *    对象里放的是 `msg` ⇒ `error.message` 退化成类名 `"Business Exception"`，真文案在 `response.msg`；
 *  · 而 `MenuService.update()` 的「父级菜单不能为当前菜单」抛的是**普通 `Error`** ⇒ 走 `err.message`。
 * 两个都读才两头都不漏 —— 这也正是本模块与新库校验脚本需要比 role 多一层的原因。
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

/** 收集「名称/routeName/perm 命中前缀」的菜单 id，再按 parentId 向下收敛到定点 */
async function collectMine(): Promise<bigint[]> {
  const seeds = await base.sysMenu.findMany({
    where: {
      OR: [
        { name: { contains: MARK } },
        { routeName: { contains: MARK } },
        { perm: { contains: MARK } },
      ],
    },
    select: { id: true },
  });
  const ids = new Set<string>(seeds.map((m) => m.id.toString()));

  // 定点收敛：把命中项的子孙一并纳入（无权限 / 仅空白权限的按钮只能这样捞到）
  let added = true;
  while (added) {
    added = false;
    const children = await base.sysMenu.findMany({
      where: { parentId: { in: [...ids].map((i) => BigInt(i)) } },
      select: { id: true },
    });
    for (const c of children) {
      if (!ids.has(c.id.toString())) {
        ids.add(c.id.toString());
        added = true;
      }
    }
  }

  return [...ids].map((i) => BigInt(i));
}

async function cleanup() {
  const ids = await collectMine();
  if (ids.length) {
    // 先清关联，避免给真实数据留孤儿
    await base.sysRoleMenu.deleteMany({ where: { menuId: { in: ids } } });
    await base.sysMenu.deleteMany({ where: { id: { in: ids } } });
  }
  const roleIds = (
    await base.sysRole.findMany({ where: { code: { contains: MARK } }, select: { id: true } })
  ).map((r) => r.id);
  await base.sysUserRole.deleteMany({ where: { userId: { in: TEST_USERS.map(BigInt) } } });
  if (roleIds.length) {
    await base.sysRoleMenu.deleteMany({ where: { roleId: { in: roleIds } } });
    await base.sysRole.deleteMany({ where: { id: { in: roleIds } } });
  }
}

/** 按 id 读原始行（绕过服务，直接看落库结果） */
async function rawMenu(id: string) {
  return await base.sysMenu.findFirst({ where: { id: BigInt(id) } });
}

/** 按 name 在树里找节点 */
function findNode(nodes: any[], name: string): any | null {
  for (const n of nodes) {
    if (n.name === name) return n;
    const hit = findNode(n.children ?? [], name);
    if (hit) return hit;
  }
  return null;
}

/** 按 route.name 在路由树里找节点 */
function findRoute(nodes: any[], routeName: string): any | null {
  for (const n of nodes) {
    if (n.name === routeName) return n;
    const hit = findRoute(n.children ?? [], routeName);
    if (hit) return hit;
  }
  return null;
}

/** 收集树里所有 name */
function collectNames(nodes: any[]): string[] {
  const out: string[] = [];
  const walk = (list: any[]) => {
    for (const n of list) {
      out.push(n.name);
      walk(n.children ?? []);
    }
  };
  walk(nodes);
  return out;
}

/** 收集路由树里所有 path */
function collectPaths(nodes: any[]): string[] {
  const out: string[] = [];
  const walk = (list: any[]) => {
    for (const n of list) {
      out.push(n.path);
      walk(n.children ?? []);
    }
  };
  walk(nodes);
  return out;
}

const MENU_VIEW_KEYS = [
  "alwaysShow",
  "component",
  "createTime",
  "icon",
  "id",
  "keepAlive",
  "name",
  "params",
  "parentId",
  "perm",
  "redirect",
  "routeName",
  "routePath",
  "sort",
  "treePath",
  "type",
  "updateTime",
  "visible",
];
const MENU_ROW_KEYS = [
  "alwaysShow",
  "component",
  "createTime",
  "icon",
  "id",
  "keepAlive",
  "menuType",
  "name",
  "params",
  "parentId",
  "perm",
  "redirect",
  "routeName",
  "routePath",
  "sort",
  "treePath",
  "updateTime",
  "visible",
];

// ────────────────────────────── 造数句柄 ──────────────────────────────
const N = {
  R1: `${MARK}-平台管理`,
  R2: `${MARK}-运维中心`,
  R3: `${MARK}-同级目录`,
  M1: `${MARK}-用户列表`,
  M2: `${MARK}-隐藏菜单`,
  M3: `${MARK}-深层按钮页`,
  M4: `${MARK}-外部链接`,
  MX: `${MARK}-改造实验台`,
  DX: `${MARK}-待删目录`,
  DXM: `${MARK}-待删菜单`,
  DXB: `${MARK}-待删按钮`,
  B1: `${MARK}-新增按钮`,
  B2: `${MARK}-隐藏按钮`,
  B3: `${MARK}-无权限按钮`,
  B4: `${MARK}-重复权限按钮`,
  B5: `${MARK}-空白权限按钮`,
  CG: `${MARK}-代码生成菜单`,
  FLAG: `${MARK}-返回值检查`,
};
const PERM_ADD = `${MARK}:user:add`;
const PERM_HIDDEN = `${MARK}:user:hidden`;
const PERM_DEL = `${MARK}:del:remove`;
/** 带空白的权限标识：验证 `findALLButtons` / `findPermsByMenuIds` 会 trim */
const PERM_ADD_PADDED = `  ${PERM_ADD}  `;
/** 仅空白：验证 trim 后会被过滤 */
const PERM_BLANK = "   ";

let R1 = "";
let R2 = "";
let R3 = "";
let M1 = "";
let M2 = "";
let M3 = "";
let M4 = "";
let MX = "";
let DX = "";
let DXM = "";
let DXB = "";
let B3 = "";
/** 按钮菜单**自身**的 ID —— `findButtons` / `findPermsByMenuIds` 的入参是它们，不是父菜单 ID */
const BTN: Record<string, string> = {};

async function seed() {
  // 目录：R1 的 routePath 不带斜杠（验证自动补 /）；R2 已带斜杠（验证不再补）
  await service.create({
    name: N.R1,
    type: "C",
    routePath: "verify-root",
    sort: 1,
    icon: "Platform",
  } as never);
  R1 = (await base.sysMenu.findFirst({ where: { name: N.R1 } }))!.id.toString();

  await service.create({ name: N.R2, type: "C", routePath: "/verify-ops", sort: 0 } as never);
  R2 = (await base.sysMenu.findFirst({ where: { name: N.R2 } }))!.id.toString();

  // 不传 sort ⇒ 落列默认值 0
  await service.create({ name: N.R3, type: "C" } as never);
  R3 = (await base.sysMenu.findFirst({ where: { name: N.R3 } }))!.id.toString();

  // 二级菜单（带 params 对象、keepAlive、icon）
  await service.create({
    name: N.M1,
    type: "M",
    parentId: R1,
    routeName: `${MARK}UserList`,
    routePath: "user-list",
    component: "verify/user/index",
    icon: "User",
    sort: 2,
    keepAlive: 1,
    alwaysShow: 0,
    visible: 1,
    params: { a: "1", b: 2 },
  } as never);
  M1 = (await base.sysMenu.findFirst({ where: { name: N.M1 } }))!.id.toString();

  // 隐藏菜单
  await service.create({
    name: N.M2,
    type: "M",
    parentId: R1,
    routePath: "hidden",
    component: "verify/hidden/index",
    sort: 3,
    visible: 0,
  } as never);
  M2 = (await base.sysMenu.findFirst({ where: { name: N.M2 } }))!.id.toString();

  // 三级菜单（父级是 M1）—— 验证 treePath 三段式
  await service.create({
    name: N.M3,
    type: "M",
    parentId: M1,
    routePath: "deep",
    component: "verify/deep/index",
    sort: 1,
  } as never);
  M3 = (await base.sysMenu.findFirst({ where: { name: N.M3 } }))!.id.toString();

  // 外链：component 应被置为 null
  await service.create({
    name: N.M4,
    type: "M",
    parentId: R1,
    routePath: "https://example.com",
    component: "should-be-nulled-by-service",
    sort: 4,
  } as never);
  M4 = (await base.sysMenu.findFirst({ where: { name: N.M4 } }))!.id.toString();

  // 改造实验台（用于 update 的破坏性用例，避免污染其它断言）
  await service.create({
    name: N.MX,
    type: "M",
    parentId: R1,
    routePath: "lab",
    component: "verify/lab/index",
    sort: 20,
  } as never);
  MX = (await base.sysMenu.findFirst({ where: { name: N.MX } }))!.id.toString();

  // 一次性按钮（挂 M1）
  const buttonSeeds: { name: string; perm: string | null; sort: number; visible?: number }[] = [
    { name: N.B1, perm: PERM_ADD_PADDED, sort: 1 },
    { name: N.B2, perm: PERM_HIDDEN, sort: 2, visible: 0 },
    { name: N.B3, perm: null, sort: 3 },
    { name: N.B4, perm: PERM_ADD, sort: 4 },
    { name: N.B5, perm: PERM_BLANK, sort: 5 },
  ];
  for (const b of buttonSeeds) {
    await service.create({
      name: b.name,
      type: "B",
      parentId: M1,
      perm: b.perm,
      sort: b.sort,
      visible: b.visible ?? 1,
    } as never);
  }
  BTN.B1 = (await base.sysMenu.findFirst({ where: { name: N.B1 } }))!.id.toString();
  BTN.B2 = (await base.sysMenu.findFirst({ where: { name: N.B2 } }))!.id.toString();
  BTN.B3 = (await base.sysMenu.findFirst({ where: { name: N.B3 } }))!.id.toString();
  BTN.B4 = (await base.sysMenu.findFirst({ where: { name: N.B4 } }))!.id.toString();
  BTN.B5 = (await base.sysMenu.findFirst({ where: { name: N.B5 } }))!.id.toString();
  B3 = BTN.B3;

  // 待删子树（三级），并给 DX 绑一条角色关联，用于验证「孤儿关联」已知缺陷
  await service.create({ name: N.DX, type: "C", routePath: "verify-del", sort: 30 } as never);
  DX = (await base.sysMenu.findFirst({ where: { name: N.DX } }))!.id.toString();
  await service.create({
    name: N.DXM,
    type: "M",
    parentId: DX,
    routePath: "del-child",
    component: "verify/del/index",
    sort: 1,
  } as never);
  DXM = (await base.sysMenu.findFirst({ where: { name: N.DXM } }))!.id.toString();
  await service.create({
    name: N.DXB,
    type: "B",
    parentId: DXM,
    perm: PERM_DEL,
    sort: 1,
  } as never);
  DXB = (await base.sysMenu.findFirst({ where: { name: N.DXB } }))!.id.toString();

  // 角色 + 用户绑定（供 getRoutes 非管理员分支）
  const role = await base.sysRole.create({
    data: {
      name: `${MARK}-路由验证角色`,
      code: `${MARK}_ROUTE`,
      status: 1,
      dataScope: 1,
      createTime: new Date(),
      updateTime: new Date(),
    },
  });
  await base.sysRoleMenu.createMany({
    data: [
      { roleId: role.id, menuId: BigInt(R1) },
      { roleId: role.id, menuId: BigInt(M1) },
      // 故意把按钮也塞进去：验证 getRoutes 会按 type 过滤掉
      { roleId: role.id, menuId: BigInt(B3) },
      { roleId: role.id, menuId: BigInt(DX) },
    ],
  });
  await base.sysUserRole.create({ data: { userId: BigInt(U1), roleId: role.id } });
  // U2 刻意不绑角色
}

async function main() {
  await cleanup();
  await seed();

  // ---------------------------------------------------------- 1) create / treePath
  console.log("\n=== 1) 创建：返回值、treePath 两段式、目录与外链规则、审计字段 ===");
  // 挂在 R3 下、且 visible=0，避免影响后续对 R1/M1 子节点数与全局权限集合的断言
  const createdFlag = await service.create({
    name: N.FLAG,
    type: "B",
    parentId: R3,
    perm: `${MARK}:flag:check`,
    sort: 1,
    visible: 0,
  } as never);
  check("create 返回 true", createdFlag, true);

  const r1 = (await rawMenu(R1))!;
  check("顶层目录 parentId 落库为 0", r1.parentId.toString(), "0");
  check("顶层目录 treePath = 自身 ID（不含 0）", r1.treePath, R1);
  check("type=C ⇒ component 固定为 Layout", r1.component, "Layout");
  check("一级目录 routePath 自动补前导斜杠（原始 verify-root）", r1.routePath, "/verify-root");
  checkTrue("createTime 已填充（替代原 AuditSubscriber）", r1.createTime instanceof Date);
  checkTrue("updateTime 已填充", r1.updateTime instanceof Date);
  check("sys_menu 无 create_by 列 ⇒ 读回的实体没有该字段", "createBy" in r1, false);
  check("sys_menu 无 is_deleted 列 ⇒ 读回的实体没有该字段", "isDeleted" in r1, false);

  const r2 = (await rawMenu(R2))!;
  check("已是 / 开头的 routePath 不再重复补", r2.routePath, "/verify-ops");
  check("显式 sort 生效", r2.sort, 0);

  const r3 = (await rawMenu(R3))!;
  check("未传 sort ⇒ 列默认值 0", r3.sort, 0);
  check("未传 visible ⇒ 列默认值 1", r3.visible, 1);
  check("type=C 未传 routePath ⇒ 落 NULL", r3.routePath, null);

  const m1 = (await rawMenu(M1))!;
  check("二级 treePath = 父ID,自身ID", m1.treePath, `${R1},${M1}`);
  const m3 = (await rawMenu(M3))!;
  check("三级 treePath 三段式", m3.treePath, `${R1},${M1},${M3}`);
  check("显式 keepAlive 落库", m1.keepAlive, 1);
  check("显式 alwaysShow=0 落库", m1.alwaysShow, 0);
  check("params 以 JSON 落库", m1.params, { a: "1", b: 2 });

  const m4 = (await rawMenu(M4))!;
  check("外链菜单（M + http）component 被置空", m4.component, null);
  check("外链 routePath 原样保留", m4.routePath, "https://example.com");

  console.log("\n--- 1b) 缺陷 2 回归：DTO 里表不存在的字段必须被忽略且不报错 ---");
  const unknownFieldMenu = await service.create({
    name: `${MARK}-未知字段菜单`,
    type: "M",
    parentId: R1,
    routePath: "unknown-fields",
    component: "verify/uf/index",
    permissionType: "custom",
    authSymbol: "x",
    orderWeight: 9,
    remark: "备注不该入库",
    createTab: true,
  } as never);
  check("create 带 5 个表外字段不报错", unknownFieldMenu, true);
  const ufRow = (await base.sysMenu.findFirst({ where: { name: `${MARK}-未知字段菜单` } }))!;
  check("表外字段一律未落库（读回的行只有真列）", Object.keys(ufRow).sort(), MENU_ROW_KEYS);

  console.log("\n--- 1c) parentId 校验 ---");
  await expectThrow(
    "parentId 非法时抛业务异常（不静默变顶层）",
    () =>
      service.create({
        name: `${MARK}-坏父节点`,
        type: "M",
        parentId: "abc",
        routePath: "bad-parent",
      } as never),
    "父菜单ID格式不正确"
  );
  // 【⑪ 保持原行为】父节点「存在性」不校验：ID 合法但不存在 ⇒ treePath 落 "0"，parentId 照传
  await service.create({
    name: `${MARK}-幽灵父节点`,
    type: "M",
    parentId: GHOST_ID,
    routePath: "ghost",
  } as never);
  const ghost = (await base.sysMenu.findFirst({ where: { name: `${MARK}-幽灵父节点` } }))!;
  // `generateMenuTreePath()` 找不到父就返回 "0"，随后照常追加自身 ID ⇒ 落成 "0,自身ID"
  check('【⑪】父节点不存在时 treePath 落 "0,自身ID"', ghost.treePath, `0,${ghost.id.toString()}`);
  check("【⑪】父节点不存在时 parentId 仍按传入值落库", ghost.parentId.toString(), GHOST_ID);

  // ---------------------------------------------------------------- 2) 查询
  console.log("\n=== 2) findAll / find：字符串主键与排序 ===");
  const all = await service.findAll();
  const allMine = all.filter((m) => m.name.startsWith(MARK));
  check("我造的菜单条数", allMine.length, 19);
  check(
    "findAll 主键全为字符串",
    allMine.every((m) => typeof m.id === "string"),
    true
  );
  check(
    "findAll 返回对象的键集合（对外仍叫 type，不是 menuType）",
    Object.keys(allMine[0]).sort(),
    MENU_VIEW_KEYS
  );
  const sorts = all.map((m) => m.sort);
  check(
    "findAll 按 sort 升序",
    sorts.every((s, i) => i === 0 || sorts[i - 1] <= s),
    true
  );

  const byIds = await service.find([R1, M1]);
  check("find 命中 2 条", byIds.length, 2);
  check("find 空数组返回空", await service.find([]), []);
  check("find 全非法 ID 返回空（不报错）", await service.find(["abc", ""]), []);
  check("find 混合非法 ID 只保留合法项", (await service.find([R1, "abc"])).length, 1);

  console.log("\n=== 3) 按钮权限：findALLButtons / findButtons / findPermsByMenuIds ===");
  const allButtons = await service.findALLButtons();
  check(
    "findALLButtons 只保留 visible=1 的 B 类、trim 后去重",
    allButtons.filter((p) => p.includes(MARK)).sort(),
    [PERM_ADD, PERM_DEL].sort()
  );
  checkTrue("findALLButtons 不含 visible=0 的按钮", !allButtons.includes(PERM_HIDDEN));
  checkTrue(
    "findALLButtons 结果已 trim（我自己造的那几条无前导空格）",
    !allButtons.filter((p) => p.includes(MARK)).some((p) => p !== p.trim())
  );

  // ⚠️ 注意入参语义：`findButtons` / `findPermsByMenuIds` 是 `id IN (入参) AND type='B'`，
  //    要传**按钮菜单自身的 ID**，传父菜单 ID 只会得到空数组（方法名容易被误读，已记入清单）。
  // 【⑧ 已知缺陷·保持原行为】findButtons 不看 visible、不 trim，空白权限也会返回
  const buttons = await service.findButtons([BTN.B1, BTN.B2, BTN.B3, BTN.B4, BTN.B5]);
  check("findButtons 按 sort 返回全部 B 类权限（含隐藏、含仅空白项，不 trim）", buttons, [
    PERM_ADD_PADDED,
    PERM_HIDDEN,
    PERM_ADD,
    PERM_BLANK,
  ]);
  check("findButtons 空数组返回空", await service.findButtons([]), []);
  check(
    "findButtons 传非 B 类菜单 ID 时无结果（入参语义是「按钮自身 ID」）",
    await service.findButtons([R1, M2]),
    []
  );
  check(
    "findButtons 混合入参只保留 B 类那一项",
    (await service.findButtons([R1, BTN.B1])).length,
    1
  );

  const permsByMenu = await service.findPermsByMenuIds([BTN.B1, BTN.B2, BTN.B3, BTN.B4, BTN.B5]);
  check("findPermsByMenuIds 去重且 trim，排除 null/空白权限", permsByMenu.slice().sort(), [
    PERM_ADD,
    PERM_HIDDEN,
  ]);
  check("findPermsByMenuIds 空数组返回空", await service.findPermsByMenuIds([]), []);
  check("findPermsByMenuIds 全非法 ID 返回空", await service.findPermsByMenuIds(["abc"]), []);

  // ---------------------------------------------------------------- 4) 路由
  console.log("\n=== 4) getRoutes：超级管理员（userId=1） ===");
  const adminRoutes = await service.getRoutes("1");
  const rootRoute = adminRoutes.find((r: any) => r.path === "/verify-root");
  checkTrue("顶层目录路由存在（routePath 被补成 /verify-root）", rootRoute !== undefined);
  check("顶层目录路由 component=Layout", rootRoute?.component, "Layout");
  check("顶层目录未设 routeName ⇒ name 为空串", rootRoute?.name, "");
  check("顶层目录 meta.title", rootRoute?.meta?.title, N.R1);
  check("顶层目录 meta.icon", rootRoute?.meta?.icon, "Platform");
  check("顶层目录 keepAlive=false（未设 1）", rootRoute?.meta?.keepAlive, false);
  check(
    "顶层目录 children 只含 C/M 类（M1/M2/M4/MX/未知字段菜单）",
    (rootRoute?.children ?? []).length,
    5
  );
  check(
    "按钮不进路由（children 的 routeName 列表）",
    (rootRoute?.children ?? []).map((c: any) => c.name).sort(),
    ["", "", "", "", `${MARK}UserList`].sort()
  );
  checkTrue(
    "隐藏菜单（visible=0）仍在路由里且 meta.hidden=true",
    ((rootRoute?.children ?? []).find((c: any) => c.path === "hidden") as any)?.meta?.hidden ===
      true
  );

  const m1Route = findRoute(adminRoutes, `${MARK}UserList`);
  checkTrue("超级管理员路由含我造的二级菜单", m1Route !== null);
  check("M1 meta.params 来自 json 列", m1Route?.meta?.params, { a: "1", b: 2 });
  check("M1 meta.icon", m1Route?.meta?.icon, "User");
  check("M1 meta.keepAlive=true（keepAlive=1）", m1Route?.meta?.keepAlive, true);
  check("M1 meta.alwaysShow=false（alwaysShow=0）", m1Route?.meta?.alwaysShow, false);
  check("M1 只有 1 个子路由（M3）", m1Route?.children?.length, 1);
  check("M1 的子路由 path", m1Route?.children?.[0]?.path, "deep");
  check(
    "叶子节点没有 children 键（原实现 delete route.children）",
    "children" in (m1Route?.children?.[0] ?? {}),
    false
  );

  const externalRoute = (rootRoute?.children ?? []).find((c: any) => c.path.startsWith("http"));
  check('外链路由 component 为空串（null || ""）', externalRoute?.component, "");

  console.log("\n=== 5) getRoutes：普通用户（走 getUserMenuIds 真链路） ===");
  const u1Routes = await service.getRoutes(U1);
  check(
    "U1 授权 [R1,M1,B3,DX] ⇒ 路由根层 2 个目录、共 3 条路由",
    [u1Routes.length, collectPaths(u1Routes).length],
    [2, 3]
  );
  const u1Root = u1Routes.find((r: any) => r.path === "/verify-root");
  check("U1 的 R1 下只有 M1（M2/M4 未授权）", (u1Root?.children ?? []).length, 1);
  check("U1 的 M1 routeName 正确", u1Root?.children?.[0]?.name, `${MARK}UserList`);
  check(
    "【⑨ 已知缺陷】U1 未授权 M3 ⇒ M1 没有 children 键（祖先链不补全，路由会断）",
    "children" in (u1Root?.children?.[0] ?? {}),
    false
  );
  check(
    "授权里的按钮 ID 被 type 过滤掉（无空 path 节点）",
    collectPaths(u1Routes).sort(),
    ["/verify-del", "/verify-root", "user-list"].sort()
  );

  check("U2 无角色 ⇒ 空路由", await service.getRoutes(U2), []);
  check("非法 userId ⇒ 空路由", await service.getRoutes("abc"), []);
  check("不存在的 userId ⇒ 空路由", await service.getRoutes(GHOST_ID), []);

  // ---------------------------------------------------------------- 6) 树形列表
  console.log("\n=== 6) getMenus：全量树 / 关键字 + 祖先补全 ===");
  const tree = await service.getMenus("");
  const r1Node = findNode(tree, N.R1);
  checkTrue("全量树含我造的目录 R1", r1Node !== null);
  check(
    "R1 的直接子节点数（M1/M2/M4/MX/未知字段菜单；5 个按钮挂在 M1 下）",
    r1Node.children.length,
    5
  );
  check(
    "按钮挂在 M1 下而非 R1 下（R1 的 children 里没有 B 类）",
    findNode(tree, N.B5).parentId,
    M1
  );
  check("M1 下含 M3 与 5 个按钮", findNode(tree, N.M1).children.length, 6);
  check("叶子节点 children 为空数组", findNode(tree, N.B5).children, []);

  const kwDeep = await service.getMenus(N.M3);
  check("【祖先补全】只命中三级节点时返回整条父链", collectNames(kwDeep), [N.R1, N.M1, N.M3]);

  const kwLeaf = await service.getMenus(N.M1);
  check("命中二级节点 ⇒ 只补祖先，不带子孙", collectNames(kwLeaf), [N.R1, N.M1]);

  const kwLower = await service.getMenus(N.M1.toLowerCase());
  checkTrue("关键字大小写不敏感（对齐 MySQL CI 语义）", findNode(kwLower, N.M1) !== null);
  check("无命中时返回空树", await service.getMenus("绝不存在的菜单ZZZ"), []);

  console.log("\n=== 7) findOptions：下拉树 ===");
  const options = await service.findOptions();
  const optR1 = (function find(list: any[]): any {
    for (const n of list) {
      if (n.value === R1) return n;
      const hit = find(n.children ?? []);
      if (hit) return hit;
    }
    return null;
  })(options);
  checkTrue("下拉树含我造的目录", optR1 !== null);
  check("下拉节点 label 为菜单名", optR1.label, N.R1);
  check("下拉节点 value 为字符串主键", typeof optR1.value, "string");
  check("下拉节点只含 label/value/children 三个键", Object.keys(optR1).sort(), [
    "children",
    "label",
    "value",
  ]);
  check(
    "下拉子节点嵌套正确",
    optR1.children.some((c: any) => c.value === M1),
    true
  );

  // ---------------------------------------------------------------- 8) 表单
  console.log("\n=== 8) getMenuForm：params 回显（对象 → [{key,value}]） ===");
  const form = await service.getMenuForm(M1);
  check("表单 name", form?.name, N.M1);
  check("表单主键为字符串", typeof form?.id, "string");
  check("表单对外字段名为 type", form?.type, "M");
  check("params 对象被展开成 [{key,value}]（值统一 String 化）", form?.params, [
    { key: "a", value: "1" },
    { key: "b", value: "2" },
  ]);
  check("params 为 NULL 时表单给 null", (await service.getMenuForm(M2))?.params, null);
  check("不存在的 ID 返回 null", await service.getMenuForm(GHOST_ID), null);
  check(
    "【③ 有意偏差】非法 ID 返回 null（原本是 SQL 级 500）",
    await service.getMenuForm("abc"),
    null
  );

  console.log("\n--- 8b) 【⑦ 已知缺陷·保持原行为】params 表单往返失真 ---");
  // 前端提交的是 [{key,value}] 数组；服务端按普通对象解码 ⇒ 往返后变成怪东西
  await service.create({
    name: `${MARK}-数组参数菜单`,
    type: "M",
    parentId: R1,
    routePath: "arr-params",
    component: "verify/arr/index",
    params: [{ key: "a", value: "1" }],
  } as never);
  const arrId = (await base.sysMenu.findFirst({
    where: { name: `${MARK}-数组参数菜单` },
  }))!.id.toString();
  check(
    '提交 [{key,value}] 数组后回显变成 {key:"0", value:"[object Object]"}',
    (await service.getMenuForm(arrId))?.params,
    [{ key: "0", value: "[object Object]" }]
  );

  // ---------------------------------------------------------------- 9) 更新
  console.log("\n=== 9) update：undefined 跳过 / 父级变更级联 / 两处缺陷回归 ===");
  const beforeM1 = (await rawMenu(M1))!;
  check(
    "update 返回 true",
    await service.update(M1, { name: `${MARK}-用户列表改` } as never),
    true
  );
  const afterRename = (await rawMenu(M1))!;
  check("改名生效", afterRename.name, `${MARK}-用户列表改`);
  check("改名不动 treePath", afterRename.treePath, beforeM1.treePath);
  check("改名不动 parentId", afterRename.parentId.toString(), beforeM1.parentId.toString());
  check("改名不动 routePath", afterRename.routePath, beforeM1.routePath);
  check("改名不动 component", afterRename.component, beforeM1.component);
  check("改名不动 sort（未传即跳过）", afterRename.sort, beforeM1.sort);
  checkTrue("改名刷新 updateTime", afterRename.updateTime! >= beforeM1.updateTime!);

  console.log("\n--- 9a) 缺陷 1 回归：只传 visible 不得把子菜单上提 ---");
  await service.update(M1, { visible: 0 } as never);
  const afterVisible = (await rawMenu(M1))!;
  check("PATCH visible ⇒ visible 已改", afterVisible.visible, 0);
  check("PATCH visible ⇒ parentId 不变（原实现会置 0）", afterVisible.parentId.toString(), R1);
  check("PATCH visible ⇒ treePath 不变（原实现会重算成 0）", afterVisible.treePath, `${R1},${M1}`);
  check(
    "PATCH visible ⇒ 子孙 treePath 未被级联改写",
    (await rawMenu(M3))!.treePath,
    `${R1},${M1},${M3}`
  );
  await service.update(M1, { visible: 1 } as never);

  // 修复没有削弱正常能力：显式传 parentId="0" 仍然能提为顶层
  await service.update(MX, { parentId: "0" } as never);
  const mxTop = (await rawMenu(MX))!;
  check("显式 parentId=0 ⇒ parentId 置 0（提为顶层）", mxTop.parentId.toString(), "0");
  // 【保持原行为】`update()` 只把 `treePath` 写成 `generateMenuTreePath(newParent)` 的返回值，
  // `"0"` 时就是 `"0"`；而 `create()` 对顶层写的是**自身 ID** ⇒ 两处约定不一致（原实现同样如此）
  check(
    '【保持原行为】update 提为顶层时 treePath 落 "0"（create 会写自身 ID，两处约定不同）',
    mxTop.treePath,
    "0"
  );
  await service.update(MX, { parentId: R1 } as never);
  check("再挂回 R1 后 treePath 复原", (await rawMenu(MX))!.treePath, R1);

  console.log("\n--- 9b) 父级变更 ⇒ 自身 treePath 重算 + 子孙级联 ---");
  // 🔴 这里顺带固化了 `treePath` 的**第二处既有不一致**（原实现同样如此，非移植引入）：
  //    create() 的约定是「treePath 含自身 ID」（`父路径,子ID`），
  //    而 update() / updateChildrenTreePath() 写出的 treePath **不含自身 ID**
  //    （update 只写 `generateMenuTreePath(新父)` 的返回值；级联写 `新父路径 + 父自身ID`）。
  //    后果有限：**祖先链始终完整**，所以 `getMenus()` 的祖先补全不受影响；
  //    但「treePath 一定以自身 ID 结尾」这条不成文约定只对 create 出来的树成立。
  const m3Before = (await rawMenu(M3))!.treePath;
  check("换父前 M3 的 treePath 以自身 ID 结尾（create 系约定）", m3Before, `${R1},${M1},${M3}`);

  await service.update(M1, { parentId: R2 } as never);
  check("M1 换父后 parentId 已更新", (await rawMenu(M1))!.parentId.toString(), R2);
  check(
    "M1 换父后 treePath = 新父的 treePath（update 系约定：不含自身 ID）",
    (await rawMenu(M1))!.treePath,
    R2
  );
  check(
    "子孙 M3 的 treePath 被级联改写为「新父路径 + 父自身 ID」",
    (await rawMenu(M3))!.treePath,
    `${R2},${M1}`
  );
  await service.update(M1, { parentId: R1 } as never);
  check("换回后 M1 treePath 复原", (await rawMenu(M1))!.treePath, R1);
  check(
    "【保持原行为】M3 的 treePath 变回「父路径 + 父 ID」，不再以自身 ID 结尾（update 系约定）",
    (await rawMenu(M3))!.treePath,
    `${R1},${M1}`
  );
  check(
    "祖先链仍然完整（getMenus 的祖先补全依赖它）",
    (await rawMenu(M3))!.treePath!.split(",").includes(R1) &&
      (await rawMenu(M3))!.treePath!.split(",").includes(M1),
    true
  );

  console.log("\n--- 9c) 缺陷 2 回归：update 带表外字段不得 500 ---");
  check(
    "update 带 5 个表外字段不报错（原本 EntityPropertyNotFoundError ⇒ 500）",
    await service.update(MX, {
      sort: 21,
      permissionType: "custom",
      authSymbol: "x",
      orderWeight: 3,
      remark: "备注",
      createTab: false,
    } as never),
    true
  );
  check("同一次请求里的真实列仍被正常写入", (await rawMenu(MX))!.sort, 21);

  console.log("\n--- 9d) 校验与边界 ---");
  await expectThrow(
    "父级不能为自己（抛的是普通 Error，不是 BusinessException）",
    () => service.update(MX, { parentId: MX } as never),
    "父级菜单不能为当前菜单"
  );
  await expectThrow(
    "【④ 有意偏差】parentId 非法时抛业务异常",
    () => service.update(MX, { parentId: "abc" } as never),
    "父菜单ID格式不正确"
  );
  check("不存在的 ID 返回 null", await service.update(GHOST_ID, { name: "x" } as never), null);
  check(
    "【③ 有意偏差】非法 ID 返回 null（原本是 SQL 级 500）",
    await service.update("abc", { name: "x" } as never),
    null
  );

  // type=C 时 routePath 补斜杠 + component=Layout
  await service.update(MX, { type: "C", parentId: "0", routePath: "lab-dir" } as never);
  const mxDir = (await rawMenu(MX))!;
  check("type=C ⇒ component 变 Layout", mxDir.component, "Layout");
  check("type=C 且 parentId=0 ⇒ routePath 补斜杠", mxDir.routePath, "/lab-dir");
  check("type=C 且 parentId=0 ⇒ treePath 落 0", mxDir.treePath, "0");

  // 【保持原行为】补斜杠的判定用的是**入参** parentId，未传时 `!parentId` 为真 ⇒ 仍按顶层补斜杠
  await service.update(MX, { type: "C", routePath: "lab-dir2" } as never);
  const mxDir2 = (await rawMenu(MX))!;
  check("【保持原行为】parentId 未传时按「顶层」判定仍补斜杠", mxDir2.routePath, "/lab-dir2");
  check("【已修】此时 parentId 并未被改动", mxDir2.parentId.toString(), "0");

  await service.update(MX, {
    type: "M",
    parentId: R1,
    routePath: "lab",
    component: "verify/lab/index",
  } as never);
  check("实验台还原为 M", (await rawMenu(MX))!.menuType, "M");

  // params 置 null ⇒ SQL NULL（Prisma.DbNull），不是 JSON null
  await service.update(M1, { params: null } as never);
  check("params 传 null ⇒ 落 SQL NULL", (await rawMenu(M1))!.params, null);
  await service.update(M1, { params: { a: "1", b: 2 } } as never);
  check("params 复原", (await rawMenu(M1))!.params, { a: "1", b: 2 });

  // ---------------------------------------------------------------- 10) 删除
  console.log("\n=== 10) deleteMenu：级联物理删除 + 孤儿关联（已知缺陷） ===");
  check(
    "删除前 DX 上有 1 条角色关联",
    await base.sysRoleMenu.count({ where: { menuId: BigInt(DX) } }),
    1
  );

  check("deleteMenu 返回 true", await service.deleteMenu(DX), true);
  check("自身已删", await rawMenu(DX), null);
  check("二级子菜单已删", await rawMenu(DXM), null);
  check("三级子菜单已删（递归到底）", await rawMenu(DXB), null);
  check(
    "【⑥ 已知缺陷·保持原行为】角色关联行未被清理（孤儿）",
    await base.sysRoleMenu.count({ where: { menuId: BigInt(DX) } }),
    1
  );

  check(
    "【③ 有意偏差】非法 ID 返回 true 且不报错（原本是 SQL 级 500）",
    await service.deleteMenu("abc"),
    true
  );
  check("不存在的 ID 返回 true", await service.deleteMenu(GHOST_ID), true);

  // ---------------------------------------------------------------- 11) 代码生成菜单
  console.log("\n=== 11) addMenuForCodegen：批量建菜单 + 6 个动作按钮 ===");
  const maxSortBefore = (await base.sysMenu.findFirst({
    where: { parentId: BigInt(R1) },
    orderBy: { sort: "desc" },
  }))!.sort;

  await service.addMenuForCodegen(Number(R1), "verify_table", MARK, N.CG, "VerifyEntity");

  const cg = await base.sysMenu.findFirst({ where: { name: N.CG } });
  checkTrue("代码生成菜单已创建", cg !== null);
  check("type=M", cg?.menuType, "M");
  check("routeName = entityName", cg?.routeName, "VerifyEntity");
  check("routePath = entityName 的 kebab-case", cg?.routePath, "verify-entity");
  check("component = moduleName/entityKebab/index", cg?.component, `${MARK}/verify-entity/index`);
  check("sort = 同级最大 sort + 1", cg?.sort, maxSortBefore + 1);
  check("visible = 1", cg?.visible, 1);
  check("【⑩ 保持原行为】treePath 把父 ID 重复了一次", cg?.treePath, `${R1},${R1}`);

  const cgButtons = await base.sysMenu.findMany({
    where: { parentId: cg!.id },
    orderBy: { sort: "asc" },
  });
  check("生成 6 个按钮", cgButtons.length, 6);
  check(
    "按钮名固定为 6 个动作",
    cgButtons.map((b) => b.name),
    ["add", "edit", "delete", "detail", "export", "import"]
  );
  check(
    "按钮权限标识 = moduleName:表名下划线转横杠:动作",
    cgButtons.map((b) => b.perm),
    ["add", "edit", "delete", "detail", "export", "import"].map((a) => `${MARK}:verify-table:${a}`)
  );
  check(
    "按钮 sort 依次 1..6",
    cgButtons.map((b) => b.sort),
    [1, 2, 3, 4, 5, 6]
  );
  check(
    "按钮 treePath = 菜单 treePath + 菜单 ID",
    cgButtons.every((b) => b.treePath === `${R1},${R1},${cg!.id.toString()}`),
    true
  );
  check(
    "按钮 type 均为 B 且 visible=1",
    cgButtons.every((b) => b.menuType === "B" && b.visible === 1),
    true
  );
  check(
    "代码生成菜单进入路由树（是 M 类）",
    findRoute(await service.getRoutes("1"), "VerifyEntity") !== null,
    true
  );
  check(
    "新按钮进入 findPermsByMenuIds（传按钮自身 ID）",
    (await service.findPermsByMenuIds(cgButtons.map((b) => b.id.toString()))).sort(),
    ["add", "edit", "delete", "detail", "export", "import"]
      .map((a) => `${MARK}:verify-table:${a}`)
      .sort()
  );
  check(
    "findButtons 也能按这批按钮 ID 取回（顺序 = sort）",
    await service.findButtons(cgButtons.map((b) => b.id.toString())),
    ["add", "edit", "delete", "detail", "export", "import"].map((a) => `${MARK}:verify-table:${a}`)
  );

  await service.addMenuForCodegen(999999999, "x_table", MARK, `${MARK}-不该创建`, "NoEntity");
  check(
    "父菜单不存在时不创建任何菜单",
    await base.sysMenu.count({ where: { name: `${MARK}-不该创建` } }),
    0
  );

  // ---------------------------------------------------------------- 12) 清理
  console.log("\n=== 12) 清理与残留 ===");
  await cleanup();
  const residueMenu = await base.sysMenu.count({
    where: {
      OR: [
        { name: { contains: MARK } },
        { routeName: { contains: MARK } },
        { perm: { contains: MARK } },
      ],
    },
  });
  check("菜单造数已清理干净", residueMenu, 0);
  check("角色造数已清理干净", await base.sysRole.count({ where: { code: { contains: MARK } } }), 0);
  check(
    "用户角色绑定已清理干净",
    await base.sysUserRole.count({ where: { userId: { in: TEST_USERS.map(BigInt) } } }),
    0
  );
  check(
    "R1（已随清理删除）上无残留角色关联",
    (
      await base.sysRoleMenu.findMany({ where: { menuId: BigInt(R1) }, select: { roleId: true } })
    ).map((r) => r.roleId.toString()),
    []
  );

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
      `\n================ menu 模块验证：${checks - failures}/${checks} 通过 ================`
    );
    if (failures) {
      console.log(`失败 ${failures} 项`);
      process.exitCode = 1;
    }
  });
