import {
  Body,
  Controller,
  Delete,
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
import { HealthRecordService } from "./health-record.service";
import { PetPermissions } from "./pet-permissions.constants";
import { CreateHealthRecordDto } from "./dto/create-health-record.dto";
import { UpdateHealthRecordDto } from "./dto/update-health-record.dto";
import { QueryHealthRecordDto } from "./dto/query-health-record.dto";

/**
 * 健康档案接口（P0-06-03 · FR-2）
 *
 * 权限点：`pet:health:list / pet:health:create / pet:health:update / pet:health:delete`
 * （PermissionGuard 校验；ROOT 角色直放）。
 *
 * 租户上下文：类级 `@RequireTenant()` + `TenantContextGuard`（成对使用）——
 * 无租户上下文（平台 admin 等）一律 403 + A0302，fail-closed。
 *
 * ⚠️ 审计 entityType 暂用字符串字面量 "health_record"：@peluvida/shared 的
 * AuditEntityType 由并行任务增量登记（禁改 shared 包，见任务分工），此处仅做
 * 类型断言满足装饰器签名。
 */
const AUDIT_ENTITY_HEALTH_RECORD = "health_record" as AuditEntityType;

@ApiTags("13.宠物健康档案")
@Controller("pets/:petId/health")
@UseGuards(TenantContextGuard)
@RequireTenant()
export class HealthRecordController {
  constructor(private readonly healthRecordService: HealthRecordService) {}

  @ApiOperation({ summary: "健康档案建档（疫苗/驱虫/过敏/用药/绝育/慢病）" })
  @Post()
  @Permissions(PetPermissions.PET_HEALTH_CREATE)
  @Audit({ entityType: AUDIT_ENTITY_HEALTH_RECORD, action: AuditAction.CREATE })
  async createRecord(
    @Param("petId", ParseUUIDPipe) petId: string,
    @Body() formData: CreateHealthRecordDto
  ) {
    return await this.healthRecordService.createRecord(petId, formData);
  }

  @ApiOperation({ summary: "健康档案列表（recordType/recordDate 区间/expireDate 区间筛选）" })
  @Get()
  @Permissions(PetPermissions.PET_HEALTH_LIST)
  async listRecords(
    @Param("petId", ParseUUIDPipe) petId: string,
    @Query() query: QueryHealthRecordDto
  ) {
    return await this.healthRecordService.listRecords(petId, query);
  }

  @ApiOperation({ summary: "疫苗/驱虫有效性判定（供寄养入住校验消费）" })
  @Get("validity")
  @Permissions(PetPermissions.PET_HEALTH_LIST)
  async getValidity(@Param("petId", ParseUUIDPipe) petId: string) {
    return await this.healthRecordService.getValidity(petId);
  }

  @ApiOperation({ summary: "更正健康档案记录（version 乐观锁）" })
  @Put(":recordId")
  @Permissions(PetPermissions.PET_HEALTH_UPDATE)
  @Audit({ entityType: AUDIT_ENTITY_HEALTH_RECORD, action: AuditAction.UPDATE })
  async updateRecord(
    @Param("petId", ParseUUIDPipe) petId: string,
    @Param("recordId", ParseUUIDPipe) recordId: string,
    @Body() formData: UpdateHealthRecordDto
  ) {
    return await this.healthRecordService.updateRecord(petId, recordId, formData);
  }

  @ApiOperation({ summary: "删除健康档案记录（软删，保留可追溯）" })
  @Delete(":recordId")
  @Permissions(PetPermissions.PET_HEALTH_DELETE)
  @Audit({ entityType: AUDIT_ENTITY_HEALTH_RECORD, action: AuditAction.DELETE })
  async deleteRecord(
    @Param("petId", ParseUUIDPipe) petId: string,
    @Param("recordId", ParseUUIDPipe) recordId: string
  ) {
    await this.healthRecordService.softDeleteRecord(petId, recordId);
    return { success: true };
  }
}
