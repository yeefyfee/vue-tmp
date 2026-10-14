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
import { BusinessHoursService } from "./business-hours.service";
import { StoreCalendarService } from "./store-calendar.service";
import { StoreCalendarViewService } from "./store-calendar-view.service";
import { SaveBusinessHoursDto } from "./dto/save-business-hours.dto";
import { CreateCalendarEntryDto } from "./dto/create-calendar-entry.dto";
import { QueryCalendarDto } from "./dto/query-calendar.dto";

/**
 * 门店营业时间接口（P0-04-04 · FR-3：每周时段 + 日期级例外日历）
 *
 * 权限点：复用门店档案的 `store:list / store:update`（营业时间与日历属门店
 * 运营配置域，不新增权限种子；非 ROOT 角色授权走角色-权限配置）。
 *
 * 租户上下文：类级 `@RequireTenant()` + `TenantContextGuard`（成对使用）——
 * 无租户上下文（平台 admin 等）一律 403 + A0302，fail-closed。
 *
 * 路由挂载：`/stores/:id/business-hours` 与 `/stores/:id/calendar` 均为
 * 3 段路径，与 StoreController 的 `/stores/:id`（2 段）无静态段冲突，
 * Express 路由按段数天然区分。
 */
@ApiTags("11.门店营业时间")
@Controller("stores")
@UseGuards(TenantContextGuard)
@RequireTenant()
export class BusinessHoursController {
  constructor(
    private readonly businessHoursService: BusinessHoursService,
    private readonly storeCalendarService: StoreCalendarService,
    private readonly storeCalendarViewService: StoreCalendarViewService
  ) {}

  // ───────────── 每周营业时段（store.business_hours 整存整取） ─────────────

  @ApiOperation({ summary: "查询每周营业时段（7 天键齐全模板；无配置返回空模板）" })
  @Get(":id/business-hours")
  @Permissions("store:list")
  async getBusinessHours(@Param("id", ParseUUIDPipe) id: string) {
    return await this.businessHoursService.getBusinessHours(id);
  }

  @ApiOperation({
    summary: "整存整取每周营业时段（7 天键 / HH:mm / close>open / 每天≤3 段；version 乐观锁）",
  })
  @Put(":id/business-hours")
  @Permissions("store:update")
  @Audit({ entityType: AuditEntityType.STORE, action: AuditAction.UPDATE })
  async saveBusinessHours(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() formData: SaveBusinessHoursDto
  ) {
    return await this.businessHoursService.saveBusinessHours(id, formData);
  }

  // ───────────── 日期级例外日历（store_calendar） ─────────────

  @ApiOperation({
    summary: "新建日历例外日（1 节假日闭店 / 2 临时闭店 / 3 特殊营业；同日同店唯一）",
  })
  @Post(":id/calendar")
  @Permissions("store:update")
  @Audit({ entityType: AuditEntityType.STORE_CALENDAR, action: AuditAction.CREATE })
  async createCalendarEntry(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() formData: CreateCalendarEntryDto
  ) {
    return await this.storeCalendarService.createCalendarEntry(id, formData);
  }

  @ApiOperation({ summary: "按月列出日历例外日（month=yyyy-MM，date 升序）" })
  @Get(":id/calendar")
  @Permissions("store:list")
  async listCalendarEntries(
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: QueryCalendarDto
  ) {
    return await this.storeCalendarService.listCalendarEntries(id, query.month);
  }

  @ApiOperation({ summary: "删除日历例外日（软删）" })
  @Delete(":id/calendar/:entryId")
  @Permissions("store:update")
  @Audit({ entityType: AuditEntityType.STORE_CALENDAR, action: AuditAction.DELETE })
  async deleteCalendarEntry(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("entryId", ParseUUIDPipe) entryId: string
  ) {
    await this.storeCalendarService.deleteCalendarEntry(id, entryId);
    return { success: true };
  }

  // ───────────── 整月逐日营业视图（P0-04-07 · FR-6 聚合） ─────────────

  @ApiOperation({
    summary: "整月逐日营业视图（周时段 + 日历例外聚合；例外日优先，type1/2 闭店、type3 特殊时段）",
  })
  @Get(":id/calendar-view")
  @Permissions("store:list")
  async getCalendarView(@Param("id", ParseUUIDPipe) id: string, @Query() query: QueryCalendarDto) {
    return await this.storeCalendarViewService.getCalendarView(id, query.month);
  }
}
