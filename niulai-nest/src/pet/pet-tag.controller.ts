import { Body, Controller, Param, ParseUUIDPipe, Put, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import { AuditEntityType, AuditAction } from "@peluvida/shared";
import { Audit } from "../common/audit/audit.decorator";
import { Permissions } from "../common/decorators/auth.decorator";
import { RequireTenant } from "../tenant/decorators/require-tenant.decorator";
import { TenantContextGuard } from "../tenant/guards/tenant-context.guard";
import { BehaviorTagService } from "./behavior-tag.service";
import { PetPermissions } from "./pet-permissions.constants";
import { ReplacePetTagsDto } from "./dto/replace-pet-tags.dto";

/**
 * 宠物行为标签接口（P0-06-05 · FR-4）
 *
 * 路由：`PUT /pets/:id/tags`（**全量替换**语义，与 P0-06-02 的
 * `UpdatePetDto.behaviorTagIds` 同范式，二选一中的「全量替换」方案）。
 *
 * ⚠️ 路由顺序（踩坑 37）：本控制器为两段路径 `:id/tags`，与 PetController 的
 * 单段 `:id` 不冲突（Express 按路径段精确匹配，`:id` 不会吞掉 `:id/tags`）；
 * 仍与 PetController 同挂 `pets` 前缀，Nest 允许多控制器共享前缀。
 *
 * 权限点：`pet:tag:assign`。租户上下文：类级 `@RequireTenant()` + TenantContextGuard。
 *
 * ⚠️ 审计 entityType 用字符串字面量 "pet"（标签替换本质是宠物档案的关联变更，
 * 归入 pet 实体留痕；@peluvida/shared 枚举由并行任务登记）。
 */
const AUDIT_ENTITY_PET = "pet" as AuditEntityType;

@ApiTags("12.宠物档案")
@Controller("pets")
@UseGuards(TenantContextGuard)
@RequireTenant()
export class PetTagController {
  constructor(private readonly behaviorTagService: BehaviorTagService) {}

  @ApiOperation({ summary: "宠物行为标签全量替换（空数组=清空；联动房间/任务钩子）" })
  @Put(":id/tags")
  @Permissions(PetPermissions.PET_TAG_ASSIGN)
  @Audit({ entityType: AUDIT_ENTITY_PET, action: AuditAction.UPDATE })
  async replacePetTags(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() formData: ReplacePetTagsDto
  ) {
    return await this.behaviorTagService.setPetTags(id, formData);
  }
}
