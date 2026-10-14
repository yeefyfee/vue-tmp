import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import { AuditEntityType, AuditAction } from "@peluvida/shared";
import { Audit } from "../common/audit/audit.decorator";
import { Permissions } from "../common/decorators/auth.decorator";
import { RequireTenant } from "../tenant/decorators/require-tenant.decorator";
import { TenantContextGuard } from "../tenant/guards/tenant-context.guard";
import { StoreHqService } from "./store-hq.service";
import { BatchDispatchConfigDto } from "./dto/batch-dispatch-config.dto";

/**
 * 总部-门店两级管理接口（P0-04-06 · FR-5 骨架）
 *
 * Q15 决策：MVP 仅落 Tenant→Store 归属关系 + 门店 CRUD，批量下发深化进 M3——
 * 本控制器为骨架级两能力：总部视角门店总览 + 配置键批量下发。
 *
 * 权限点：复用门店档案的 `store:list / store:update`（总部管理属门店域的
 * 租户级视角，不新增权限种子；非 ROOT 角色授权走角色-权限配置链路）。
 *
 * 租户上下文：类级 `@RequireTenant()` + `TenantContextGuard`（成对使用）——
 * 无租户上下文（平台 admin 等）一律 403 + A0302，fail-closed。
 *
 * 🔴 路由顺序（关键）：本控制器必须在 StoreController **之前**注册
 * （store.module.ts controllers 数组顺序），否则 `GET /stores/tenant-overview`
 * 会被 StoreController 的 `GET /stores/:id` 先匹配、"tenant-overview" 过不了
 * ParseUUIDPipe 而误报 400。静态段优先于路径参数由注册顺序保证，smoke 阶段
 * 已验证路由表 Mapped 顺序。
 */
@ApiTags("14.总部-门店两级管理")
@Controller("stores")
@UseGuards(TenantContextGuard)
@RequireTenant()
export class StoreHqController {
  constructor(private readonly storeHqService: StoreHqService) {}

  @ApiOperation({ summary: "总部视角门店总览（租户级全门店 + 配置摘要 + 日历例外计数）" })
  @Get("tenant-overview")
  @Permissions("store:list")
  async getTenantOverview() {
    return await this.storeHqService.getTenantOverview();
  }

  @ApiOperation({
    summary: "批量下发配置键子集到多门店（部分成功语义：单店失败进 failed，不整体回滚）",
  })
  @Post("batch-dispatch-config")
  @Permissions("store:update")
  @Audit({ entityType: AuditEntityType.STORE, action: AuditAction.UPDATE })
  async batchDispatchConfig(@Body() formData: BatchDispatchConfigDto) {
    return await this.storeHqService.batchDispatchConfig(formData);
  }
}
