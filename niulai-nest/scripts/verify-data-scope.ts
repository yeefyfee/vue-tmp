/**
 * 数据权限扩展 · 真库验证（PEL-10c）
 *
 * 单测只覆盖纯函数；本脚本连真实 PostgreSQL，验证三件事：
 *   1. `{ field: { in: [] } }` 在 Prisma 7 + PG 下**确实返回 0 行**（fail-closed 的根基）；
 *   2. 扩展真的在 `where` 上注入了条件（各数据范围的行数符合预期）；
 *   3. 子树解析（tree_path 逗号边界）算得对。
 *
 * 运行：
 *   node ./node_modules/ts-node/dist/bin.js -r tsconfig-paths/register scripts/verify-data-scope.ts
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { RequestContext } from "../src/common/context/request-context";
import { dataScopeExtension } from "../src/common/prisma/data-scope.extension";
import { RoleDataScope } from "../src/common/models/role-data-scope.model";
import type { DataPermissionConfig } from "../src/common/decorators/data-permission.decorator";
import type { CurrentUserInfo } from "../src/common/interfaces/current-user.interface";

const CONNECTION =
  process.env.DATABASE_URL ?? "postgresql://admin:Pg%40123456@127.0.0.1:5432/peluvida_dev";

const base = new PrismaClient({ adapter: new PrismaPg({ connectionString: CONNECTION }) });
const scoped = base.$extends(dataScopeExtension);

const CFG_USER: DataPermissionConfig = {
  model: "SysUser",
  deptField: "deptId",
  ownerField: "createBy",
};

// 刻意用高位 ID，避免与真实数据碰撞
const D_ROOT = 900001n;
const D_CHILD = 900002n;
const D_GRAND = 900003n;
const D_OTHER = 900004n;

const U_ROOT = 900101n;
const U_CHILD = 900102n;
const U_GRAND = 900103n;

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? "√" : "✗"} ${label}  → 实际 ${JSON.stringify(actual)}${ok ? "" : `（期望 ${JSON.stringify(expected)}）`}`
  );
}

async function seed() {
  await base.sysDept.createMany({
    data: [
      { id: D_ROOT, name: "验证根部门", code: "V-ROOT", parentId: 0n, treePath: "0" },
      {
        id: D_CHILD,
        name: "验证子部门",
        code: "V-CHILD",
        parentId: D_ROOT,
        treePath: `0,${D_ROOT}`,
      },
      {
        id: D_GRAND,
        name: "验证孙部门",
        code: "V-GRAND",
        parentId: D_CHILD,
        treePath: `0,${D_ROOT},${D_CHILD}`,
      },
      { id: D_OTHER, name: "验证旁支部门", code: "V-OTHER", parentId: 0n, treePath: "0" },
    ],
    skipDuplicates: true,
  });
  await base.sysUser.createMany({
    data: [
      {
        id: U_ROOT,
        username: "v_root",
        nickname: "验证根",
        password: "x",
        deptId: D_ROOT,
        createBy: U_ROOT,
      },
      {
        id: U_CHILD,
        username: "v_child",
        nickname: "验证子",
        password: "x",
        deptId: D_CHILD,
        createBy: U_CHILD,
      },
      {
        id: U_GRAND,
        username: "v_grand",
        nickname: "验证孙",
        password: "x",
        deptId: D_GRAND,
        createBy: U_CHILD,
      },
    ],
    skipDuplicates: true,
  });
}

async function cleanup() {
  await base.sysUser.deleteMany({ where: { id: { in: [U_ROOT, U_CHILD, U_GRAND] } } });
  await base.sysDept.deleteMany({ where: { id: { in: [D_ROOT, D_CHILD, D_GRAND, D_OTHER] } } });
}

/** 在指定上下文下跑一次受控查询，返回命中的验证数据 ID 集合 */
async function queryIds(
  user: Partial<CurrentUserInfo>,
  scopes: RoleDataScope[]
): Promise<number[]> {
  return RequestContext.run(async () => {
    RequestContext.initUserContext({
      userId: String(U_CHILD),
      deptId: String(D_CHILD),
      deptTreePath: `0,${D_ROOT}`,
      roles: [],
      dataScopes: scopes,
      ...user,
    } as CurrentUserInfo);
    RequestContext.setDataPermissionConfig(CFG_USER);

    const rows = await scoped.sysUser.findMany({
      where: { id: { in: [U_ROOT, U_CHILD, U_GRAND] } },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    return rows.map((r) => Number(r.id));
  });
}

async function main() {
  await seed();

  console.log("\n=== 1) 恒假条件语义（fail-closed 的根基） ===");
  const emptyIn = await base.sysUser.findMany({
    where: { deptId: { in: [] } },
    select: { id: true },
  });
  check("where { deptId: { in: [] } } 返回 0 行", emptyIn.length, 0);

  console.log("\n=== 2) 各数据范围的注入结果 ===");
  check("无任何数据范围 → 0 行（拒绝）", await queryIds({}, []), []);
  check(
    "ALL → 全可见（3 行）",
    await queryIds({}, [RoleDataScope.all("ROOT")]),
    [900101, 900102, 900103]
  );
  check(
    "DEPT(本部门=子部门) → 仅子部门 1 行",
    await queryIds({}, [RoleDataScope.dept("MGR")]),
    [900102]
  );
  check(
    "DEPT_AND_SUB(子部门含自身与孙) → 2 行",
    await queryIds({}, [RoleDataScope.deptAndSub("MGR")]),
    [900102, 900103]
  );
  check(
    "DEPT_AND_SUB(根部门含全体) → 3 行",
    await queryIds({ deptId: String(D_ROOT) }, [RoleDataScope.deptAndSub("ROOT")]),
    [900101, 900102, 900103]
  );
  check(
    "SELF(本人=子部门账号) → 本人 + 其代建的数据 2 行",
    await queryIds({}, [RoleDataScope.self("EMP")]),
    // 种子数据里 U_GRAND 的 create_by 刻意设为 U_CHILD（模拟主管为下属建档），
    // 因此按 create_by 过滤应当命中 2 行 —— 这正是 SELF 的原语义。
    [900102, 900103]
  );
  check(
    "CUSTOM([孙部门]) → 1 行",
    await queryIds({}, [RoleDataScope.custom("CU", [Number(D_GRAND)])]),
    [900103]
  );
  check(
    "多角色并集 DEPT(子) ∪ CUSTOM(孙) → 2 行",
    await queryIds({}, [RoleDataScope.dept("MGR"), RoleDataScope.custom("CU", [Number(D_GRAND)])]),
    [900102, 900103]
  );

  console.log("\n=== 3) 剪枝与旁路 ===");
  check("超管绕过一切 → 3 行", await queryIds({ isRoot: true }, []), [900101, 900102, 900103]);
  check(
    "预解析失败（deptId 非法）+ DEPT → 0 行",
    await queryIds({ deptId: "not-a-number" }, [RoleDataScope.dept("MGR")]),
    []
  );

  // 模型不匹配时不得注入
  const other = await RequestContext.run(async () => {
    RequestContext.initUserContext({
      userId: String(U_CHILD),
      deptId: String(D_CHILD),
      deptTreePath: `0,${D_ROOT}`,
      roles: [],
      dataScopes: [],
    } as CurrentUserInfo);
    RequestContext.setDataPermissionConfig(CFG_USER); // 声明的是 SysUser
    const rows = await scoped.sysDept.findMany({
      where: { id: { in: [D_ROOT, D_CHILD, D_GRAND, D_OTHER] } },
      select: { id: true },
    });
    return rows.length;
  });
  check("请求声明 SysUser 时，SysDept 查询不受注入 → 4 行", other, 4);

  console.log(`\n=== 结论：${failures === 0 ? "全部通过 ✅" : `${failures} 项失败 ❌`} ===`);
}

main()
  .then(async () => {
    await cleanup();
    await base.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (e) => {
    console.error("运行失败：", e);
    try {
      await cleanup();
    } catch {
      /* ignore */
    }
    await base.$disconnect();
    process.exit(1);
  });
