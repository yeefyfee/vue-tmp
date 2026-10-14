/**
 * 订单服务（MVP-WEB-07-01 列表 / 07-02 详情四页签 / 07-03 生成与组合明细 / 07-04 优惠与权益分摊）
 *
 * 契约口径（与 booking / store / customer 域同构）：
 *  - 分页返回 `{ data, page: { pageNum, pageSize, total } }`，
 *    由全局 ResponseInterceptor 改写成 `list/total/page/page_size` 顶层扁平信封；
 *  - 所有入口一律过滤 `deletedAt: null`；
 *  - 排序走白名单（`order.constants.ts`），非法 `sortBy` 静默回落默认值。
 *
 * 07-03 写侧口径：
 *  - **价格快照**：`item_name` / `unit_price` 落库即固化，后续服务项调价不回写历史订单
 *    （PRD《订单管理》）；`total_amount` / `payable_amount` 由服务端按明细合计裁定，
 *    不接受调用方传值；
 *  - **编辑 / 删除状态守卫**：仅 draft / pending_payment（`ORDER_EDITABLE_STATUSES`）；
 *  - **并发护栏**：编辑走「version CAS」（`updateMany` where 带 version，踩 0 计数即 A0909），
 *    删除走「状态 CAS」（where 带 editable 集合，踩 0 后重读裁决 A0901 / A0908）；
 *  - **审计**：与业务写入**同事务**（显式轨，防抵赖优先，对齐 booking 流转口径）；
 *  - **明细替换语义**：编辑时旧明细**软删**（`deletedAt`，与全库逻辑删除口径一致）、
 *    新明细整批落库，明细行本身无独立审计实体，历史行迹由软删列位保留。
 */

import { Injectable, Logger } from "@nestjs/common";
import { Prisma, type Order, type OrderItem } from "@prisma/client";
import {
  AuditAction,
  AuditEntityType,
  Money,
  ORDER_CLOSE_REASON,
  OrderItemDiscountSource,
  OrderItemFulfillStatus,
  OrderItemType,
  OrderStatus,
  type PageResult,
} from "@peluvida/shared";

import { AuditLogService } from "../common/audit/audit-log.service";
import { AuditLogQueryService, type AuditLogItem } from "../common/audit/audit-log-query.service";
import { QueryAuditLogDto } from "../common/audit/dto/query-audit-log.dto";
import { RequestContext } from "../common/context/request-context";
import { ErrorCode } from "../common/enums/error-code.enum";
import { BusinessException } from "../common/exceptions/business.exception";
import { toBigInt } from "../common/prisma/prisma-ids";
import { PrismaService } from "../common/prisma/prisma.service";
import { formatDateTimeInZone } from "../common/utils/date.util";
import {
  ORDER_DEFAULT_SORT_BY,
  ORDER_EDITABLE_STATUSES,
  ORDER_NO_MAX_RETRY,
  ORDER_NO_PREFIX,
  ORDER_NO_SUFFIX_DIGITS,
  ORDER_SORTABLE_FIELDS,
  type OrderSortableField,
} from "./order.constants";
import { CreateOrderDto, UpdateOrderDto } from "./dto/order-item-input.dto";
import { CloseOrderDto } from "./dto/order-close.dto";
import { UpdateOrderDiscountDto } from "./dto/order-discount.dto";
import { OrderTransitionDto } from "./dto/order-transition.dto";
import { QueryOrderDto } from "./dto/query-order.dto";
import { closeOrderInTransaction } from "./order-close.util";

/** 订单列表行（`Order` + 服务端补齐的展示字段） */
export interface OrderListItem extends Order {
  readonly storeName: string | null;
  readonly petName: string | null;
  readonly customerName: string | null;
}

/**
 * 订单详情（MVP-WEB-07-02）
 *
 * `order` 与列表行同形（复用 `attachDisplayFields`，杜绝两套展示字段口径），
 * 另补 `sourceBookingNo`（来源预约单号，仅在有关联时回查 1 次，非 N+1）；
 * `items` 为 `order_item` 明细行（原样透传业务列，`BigInt` 由 `bigint-json` 垫片序列化为字符串）。
 *
 * ⚠️ **不含支付流水**：`payment` 域在当前版本**尚未建模**（无表、无模型）⇒ 本接口
 * 不返回空数组冒充数据源，「支付记录」页签由前端渲染诚实空态（对齐 05-01 的
 * `PetUnavailableTab` 口径，见 PITFALLS「未上线字段不渲染」）。
 */
export interface OrderDetailResult {
  readonly order: OrderListItem & { readonly sourceBookingNo: string | null };
  readonly items: OrderItem[];
}

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogQuery: AuditLogQueryService,
    private readonly auditLogService: AuditLogService
  ) {}

  /**
   * 订单分页列表（MVP-WEB-07-01）
   *
   * 筛选：storeId / status / orderNo（前缀）/ 创建日期区间（闭区间）。
   * 排序：白名单字段 + ASC/DESC，默认 `createdAt desc`。
   */
  async getOrderPage(query: QueryOrderDto) {
    const pageNum = Number(query.pageNum) > 0 ? Number(query.pageNum) : 1;
    const pageSize = Number(query.pageSize) > 0 ? Number(query.pageSize) : 20;

    const where: Prisma.OrderWhereInput = { deletedAt: null };
    if (query.storeId) where.storeId = query.storeId;
    if (query.status) where.status = query.status;
    if (query.orderNo) where.orderNo = { startsWith: query.orderNo };

    const dateRange = this.buildCreatedAtRange(query.createdAtStart, query.createdAtEnd);
    if (dateRange) where.createdAt = dateRange;

    const sortBy = this.resolveSortField(query.sortBy);
    const order: Prisma.SortOrder = query.order?.toUpperCase() === "ASC" ? "asc" : "desc";
    const orderBy: Prisma.OrderOrderByWithRelationInput[] = [{ [sortBy]: order }, { id: "asc" }];

    const [list, total] = await Promise.all([
      this.prisma.scoped.order.findMany({
        where,
        orderBy,
        skip: (pageNum - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.scoped.order.count({ where }),
    ]);

    return {
      data: await this.attachDisplayFields(list),
      page: {
        pageNum,
        pageSize,
        total,
      },
    };
  }

  /**
   * 订单详情（MVP-WEB-07-02 订单详情四页签）
   *
   * 一次性返回「概览 + 明细」两条已建模数据源的载荷：
   *  - `order`：与列表行同形（同一 `attachDisplayFields`，展示字段零漂移）；
   *  - `items`：`order_item` 明细，按 `createdAt asc, id asc` 稳定排序
   *    （同刻落库时二级键定序，与列表页排序口径一致）。
   *
   * 已软删订单视为不存在（A0901）——不返回 200 + 空体，避免「订单已删」与
   * 「订单 id 打错」在前端不可区分。
   */
  async getOrderDetail(id: string): Promise<OrderDetailResult> {
    const [order, items] = await Promise.all([
      this.requireOrder(id),
      this.prisma.scoped.orderItem.findMany({
        where: { orderId: id, deletedAt: null },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    ]);

    const [enriched] = await this.attachDisplayFields([order]);
    // 来源预约单号（可空）：非空时回查 1 次，仅取 bookingNo（不做 N+1 循环）
    const sourceBooking = order.sourceBookingId
      ? await this.prisma.scoped.booking.findFirst({
          where: { id: order.sourceBookingId },
          select: { bookingNo: true },
        })
      : null;
    return {
      order: { ...enriched, sourceBookingNo: sourceBooking?.bookingNo ?? null },
      items,
    };
  }

  /**
   * 订单操作日志（MVP-WEB-07-02「操作日志」页签）
   *
   * 复用全局审计查询服务（`AuditLogQueryService`，与 `GET /audit-logs` 同一实现，
   * 不另写一份查询 —— 避免同判据双源）。**权限挂订单读码 `order:list`**：
   * 审计查询端点自身要求 `audit:list`，而审计查看权不该成为「订单详情可见者
   * 看不到自己单子履历」的阻塞 ⇒ 在订单域开一个受 `order:list` 保护的只读通道。
   *
   * 租户锚点与存在性：先校验订单存在（A0901），再委托审计服务
   * （后者 where 必带上下文租户，fail-closed）。
   */
  async getOrderAuditLogs(id: string, query: QueryAuditLogDto): Promise<PageResult<AuditLogItem>> {
    await this.requireOrder(id);
    // ⚠️ entityType / entityId 在 spread **之后**覆写：调用方无权改写审计锚点
    return await this.auditLogQuery.findPage({
      ...query,
      entityType: AuditEntityType.ORDER,
      entityId: id,
    });
  }

  /* ─────────────── MVP-WEB-07-03 订单生成 / 编辑 / 删除 ─────────────── */

  /**
   * 创建订单（MVP-WEB-07-03 · draft 锁定价格快照）
   *
   * 落库即 `draft`（PRD《订单管理》：草稿态锁定明细价格快照）。
   *
   * 引用校验链（任一失败即 4xx 业务码，不裸 500）：
   *   门店存在且启用（A0902）→ 客户存在（A0903）→ 宠物存在且归属该客户（A0904）
   *   → 来源预约存在（可选，失效即 BOOKING_NOT_FOUND）
   *   → 服务类明细的 refId 须指向**启用**服务项（A0906；租户级 / 本门店均合法）。
   *
   * 金额：服务端按明细合计裁定（`Σ unitPrice × quantity`，分，BigInt 运算），
   * `discount_amount` 列位落 0（优惠分摊归后续模块），`payable = total - 0`。
   *
   * 事务（`withTenantContext`，RLS GUC 一致）：单号生成落库（唯一约束兜底重试）
   * → 明细整批落库 → 同事务审计（CREATE）。审计失败即业务失败（显式轨）。
   */
  async createOrder(dto: CreateOrderDto): Promise<OrderDetailResult> {
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw new BusinessException(ErrorCode.TENANT_CONTEXT_MISSING);
    }
    const userId = RequestContext.getUserId();

    const refs = await this.resolveOrderRefs(
      dto.storeId,
      dto.customerId,
      dto.petId,
      dto.sourceBookingId ?? null
    );
    const parsed = await this.parseOrderItems(dto.items, refs.storeId);

    const created = await this.prisma.withTenantContext(tenantId, async (tx) => {
      const order = await this.createWithUniqueOrderNo(
        {
          tenantId: BigInt(tenantId),
          storeId: refs.storeId,
          customerId: refs.customerId,
          petId: refs.petId,
          sourceBookingId: refs.sourceBookingId,
          totalAmount: parsed.totalAmount,
          discountAmount: 0n,
          payableAmount: parsed.totalAmount,
          creditFlag: parseCreditFlag(dto.creditFlag) ?? false,
          status: OrderStatus.DRAFT,
          remark: dto.remark ?? null,
          createdBy: toBigInt(userId),
          updatedBy: toBigInt(userId),
        },
        (data) => tx.order.create({ data })
      );

      await tx.orderItem.createMany({
        data: parsed.rows.map((row) => ({
          ...row,
          tenantId: BigInt(tenantId),
          orderId: order.id,
          createdBy: toBigInt(userId),
          updatedBy: toBigInt(userId),
        })),
      });

      await this.auditLogService.record(
        {
          entityType: AuditEntityType.ORDER,
          entityId: order.id,
          action: AuditAction.CREATE,
          before: null,
          after: {
            orderNo: order.orderNo,
            status: order.status,
            totalAmount: String(parsed.totalAmount),
            payableAmount: String(parsed.totalAmount),
            itemsCount: parsed.rows.length,
          },
        },
        tx
      );
      return order;
    });

    this.logger.log(`订单已创建：${created.orderNo}（${parsed.rows.length} 条明细）`);
    return await this.getOrderDetail(created.id);
  }

  /**
   * 编辑订单（MVP-WEB-07-03）
   *
   * 状态守卫：仅 draft / pending_payment（A0907）；`version` CAS 并发护栏（A0909）。
   * `items` 为**全量替换**语义：事务内旧明细软删、新明细整批落库（前端编辑前必须补拉回填，
   * 踩坑 123）；金额按新明细重算。备注 / 赊账标记不传则保留原值。
   * 新明细的 `created_at` 由 `parseOrderItems` 按提交索引显式错开 ⇒ 编辑后行序 = 本次提交顺序。
   */
  async updateOrder(id: string, dto: UpdateOrderDto): Promise<OrderDetailResult> {
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw new BusinessException(ErrorCode.TENANT_CONTEXT_MISSING);
    }
    const userId = RequestContext.getUserId();

    const row = await this.requireOrder(id);
    if (!ORDER_EDITABLE_STATUSES.includes(row.status as OrderStatus)) {
      throw new BusinessException(ErrorCode.ORDER_STATUS_NOT_EDITABLE);
    }

    const parsed = await this.parseOrderItems(dto.items, row.storeId);
    const now = new Date();

    await this.prisma.withTenantContext(tenantId, async (tx) => {
      // CAS where 带 version + editable 集合：并发改价 / 并发流转任一先行即失败
      const cas = await tx.order.updateMany({
        where: {
          id: row.id,
          tenantId: BigInt(tenantId),
          deletedAt: null,
          status: { in: [...ORDER_EDITABLE_STATUSES] },
          version: dto.version,
        },
        data: {
          remark: dto.remark ?? row.remark,
          creditFlag: parseCreditFlag(dto.creditFlag) ?? row.creditFlag,
          totalAmount: parsed.totalAmount,
          payableAmount: parsed.totalAmount,
          updatedBy: toBigInt(userId),
          version: { increment: 1 },
        },
      });
      if (cas.count === 0) {
        throw new BusinessException(ErrorCode.ORDER_VERSION_CONFLICT);
      }

      await tx.orderItem.updateMany({
        where: { orderId: row.id, tenantId: BigInt(tenantId), deletedAt: null },
        data: { deletedAt: now, updatedBy: toBigInt(userId) },
      });
      await tx.orderItem.createMany({
        data: parsed.rows.map((item) => ({
          ...item,
          tenantId: BigInt(tenantId),
          orderId: row.id,
          createdBy: toBigInt(userId),
          updatedBy: toBigInt(userId),
        })),
      });

      await this.auditLogService.record(
        {
          entityType: AuditEntityType.ORDER,
          entityId: row.id,
          action: AuditAction.UPDATE,
          before: {
            status: row.status,
            totalAmount: String(row.totalAmount),
            payableAmount: String(row.payableAmount),
          },
          after: {
            status: row.status,
            totalAmount: String(parsed.totalAmount),
            payableAmount: String(parsed.totalAmount),
            itemsCount: parsed.rows.length,
          },
        },
        tx
      );
    });

    this.logger.log(`订单已编辑：${row.orderNo}（version ${row.version} → ${row.version + 1}）`);
    return await this.getOrderDetail(id);
  }

  /**
   * 设置订单优惠（MVP-WEB-07-04 优惠与权益分摊）
   *
   * `PUT /orders/:id/discount`（权限 `order:discount`，PRD《权限规则》默认角色 = 店长）。
   *
   * 契约：
   *  - **唯一判据 = 订单级优惠额**（`discountAmount`，分）：服务端按各行**小计**
   *    （`unit_price * quantity`）比例**分摊**到明细行 —— 复用 `@peluvida/shared` 的
   *    `Money.allocate`（余数逐分派发），保证 **Σ 行优惠 == 订单优惠**（零误差，
   *    踩坑 131-d 的「合计不等」家族）；不接受「按行给优惠」的第二套输入。
   *  - **守恒不变式**：`order.discount_amount == Σ 未软删明细行 discount_amount`、
   *    `order.payable_amount == order.total_amount - order.discount_amount`。
   *  - **来源**一律落 `MANUAL`（手动改价）：本端点是本期唯一折扣写入口；会员等级
   *    （11-07）/ 优惠券（营销域未建模）的自动优惠上线后写入**同一列位** —— 值域预留、
   *    数据侧诚实降级，不伪造来源。
   *  - **状态守卫**：仅 draft / pending_payment（A0907）；明细为空（A0905）；
   *    优惠额 > 订单总额（A0910）；`version` CAS 并发护栏（A0909）。
   *  - `discountAmount = 0` ⇒ 清除优惠（行优惠归零、来源回 `NONE`）。
   */
  async updateOrderDiscount(id: string, dto: UpdateOrderDiscountDto): Promise<OrderDetailResult> {
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw new BusinessException(ErrorCode.TENANT_CONTEXT_MISSING);
    }
    const userId = RequestContext.getUserId();

    const row = await this.requireOrder(id);
    if (!ORDER_EDITABLE_STATUSES.includes(row.status as OrderStatus)) {
      throw new BusinessException(ErrorCode.ORDER_STATUS_NOT_EDITABLE);
    }

    const items = await this.prisma.scoped.orderItem.findMany({
      where: { orderId: row.id, deletedAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (items.length === 0) {
      throw new BusinessException(ErrorCode.ORDER_ITEMS_EMPTY);
    }

    const discount = BigInt(dto.discountAmount);
    if (discount > row.totalAmount) {
      throw new BusinessException(ErrorCode.ORDER_DISCOUNT_EXCEEDS_TOTAL);
    }
    // 防御性护栏：DTO 上限（10 位）与 quantity 上限（999）内正常不可达；
    // 一旦超安全整数，`Money.allocate` 会抛 RangeError（500），此处显式归为业务错误。
    const discountCents = Number(discount);
    if (!Number.isSafeInteger(discountCents)) {
      throw new BusinessException(ErrorCode.ORDER_DISCOUNT_EXCEEDS_TOTAL);
    }

    // 分摊基数 = 各行小计（分）；`Money.allocate` 保证 Σ 分摊 == discount
    const shares: bigint[] =
      discount === 0n
        ? items.map(() => 0n)
        : Money.fromCents(discountCents)
            .allocate(items.map((item) => Number(item.unitPrice * BigInt(item.quantity))))
            .map((money) => BigInt(money.toCents()));
    const payable = row.totalAmount - discount;

    await this.prisma.withTenantContext(tenantId, async (tx) => {
      // CAS where 带 version + editable 集合：并发改价 / 并发流转任一先行即失败
      const cas = await tx.order.updateMany({
        where: {
          id: row.id,
          tenantId: BigInt(tenantId),
          deletedAt: null,
          status: { in: [...ORDER_EDITABLE_STATUSES] },
          version: dto.version,
        },
        data: {
          discountAmount: discount,
          payableAmount: payable,
          updatedBy: toBigInt(userId),
          version: { increment: 1 },
        },
      });
      if (cas.count === 0) {
        throw new BusinessException(ErrorCode.ORDER_VERSION_CONFLICT);
      }

      await Promise.all(
        items.map((item, index) => {
          const share = shares[index] ?? 0n;
          return tx.orderItem.update({
            where: { id: item.id },
            data: {
              discountAmount: share,
              // 分摊额为 0 的行不得留来源（否则「无优惠」与「手动改价」语义打架）
              discountSource:
                share > 0n ? OrderItemDiscountSource.MANUAL : OrderItemDiscountSource.NONE,
              updatedBy: toBigInt(userId),
            },
          });
        })
      );

      await this.auditLogService.record(
        {
          entityType: AuditEntityType.ORDER,
          entityId: row.id,
          action: AuditAction.UPDATE,
          before: {
            discountAmount: String(row.discountAmount),
            payableAmount: String(row.payableAmount),
          },
          after: {
            discountAmount: String(discount),
            payableAmount: String(payable),
            itemsCount: items.length,
          },
        },
        tx
      );
    });

    this.logger.log(
      `订单优惠已设置：${row.orderNo}（优惠 ${discount.toString()} 分，分摊到 ${items.length} 行）`
    );
    return await this.getOrderDetail(id);
  }

  /* ─────────────── MVP-WEB-07-05 履约联动（order_item 与状态流转） ─────────────── */

  /**
   * 开始服务（MVP-WEB-07-05 · `paid → in_progress`）
   *
   * PRD《页面功能》#订单详情 1：`paid` 态顶部操作区显示「开始服务」；
   * PRD《操作流程》「开单收银」7：`paid` 订单可一键「开始服务」进入 `in_progress`。
   *
   * 权限 `order:start`（PRD 未列该动作的权限矩阵行 ⇒ 取「履约执行」口径：
   * 店长 / 美容师 / 寄养员，见 seed 授权注释）。
   * 状态守卫：仅 `paid`（A0911）；`version` CAS 并发护栏（A0909）。
   * 联动：全部未软删明细行 `fulfill_status` 置 `IN_PROGRESS`（1）。
   */
  async startOrder(id: string, dto: OrderTransitionDto): Promise<OrderDetailResult> {
    return await this.advanceFulfillment(
      id,
      dto,
      OrderStatus.PAID,
      OrderStatus.IN_PROGRESS,
      OrderItemFulfillStatus.PENDING,
      OrderItemFulfillStatus.IN_PROGRESS
    );
  }

  /**
   * 完成服务（MVP-WEB-07-05 · `in_progress → completed`）
   *
   * PRD《页面功能》#订单详情 1：`in_progress` 态显示「完成服务」。
   * 权限 `order:complete`；状态守卫：仅 `in_progress`（A0911）；`version` CAS（A0909）。
   * 联动：全部未软删明细行 `fulfill_status` 置 `COMPLETED`（2）。
   *
   * ⚠️ `completed` 触发的**时间线 / 提成 / 积分 / 套餐扣次**依赖尚未建模的域
   * （Timeline / Membership 等）⇒ 本期只落「订单状态 + 明细履约状态 + 审计」三件套，
   * 后续域上线后在同一事务点补挂，不伪造副作用。
   */
  async completeOrder(id: string, dto: OrderTransitionDto): Promise<OrderDetailResult> {
    return await this.advanceFulfillment(
      id,
      dto,
      OrderStatus.IN_PROGRESS,
      OrderStatus.COMPLETED,
      OrderItemFulfillStatus.IN_PROGRESS,
      OrderItemFulfillStatus.COMPLETED
    );
  }

  /* ─────────────── MVP-WEB-07-06 订单关闭 / 超时未支付自动关闭 ─────────────── */

  /**
   * 关闭订单（MVP-WEB-07-06 · 待支付态「取消」）
   *
   * PRD《页面功能》#订单详情 1：`pending_payment` 态顶部操作区显示「取消」；
   * 权限 `order:close`（PRD 关键操作矩阵未单列该动作 ⇒ 取「前台取消待支付单」口径：
   * 店长 + 前台，见 seed 授权注释）。状态守卫：仅 `pending_payment`（A0912）；
   * `version` CAS 并发护栏（A0909）；关闭原因固定 `customer_cancel`（客户取消），
   * 落 `close_reason` + `closed_at`（与自动关闭共用 `closeOrderInTransaction` 落库口径）。
   *
   * ⚠️ 与「作废」区分：作废 = `DELETE /orders/:id`（07-03 软删，单据消失）；
   * 关闭 = 保留单据转入 `closed` 终态（可在列表按状态筛出）。
   */
  async closeOrder(id: string, dto: CloseOrderDto): Promise<OrderDetailResult> {
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw new BusinessException(ErrorCode.TENANT_CONTEXT_MISSING);
    }
    const userId = RequestContext.getUserId();

    const row = await this.requireOrder(id);
    if (row.status !== OrderStatus.PENDING_PAYMENT) {
      throw new BusinessException(ErrorCode.ORDER_CLOSE_INVALID);
    }

    await this.prisma.withTenantContext(tenantId, async (tx) => {
      const closed = await closeOrderInTransaction(tx, this.auditLogService, {
        tenantId,
        order: row,
        reason: ORDER_CLOSE_REASON.CUSTOMER_CANCEL,
        operatorId: toBigInt(userId),
        version: dto.version,
      });
      if (!closed) {
        throw new BusinessException(ErrorCode.ORDER_VERSION_CONFLICT);
      }
    });

    this.logger.log(`订单已关闭：${row.orderNo}（原因 customer_cancel）`);
    return await this.getOrderDetail(id);
  }

  /**
   * 履约流转公共实现（start / complete 共用）：
   * 显式状态守卫（`row.status !== from` ⇒ A0911）+ CAS（where 再带 `status: from` 与
   * `version`，双保险：旁路一层仍写不进库）+ 明细履约状态整批联动 + 同事务审计。
   */
  private async advanceFulfillment(
    id: string,
    dto: OrderTransitionDto,
    from: OrderStatus,
    to: OrderStatus,
    fromItemStatus: OrderItemFulfillStatus,
    toItemStatus: OrderItemFulfillStatus
  ): Promise<OrderDetailResult> {
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw new BusinessException(ErrorCode.TENANT_CONTEXT_MISSING);
    }
    const userId = RequestContext.getUserId();

    const row = await this.requireOrder(id);
    if (row.status !== from) {
      throw new BusinessException(ErrorCode.ORDER_FULFILL_TRANSITION_INVALID);
    }

    await this.prisma.withTenantContext(tenantId, async (tx) => {
      // CAS where 带 status(from) + version：并发流转 / 并发改价任一先行即失败
      const cas = await tx.order.updateMany({
        where: {
          id: row.id,
          tenantId: BigInt(tenantId),
          deletedAt: null,
          status: from,
          version: dto.version,
        },
        data: {
          status: to,
          updatedBy: toBigInt(userId),
          version: { increment: 1 },
        },
      });
      if (cas.count === 0) {
        throw new BusinessException(ErrorCode.ORDER_VERSION_CONFLICT);
      }

      const cascaded = await tx.orderItem.updateMany({
        where: { orderId: row.id, tenantId: BigInt(tenantId), deletedAt: null },
        data: { fulfillStatus: toItemStatus, updatedBy: toBigInt(userId) },
      });

      await this.auditLogService.record(
        {
          entityType: AuditEntityType.ORDER,
          entityId: row.id,
          action: AuditAction.UPDATE,
          before: { status: from, itemFulfillStatus: fromItemStatus },
          after: {
            status: to,
            itemFulfillStatus: toItemStatus,
            itemsCount: cascaded.count,
          },
        },
        tx
      );
    });

    this.logger.log(`订单履约流转：${row.orderNo}（${from} → ${to}）`);
    return await this.getOrderDetail(id);
  }

  /**
   * 删除订单（MVP-WEB-07-03 · 软删）
   *
   * 状态守卫：仅 draft / pending_payment（A0908）；删除走**状态 CAS**
   * （where 带 editable 集合），踩 0 计数后重读裁决：行已消失 → A0901，
   * 状态被并发流转 → A0908（对齐 booking CAS 失败「回读现状」口径）。
   * 明细不单独处理：详情入口先 `requireOrder`，主单软删后明细不可达。
   */
  async deleteOrder(id: string): Promise<{ id: string }> {
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw new BusinessException(ErrorCode.TENANT_CONTEXT_MISSING);
    }
    const userId = RequestContext.getUserId();

    const row = await this.requireOrder(id);
    if (!ORDER_EDITABLE_STATUSES.includes(row.status as OrderStatus)) {
      throw new BusinessException(ErrorCode.ORDER_STATUS_NOT_DELETABLE);
    }

    await this.prisma.withTenantContext(tenantId, async (tx) => {
      const cas = await tx.order.updateMany({
        where: {
          id: row.id,
          tenantId: BigInt(tenantId),
          deletedAt: null,
          status: { in: [...ORDER_EDITABLE_STATUSES] },
        },
        data: {
          deletedAt: new Date(),
          updatedBy: toBigInt(userId),
          version: { increment: 1 },
        },
      });
      if (cas.count === 0) {
        const fresh = await tx.order.findFirst({
          where: { id: row.id, tenantId: BigInt(tenantId) },
        });
        throw new BusinessException(
          fresh ? ErrorCode.ORDER_STATUS_NOT_DELETABLE : ErrorCode.ORDER_NOT_FOUND
        );
      }

      await this.auditLogService.record(
        {
          entityType: AuditEntityType.ORDER,
          entityId: row.id,
          action: AuditAction.DELETE,
          before: {
            orderNo: row.orderNo,
            status: row.status,
            totalAmount: String(row.totalAmount),
            payableAmount: String(row.payableAmount),
          },
          after: null,
        },
        tx
      );
    });

    this.logger.log(`订单已删除：${row.orderNo}`);
    return { id: row.id };
  }

  /**
   * 创建引用校验链（createOrder 专用；update 不换挂靠对象，无需重校）。
   * 命中即返回规范化结果，未命中抛对应业务码。
   */
  private async resolveOrderRefs(
    storeId: string,
    customerId: string,
    petId: string,
    sourceBookingId: string | null
  ): Promise<{
    storeId: string;
    customerId: string;
    petId: string;
    sourceBookingId: string | null;
  }> {
    const store = await this.prisma.scoped.store.findFirst({
      where: { id: storeId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!store || store.status !== 1) {
      throw new BusinessException(ErrorCode.ORDER_STORE_INVALID);
    }

    const [customer, pet] = await Promise.all([
      this.prisma.scoped.customer.findFirst({
        where: { id: customerId, deletedAt: null },
        select: { id: true },
      }),
      this.prisma.scoped.pet.findFirst({
        where: { id: petId, deletedAt: null },
        select: { id: true, ownerCustomerId: true },
      }),
    ]);
    if (!customer) {
      throw new BusinessException(ErrorCode.ORDER_CUSTOMER_INVALID);
    }
    // 宠物不存在 / 不属该客户同一码（不泄露他人宠物 id 的存在性）
    if (!pet || pet.ownerCustomerId !== customerId) {
      throw new BusinessException(ErrorCode.ORDER_PET_INVALID);
    }

    if (sourceBookingId) {
      const booking = await this.prisma.scoped.booking.findFirst({
        where: { id: sourceBookingId, deletedAt: null },
        select: { id: true },
      });
      if (!booking) {
        throw new BusinessException(ErrorCode.BOOKING_NOT_FOUND);
      }
    }

    return { storeId, customerId, petId, sourceBookingId };
  }

  /**
   * 明细解析与校验（create / update 共用）：
   *  - 金额列由 DTO `@Matches(/^\d{1,10}$/)` 保证非负整数字符串，此处安全 `BigInt`；
   *  - `itemType=1`（服务）批量回查启用服务项（1 次 `in` 查询，非 N+1），
   *    门店私有类目须与订单门店一致（租户级 `storeId=null` 恒合法）；
   *  - `itemType=2/3`（商品/套餐）无被引实体模型，`refId` 由调用方给 uuid，直接落快照；
   *  - 合计服务端裁定，返回 BigInt 分值与待落库行。
   */
  private async parseOrderItems(
    items: Array<{
      itemType: number;
      refId: string;
      itemName: string;
      unitPrice: string;
      quantity: number;
    }>,
    storeId: string
  ): Promise<{
    rows: Array<{
      itemType: number;
      refId: string;
      itemName: string;
      quantity: number;
      unitPrice: bigint;
      /** 显式行序载体（见下：事务内 `now()` 恒定 ⇒ 必须错开，否则行序随随机 uuid 漂移） */
      createdAt: Date;
    }>;
    totalAmount: bigint;
  }> {
    const serviceRefIds = [
      ...new Set(
        items.filter((item) => item.itemType === OrderItemType.SERVICE).map((item) => item.refId)
      ),
    ];
    if (serviceRefIds.length > 0) {
      const cats = await this.prisma.scoped.serviceCategory.findMany({
        where: { id: { in: serviceRefIds }, status: 1, deletedAt: null },
        select: { id: true, storeId: true },
      });
      const catMap = new Map(cats.map((cat) => [cat.id, cat]));
      for (const item of items) {
        if (item.itemType !== OrderItemType.SERVICE) continue;
        const cat = catMap.get(item.refId);
        if (!cat || (cat.storeId !== null && cat.storeId !== storeId)) {
          throw new BusinessException(ErrorCode.ORDER_SERVICE_INVALID);
        }
      }
    }

    const baseMs = Date.now();
    const rows = items.map((item, index) => ({
      itemType: item.itemType,
      refId: item.refId,
      itemName: item.itemName,
      quantity: item.quantity,
      unitPrice: BigInt(item.unitPrice),
      /**
       * 🔴 行序 = **提交顺序**：明细排序键是 `created_at asc, id asc`，而 PostgreSQL 的
       * `now()` 取的是**事务时间戳**（同事务内恒定）⇒ 若整批明细都吃 DB 默认值，全批
       * `created_at` 完全并列，行序退化为随机 uuid 序 —— 用户提交的行序丢失，且断言/测试
       * 变成掷硬币（同型踩坑 131-d）。这里按提交索引显式错开 1 毫秒，使行序稳定可预期；
       * `id asc` 仅作跨编辑场景的兜底二级键。
       */
      createdAt: new Date(baseMs + index),
    }));
    const totalAmount = rows.reduce((sum, row) => sum + row.unitPrice * BigInt(row.quantity), 0n);
    return { rows, totalAmount };
  }

  /**
   * 订单单号：`OD + 时间戳14位 + 2位随机`（时间戳法，无跨请求状态；唯一性由
   * `uk_order_tenant_no` 兜底 + 有限重试，与 booking 单号策略同构）。
   */
  private buildOrderNo(): string {
    const stamp = (formatDateTimeInZone(new Date()) ?? "").replace(/[-: ]/g, "").slice(0, 14);
    const max = 10 ** ORDER_NO_SUFFIX_DIGITS;
    const suffix = String(Math.floor(Math.random() * max)).padStart(ORDER_NO_SUFFIX_DIGITS, "0");
    return `${ORDER_NO_PREFIX}${stamp}${suffix}`;
  }

  /** 落库；唯一约束冲突（P2002）时更换随机后缀重试，非唯一错误立即抛出 */
  private async createWithUniqueOrderNo(
    base: Omit<Prisma.OrderUncheckedCreateInput, "orderNo">,
    create: (data: Prisma.OrderUncheckedCreateInput) => Promise<Order>
  ): Promise<Order> {
    let lastError: unknown;
    for (let attempt = 0; attempt < ORDER_NO_MAX_RETRY; attempt++) {
      try {
        return await create({ ...base, orderNo: this.buildOrderNo() });
      } catch (error) {
        lastError = error;
        if (!isUniqueViolation(error)) throw error;
      }
    }
    throw lastError;
  }

  /** 订单存在性校验（scoped：租户内 + 未软删），不通过抛 A0901；命中返回该行 */
  private async requireOrder(id: string): Promise<Order> {
    const order = await this.prisma.scoped.order.findFirst({
      where: { id, deletedAt: null },
    });
    if (!order) {
      throw new BusinessException(ErrorCode.ORDER_NOT_FOUND);
    }
    return order;
  }

  private buildCreatedAtRange(start?: string, end?: string): Prisma.DateTimeFilter | undefined {
    if (!start && !end) return undefined;
    const filter: Prisma.DateTimeFilter = {};
    if (start) {
      filter.gte = new Date(`${start}T00:00:00.000Z`);
    }
    if (end) {
      const endDate = new Date(`${end}T00:00:00.000Z`);
      endDate.setUTCDate(endDate.getUTCDate() + 1);
      filter.lt = endDate;
    }
    return filter;
  }

  private resolveSortField(sortBy?: string): OrderSortableField {
    if (!sortBy) return ORDER_DEFAULT_SORT_BY;
    const fields = ORDER_SORTABLE_FIELDS as readonly string[];
    return fields.includes(sortBy) ? (sortBy as OrderSortableField) : ORDER_DEFAULT_SORT_BY;
  }

  /**
   * 补齐列表展示字段（门店名 / 宠物名 / 客户名）。
   * 批量回查（3 次 `in` 查询，非 N+1）。
   */
  private async attachDisplayFields(rows: Order[]): Promise<OrderListItem[]> {
    if (rows.length === 0) return [];

    const storeIds = [...new Set(rows.map((row) => row.storeId))];
    const petIds = [...new Set(rows.map((row) => row.petId))];
    const customerIds = [...new Set(rows.map((row) => row.customerId))];

    const [stores, pets, customers] = await Promise.all([
      this.prisma.scoped.store.findMany({
        where: { id: { in: storeIds } },
        select: { id: true, name: true },
      }),
      this.prisma.scoped.pet.findMany({
        where: { id: { in: petIds } },
        select: { id: true, name: true },
      }),
      this.prisma.scoped.customer.findMany({
        where: { id: { in: customerIds } },
        select: { id: true, name: true },
      }),
    ]);

    const storeMap = new Map(stores.map((s) => [s.id, s.name]));
    const petMap = new Map(pets.map((p) => [p.id, p.name]));
    const customerMap = new Map(customers.map((c) => [c.id, c.name]));

    return rows.map((row) => ({
      ...row,
      storeName: storeMap.get(row.storeId) ?? null,
      petName: petMap.get(row.petId) ?? null,
      customerName: customerMap.get(row.customerId) ?? null,
    }));
  }
}

/** Prisma 唯一约束冲突（P2002）判定（与 booking 单号重试同构） */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/** 赊账标记解析：DTO 以字符串承载（"true"/"1" 为真）；不传返回 undefined（保留原值） */
function parseCreditFlag(raw?: string): boolean | undefined {
  if (raw === undefined) return undefined;
  return raw === "true" || raw === "1";
}
