import { Body, Controller, Get, Param, Patch, Query, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import { AuditEntityType, AuditAction } from "@peluvida/shared";
import { Audit } from "../common/audit/audit.decorator";
import { Permissions } from "../common/decorators/auth.decorator";
import { RequireTenant } from "./decorators/require-tenant.decorator";
import { TenantContextGuard } from "./guards/tenant-context.guard";
import { PlatformOnlyGuard } from "./guards/platform-only.guard";
import { TenantContextService } from "./tenant-context.service";
import { TenantManagementService } from "./tenant-management.service";
import { QueryTenantDto } from "./dto/query-tenant.dto";
import { UpdateTenantDto } from "./dto/update-tenant.dto";

/**
 * 租户管理接口（P0-03-04）
 *
 * 两类路由、两套守卫，**绝不混挂**：
 *  - 租户侧 `GET /tenants/current`：`@RequireTenant()` + `TenantContextGuard`——
 *    平台 admin 无租户上下文会被 fail-closed 拒绝（403 + A0302）；
 *  - 平台侧 `GET /tenants`、`GET /tenants/:id`、`PATCH /tenants/:id`：
 *    `PlatformOnlyGuard`——带租户上下文的账号（租户 ROOT 等）一律
 *    403 + A0305「仅平台账号可操作」，杜绝租户自改套餐提权；
 *    平台 admin（JWT 无 tenantId）正常放行。
 *
 * 权限点（PermissionGuard：ROOT 直放，非 ROOT 走 sys_menu(type=B)+sys_role_menu
 * 链路授权，无权限 seed 机制——沿用本仓库惯例）：
 *  - 租户侧 `tenant:read`；平台侧 `tenant:list` / `tenant:update`。
 *
 * 路由顺序：`GET /tenants/current` 必须先于 `GET /tenants/:id` 声明，
 * 否则 "current" 会被 `:id` 吞掉。
 */
@ApiTags("15.租户管理")
@Controller("tenants")
export class TenantManagementController {
  constructor(
    private readonly tenantManagementService: TenantManagementService,
    private readonly tenantContextService: TenantContextService
  ) {}

  @ApiOperation({ summary: "当前租户信息 + 生效能力开关清单（租户侧门控渲染数据源）" })
  @Get("current")
  @UseGuards(TenantContextGuard)
  @RequireTenant()
  @Permissions("tenant:read")
  async getCurrentTenant() {
    return await this.tenantManagementService.getCurrentTenant(
      this.tenantContextService.requireTenantId()
    );
  }

  @ApiOperation({ summary: "租户分页列表（平台侧，code/name/status/plan 筛选）" })
  @Get()
  @UseGuards(PlatformOnlyGuard)
  @Permissions("tenant:list")
  async getTenantPage(@Query() query: QueryTenantDto) {
    return await this.tenantManagementService.getTenantPage(query);
  }

  @ApiOperation({ summary: "租户详情（平台侧）" })
  @Get(":id")
  @UseGuards(PlatformOnlyGuard)
  @Permissions("tenant:list")
  async getTenantDetail(@Param("id") id: string) {
    return await this.tenantManagementService.getTenantDetail(id);
  }

  @ApiOperation({
    summary: "更新租户（平台侧：name/status/plan/featureFlags；plan 变更同步能力开关预设）",
  })
  @Patch(":id")
  @UseGuards(PlatformOnlyGuard)
  @Permissions("tenant:update")
  // 审计自动轨（P0-03-04 挂账）：停用/恢复租户属关键治理动作，
  // AuditInterceptor 已由 app.module 全局注册（APP_INTERCEPTOR），元数据即生效
  @Audit({ entityType: AuditEntityType.TENANT, action: AuditAction.UPDATE })
  async updateTenant(@Param("id") id: string, @Body() formData: UpdateTenantDto) {
    return await this.tenantManagementService.updateTenant(id, formData);
  }
}
