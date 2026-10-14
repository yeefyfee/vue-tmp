/**
 * 订单模块常量（MVP-WEB-07-01 订单列表）
 *
 * 状态值域**唯一来源**为 `@peluvida/shared` 的 `OrderStatus`（snake_case 字符串），
 * 本文件只做「后端校验所需」的再导出与派生，**不重新定义**状态字面量。
 */

import { OrderStatus } from "@peluvida/shared";

export const ORDER_STATUS_VALUES: readonly string[] = Object.values(OrderStatus);

export { OrderStatus };
export type OrderStatusValue = (typeof OrderStatus)[keyof typeof OrderStatus];

/** 排序字段白名单 */
export const ORDER_SORTABLE_FIELDS = [
  "orderNo",
  "status",
  "createdAt",
  "totalAmount",
  "payableAmount",
] as const;
export type OrderSortableField = (typeof ORDER_SORTABLE_FIELDS)[number];

/** 列表默认排序 */
export const ORDER_DEFAULT_SORT_BY: OrderSortableField = "createdAt";

/** 业务单号前缀 */
export const ORDER_NO_PREFIX = "OD";

/** 单号随机后缀位数 */
export const ORDER_NO_SUFFIX_DIGITS = 2;

/** 单号生成最大重试次数 */
export const ORDER_NO_MAX_RETRY = 5;

/**
 * 可编辑 / 可删除状态集合（MVP-WEB-07-03，PRD《订单管理》验收要点：
 * 仅 draft / pending_payment 允许编辑与删除；paid 起进入履约闭环即冻结）。
 */
export const ORDER_EDITABLE_STATUSES: readonly OrderStatusValue[] = [
  OrderStatus.DRAFT,
  OrderStatus.PENDING_PAYMENT,
];

/**
 * 待支付超时自动关闭阈值（分钟）—— MVP-WEB-07-06
 *
 * 口径：`pending_payment` 订单自**创建时刻**起超过该时长仍未支付 ⇒ 自动关闭
 * （原因 `payment_timeout`）。PRD《操作流程》未定义自动关单窗口，此值为本期唯一
 * 裁定口径；外部 cron 周期调用扫描脚本（`order:scan-auto-close`）时应保证
 * 扫描周期 < 本阈值，避免漏扫。
 */
export const ORDER_AUTO_CLOSE_TIMEOUT_MINUTES = 30;

/**
 * 单租户单轮扫描保护上限：一次最多取这么多条待关闭候选（按创建时间升序 ⇒
 * 最久未支付者先关闭）。超时订单是「待处理清单」而非历史流水，正常量级远小于此值；
 * 触顶时返回结果仍自洽（只统计取到的行），避免无界结果集。
 */
export const ORDER_AUTO_CLOSE_MAX_SCAN = 500;

/**
 * 自动关单扫描幂等键保留窗口（秒）：扫描侧 `SET NX EX` 去重键的 TTL。
 * 目的：覆盖「入队 → worker 消费」的时间窗，避免重复扫描期间同一订单被反复入队；
 * 订单关闭后不再命中 `pending_payment` 过滤条件，故键过期后也不会被重新扫描到。
 */
export const ORDER_AUTO_CLOSE_DEDUPE_TTL_SECONDS = 24 * 60 * 60;
