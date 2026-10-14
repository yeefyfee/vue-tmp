import { normalizePageQuery, type PageQueryInput } from "@peluvida/shared";

import type {
  BuildFindArgsOptions,
  FilterOperator,
  OrderDirection,
  PaginationParams,
  PrismaFindArgs,
  PrismaOrderBy,
  StringFilterMode,
} from "./pagination.types";

/**
 * P0-07-02 统一分页 / 过滤 / 排序工具函数
 *
 * 设计要点：
 *  1. **单一口径**：分页边界常量与规范化逻辑复用 `@peluvida/shared` 的
 *     `normalizePageQuery`（默认 1 / 20、上限 100、兼容历史 `pageNum/pageSize`），
 *     与全局 `ResponseInterceptor` 的分页信封解析同源，杜绝三端漂移。
 *  2. **白名单防注入**：`sort` / 过滤字段一律经白名单收敛——排序字段不在白名单
 *     时回退默认字段，绝不把任意字符串透传进 `orderBy`（既是防列名注入，也是防
 *     无索引全表排序）。
 *  3. **不侵入业务**：本基座不修改任何既有端点；业务列表服务按需
 *     `findMany({ ...buildPrismaFindArgs(query, opts), where: { ...args.where } })`
 *     逐步接入（接入清单见交付报告）。
 *
 * ── 用法示例 ─────────────────────────────────────────────
 * ```ts
 * import { buildPrismaFindArgs, normalizePagination } from "../../common/pagination/pagination.util";
 *
 * // 1) 只要分页偏移量
 * const { skip, take, page, page_size } = normalizePagination(query);
 *
 * // 2) 一条龙：分页 + 白名单排序 + 等值/模糊过滤
 * const args = buildPrismaFindArgs(query, {
 *   allowedSortFields: ["createdAt", "name", "mobile"],
 *   fallbackSort: "createdAt",
 *   baseWhere: { deletedAt: null },
 *   filters: [
 *     { field: "mobile", op: "equals" },
 *     { field: "name", op: "contains", mode: "insensitive" },
 *     { field: "storeId", op: "equals" },
 *   ],
 * });
 * const [list, total] = await Promise.all([
 *   this.prisma.scoped.customer.findMany(args),
 *   this.prisma.scoped.customer.count({ where: args.where }),
 * ]);
 * return { list, total, page, page_size } satisfies PageResult<typeof list[number]>;
 * ```
 */

/** 缺省排序方向：与存量门店 / 客户列表口径一致（默认 desc） */
const DEFAULT_ORDER: OrderDirection = "desc";

/**
 * 规范化分页参数：`page / page_size → { page, page_size, skip, take }`。
 *
 * `page < 1` / `page_size < 1` / 非法值 / 缺失 均回退默认（1 / 20）；
 * `page_size` 超上限截断为 100。委托 `@peluvida/shared`，兼容历史命名。
 */
export function normalizePagination(query: PageQueryInput = {}): PaginationParams {
  const { page, page_size } = normalizePageQuery(query);
  return {
    page,
    page_size,
    skip: (page - 1) * page_size,
    take: page_size,
  };
}

/**
 * 归一化排序方向：仅识别 `asc / desc`（大小写不敏感），其余回退 `defaultOrder`。
 */
export function resolveOrderDirection(
  order: unknown,
  defaultOrder: OrderDirection = DEFAULT_ORDER
): OrderDirection {
  if (typeof order === "string") {
    const lowered = order.toLowerCase();
    if (lowered === "asc") return "asc";
    if (lowered === "desc") return "desc";
  }
  return defaultOrder;
}

/**
 * 构造 Prisma `orderBy`（白名单机制）。
 *
 * 解析优先级：
 *  1. `sort` 命中 `allowedSortFields` → 用之；
 *  2. 否则 `fallbackSort` 命中白名单 → 用之；
 *  3. 否则回退白名单首项；
 *  4. 白名单为空数组 → 返回 `undefined`（不做排序）。
 *
 * 方向经 {@link resolveOrderDirection} 归一（默认 `desc`）。
 *
 * @returns `{ [字段]: "asc" | "desc" }`；白名单为空时 `undefined`
 */
export function buildOrderBy(
  sort: unknown,
  order: unknown,
  allowedSortFields: readonly string[],
  fallbackSort?: string,
  defaultOrder: OrderDirection = DEFAULT_ORDER
): PrismaOrderBy | undefined {
  if (!Array.isArray(allowedSortFields) || allowedSortFields.length === 0) {
    return undefined;
  }

  let field: string;
  if (typeof sort === "string" && allowedSortFields.includes(sort)) {
    field = sort;
  } else if (fallbackSort && allowedSortFields.includes(fallbackSort)) {
    field = fallbackSort;
  } else {
    field = allowedSortFields[0];
  }

  return { [field]: resolveOrderDirection(order, defaultOrder) };
}

/**
 * 把「算子 + 值」编译为 Prisma where 片段。
 *
 * - `equals` → 原始值（标量等值）
 * - `contains / startsWith / endsWith` → `{ contains|startsWith|endsWith, mode? }`
 * - `in` → `{ in: [...] }`（非数组值包成单元素数组）
 * - `gte / lte` → `{ gte | lte }`
 */
export function buildFilterCondition(
  op: FilterOperator,
  value: unknown,
  mode?: StringFilterMode
): unknown {
  const insensitive = mode === "insensitive";
  switch (op) {
    case "contains":
      return { contains: value, ...(insensitive ? { mode: "insensitive" } : {}) };
    case "startsWith":
      return { startsWith: value, ...(insensitive ? { mode: "insensitive" } : {}) };
    case "endsWith":
      return { endsWith: value, ...(insensitive ? { mode: "insensitive" } : {}) };
    case "in":
      return { in: Array.isArray(value) ? value : [value] };
    case "gte":
      return { gte: value };
    case "lte":
      return { lte: value };
    case "equals":
    default:
      return value;
  }
}

/**
 * 一条龙构造 Prisma `findMany` 参数：`{ skip, take, orderBy, where }`。
 *
 * - 分页：委托 {@link normalizePagination}；
 * - 排序：委托 {@link buildOrderBy}（白名单 + 回退）；
 * - 过滤：按 `filters` 配置逐维度取值 `query[source ?? field]`，
 *   `undefined / null / ""` 视为该维度不参与（缺省端点不炸接口），
 *   经 `transform` 后再次判空，再编译为 where 条件；
 * - `baseWhere`（如 `{ deletedAt: null }`）与过滤结果浅合并。
 *
 * @param query   已（或未）校验的查询对象；未校验时本函数仍做防御性归一
 * @param options 白名单 / 过滤 / 默认值配置
 */
export function buildPrismaFindArgs(
  query: Record<string, unknown> = {},
  options: BuildFindArgsOptions
): PrismaFindArgs {
  const { skip, take } = normalizePagination(query);

  const where: Record<string, unknown> = { ...(options.baseWhere ?? {}) };

  for (const filter of options.filters ?? []) {
    const sourceKey = filter.source ?? filter.field;
    const raw = query[sourceKey];
    if (raw === undefined || raw === null || raw === "") continue;

    const value = filter.transform ? filter.transform(raw) : raw;
    if (value === undefined || value === null) continue;

    where[filter.field] = buildFilterCondition(filter.op ?? "equals", value, filter.mode);
  }

  return {
    skip,
    take,
    orderBy: buildOrderBy(
      query.sort,
      query.order,
      options.allowedSortFields,
      options.fallbackSort,
      options.defaultOrder
    ),
    where,
  };
}
