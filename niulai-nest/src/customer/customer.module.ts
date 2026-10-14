import { Module } from "@nestjs/common";

import { AuditModule } from "../common/audit/audit.module";
import { CustomerMergeController } from "./customer-merge.controller";
import { CustomerController } from "./customer.controller";
import { CustomerPetController } from "./customer-pet.controller";
import { PetTransferController } from "./pet-transfer.controller";
import { CustomerReachController } from "./customer-reach.controller";
import { BlacklistController } from "./blacklist.controller";
import { CustomerService } from "./customer.service";
import { CustomerMergeService } from "./customer-merge.service";
import { CustomerPetService } from "./customer-pet.service";
import { PetTransferService } from "./pet-transfer.service";
import { CustomerReachService } from "./customer-reach.service";
import { BlacklistService } from "./blacklist.service";

/**
 * 客户域模块（P0-05 全线）
 *
 *   P0-05-02 萌主档案 FR-1（CustomerController / CustomerService）
 *   P0-05-03 多宠物归属 FR-2（CustomerPetController / PetTransferController）
 *   P0-05-04 触达渠道与偏好 FR-3（CustomerReachController / CustomerReachService）
 *   P0-05-05 黑名单（门店/租户两级，硬拦截）FR-4（BlacklistController / BlacklistService）
 *   P0-05-06 客户来源枚举 + 分层 lifecycle FR-5/FR-6（并入 CustomerController / CustomerService）
 *   P0-05-07 客户合并 FR-7（CustomerMergeController / CustomerMergeService）
 *
 * ⚠️ 控制器注册顺序（踩坑 37）：`CustomerMergeController`（静态段 `POST /customers/merge`）
 * 置于数组**首位**，先于含 `:id` 参数路由的 `CustomerController` 注册，避免静态段被
 * 参数路由吞掉误报 400。
 *
 * 数据访问走全局 PrismaModule 暴露的 PrismaService（`prisma.scoped.customer` /
 * `customerPet` / `pet` / `petTransferRequest` / `reachLog` / `blacklist` 已由租户隔离 +
 * 数据权限扩展链包裹，对应模型均在 TENANT_SCOPED_MODELS 名单内）；
 * 租户上下文守卫（TenantContextGuard）由全局 TenantModule（@Global）提供。
 *
 * `AuditModule` 导入：客户合并走**显式同事务审计轨**（`AuditLogService.record`），
 * 经 import 取得其导出的 `AuditLogService`（AuditModule 非 @Global）。
 *
 * CustomerReachService 依赖 BlacklistService（触达前黑名单硬拦截），二者同模块提供商，
 * 由 Nest 在同一模块内完成解析。
 */
@Module({
  imports: [AuditModule],
  controllers: [
    CustomerMergeController,
    CustomerController,
    CustomerPetController,
    PetTransferController,
    CustomerReachController,
    BlacklistController,
  ],
  providers: [
    CustomerService,
    CustomerMergeService,
    CustomerPetService,
    PetTransferService,
    CustomerReachService,
    BlacklistService,
  ],
  exports: [
    CustomerService,
    CustomerMergeService,
    CustomerPetService,
    PetTransferService,
    CustomerReachService,
    BlacklistService,
  ],
})
export class CustomerModule {}
