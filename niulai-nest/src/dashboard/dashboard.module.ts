import { Module } from "@nestjs/common";

import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";

/**
 * 经营工作台模块（MVP-WEB-03-01）
 *
 * 数据访问走全局 PrismaModule 暴露的 PrismaService（`prisma.scoped.room` /
 * `prisma.scoped.healthRecord` / `prisma.scoped.pet` 均已由租户隔离扩展包裹，
 * 三者在 TENANT_SCOPED_MODELS 名单内）；租户上下文守卫由全局 TenantModule
 * （@Global）提供，故本模块无需 imports。
 */
@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
