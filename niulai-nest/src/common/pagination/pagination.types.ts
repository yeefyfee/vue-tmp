import type { Prisma } from "@prisma/client";

/**
 * P0-07-02 统一分页 / 过滤 / 排序基座 —— 类型定义
 *
 * 契约来源（不得偏离）：
 *  - 分页响应信封固定 `{ list, total, page, page_size }`（决策 A4 / Q5）；
 *  - 全局 `ResponseInterceptor` 负责把业务层载荷改写成统一信封
 *    `{ code, msg, data }`（成功 code 取自 `ErrorCode.SUCCESS.code`）；
 *  - 请求参数统一 snake_case `page / page_size`（与 DB / API 命名一致）。
 *
 * 与 `@peluvida/shared` 的关系：
 *  - `PageResult<T>` 为后端侧结构，字段与 `@peluvida/shared` 的 `PageResult`
 *    保持一致（`list / total / page / page_size`），此处声明为可变数组形态
 *    （`list: T[]`）以贴合后端 service 直接组装返回的场景；
 *  - 分页边界常量（默认 1 / 20、上限 100）与规范化纯函数
 *    统一复用 `@peluvida/shared`，保证全端唯一口径（见 pagination.util.ts）。
 */

/** 排序方向（`Prisma.SortOrder` 的字符串子集，统一小写） */
export type OrderDirection = "asc" | "desc";

/**
 * Prisma `orderBy` 的通用形态：`{ [字段]: "asc" | "desc" }`。
 *
 * 之所以收敛成宽松的记录类型而非具体模型的 `XxxOrderByWithRelationInput`：
 * 白名单机制下字段名是运行时决定的，具体模型类型无法表达；调用方在
 * `findMany({ orderBy })` 处按其模型类型消费即可（结构兼容）。
 */
export type PrismaOrderBy = Record<string, Prisma.SortOrder>;

/** 规范化后的分页参数（在 page / page_size 之上补出 SQL 偏移量与条数） */
export interface PaginationParams {
  /** 页码（≥1） */
  readonly page: number;
  /** 每页条数（1~100） */
  readonly page_size: number;
  /** SQL OFFSET = (page - 1) * page_size */
  readonly skip: number;
  /** SQL LIMIT（= page_size，经上限截断） */
  readonly take: number;
}

/** 统一列表信封：`{ list, total, page, page_size }` */
export interface PageResult<T> {
  /** 当前页数据 */
  list: T[];
  /** 满足条件的总条数 */
  total: number;
  /** 当前页码 */
  page: number;
  /** 每页条数 */
  page_size: number;
}

/** 过滤匹配算子 */
export type FilterOperator =
  "equals" | "contains" | "startsWith" | "endsWith" | "in" | "gte" | "lte";

/** 字符串模糊算子的匹配模式（`insensitive` = 忽略大小写，PG ILIKE） */
export type StringFilterMode = "default" | "insensitive";

/**
 * 单个过滤维度配置。
 *
 * 支持「等值（equals，默认）」与「模糊（contains / startsWith / endsWith）」，
 * 另附 `in / gte / lte` 以覆盖枚举集合与区间场景。
 */
export interface FilterConfig {
  /** 目标 Prisma 字段名（进 where 的键） */
  readonly field: string;
  /** 匹配算子，默认 `"equals"` */
  readonly op?: FilterOperator;
  /** 取值来源的 query 键名；默认与 `field` 相同 */
  readonly source?: string;
  /**
   * 取值转换器（如把 query 字符串按应用时区转 Date、把 "1" 转 number）。
   * 返回 `null` / `undefined` 时视为该维度不参与过滤（缺省端点不炸接口）。
   */
  readonly transform?: (raw: unknown) => unknown;
  /** 字符串类算子是否忽略大小写 */
  readonly mode?: StringFilterMode;
}

/** `buildPrismaFindArgs` 选项 */
export interface BuildFindArgsOptions {
  /**
   * 排序字段白名单（必填）。
   * `sort` 不在白名单时回退 `fallbackSort`（缺省取白名单首项）；
   * 白名单为空数组时禁用排序（`orderBy` 返回 `undefined`）。
   */
  readonly allowedSortFields: readonly string[];
  /** 过滤维度配置（可选） */
  readonly filters?: readonly FilterConfig[];
  /** 未命中白名单时的默认排序字段（缺省取白名单首项） */
  readonly fallbackSort?: string;
  /** 默认排序方向，缺省 `"desc"`（对齐存量门店 / 客户列表口径） */
  readonly defaultOrder?: OrderDirection;
  /** 基础 where（如 `{ deletedAt: null }`），与过滤条件浅合并 */
  readonly baseWhere?: Record<string, unknown>;
}

/** `buildPrismaFindArgs` 结果：可直接展开进 Prisma `findMany` 参数 */
export interface PrismaFindArgs {
  skip: number;
  take: number;
  orderBy?: PrismaOrderBy;
  where: Record<string, unknown>;
}
