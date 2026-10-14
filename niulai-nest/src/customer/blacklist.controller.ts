import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import { AuditEntityType, AuditAction } from "@peluvida/shared";
import { Audit } from "../common/audit/audit.decorator";
import { Permissions } from "../common/decorators/auth.decorator";
import { RequireTenant } from "../tenant/decorators/require-tenant.decorator";
import { TenantContextGuard } from "../tenant/guards/tenant-context.guard";
import { BlacklistService } from "./blacklist.service";
import { CustomerPermissions } from "./customer-permissions.constants";
import { CreateBlacklistDto } from "./dto/create-blacklist.dto";
import { QueryBlacklistDto } from "./dto/query-blacklist.dto";
import { ReleaseBlacklistDto } from "./dto/release-blacklist.dto";

/**
 * 审计 entityType 暂用字符串字面量 "blacklist"（对齐宠物域 "pet" 先例）：
 * @peluvida/shared 的 AuditEntityType 由并行任务增量登记（禁改 shared index），
 * 此处仅做类型断言满足装饰器签名；落库值 "blacklist" 与下轮 shared 登记对齐。
 */
const AUDIT_ENTITY_BLACKLIST = "blacklist" as AuditEntityType;

/**
 * 黑名单接口（P0-05-05 · FR-4 门店/租户两级黑名单，硬拦截）
 *
 * 路由形态（挂在 /customers/:id 下）：
 *  - `POST /customers/:id/blacklist`                         拉黑（scope=store/tenant）；
 *  - `GET  /customers/:id/blacklist`                         分页查询（scope/storeId/status）；
 *  - `POST /customers/:id/blacklist/:blacklistId/release`    解除（status 1→0，保留记录，
 *                                                            **须填解除原因** `reason`）。
 *
 * 硬拦截统一走 `BlacklistService.checkBlocked`（范式接入点见
 * `CustomerReachService.createReachLog`：记触达前先判黑名单，命中 A0522）。
 * 权限点：`customer:blacklist:list / customer:blacklist:create / customer:blacklist:release`
 * （ROOT 直放）；
 * 类级 `@RequireTenant()` + `TenantContextGuard`（fail-closed）。
 */
@ApiTags("11.萌主档案")
@Controller("customers")
@UseGuards(TenantContextGuard)
@RequireTenant()
export class BlacklistController {
  constructor(private readonly blacklistService: BlacklistService) {}

  @ApiOperation({ summary: "拉黑客户（scope=store 门店级 / scope=tenant 租户级）" })
  @Post(":id/blacklist")
  @Permissions(CustomerPermissions.CUSTOMER_BLACKLIST_CREATE)
  @Audit({ entityType: AUDIT_ENTITY_BLACKLIST, action: AuditAction.CREATE })
  async addToBlacklist(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() formData: CreateBlacklistDto
  ) {
    return await this.blacklistService.addToBlacklist(id, formData);
  }

  @ApiOperation({ summary: "客户黑名单分页（scope / storeId / status 筛选）" })
  @Get(":id/blacklist")
  @Permissions(CustomerPermissions.CUSTOMER_BLACKLIST_LIST)
  async getBlacklistPage(
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: QueryBlacklistDto
  ) {
    return await this.blacklistService.getBlacklistPage(id, query);
  }

  @ApiOperation({ summary: "解除黑名单（status 1→0，保留行为记录，须填解除原因）" })
  @Post(":id/blacklist/:blacklistId/release")
  @Permissions(CustomerPermissions.CUSTOMER_BLACKLIST_RELEASE)
  @Audit({ entityType: AUDIT_ENTITY_BLACKLIST, action: AuditAction.UPDATE })
  async releaseBlacklist(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("blacklistId", ParseUUIDPipe) blacklistId: string,
    @Body() formData: ReleaseBlacklistDto
  ) {
    return await this.blacklistService.releaseBlacklist(id, blacklistId, formData.reason);
  }
}
