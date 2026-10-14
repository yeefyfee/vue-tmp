import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import { AuditEntityType, AuditAction } from "@peluvida/shared";
import { Audit } from "../common/audit/audit.decorator";
import { Permissions } from "../common/decorators/auth.decorator";
import { RequireTenant } from "../tenant/decorators/require-tenant.decorator";
import { TenantContextGuard } from "../tenant/guards/tenant-context.guard";
import { CustomerPetService } from "./customer-pet.service";
import { CustomerPermissions } from "./customer-permissions.constants";
import { BindPetDto } from "./dto/bind-pet.dto";

/**
 * 审计 entityType 暂用字符串字面量 "customer_pet"（对齐宠物域 "pet" 先例）：
 * @peluvida/shared 的 AuditEntityType 由并行任务增量登记（禁改 shared 包），
 * 此处仅做类型断言满足装饰器签名；落库值 "customer_pet" 与下轮 shared 登记对齐。
 */
const AUDIT_ENTITY_CUSTOMER_PET = "customer_pet" as AuditEntityType;

/**
 * 客户-宠物归属关系接口（P0-05-03 · FR-2 多宠物归属）
 *
 * 权限点：`customer:pet:list / customer:pet:bind / customer:pet:unbind`
 * （PermissionGuard 校验；ROOT 直放）。
 * 租户上下文：类级 `@RequireTenant()` + `TenantContextGuard`（成对使用）——
 * 无租户上下文（平台 admin 等）一律 403 + A0302，fail-closed。
 */
@ApiTags("11.萌主档案")
@Controller("customers")
@UseGuards(TenantContextGuard)
@RequireTenant()
export class CustomerPetController {
  constructor(private readonly customerPetService: CustomerPetService) {}

  @ApiOperation({ summary: "某客户的宠物列表（join pet 摘要：name/petType/profileCompleteness）" })
  @Get(":id/pets")
  @Permissions(CustomerPermissions.CUSTOMER_PET_LIST)
  async listCustomerPets(@Param("id", ParseUUIDPipe) id: string) {
    return await this.customerPetService.listCustomerPets(id);
  }

  @ApiOperation({ summary: "绑定宠物归属（宠物须属当前租户且现行主人为本客户）" })
  @Post(":id/pets")
  @Permissions(CustomerPermissions.CUSTOMER_PET_BIND)
  @Audit({ entityType: AUDIT_ENTITY_CUSTOMER_PET, action: AuditAction.CREATE })
  async bindPet(@Param("id", ParseUUIDPipe) id: string, @Body() formData: BindPetDto) {
    return await this.customerPetService.bindPet(id, formData.petId);
  }

  @ApiOperation({ summary: "解绑宠物归属（归属变更须经审批转移，禁止直接解绑当前归属）" })
  @Delete(":id/pets/:petId")
  @Permissions(CustomerPermissions.CUSTOMER_PET_UNBIND)
  @Audit({ entityType: AUDIT_ENTITY_CUSTOMER_PET, action: AuditAction.DELETE })
  async unbindPet(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("petId", ParseUUIDPipe) petId: string
  ) {
    await this.customerPetService.unbindPet(id, petId);
    return { success: true };
  }
}
