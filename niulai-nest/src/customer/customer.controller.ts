import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { CustomerService } from "./customer.service";
import { CustomerPermissions } from "./customer-permissions.constants";
import { CreateCustomerDto } from "./dto/create-customer.dto";
import { UpdateCustomerDto } from "./dto/update-customer.dto";
import { QueryCustomerDto } from "./dto/query-customer.dto";

/**
 * 萌主档案接口（P0-05-02 · FR-1）
 *
 * 权限点：`customer:list / customer:create / customer:update / customer:delete`
 * （PermissionGuard 校验；ROOT 角色直放——tenant_admin/admin 均为 ROOT，
 * 无需权限种子即可访问，非 ROOT 角色的授权走角色-权限配置）。
 *
 * 租户上下文：类级 `@RequireTenant()` + `TenantContextGuard`（成对使用）——
 * 无租户上下文（平台 admin 等）一律 403 + A0302，fail-closed。
 * 租户归属只认 ALS 上下文（JWT payload），DTO 白名单剥离伪造 tenantId。
 */
@ApiTags("11.萌主档案")
@Controller("customers")
@UseGuards(TenantContextGuard)
@RequireTenant()
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @ApiOperation({ summary: "创建萌主档案" })
  @Post()
  @Permissions(CustomerPermissions.CUSTOMER_CREATE)
  @Audit({ entityType: AuditEntityType.CUSTOMER, action: AuditAction.CREATE })
  async createCustomer(@Body() formData: CreateCustomerDto) {
    return await this.customerService.createCustomer(formData);
  }

  @ApiOperation({ summary: "萌主档案分页列表（mobile/name/storeId/lifecycle/createdAt 区间筛选）" })
  @Get()
  @Permissions(CustomerPermissions.CUSTOMER_LIST)
  async getCustomerPage(@Query() query: QueryCustomerDto) {
    return await this.customerService.getCustomerPage(query);
  }

  // ⚠️ 静态段路由必须先于参数路由 `:id` 注册（踩坑 37）：否则 GET /customers/source-options
  //    会被 ParseUUIDPipe 吞掉误报 400。故本方法置于 getCustomerDetail 之前。
  @ApiOperation({ summary: "客户来源选项（value/label，来源枚举合法值域）" })
  @Get("source-options")
  @Permissions(CustomerPermissions.CUSTOMER_LIST)
  async getSourceOptions() {
    return this.customerService.getSourceOptions();
  }

  // 同为静态段路由，必须前置（同上踩坑 37）：否则 GET /customers/lifecycle-stats
  // 会被 `:id` 的 ParseUUIDPipe 吞掉误报 400。
  @ApiOperation({ summary: "客户分层分布统计（全量租户口径，供分层钻取筛选与规则解释）" })
  @Get("lifecycle-stats")
  @Permissions(CustomerPermissions.CUSTOMER_LIST)
  async getLifecycleStats() {
    return await this.customerService.getLifecycleStats();
  }

  @ApiOperation({ summary: "萌主档案详情" })
  @Get(":id")
  @Permissions(CustomerPermissions.CUSTOMER_LIST)
  async getCustomerDetail(@Param("id", ParseUUIDPipe) id: string) {
    return await this.customerService.getCustomerDetail(id);
  }

  @ApiOperation({ summary: "更新萌主档案（version 乐观锁）" })
  @Put(":id")
  @Permissions(CustomerPermissions.CUSTOMER_UPDATE)
  @Audit({ entityType: AuditEntityType.CUSTOMER, action: AuditAction.UPDATE })
  async updateCustomer(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() formData: UpdateCustomerDto
  ) {
    return await this.customerService.updateCustomer(id, formData);
  }

  @ApiOperation({
    summary: "局部更新萌主档案（PATCH 语义，含 lifecycle 分层更新；version 乐观锁）",
  })
  @Patch(":id")
  @Permissions(CustomerPermissions.CUSTOMER_UPDATE)
  @Audit({ entityType: AuditEntityType.CUSTOMER, action: AuditAction.UPDATE })
  async patchCustomer(@Param("id", ParseUUIDPipe) id: string, @Body() formData: UpdateCustomerDto) {
    return await this.customerService.updateCustomer(id, formData);
  }

  @ApiOperation({ summary: "删除萌主档案（软删，手机号释放可复用）" })
  @Delete(":id")
  @Permissions(CustomerPermissions.CUSTOMER_DELETE)
  @Audit({ entityType: AuditEntityType.CUSTOMER, action: AuditAction.DELETE })
  async deleteCustomer(@Param("id", ParseUUIDPipe) id: string) {
    await this.customerService.softDeleteCustomer(id);
    return { success: true };
  }
}
