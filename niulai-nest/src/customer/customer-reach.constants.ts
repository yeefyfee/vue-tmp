/**
 * 触达域常量（P0-05-04 · FR-3 触达渠道与偏好）
 *
 * 渠道枚举**取值来源**：`@peluvida/shared` 的 `ReachChannel`（三端与后端共享的
 * 唯一合法值域，与 `reach_log.channel SMALLINT` 列对齐，迁移 20261007114800 建列时
 * 即按此口径注释）。此处**再导出**（而非第二处定义），避免枚举漂移。
 *
 * 触达结果 `ReachResult`（1 成功 / 2 失败）与选项表 `REACH_CHANNEL_OPTIONS` /
 * `REACH_RESULT_OPTIONS` 同源于 shared；本文件另收敛**触达域本地常量**
 * （排序白名单），供 service / DTO 复用。
 */
export {
  ReachChannel,
  REACH_CHANNEL_VALUES,
  REACH_CHANNEL_OPTIONS,
  ReachResult,
  REACH_RESULT_VALUES,
  REACH_RESULT_OPTIONS,
} from "@peluvida/shared";

/** 触达日志排序字段白名单（sortBy 合法域：防注入 + 防无索引全表排序） */
export const REACH_LOG_SORTABLE_FIELDS = ["reachedAt", "createdAt"] as const;
export type ReachLogSortableField = (typeof REACH_LOG_SORTABLE_FIELDS)[number];
