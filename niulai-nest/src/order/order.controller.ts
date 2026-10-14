/**
 * 订单接口（MVP-WEB-07-01 订单列表 / 07-02 订单详情 / 07-03 订单生成与组合明细 /
 * 07-04 优惠与权益分摊）
 *  - `POST /api/v1/orders`              创建订单（draft，权限 `order:create`）
 *  - `GET /api/v1/orders`               订单分页列表（权限 `order:list`）
 *  - `GET /api/v1/orders/:id`           订单详情（订单 + 明细）（权限 `order:list`）
 *  - `GET /api/v1/orders/:id/audit-logs` 订单操作日志（审计流水）（权限 `order:list`）
 *  - `PUT /api/v1/orders/:id`           编辑订单（明细全量替换；权限 `order:update`）
 *  - `PUT /api/v1/orders/:id/discount`  设置订单优惠（按明细小计比例分摊；权限 `order:discount`）
 *  - `PUT /api/v1/orders/:id/start`     开始服务（paid → in_progress；权限 `order:start`）
 *  - `PUT /api/v1/orders/:id/complete`  完成服务（in_progress → completed；权限 `order:complete`）
 *  - `PUT /api/v1/orders/:id/close`     关闭订单（pending_payment → closed；权限 `order:close`）
 *  - `DELETE /api/v1/orders/:id`        删除订单（软删；权限 `order:delete`）
 *
 * 租户上下文：类级 `@RequireTenant()` + `TenantContextGuard`（成对使用）——
 * 无租户上下文（平台 admin 等）一律 403 + A0302，fail-closed。
 *
 * ⚠️ 路由注册顺序（踩坑 37）：静态段与多段参数路由在前，单段参数 `:id` 在最后。
 *    `PUT :id/discount`（两段）与 `PUT :id`（一段）段数不同无吞并风险；
 *    读端点 `:id/audit-logs` 同理。仍按「静态段在前、参数段在后」排布。
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import { QueryAuditLogDto } from "../common/audit/dto/query-audit-log.dto";
import { Permissions } from "../common/decorators/auth.decorator";
import { RequireTenant } from "../tenant/decorators/require-tenant.decorator";
import { TenantContextGuard } from "../tenant/guards/tenant-context.guard";
import { OrderPermissions } from "./order-permissions.constants";
import { OrderService } from "./order.service";
import { CreateOrderDto, UpdateOrderDto } from "./dto/order-item-input.dto";
import { CloseOrderDto } from "./dto/order-close.dto";
import { UpdateOrderDiscountDto } from "./dto/order-discount.dto";
import { OrderTransitionDto } from "./dto/order-transition.dto";
import { QueryOrderDto } from "./dto/query-order.dto";

@ApiTags("14.订单")
@Controller("orders")
@UseGuards(TenantContextGuard)
@RequireTenant()
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @ApiOperation({ summary: "创建订单（draft 锁定价格快照；金额由服务端按明细合计裁定）" })
  @Post()
  @Permissions(OrderPermissions.ORDER_CREATE)
  async createOrder(@Body() dto: CreateOrderDto) {
    return await this.orderService.createOrder(dto);
  }

  @ApiOperation({
    summary: "订单分页列表（storeId/status/orderNo/创建日期区间筛选）",
  })
  @Get()
  @Permissions(OrderPermissions.ORDER_LIST)
  async getOrderPage(@Query() query: QueryOrderDto) {
    return await this.orderService.getOrderPage(query);
  }

  @ApiOperation({
    summary: "订单操作日志（审计流水，按 created_at 倒序；分页参数 page / page_size）",
  })
  @Get(":id/audit-logs")
  @Permissions(OrderPermissions.ORDER_LIST)
  async getOrderAuditLogs(
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: QueryAuditLogDto
  ) {
    return await this.orderService.getOrderAuditLogs(id, query);
  }

  @ApiOperation({ summary: "订单详情（订单 + 明细）" })
  @Get(":id")
  @Permissions(OrderPermissions.ORDER_LIST)
  async getOrderDetail(@Param("id", ParseUUIDPipe) id: string) {
    return await this.orderService.getOrderDetail(id);
  }

  @ApiOperation({
    summary: "设置订单优惠（按明细小计比例分摊到各行；权限 order:discount）",
  })
  @Put(":id/discount")
  @Permissions(OrderPermissions.ORDER_DISCOUNT)
  async updateOrderDiscount(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderDiscountDto
  ) {
    return await this.orderService.updateOrderDiscount(id, dto);
  }

  @ApiOperation({
    summary: "开始服务（paid → in_progress；明细履约状态联动置进行中；权限 order:start）",
  })
  @Put(":id/start")
  @Permissions(OrderPermissions.ORDER_START)
  async startOrder(@Param("id", ParseUUIDPipe) id: string, @Body() dto: OrderTransitionDto) {
    return await this.orderService.startOrder(id, dto);
  }

  @ApiOperation({
    summary: "完成服务（in_progress → completed；明细履约状态联动置已完成；权限 order:complete）",
  })
  @Put(":id/complete")
  @Permissions(OrderPermissions.ORDER_COMPLETE)
  async completeOrder(@Param("id", ParseUUIDPipe) id: string, @Body() dto: OrderTransitionDto) {
    return await this.orderService.completeOrder(id, dto);
  }

  @ApiOperation({
    summary: "关闭订单（pending_payment → closed；权限 order:close）",
  })
  @Put(":id/close")
  @Permissions(OrderPermissions.ORDER_CLOSE)
  async closeOrder(@Param("id", ParseUUIDPipe) id: string, @Body() dto: CloseOrderDto) {
    return await this.orderService.closeOrder(id, dto);
  }

  @ApiOperation({
    summary: "编辑订单（仅 draft/pending_payment；明细全量替换；version 乐观锁）",
  })
  @Put(":id")
  @Permissions(OrderPermissions.ORDER_UPDATE)
  async updateOrder(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateOrderDto) {
    return await this.orderService.updateOrder(id, dto);
  }

  @ApiOperation({ summary: "删除订单（软删；仅 draft/pending_payment）" })
  @Delete(":id")
  @HttpCode(200)
  @Permissions(OrderPermissions.ORDER_DELETE)
  async deleteOrder(@Param("id", ParseUUIDPipe) id: string) {
    return await this.orderService.deleteOrder(id);
  }
}
