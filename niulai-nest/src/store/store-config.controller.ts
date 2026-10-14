import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import { AuditEntityType, AuditAction } from "@peluvida/shared";
import { Audit } from "../common/audit/audit.decorator";
import { Permissions } from "../common/decorators/auth.decorator";
import { RequireTenant } from "../tenant/decorators/require-tenant.decorator";
import { TenantContextGuard } from "../tenant/guards/tenant-context.guard";
import { StoreConfigService } from "./store-config.service";
import { UpdateStoreConfigDto } from "./dto/update-store-config.dto";

/**
 * 门店配置接口（P0-04-05 · FR-4）
 *
 * 权限点：复用门店档案的 `store:list / store:update`（门店配置属门店运营
 * 配置域，不新增权限种子；非 ROOT 角色授权走角色-权限配置）。
 *
 * 租户上下文：类级 `@RequireTenant()` + `TenantContextGuard`（成对使用）——
 * 无租户上下文（平台 admin 等）一律 403 + A0302，fail-closed。
 *
 * 路由挂载：`/stores/:id/config` 为 3 段路径，与 StoreController 的
 * `/stores/:id`（2 段）无静态段冲突。
 */
@ApiTags("13.门店配置")
@Controller("stores")
@UseGuards(TenantContextGuard)
@RequireTenant()
export class StoreConfigController {
  constructor(private readonly storeConfigService: StoreConfigService) {}

  @ApiOperation({ summary: "查询结构化配置（NULL/缺键/非法值逐键合并平台默认值）" })
  @Get(":id/config")
  @Permissions("store:list")
  async getStoreConfig(@Param("id", ParseUUIDPipe) id: string) {
    return await this.storeConfigService.getStoreConfig(id);
  }

  @ApiOperation({
    summary: "部分更新配置（浅 merge；粒度/提前量/取消截止/寄养出入住/推送开关；version 乐观锁）",
  })
  @Patch(":id/config")
  @Permissions("store:update")
  @Audit({ entityType: AuditEntityType.STORE, action: AuditAction.UPDATE })
  async updateStoreConfig(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() formData: UpdateStoreConfigDto
  ) {
    return await this.storeConfigService.updateStoreConfig(id, formData);
  }
}
