import {
  Body,
  Controller,
  Delete,
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
import { WeightService } from "./weight.service";
import { PetPermissions } from "./pet-permissions.constants";
import { CreateWeightDto } from "./dto/create-weight.dto";
import { QueryWeightCurveDto } from "./dto/query-weight-curve.dto";

/**
 * 体重曲线接口（P0-06-04 · FR-3）
 *
 * 权限点：`pet:weight:list / pet:weight:create / pet:weight:delete`。
 *
 * 租户上下文：类级 `@RequireTenant()` + `TenantContextGuard`——无租户上下文一律
 * 403 + A0302，fail-closed。
 *
 * ⚠️ 审计 entityType 暂用字符串字面量 "weight"（@peluvida/shared 未登记，见任务分工）。
 */
const AUDIT_ENTITY_WEIGHT = "weight" as AuditEntityType;

@ApiTags("14.宠物体重曲线")
@Controller("pets/:petId")
@UseGuards(TenantContextGuard)
@RequireTenant()
export class WeightController {
  constructor(private readonly weightService: WeightService) {}

  @ApiOperation({ summary: "体重曲线（按称重日时间序列返回，含 pet 当前体重快照）" })
  @Get("weight-curve")
  @Permissions(PetPermissions.PET_WEIGHT_LIST)
  async getWeightCurve(
    @Param("petId", ParseUUIDPipe) petId: string,
    @Query() query: QueryWeightCurveDto
  ) {
    return await this.weightService.getWeightCurve(petId, query);
  }

  @ApiOperation({ summary: "记录体重（同步更新 pet.weightKg 快照 + 时间线事件）" })
  @Post("weights")
  @Permissions(PetPermissions.PET_WEIGHT_CREATE)
  @Audit({ entityType: AUDIT_ENTITY_WEIGHT, action: AuditAction.CREATE })
  async createWeight(
    @Param("petId", ParseUUIDPipe) petId: string,
    @Body() formData: CreateWeightDto
  ) {
    return await this.weightService.createWeight(petId, formData);
  }

  @ApiOperation({ summary: "删除体重记录（软删，重算 pet 体重快照）" })
  @Delete("weights/:recordId")
  @Permissions(PetPermissions.PET_WEIGHT_DELETE)
  @Audit({ entityType: AUDIT_ENTITY_WEIGHT, action: AuditAction.DELETE })
  async deleteWeight(
    @Param("petId", ParseUUIDPipe) petId: string,
    @Param("recordId", ParseUUIDPipe) recordId: string
  ) {
    await this.weightService.deleteWeight(petId, recordId);
    return { success: true };
  }
}
