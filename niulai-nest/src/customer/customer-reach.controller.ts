import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import { AuditEntityType, AuditAction } from "@peluvida/shared";
import { Audit } from "../common/audit/audit.decorator";
import { Permissions } from "../common/decorators/auth.decorator";
import { RequireTenant } from "../tenant/decorators/require-tenant.decorator";
import { TenantContextGuard } from "../tenant/guards/tenant-context.guard";
import { CustomerReachService } from "./customer-reach.service";
import { CustomerPermissions } from "./customer-permissions.constants";
import { CreateReachLogDto } from "./dto/create-reach-log.dto";
import { QueryReachLogDto } from "./dto/query-reach-log.dto";
import { UpdateReachPreferenceDto } from "./dto/update-reach-preference.dto";

/**
 * 审计 entityType 暂用字符串字面量 "reach_log"（对齐宠物域 "pet" / 客户域 "customer_pet"
 * 先例）：@peluvida/shared 的 AuditEntityType 由并行任务增量登记（禁改 shared index），
 * 此处仅做类型断言满足装饰器签名；落库值 "reach_log" 与下轮 shared 登记对齐。
 */
const AUDIT_ENTITY_REACH_LOG = "reach_log" as AuditEntityType;

/**
 * 触达渠道与偏好接口（P0-05-04 · FR-3）
 *
 * 路由形态（均挂在 /customers/:id 下，与客户域控制器共存于 @Controller("customers")）：
 *  - `POST /customers/:id/reach-logs`       记录实测触达（黑名单硬拦截 + 偏好软拦截）；
 *  - `GET  /customers/:id/reach-logs`       触达历史分页（channel / 时间闭区间筛选）；
 *  - `GET  /customers/:id/reach-preferences` 读触达偏好（兜底默认）；
 *  - `PUT  /customers/:id/reach-preferences` 写触达偏好（整存整取）。
 *
 * 权限点：`customer:reach:list / customer:reach:create / customer:reach:preference:read /
 * customer:reach:preference:update`（ROOT 直放）；
 * 类级 `@RequireTenant()` + `TenantContextGuard`（fail-closed）。
 */
@ApiTags("11.萌主档案")
@Controller("customers")
@UseGuards(TenantContextGuard)
@RequireTenant()
export class CustomerReachController {
  constructor(private readonly reachService: CustomerReachService) {}

  @ApiOperation({ summary: "记录客户触达（黑名单硬拦截 + 触达偏好校验）" })
  @Post(":id/reach-logs")
  @Permissions(CustomerPermissions.CUSTOMER_REACH_CREATE)
  @Audit({ entityType: AUDIT_ENTITY_REACH_LOG, action: AuditAction.CREATE })
  async createReachLog(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() formData: CreateReachLogDto
  ) {
    return await this.reachService.createReachLog(id, formData);
  }

  @ApiOperation({ summary: "客户触达历史分页（channel / reachedAt 时间闭区间筛选）" })
  @Get(":id/reach-logs")
  @Permissions(CustomerPermissions.CUSTOMER_REACH_LIST)
  async listReachLogs(@Param("id", ParseUUIDPipe) id: string, @Query() query: QueryReachLogDto) {
    return await this.reachService.listReachLogs(id, query);
  }

  @ApiOperation({ summary: "读取客户触达偏好（未配置返回默认）" })
  @Get(":id/reach-preferences")
  @Permissions(CustomerPermissions.CUSTOMER_REACH_PREFERENCE_READ)
  async getReachPreference(@Param("id", ParseUUIDPipe) id: string) {
    return await this.reachService.getReachPreference(id);
  }

  @ApiOperation({ summary: "设置客户触达偏好（允许/拒绝渠道 + 免打扰，整存整取）" })
  @Put(":id/reach-preferences")
  @Permissions(CustomerPermissions.CUSTOMER_REACH_PREFERENCE_UPDATE)
  @Audit({ entityType: AuditEntityType.CUSTOMER, action: AuditAction.UPDATE })
  async updateReachPreference(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() formData: UpdateReachPreferenceDto
  ) {
    return await this.reachService.updateReachPreference(id, formData);
  }
}
