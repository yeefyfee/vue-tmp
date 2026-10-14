import { Prisma, type PrismaClient } from "@prisma/client";
import { RequestContext } from "../../common/context/request-context";
import { TENANT_SCOPED_MODELS } from "../tenant.constants";

/**
 * 租户范围 · Prisma 扩展（PEL-11 内核 + CROSS-09 挂链）
 *
 * 分层：
 *  - **纯函数内核**（`resolveTenantWhere` / `planTenantOperation`）：无 IO、无隐式上下文，
 *    全部边界可单测（见 `tenant-scope.extension.spec.ts`）；
 *  - **`tenantScopeExtension`**：`$extends` 对象，名单内模型自动注入租户条件
 *    （读/改/删注入 where，写注入 data；上下文值恒定覆盖调用方传入值），
 *    由 `PrismaService.scoped` 链式挂载（租户在外层、数据权限在内层）；
 *  - **RLS 兜底**：DB 侧策略见迁移 `*_tenant_rls_policies` 的 `app_enable_tenant_rls()`，
 *    事务内 GUC 写入走 `PrismaService.withTenantContext()`（raw SQL / 批处理逃生通道用）。
 *
 * 设计与 `data-scope.extension.ts` 同源：
 *  1. **编译与执行分离** —— 纯函数无 IO、无隐式上下文，全部边界可单测；
 *  2. **只作用于名单内模型** —— 名单外的模型原样放行，避免误伤平台级表；
 *  3. **失败即拒绝（fail-closed）** —— 名单内模型缺租户上下文时抛错，
 *     绝不静默放行（数据串租户是最高危事故）。
 *
 * ⚠️ 注入边界：只处理**顶层**载荷/条件；关系嵌套写入（`create: { posts: { create: … } }`）
 * 需业务层显式带 tenantId（当前 schema 无关系，业务域建模时若引入须复核本边界）。
 */

/** 租户上下文缺失异常：名单内模型在无租户上下文时的唯一出口 */
export class TenantContextMissingError extends Error {
  readonly model: string;

  constructor(model: string) {
    super(
      `[TenantScope] 模型 ${model} 属于租户隔离范围，但当前请求没有租户上下文（fail-closed 拒绝）`
    );
    this.name = "TenantContextMissingError";
    this.model = model;
  }
}

export type TenantWhereResult<T> =
  | { action: "pass-through" }
  | { action: "inject"; where: T }
  | { action: "reject"; error: TenantContextMissingError };

/**
 * 计算某次查询应注入的租户 where 条件。
 *
 * @param model  Prisma 模型名（如 `"Customer"`）
 * @param tenantId 当前请求的租户ID（`RequestContext.getTenantId()`），可为 null
 * @returns 三态结果：放行（名单外）/ 注入条件（名单内且有上下文）/ 拒绝（名单内且无上下文）
 */
export function resolveTenantWhere(
  model: string,
  tenantId: string | null
): TenantWhereResult<Record<string, unknown>> {
  // 名单外模型：平台级表，不注入任何条件
  if (!TENANT_SCOPED_MODELS.has(model)) {
    return { action: "pass-through" };
  }

  // 名单内模型：必须有租户上下文
  if (tenantId === null || String(tenantId).trim() === "") {
    return { action: "reject", error: new TenantContextMissingError(model) };
  }

  const parsed = toBigIntOrNull(tenantId);
  if (parsed === null) {
    // 上下文存在但格式非法 —— 同样按缺失处理（宁可拒绝，不可带着脏值放行）
    return { action: "reject", error: new TenantContextMissingError(model) };
  }

  return { action: "inject", where: { tenantId: parsed } };
}

/**
 * 从当前请求上下文解析租户条件的便捷入口（供 CROSS-09 挂链时使用）。
 * 上下文不存在（如定时任务、启动期）按「无租户」处理，由调用方决定语义。
 */
export function resolveTenantWhereFromContext(
  model: string
): TenantWhereResult<Record<string, unknown>> {
  return resolveTenantWhere(model, RequestContext.getTenantId());
}

/** 供扩展组装 `Prisma.sql` 片段时使用：租户ID 的合法形态只有 bigint */
export function tenantIdToBigInt(tenantId: string): bigint | null {
  return toBigIntOrNull(tenantId);
}

function toBigIntOrNull(value: string | number | null | undefined): bigint | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    return BigInt(value as string | number);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// CROSS-09 · 操作分类（纯函数，可单测）
// ─────────────────────────────────────────────

/** 某操作应如何注入租户条件 */
export interface TenantOperationPlan {
  /**
   * where 注入形态：
   *  - `false`：不注入（无 where 的操作 / create 类）；
   *  - `"list"`：`AND` 合并进现有 where（列表/过滤/批量改删，保留调用方条件）；
   *  - `"unique"`：展开合并进唯一 where（extendedWhereUnique 已 GA，允许附加非唯一过滤；
   *    上下文值覆盖调用方传入的 tenantId，行不匹配即按「未找到」处理——正确的隔离语义）。
   */
  where: false | "list" | "unique";
  /** 是否向写载荷（data / upsert 的 create+update）注入 tenantId（上下文值优先） */
  data: boolean;
}

/** 按操作分类注入策略（与 Prisma 文档操作名一一对应） */
export function planTenantOperation(operation: string): TenantOperationPlan {
  switch (operation) {
    // 列表 / 过滤 / 批量改删：AND 合并
    case "findMany":
    case "findFirst":
    case "findFirstOrThrow":
    case "count":
    case "aggregate":
    case "groupBy":
    case "updateMany":
    case "deleteMany":
      return { where: "list", data: false };
    // 唯一键操作：展开合并进唯一 where（P2025=未找到，即隔离生效）
    case "findUnique":
    case "findUniqueOrThrow":
    case "update":
    case "delete":
    case "upsert":
      return { where: "unique", data: operation === "upsert" };
    // 创建类：注入写载荷
    case "create":
    case "createMany":
    case "createManyAndReturn":
      return { where: false, data: true };
    // 其它（$queryRaw / executeRaw 等无模型操作在 $allOperations 里 model 为空，到不了这里）
    default:
      return { where: false, data: false };
  }
}

// ─────────────────────────────────────────────
// CROSS-09 · $extends 挂链对象
// ─────────────────────────────────────────────

/** 把 tenantId 注入单个写载荷（数组逐项注入；上下文值恒定覆盖） */
function withTenantId(payload: unknown, tenantId: bigint): unknown {
  if (Array.isArray(payload)) return payload.map((item) => withTenantId(item, tenantId));
  return { ...((payload as Record<string, unknown>) ?? {}), tenantId };
}

function injectTenantIntoPayload(
  args: Record<string, unknown>,
  tenantId: bigint,
  operation: string
): Record<string, unknown> {
  if (operation === "upsert") {
    return {
      ...args,
      create: withTenantId(args.create, tenantId),
      update: withTenantId(args.update, tenantId),
    };
  }
  return { ...args, data: withTenantId(args.data, tenantId) };
}

/**
 * 租户隔离扩展（CROSS-09 挂链）。
 *
 * 挂载位置：`PrismaService.scoped` 链的外层 ——
 * `base.$extends(tenantScopeExtension).$extends(dataScopeExtension)`，
 * 两类条件叠加互不干扰；基础客户端 `this` 保留原样供系统级操作使用。
 * 对名单内模型全部读写生效；名单为空时是纯透传（当前 14 张平台级表零影响）。
 */
export const tenantScopeExtension = Prisma.defineExtension((client) =>
  client.$extends({
    name: "peluvida-tenant-scope",
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          if (!model) return query(args);
          const verdict = resolveTenantWhereFromContext(model);
          // 名单外：平台级模型，原样放行
          if (verdict.action === "pass-through") return query(args);
          // 名单内且无（合法）租户上下文：fail-closed 拒绝
          if (verdict.action === "reject") throw verdict.error;

          const plan = planTenantOperation(operation);
          const tenantId = (verdict.where as { tenantId: bigint }).tenantId;
          let next = args as Record<string, unknown>;

          if (plan.where === "list") {
            const currentWhere = next.where;
            const tenantCond = { tenantId };
            next = {
              ...next,
              where: currentWhere ? { AND: [currentWhere, tenantCond] } : tenantCond,
            };
          } else if (plan.where === "unique") {
            next = {
              ...next,
              where: { ...((next.where as Record<string, unknown>) ?? {}), tenantId },
            };
          }
          if (plan.data) {
            next = injectTenantIntoPayload(next, tenantId, operation);
          }
          return query(next as typeof args);
        },
      },
    },
  })
);

/** 业务代码统一使用的「带租户隔离」客户端类型（单层） */
export const extendWithTenantScope = <T extends PrismaClient>(base: T) =>
  base.$extends(tenantScopeExtension);

export type TenantScopedClient = ReturnType<typeof extendWithTenantScope>;
