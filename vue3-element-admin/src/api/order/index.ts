/**
 * 订单 API（MVP-WEB-07-01 订单列表 / 07-02 订单详情四页签 / 07-03 订单生成与组合明细 /
 * 07-04 优惠与权益分摊 / 07-05 履约联动）
 */

import request from "@/utils/request";
import type { PageResult } from "@/api/common";
import type {
  CreateOrderPayload,
  OrderAuditLogItem,
  OrderAuditQueryParams,
  OrderDetail,
  OrderQueryParams,
  OrderRow,
  OrderTransitionPayload,
  UpdateOrderDiscountPayload,
  UpdateOrderPayload,
} from "./types";

const ORDER_BASE_URL = "/api/v1/orders";

const OrderAPI = {
  getPage(params: OrderQueryParams) {
    return request<unknown, PageResult<OrderRow>>({
      url: ORDER_BASE_URL,
      method: "get",
      params,
    });
  },

  /** 订单详情（订单 + 明细） */
  getDetail(id: string) {
    return request<unknown, OrderDetail>({
      url: `${ORDER_BASE_URL}/${id}`,
      method: "get",
    });
  },

  /**
   * 订单操作日志（审计流水，按 created_at 倒序）
   *
   * 走订单域的只读通道（受 `order:list` 保护）⇒ 订单详情可见者即可见其履历，
   * 不需要额外的 `audit:list` 权限；服务端已强制锚定 `entityType=order` + 订单 id。
   */
  getAuditLogs(id: string, params: OrderAuditQueryParams = {}) {
    return request<unknown, PageResult<OrderAuditLogItem>>({
      url: `${ORDER_BASE_URL}/${id}/audit-logs`,
      method: "get",
      params,
    });
  },

  /** 创建订单（服务端固定落 draft，锁定价格快照） */
  create(data: CreateOrderPayload) {
    return request<unknown, OrderDetail>({
      url: ORDER_BASE_URL,
      method: "post",
      data,
    });
  },

  /** 编辑订单（仅 draft/pending_payment；明细全量替换；version 乐观锁） */
  update(id: string, data: UpdateOrderPayload) {
    return request<unknown, OrderDetail>({
      url: `${ORDER_BASE_URL}/${id}`,
      method: "put",
      data,
    });
  },

  /**
   * 设置订单优惠（MVP-WEB-07-04；权限 `order:discount`，默认店长）
   *
   * 载荷只含「订单级优惠额」——服务端按明细行小计比例分摊后落各行
   * （`order.discount_amount == Σ 未软删行 discount_amount`），返回最新详情。
   */
  updateDiscount(id: string, data: UpdateOrderDiscountPayload) {
    return request<unknown, OrderDetail>({
      url: `${ORDER_BASE_URL}/${id}/discount`,
      method: "put",
      data,
    });
  },

  /** 删除订单（软删；仅 draft/pending_payment） */
  remove(id: string) {
    return request<unknown, { id: string }>({
      url: `${ORDER_BASE_URL}/${id}`,
      method: "delete",
    });
  },

  /**
   * 开始服务（MVP-WEB-07-05；权限 `order:start`，`paid → in_progress`）
   *
   * 服务端固定 `paid → in_progress` 并联动全明细履约状态置「进行中」，返回最新详情；
   * 非 `paid` 态返 A0911，`version` 落后返 A0909。
   */
  start(id: string, data: OrderTransitionPayload) {
    return request<unknown, OrderDetail>({
      url: `${ORDER_BASE_URL}/${id}/start`,
      method: "put",
      data,
    });
  },

  /**
   * 完成服务（MVP-WEB-07-05；权限 `order:complete`，`in_progress → completed`）
   *
   * 服务端固定 `in_progress → completed` 并联动全明细履约状态置「已完成」，返回最新详情；
   * 非 `in_progress` 态返 A0911，`version` 落后返 A0909。
   */
  complete(id: string, data: OrderTransitionPayload) {
    return request<unknown, OrderDetail>({
      url: `${ORDER_BASE_URL}/${id}/complete`,
      method: "put",
      data,
    });
  },
};

export default OrderAPI;

export * from "./types";
