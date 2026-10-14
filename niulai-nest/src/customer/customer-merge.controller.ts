import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import { Idempotent } from "../common/idempotency/idempotency.decorator";
import { Permissions } from "../common/decorators/auth.decorator";
import { RequireTenant } from "../tenant/decorators/require-tenant.decorator";
import { TenantContextGuard } from "../tenant/guards/tenant-context.guard";
import { CustomerMergeService } from "./customer-merge.service";
import { CustomerPermissions } from "./customer-permissions.constants";
import { MergeCustomerDto } from "./dto/merge-customer.dto";

/**
 * 客户合并接口（P0-05-07 · FR-7）
 *
 * 路由：`POST /customers/merge`（**静态段**）。
 *
 * ⚠️ 路由注册顺序（踩坑 37）：静态段必须**先于**同前缀的参数路由注册——本控制器
 * 置于 `CustomerModule.controllers` 数组**首位**，确保 `POST /customers/merge`
 * 不被 `:id` 参数路由吞掉（本域 `CustomerController` 有 `GET/PUT/PATCH/DELETE
 * /customers/:id`；`merge` 为纯静态段，先注册最稳妥）。
 *
 * 权限点：`customer:merge`（PermissionGuard 校验；ROOT 直放——tenant_admin/admin
 * 均为 ROOT，无需权限种子即可访问；非 ROOT 角色授权走角色-权限配置）。
 * 幂等：`@Idempotent()`（P0-07-01 opt-in，携带 `Idempotency-Key` 时同 key 重复
 * 提交回放首次结果；未携带则跳过，不影响存量调用方）。
 * 审计：显式同事务轨（`CustomerMergeService` 内 `AuditLogService.record`，
 * 带合并 diff）——故此处**不挂** `@Audit` 自动轨，避免双写。
 * 租户上下文：类级 `@RequireTenant()` + `TenantContextGuard`（成对使用）——
 * 无租户上下文（平台 admin 等）一律 403 + A0302，fail-closed。
 */
@ApiTags("11.萌主档案")
@Controller("customers")
@UseGuards(TenantContextGuard)
@RequireTenant()
export class CustomerMergeController {
  constructor(private readonly customerMergeService: CustomerMergeService) {}

  @ApiOperation({
    summary: "合并客户（source 并入 target；迁移宠物归属/关联/触达，源客户归档）",
  })
  @Post("merge")
  @Permissions(CustomerPermissions.CUSTOMER_MERGE)
  @Idempotent()
  async mergeCustomers(@Body() formData: MergeCustomerDto) {
    return await this.customerMergeService.mergeCustomers(formData);
  }
}
