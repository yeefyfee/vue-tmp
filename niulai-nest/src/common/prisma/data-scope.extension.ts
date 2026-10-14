import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { RequestContext } from "../context/request-context";
import { DataScopeEnum } from "../enums/data-scope.enum";
import { DataScopeUtils } from "../models/role-data-scope.model";
import type { RoleDataScope } from "../models/role-data-scope.model";
import type { DataPermissionConfig } from "../decorators/data-permission.decorator";

/**
 * 数据权限 · Prisma 化实现（PEL-10c 前置）
 *
 * 背景：原实现是「猴补丁 TypeORM SelectQueryBuilder」——拦截 getMany/getOne 等，
 * 在 SQL 上 `andWhere` 拼条件。Prisma 没有 QueryBuilder，改用 **客户端扩展**（$extends）
 * 在 `where` 上做等价注入。
 *
 * 设计要点：
 *  1. **编译与执行分离**：`buildDataScopeWhere()` 是**纯函数**（无 IO、无上下文读取），
 *     入参为「配置 + 主体」，出参为「Prisma where 片段」。全部边界都能单测，不依赖数据库。
 *  2. **只在模型命中时注入**：配置里显式声明 `model`（Prisma 模型名），
 *     扩展用 `model !== cfg.model` 直接放行 —— 避免同一请求里顺带查询的其它模型被误伤
 *     （原实现靠 QueryBuilder 别名匹配，本质是同一层保护）。
 *  3. **只作用于读操作**：与原实现一致（原只补 getMany/getOne/getManyAndCount/getCount）。
 *     刻意**不含** `findUnique*` —— Prisma 的 findUnique 只接受唯一键条件，
 *     附加非唯一过滤会直接报错；需要按主键取单条且受限时，请用 `findFirst`。
 *  4. **失败即拒绝（fail-closed）**：所有分支都编译不出条件时，返回恒假条件而不是放行。
 *     与原实现 `qb.andWhere("1 = 0")` 语义一致。
 */

/** 恒假条件：Prisma 对空 `in` 列表生成永不匹配的条件，等同于 SQL 的 `1 = 0` */
function alwaysFalse(field: string): Record<string, unknown> {
  return { [field]: { in: [] } };
}

function toBigIntOrNull(value: string | number | null | undefined): bigint | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    return BigInt(value as string | number);
  } catch {
    return null;
  }
}

function toBigIntArray(values: Array<number | string> | undefined): bigint[] {
  if (!Array.isArray(values)) return [];
  return values.map((v) => toBigIntOrNull(v)).filter((v): v is bigint => v !== null);
}

/** 数据权限主体：当前登录用户的身份与授权范围 */
export interface DataScopeSubject {
  userId: string | null;
  deptId: string | null;
  isRoot: boolean;
  dataScopes: RoleDataScope[];
  /**
   * 预解析的「本部门及子部门」ID 列表。
   * 仅当 `dataScopes` 中存在 DEPT_AND_SUB 时才会被读取（见 `needsSubtreeDeptIds`）。
   * 之所以要外部传入而不在这里查库：为了让本函数保持纯函数、可单测。
   */
  subtreeDeptIds?: string[];
}

/** 该批数据范围里是否存在「本部门及子部门」——存在才需要预解析部门子树 */
export function needsSubtreeDeptIds(dataScopes: RoleDataScope[]): boolean {
  return dataScopes.some((ds) => ds.dataScope === DataScopeEnum.DEPT_AND_SUB);
}

/**
 * 编译单条角色数据范围为 Prisma 条件片段。
 * 返回 null 表示「该角色不产生限制」（例如 ALL，或缺少必要维度）——与原实现一致，
 * 调用方需在所有分支都为 null 时整体拒绝。
 */
function buildRoleBranch(
  cfg: Pick<DataPermissionConfig, "deptField" | "ownerField">,
  scope: RoleDataScope,
  subject: DataScopeSubject
): Record<string, unknown> | null {
  const { deptField, ownerField } = cfg;
  const deptId = toBigIntOrNull(subject.deptId);
  const userId = toBigIntOrNull(subject.userId);

  switch (scope.dataScope) {
    case DataScopeEnum.ALL:
      return null;

    case DataScopeEnum.DEPT_AND_SUB: {
      if (!deptField) return null;
      const ids = toBigIntArray(subject.subtreeDeptIds);
      // 解析不到子树（含 deptId 缺失）→ 该分支不产生限制，交由整体 fail-closed 兜底
      if (ids.length === 0) return null;
      return { [deptField]: { in: ids } };
    }

    case DataScopeEnum.DEPT: {
      if (!deptField || deptId === null) return null;
      return { [deptField]: deptId };
    }

    case DataScopeEnum.SELF: {
      if (!ownerField || userId === null) return null;
      return { [ownerField]: userId };
    }

    case DataScopeEnum.CUSTOM: {
      if (!deptField) return null;
      const ids = toBigIntArray(scope.customDeptIds);
      // 配了自定义范围却一个部门都没勾 → 等价于「什么都看不到」
      if (ids.length === 0) return alwaysFalse(deptField);
      return { [deptField]: { in: ids } };
    }

    default:
      return null;
  }
}

/**
 * 把「配置 + 主体」编译成要注入的 Prisma where 片段。
 *
 * @returns `null` 表示**不下发任何限制**（超管 / 未登录 / 命中 ALL）；
 *          否则返回一个必须与业务 where 做 `AND` 的条件。
 */
export function buildDataScopeWhere(
  cfg: Pick<DataPermissionConfig, "deptField" | "ownerField">,
  subject: DataScopeSubject
): Record<string, unknown> | null {
  const { userId, isRoot, dataScopes } = subject;

  // 与原实现一致：未登录不注入（此时守卫/权限守卫已决定请求能否继续）
  if (!userId) return null;
  // 超管跳过
  if (isRoot) return null;

  // 兜底字段：两个维度至少要有一个，否则无法表达「恒假」，直接放行交由权限守卫处理
  const falseField = cfg.deptField ?? cfg.ownerField;
  if (!falseField) return null;

  // 无任何角色数据范围 → 什么都看不到
  if (!dataScopes || dataScopes.length === 0) {
    return alwaysFalse(falseField);
  }

  // 任一角色为「全部数据」→ 跳过
  if (DataScopeUtils.hasAllDataScope(dataScopes)) return null;

  const branches: Record<string, unknown>[] = [];
  for (const scope of dataScopes) {
    const branch = buildRoleBranch(cfg, scope, subject);
    if (branch) branches.push(branch);
  }

  // 多角色取并集（OR）
  if (branches.length === 0) return alwaysFalse(falseField);
  if (branches.length === 1) return branches[0];
  return { OR: branches };
}

/** 需要施加数据权限的**读**操作；刻意不含 findUnique*（见文件头说明 3） */
const SCOPED_READ_OPERATIONS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "count",
  "aggregate",
  "groupBy",
]);

/**
 * 读取部门表所需的最小接口。
 * 刻意不写成 `PrismaClient` —— `defineExtension` 回调内拿到的 client 是「扩展视图」类型，
 * 直接当完整 `PrismaClient` 用会类型不兼容；也不做强转，用窄接口既安全又表达意图。
 */
interface DeptTreeReader {
  sysDept: {
    findMany(args: {
      where: Prisma.SysDeptWhereInput;
      select: { id: true };
    }): Promise<Array<{ id: bigint }>>;
  };
}

/**
 * 查询部门子树 ID 集合（含自身）。
 *
 * 语义对齐原 MySQL 实现：`id = :deptId OR FIND_IN_SET(:deptId, tree_path)`。
 * `tree_path` 是逗号分隔的祖先链（如 `0,1,210`），因此用四种边界位置覆盖：
 * 前缀 `deptId,`、后缀 `,deptId`、中缀 `,deptId,`，外加自身相等。
 *
 * 注意：刻意**不过滤 is_deleted**，与原 SQL 行为保持一致（原实现也没过滤）。
 * 该查询走**基础客户端**（未扩展），因此不会触发本扩展造成递归。
 */
async function resolveSubtreeDeptIds(client: DeptTreeReader, deptId: bigint): Promise<string[]> {
  const idText = deptId.toString();
  const rows = await client.sysDept.findMany({
    where: {
      OR: [
        { id: deptId },
        { treePath: { startsWith: `${idText},` } },
        { treePath: { endsWith: `,${idText}` } },
        { treePath: { contains: `,${idText},` } },
      ],
    },
    select: { id: true },
  });
  return rows.map((r) => r.id.toString());
}

/**
 * Prisma 数据权限扩展。
 *
 * 用法：`new PrismaClient(...).$extends(dataScopeExtension)`
 * （本项目由 `PrismaService.scoped` 统一暴露，业务代码注入那个即可）。
 */
export const dataScopeExtension = Prisma.defineExtension((client) =>
  client.$extends({
    name: "peluvida-data-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const cfg = RequestContext.getDataPermissionConfig();
          // 未声明目标模型 / 模型不匹配 / 非读操作 → 原样放行
          if (!cfg?.model || cfg.model !== model) return query(args);
          if (!cfg.deptField && !cfg.ownerField) return query(args);
          if (!SCOPED_READ_OPERATIONS.has(operation)) return query(args);

          const dataScopes = RequestContext.getDataScopes();
          let subtreeDeptIds: string[] | undefined;
          const rawDeptId = toBigIntOrNull(RequestContext.getDeptId());
          if (rawDeptId !== null && needsSubtreeDeptIds(dataScopes)) {
            subtreeDeptIds = await resolveSubtreeDeptIds(client, rawDeptId);
          }

          const scopeWhere = buildDataScopeWhere(cfg, {
            userId: RequestContext.getUserId(),
            deptId: RequestContext.getDeptId(),
            isRoot: RequestContext.isRoot(),
            dataScopes,
            subtreeDeptIds,
          });

          // null = 不限制
          if (!scopeWhere) return query(args);

          const currentWhere = (args as { where?: unknown }).where;
          const mergedWhere = currentWhere ? { AND: [currentWhere, scopeWhere] } : scopeWhere;

          return query({ ...(args as object), where: mergedWhere } as typeof args);
        },
      },
    },
  })
);

/** 业务代码统一使用的「带数据权限」客户端类型 */
export const extendWithDataScope = <T extends PrismaClient>(base: T) =>
  base.$extends(dataScopeExtension);

export type ScopedPrismaClient = ReturnType<typeof extendWithDataScope>;
