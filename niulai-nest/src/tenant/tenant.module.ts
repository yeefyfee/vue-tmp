import { Global, Module } from "@nestjs/common";
import { TenantContextService } from "./tenant-context.service";
import { TenantCapabilityService } from "./tenant-capability.service";
import { TenantManagementService } from "./tenant-management.service";
import { TenantManagementController } from "./tenant.controller";
import { TenantContextGuard } from "./guards/tenant-context.guard";
import { PlatformOnlyGuard } from "./guards/platform-only.guard";

/**
 * 租户模块 · 隔离基线（PEL-11，决策 A2）+ 能力开关（P0-03-01）+ 租户管理（P0-03-04）
 *
 * **去重边界**：
 *  - 租户管理 API（本模块 `TenantManagementController`：租户侧 current + 平台侧
 *    列表/详情/更新，plan→feature_flags 同步、A0305 平台隔离守卫）归 **P0-03-04**；
 *  - Prisma 扩展挂链 + RLS 策略落地 + 双租户隔离测试归 **CROSS-09 / P0-03-03**；
 *  - Redis 键规范全量定义归 **CROSS-10**（本模块只落 `tenant:` 前缀锚点）。
 *
 * 本模块承载：租户上下文读取（fail-closed）、`@RequireTenant()` 路由守卫、
 * 租户扩展纯函数内核（`prisma/tenant-scope.extension.ts`）、
 * 租户能力判断（`TenantCapabilityService`，Q10：业务代码只判断 feature_flags）、
 * 租户管理 API 与能力开关上抛（P0-03-04）。
 * 设为 `@Global()`：上下文读取与守卫被全部业务模块消费，无需逐模块 import。
 */
@Global()
@Module({
  controllers: [TenantManagementController],
  providers: [
    TenantContextService,
    TenantCapabilityService,
    TenantManagementService,
    TenantContextGuard,
    PlatformOnlyGuard,
  ],
  exports: [
    TenantContextService,
    TenantCapabilityService,
    TenantManagementService,
    TenantContextGuard,
    PlatformOnlyGuard,
  ],
})
export class TenantModule {}
