/**
 * 统一 API 响应壳与分页契约（01-06 · 全局请求层）
 *
 * 分页口径与 `@peluvida/shared` **同源**（决策 A4 / Q5），本模块只做类型再导出与
 * 兼容层，禁止在此另立一套常量：
 * - 请求参数：snake_case `page` / `page_size`（与 DB / 后端 `PaginationQueryDto` 一致）；
 * - 响应信封：恒为 `{ list, total, page, page_size }`。
 *
 * 存量系统域端点（用户 / 角色 / 菜单 / 部门 / 字典 / 日志 / 配置）仍使用后端
 * `BaseQueryDto` 的 camelCase `pageNum` / `pageSize`，且只返回 `{ list, total }`。
 * 请求层（`utils/request.ts`）会为后者自动补齐 `page` / `page_size`，
 * 故页面层无需再写命名分支。
 */

export {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE,
  MAX_PAGE_SIZE,
  PAGE_QUERY_KEY,
  normalizePageQuery,
  buildPageResult,
  isPageResult,
  toOffset,
} from "@peluvida/shared";

export type { PageQuery } from "@peluvida/shared";

/**
 * API 响应壳
 */
export interface ApiResult<T = unknown> {
  /** 业务状态码 */
  code: string;
  /** 业务数据 */
  data: T;
  /** 业务消息 */
  msg: string;
}

/**
 * 统一分页查询参数（snake_case）
 *
 * 适用于后端 `PaginationQueryDto` 系列端点（新业务模块，row92+）。
 */
export interface PageQueryParams {
  /** 页码（≥1） */
  page: number;
  /** 每页条数（1~100） */
  page_size: number;
  /** 排序字段（须落在端点白名单内） */
  sort?: string;
  /** 排序方向 */
  order?: "asc" | "desc";
}

/**
 * 分页查询参数的最小形状
 *
 * 兼容两套命名：新契约 `page` / `page_size`，存量系统域 `pageNum` / `pageSize`。
 * 分页列表组合式函数以本类型为泛型约束，两套参数结构均可直接复用。
 */
export interface PageQueryBase {
  page?: number;
  page_size?: number;
  pageNum?: number;
  pageSize?: number;
}

/**
 * 存量系统域查询参数（camelCase）
 *
 * @deprecated 仅用于系统管理端点（后端 `BaseQueryDto`）。新业务模块请使用
 *   {@link PageQueryParams}（snake_case），避免后端 whitelist 静默剥离导致
 *   分页参数回落到默认值而不报错（踩坑 53）。
 */
export interface BaseQueryParams {
  /** 页码 */
  pageNum: number;
  /** 每页记录数 */
  pageSize: number;

  /** 排序字段 */
  sortBy?: string;

  /** 排序方式（正序:ASC；反序:DESC） */
  order?: string;
}

/**
 * 分页接口结果
 *
 * `page` / `page_size` 声明为可选：存量端点只返回 `{ list, total }`，
 * 请求层已补齐；新端点恒返回四字段。
 */
export interface PageResult<T> {
  /** 数据列表 */
  list: T[];
  /** 总记录数 */
  total: number;
  /** 当前页码 */
  page?: number;
  /** 每页条数 */
  page_size?: number;
}

/**
 * 通用选项项
 */
export interface OptionItem {
  /** 选项值 */
  value: string | number;
  /** 选项标签 */
  label: string;
  /** 子选项 */
  children?: OptionItem[];
}

/**
 * Excel 导入结果
 */
export interface ExcelResult {
  /** 业务状态码 */
  code: string;
  /** 无效数据数量 */
  invalidCount: number;
  /** 有效数据数量 */
  validCount: number;
  /** 错误信息列表 */
  messageList: string[];
}
