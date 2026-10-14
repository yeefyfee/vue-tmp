/**
 * 分页契约（决策 A4 / Q5）
 *
 * 统一列表信封：`list / total / page / page_size`
 * - 后端在既有 `{ list, total }` 上「纯增量」补 `page / page_size`（PEL-08），
 *   因此存量前端读取 `res.list` / `res.total` 不受影响；
 * - 请求参数统一使用 `page / page_size`（snake_case，与 DB / API 命名一致）。
 */

/** 默认页码 */
export const DEFAULT_PAGE = 1;
/** 默认每页条数 */
export const DEFAULT_PAGE_SIZE = 20;
/** 每页条数上限 */
export const MAX_PAGE_SIZE = 100;
/** 页码安全上限（防止非法超大页码拖垮查询） */
export const MAX_PAGE = 1_000_000;

/** 分页请求参数键名 */
export const PAGE_QUERY_KEY = {
  page: "page",
  pageSize: "page_size",
} as const;

/** 规范化后的分页请求参数 */
export interface PageQuery {
  readonly page: number;
  readonly page_size: number;
}

/** 统一列表信封 */
export interface PageResult<T> {
  readonly list: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly page_size: number;
}

/** 分页请求参数的宽松入参（兼容后端历史的 pageNum / pageSize） */
export interface PageQueryInput {
  readonly page?: unknown;
  readonly page_size?: unknown;
  readonly pageNum?: unknown;
  readonly pageSize?: unknown;
}

function toPositiveInt(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(n) || n < 1) {
    return fallback;
  }
  return Math.floor(n);
}

/**
 * 规范化分页参数：
 * - 兼容 `pageNum / pageSize`（后端历史命名）；
 * - `page_size` 超过 {@link MAX_PAGE_SIZE} 时截断，低于 1 时回落默认值。
 */
export function normalizePageQuery(input: PageQueryInput = {}): PageQuery {
  const rawPage = input.page ?? input.pageNum;
  const rawSize = input.page_size ?? input.pageSize;

  const page = Math.min(toPositiveInt(rawPage, DEFAULT_PAGE), MAX_PAGE);
  const size = toPositiveInt(rawSize, DEFAULT_PAGE_SIZE);

  return {
    page,
    page_size: Math.min(size, MAX_PAGE_SIZE),
  };
}

/**
 * 组装统一列表信封。
 *
 * @param list  当前页数据
 * @param total 总条数
 * @param query 已规范化的分页参数
 */
export function buildPageResult<T>(
  list: readonly T[],
  total: number,
  query: PageQuery
): PageResult<T> {
  return {
    list,
    total: Number.isFinite(total) && total > 0 ? Math.floor(total) : 0,
    page: query.page,
    page_size: query.page_size,
  };
}

/**
 * 判定一个对象是否是统一列表信封（至少含 list 与 total）。
 * 用于响应拦截器识别分页结构，以及前端防御性取值。
 */
export function isPageResult(value: unknown): value is PageResult<unknown> {
  if (!value || typeof value !== "object") {
    return false;
  }
  const v = value as Record<string, unknown>;
  return Array.isArray(v.list) && typeof v.total === "number";
}

/** 由当前页码与每页条数推导 SQL 偏移量 */
export function toOffset(query: PageQuery): number {
  return (query.page - 1) * query.page_size;
}
