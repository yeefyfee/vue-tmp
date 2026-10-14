/**
 * 订单模块（MVP-WEB-07-01 订单列表 / 07-02 订单详情四页签）
 *
 * 数据访问走全局 PrismaModule 暴露的 PrismaService（`prisma.scoped.order` /
 * `prisma.scoped.orderItem` 已由租户隔离扩展包裹，Order / OrderItem 在
 * TENANT_SCOPED_MODELS 名单内）；租户上下文守卫（TenantContextGuard）由全局
 * TenantModule（@Global）提供。
 *
 * 07-02 起 imports `AuditModule`：订单详情「操作日志」页签复用其导出的
 * `AuditLogQueryService`（不另写审计查询实现，避免同判据双源）。
 *
 * 07-06 起 imports `RedisSharedModule`：超时自动关闭扫描服务（`OrderAutoCloseService`）
 * 写幂等去重键（RedisService 非 @Global，与 pet 模块同惯例）；队列注册表
 * （QUEUE_REGISTRY）由全局 QueueModule（@Global）提供，入队经其单一注册点。
 */
import { Module } from "@nestjs/common";

import { AuditModule } from "../common/audit/audit.module";
import { RedisSharedModule } from "../common/redis/redis.module";
import { OrderAutoCloseService } from "./order-auto-close.service";
import { OrderController } from "./order.controller";
import { OrderService } from "./order.service";

@Module({
  imports: [AuditModule, RedisSharedModule],
  controllers: [OrderController],
  providers: [OrderService, OrderAutoCloseService],
  exports: [OrderService, OrderAutoCloseService],
})
export class OrderModule {}
