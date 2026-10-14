import { Module } from "@nestjs/common";
import { AuditLogService } from "./audit-log.service";
import { AuditInterceptor } from "./audit.interceptor";
import { AuditLogQueryController } from "./audit-log-query.controller";
import { AuditLogQueryService } from "./audit-log-query.service";
import { TenantContextService } from "../../tenant/tenant-context.service";

/**
 * 审计模块（P0-02-08）
 *
 * 提供双轨写入能力：
 *  - 显式轨：业务 service 注入 AuditLogService，在业务事务内调用 record(entry, tx)；
 *  - 自动轨：路由上 `@UseInterceptors(AuditInterceptor)` + `@Audit({...})`。
 *
 * 查询能力（子任务 4）：AuditLogQueryController / AuditLogQueryService 在本模块
 * 内注册（AppModule 已全局 imports 本模块 ⇒ 路由随宿主挂载，无需改 app.module.ts）。
 * 平台侧查询通道待开放问题 6 拍板后另行实现（见 controller 头注释 TODO）。
 *
 * TenantContextService 本模块自持一份（无状态薄封装，语义与全局 TenantModule
 * 导出实例完全一致）：查询服务在「不引全局模块」的测试环境（audit.wiring.spec）
 * 也可独立装配。
 */
@Module({
  controllers: [AuditLogQueryController],
  providers: [AuditLogService, AuditInterceptor, AuditLogQueryService, TenantContextService],
  exports: [AuditLogService, AuditInterceptor, AuditLogQueryService],
})
export class AuditModule {}
