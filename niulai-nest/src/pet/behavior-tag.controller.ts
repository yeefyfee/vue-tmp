import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { BehaviorTagService } from "./behavior-tag.service";
import { PetPermissions } from "./pet-permissions.constants";
import { CreateBehaviorTagDto } from "./dto/create-behavior-tag.dto";
import { UpdateBehaviorTagDto } from "./dto/update-behavior-tag.dto";
import { QueryBehaviorTagDto } from "./dto/query-behavior-tag.dto";

/**
 * 行为标签库接口（P0-06-05 · FR-4）
 *
 * 权限点：`pet:tag:list / pet:tag:create / pet:tag:update / pet:tag:delete`
 * （PermissionGuard 校验；ROOT 角色直放——tenant_admin/admin 均为 ROOT，
 * 无需权限种子即可访问，非 ROOT 角色的授权走角色-权限配置）。
 *
 * 租户上下文：类级 `@RequireTenant()` + `TenantContextGuard`（成对使用）——
 * 无租户上下文（平台 admin 等）一律 403 + A0302，fail-closed。
 *
 * ⚠️ 审计 entityType 用字符串字面量 "behavior_tag"：@peluvida/shared 的
 * AuditEntityType 由并行任务增量登记（禁改 shared 包，见文件域隔离约定），
 * 此处仅做类型断言满足装饰器签名；运行时落库值 "behavior_tag" 与后续枚举登记对齐。
 */
const AUDIT_ENTITY_BEHAVIOR_TAG = "behavior_tag" as AuditEntityType;

@ApiTags("15.行为标签")
@Controller("behavior-tags")
@UseGuards(TenantContextGuard)
@RequireTenant()
export class BehaviorTagController {
  constructor(private readonly behaviorTagService: BehaviorTagService) {}

  @ApiOperation({ summary: "创建行为标签（租户级；同名存活标签 A0610，软删同名复活）" })
  @Post()
  @Permissions(PetPermissions.PET_TAG_CREATE)
  @Audit({ entityType: AUDIT_ENTITY_BEHAVIOR_TAG, action: AuditAction.CREATE })
  async createBehaviorTag(@Body() formData: CreateBehaviorTagDto) {
    return await this.behaviorTagService.createBehaviorTag(formData);
  }

  @ApiOperation({ summary: "行为标签分页列表（name 模糊 + status 启用/停用筛选）" })
  @Get()
  @Permissions(PetPermissions.PET_TAG_LIST)
  async getBehaviorTagPage(@Query() query: QueryBehaviorTagDto) {
    return await this.behaviorTagService.getBehaviorTagPage(query);
  }

  @ApiOperation({ summary: "更新行为标签（version 乐观锁；改名查重 A0610）" })
  @Patch(":id")
  @Permissions(PetPermissions.PET_TAG_UPDATE)
  @Audit({ entityType: AUDIT_ENTITY_BEHAVIOR_TAG, action: AuditAction.UPDATE })
  async updateBehaviorTag(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() formData: UpdateBehaviorTagDto
  ) {
    return await this.behaviorTagService.updateBehaviorTag(id, formData);
  }

  @ApiOperation({ summary: "删除行为标签（软删，同步清除宠物关联并重算完整度）" })
  @Delete(":id")
  @Permissions(PetPermissions.PET_TAG_DELETE)
  @Audit({ entityType: AUDIT_ENTITY_BEHAVIOR_TAG, action: AuditAction.DELETE })
  async deleteBehaviorTag(@Param("id", ParseUUIDPipe) id: string) {
    await this.behaviorTagService.softDeleteBehaviorTag(id);
    return { success: true };
  }
}
