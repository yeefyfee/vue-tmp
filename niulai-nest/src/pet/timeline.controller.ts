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
import { TimelineService } from "./timeline.service";
import { PetPermissions } from "./pet-permissions.constants";
import { QueryTimelineDto } from "./dto/query-timeline.dto";
import { CreateTimelineEventDto } from "./dto/create-timeline-event.dto";
import { ReviseTimelineEventDto } from "./dto/revise-timeline-event.dto";

/**
 * 宠物时间线接口（P0-06-06 统一事件模型 + P0-06-07 冲正纠错）
 *
 * 权限点：`pet:timeline:list / pet:timeline:create / pet:timeline:revise`
 * （PermissionGuard 校验；ROOT 角色直放——tenant_admin/admin 均为 ROOT）。
 *
 * 租户上下文：类级 `@RequireTenant()` + `TenantContextGuard`（成对使用）——
 * 无租户上下文（平台 admin 等）一律 403 + A0302，fail-closed。
 *
 * 路由：`pets/:petId/timeline` 下无静态段与 `:eventId` 参数段冲突
 * （eventId 为 BigInt 字符串，非 UUID，故不使用 ParseUUIDPipe）；读接口
 * GET "" 与 GET ":eventId" 语义独立。
 *
 * ⚠️ 审计 entityType 用字符串字面量 "timeline"（@peluvida/shared 的
 * AuditEntityType 由并行任务增量登记，禁改 shared 包除 timeline.ts/index.ts 外的文件）；
 * AuditLogService.record 接受 `AuditEntityType | string`，运行时落库值 "timeline"。
 */
const AUDIT_ENTITY_TIMELINE = "timeline" as AuditEntityType;

@ApiTags("14.宠物时间线")
@Controller("pets/:petId/timeline")
@UseGuards(TenantContextGuard)
@RequireTenant()
export class TimelineController {
  constructor(private readonly timelineService: TimelineService) {}

  @ApiOperation({
    summary: "时间线分页（eventType/eventName/refType/refId/visibleToOwner/时间闭区间）",
  })
  @Get()
  @Permissions(PetPermissions.PET_TIMELINE_LIST)
  async listTimeline(
    @Param("petId", ParseUUIDPipe) petId: string,
    @Query() query: QueryTimelineDto
  ) {
    return await this.timelineService.listTimeline(petId, query);
  }

  @ApiOperation({ summary: "手工补录事件（事件名 `模块.动作`；写入统一 SDK）" })
  @Post()
  @Permissions(PetPermissions.PET_TIMELINE_CREATE)
  @Audit({ entityType: AUDIT_ENTITY_TIMELINE, action: AuditAction.CREATE })
  async createManualEvent(
    @Param("petId", ParseUUIDPipe) petId: string,
    @Body() formData: CreateTimelineEventDto
  ) {
    return await this.timelineService.createManualEvent(petId, formData);
  }

  @ApiOperation({ summary: "事件详情（BigInt id 字符串化）" })
  @Get(":eventId")
  @Permissions(PetPermissions.PET_TIMELINE_LIST)
  async getEventDetail(
    @Param("petId", ParseUUIDPipe) petId: string,
    @Param("eventId") eventId: string
  ) {
    return await this.timelineService.getEventDetail(petId, eventId);
  }

  @ApiOperation({ summary: "冲正事件（追加式纠错，原事件保持不变）" })
  @Post(":eventId/revise")
  @Permissions(PetPermissions.PET_TIMELINE_REVISE)
  @Audit({ entityType: AUDIT_ENTITY_TIMELINE, action: AuditAction.UPDATE })
  async reviseEvent(
    @Param("petId", ParseUUIDPipe) petId: string,
    @Param("eventId") eventId: string,
    @Body() formData: ReviseTimelineEventDto
  ) {
    return await this.timelineService.reviseEvent(petId, eventId, formData);
  }
}
