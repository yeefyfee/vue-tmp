/**
 * 订单（Order）类型定义（MVP-WEB-07-01 订单列表 / 07-02 订单详情四页签 /
 * 07-03 生成与组合明细 / 07-04 优惠与权益分摊 / 07-05 履约联动）
 *
 * 状态值域**唯一来源**为 `@peluvida/shared` 的 `OrderStatus`；
 * 明细类型值域唯一来源为 `@peluvida/shared` 的 `OrderItemType`；
 * 明细履约状态值域唯一来源为 `@peluvida/shared` 的 `OrderItemFulfillStatus`。
 *
 * ⚠️ 命名：`OrderRow` 是**订单主表行**（`order`），`OrderDetailItem` 才是
 * `order_item` **明细行** —— 两者别再混用（07-01 起本文件曾用 `OrderItem` 指订单行，
 * 07-02 引入真实明细后改名，避免同名两义）。
 */

import type { OrderItemType, OrderStatus } from "@peluvida/shared";
import type { BaseQueryParams } from "@/api/common";

export interface OrderQueryParams extends BaseQueryParams {
  storeId?: string;
  status?: OrderStatus;
  orderNo?: string;
  createdAtStart?: string;
  createdAtEnd?: string;
}

/** 订单主表行（列表 / 详情共用；BigInt 金额列在 wire 上为字符串） */
export interface OrderRow {
  id: string;
  storeId: string;
  customerId: string;
  petId: string;
  sourceBookingId: string | null;
  orderNo: string;
  totalAmount: string;
  discountAmount: string;
  payableAmount: string;
  creditFlag: boolean;
  status: OrderStatus;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  storeName: string | null;
  petName: string | null;
  customerName: string | null;
}

/** 订单明细行（`order_item`）；`unitPrice` / `discountAmount` 为分（wire 上字符串） */
export interface OrderDetailItem {
  id: string;
  orderId: string;
  /** 1 服务 / 2 商品 / 3 套餐（值域见 shared `OrderItemType`） */
  itemType: OrderItemType;
  refId: string;
  itemName: string;
  quantity: number;
  unitPrice: string;
  /**
   * 该行分摊到的优惠额（分，字符串）—— MVP-WEB-07-04
   *
   * 由服务端按行小计比例分摊裁定（`order.discount_amount == Σ 未软删行本列`）。
   */
  discountAmount: string;
  /** 折扣来源（0 无 / 1 手动改价 / 2 会员等级 / 3 优惠券；值域见 shared `OrderItemDiscountSource`） */
  discountSource: number;
  /** 0 未退款 / 1 部分退款 / 2 已全额退款（PRD 字段设计；退款域上线前不渲染） */
  refundStatus: number;
  /** 0 未开始 / 1 进行中 / 2 已完成（PRD 字段设计；履约联动 07-05 上线前不渲染） */
  fulfillStatus: number;
  createdAt: string;
  updatedAt: string;
}

/** 订单详情载荷（`GET /orders/:id`） */
export interface OrderDetail {
  order: OrderRow & {
    /** 来源预约单号（`sourceBookingId` 非空时由服务端回查补齐；仅展示用） */
    sourceBookingNo: string | null;
  };
  items: OrderDetailItem[];
}

// ─────────────────────── 订单写侧（MVP-WEB-07-03 生成与组合明细） ───────────────────────

/** 订单明细输入（价格快照：`itemName` / `unitPrice` 落库即固化） */
export interface OrderItemInput {
  /** 1 服务 / 2 商品 / 3 套餐（值域见 shared `OrderItemType`） */
  itemType: OrderItemType;
  /** 关联对象 id（服务项叶子 / 商品 / 套餐） */
  refId: string;
  /** 明细名称（快照） */
  itemName: string;
  /** 单价（分，非负整数字符串） */
  unitPrice: string;
  /** 数量（1~999） */
  quantity: number;
}

/** 创建订单载荷（`POST /orders`；服务端固定落 draft，金额按明细合计裁定） */
export interface CreateOrderPayload {
  storeId: string;
  customerId: string;
  petId: string;
  /** 来源预约 id（可选） */
  sourceBookingId?: string;
  items: OrderItemInput[];
  remark?: string;
}

/** 编辑订单载荷（`PUT /orders/:id`；仅 draft/pending_payment；明细全量替换） */
export interface UpdateOrderPayload {
  /** 乐观锁基准版本（必填） */
  version: number;
  items: OrderItemInput[];
  remark?: string;
}

// ─────────────────────── 优惠与权益分摊（MVP-WEB-07-04） ───────────────────────

/**
 * 设置订单优惠载荷（`PUT /orders/:id/discount`；权限 `order:discount`）
 *
 * 🔴 **唯一判据 = 订单级优惠额**：服务端按明细行小计比例分摊到各行
 * （`order_item.discount_amount`），前端**不**按行提交优惠（同一判据不留两源）。
 * `discountAmount = "0"` 表示清除优惠。
 */
export interface UpdateOrderDiscountPayload {
  /** 乐观锁基准版本（必填） */
  version: number;
  /** 订单优惠额（分，非负整数字符串；"0" = 清除优惠） */
  discountAmount: string;
}

// ─────────────────────── 履约联动（MVP-WEB-07-05） ───────────────────────

/**
 * 订单履约流转载荷（`PUT /orders/:id/start` / `PUT /orders/:id/complete`）
 *
 * 载荷只有 `version`：目标状态由服务端按状态机裁定（`start` 固定 `paid → in_progress`、
 * `complete` 固定 `in_progress → completed`），前端**不**传目标状态，避免绕过状态机直改字段。
 */
export interface OrderTransitionPayload {
  /** 乐观锁基准版本（必填） */
  version: number;
}

/** 审计查询入参（`GET /orders/:id/audit-logs`；分页口径 snake_case：page / page_size） */
export interface OrderAuditQueryParams {
  page?: number;
  page_size?: number;
}

/**
 * 审计流水行（订单「操作日志」页签）
 *
 * `action` 值域见 shared `AuditAction`（SmallInt，1~7）；
 * `operatorType` 0 系统 / 1 用户；`before` / `after` 为「仅变更字段」前后快照
 * （create 动作的 `before` 为 null）。
 */
export interface OrderAuditLogItem {
  id: string;
  entityType: string;
  entityId: string;
  action: number;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  operatorId: string | null;
  operatorType: number;
  operatorName: string | null;
  createdAt: string;
}
