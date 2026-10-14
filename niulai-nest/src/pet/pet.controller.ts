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
import { PetService } from "./pet.service";
import { HealthRecordService } from "./health-record.service";
import { PetPermissions } from "./pet-permissions.constants";
import { CreatePetDto } from "./dto/create-pet.dto";
import { UpdatePetDto } from "./dto/update-pet.dto";
import { QueryPetDto } from "./dto/query-pet.dto";
import { QueryHealthExpiryReminderDto } from "./dto/query-health-expiry-reminder.dto";

/**
 * 宠物档案接口（P0-06-02 · FR-1）
 *
 * 权限点：`pet:list / pet:create / pet:update / pet:delete`
 * （PermissionGuard 校验；ROOT 角色直放——tenant_admin/admin 均为 ROOT，
 * 无需权限种子即可访问，非 ROOT 角色的授权走角色-权限配置）。
 *
 * 租户上下文：类级 `@RequireTenant()` + `TenantContextGuard`（成对使用）——
 * 无租户上下文（平台 admin 等）一律 403 + A0302，fail-closed。
 * 租户归属只认 ALS 上下文（JWT payload），DTO 白名单剥离伪造 tenantId。
 *
 * ⚠️ 审计 entityType 暂用字符串字面量 "pet"：@peluvida/shared 的
 * AuditEntityType 由并行任务增量登记（禁改 shared 包，见任务分工），
 * 此处仅做类型断言满足装饰器签名；AuditLogService.record 接受
 * `AuditEntityType | string`，运行时落库值 "pet" 与下轮 shared 枚举登记对齐。
 */
const AUDIT_ENTITY_PET = "pet" as AuditEntityType;

@ApiTags("12.宠物档案")
@Controller("pets")
@UseGuards(TenantContextGuard)
@RequireTenant()
export class PetController {
  constructor(
    private readonly petService: PetService,
    private readonly healthRecordService: HealthRecordService
  ) {}

  @ApiOperation({ summary: "创建宠物档案（完整度评分随字段填充重算）" })
  @Post()
  @Permissions(PetPermissions.PET_CREATE)
  @Audit({ entityType: AUDIT_ENTITY_PET, action: AuditAction.CREATE })
  async createPet(@Body() formData: CreatePetDto) {
    return await this.petService.createPet(formData);
  }

  @ApiOperation({
    summary: "宠物档案分页列表（petType/ownerCustomerId/storeId/chipNo 精确 + name 模糊筛选）",
  })
  @Get()
  @Permissions(PetPermissions.PET_LIST)
  async getPetPage(@Query() query: QueryPetDto) {
    return await this.petService.getPetPage(query);
  }

  /**
   * 跨宠物健康到期提醒（MVP-WEB-05-02 · FR-2 / BR-1）
   *
   * ⚠️ **静态段必须声明在 `@Get(":id")` 之前**（踩坑 37）：两者段数同为 2
   * （`/pets/health-expiry-reminders` vs `/pets/:id`），Nest 按**方法声明顺序**
   * 注册路由，若 `:id` 在前，本请求会被 `ParseUUIDPipe` 吞成 400。
   */
  @ApiOperation({ summary: "跨宠物健康到期提醒清单（疫苗/驱虫，含已过期；租户级）" })
  @Get("health-expiry-reminders")
  @Permissions(PetPermissions.PET_HEALTH_LIST)
  async getHealthExpiryReminders(@Query() query: QueryHealthExpiryReminderDto) {
    return await this.healthRecordService.listExpiryReminders(query);
  }

  @ApiOperation({ summary: "宠物档案详情（含行为标签）" })
  @Get(":id")
  @Permissions(PetPermissions.PET_LIST)
  async getPetDetail(@Param("id", ParseUUIDPipe) id: string) {
    return await this.petService.getPetDetail(id);
  }

  @ApiOperation({ summary: "更新宠物档案（version 乐观锁；完整度评分重算）" })
  @Put(":id")
  @Permissions(PetPermissions.PET_UPDATE)
  @Audit({ entityType: AUDIT_ENTITY_PET, action: AuditAction.UPDATE })
  async updatePet(@Param("id", ParseUUIDPipe) id: string, @Body() formData: UpdatePetDto) {
    return await this.petService.updatePet(id, formData);
  }

  @ApiOperation({ summary: "删除宠物档案（软删，同步清行为标签关联）" })
  @Delete(":id")
  @Permissions(PetPermissions.PET_DELETE)
  @Audit({ entityType: AUDIT_ENTITY_PET, action: AuditAction.DELETE })
  async deletePet(@Param("id", ParseUUIDPipe) id: string) {
    await this.petService.softDeletePet(id);
    return { success: true };
  }
}
