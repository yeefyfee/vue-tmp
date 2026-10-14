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

import { Permissions } from "../common/decorators/auth.decorator";
import { RequireTenant } from "../tenant/decorators/require-tenant.decorator";
import { TenantContextGuard } from "../tenant/guards/tenant-context.guard";
import { RoomService } from "./room.service";
import { CreateRoomDto } from "./dto/create-room.dto";
import { UpdateRoomDto } from "./dto/update-room.dto";
import { QueryRoomDto } from "./dto/query-room.dto";
import { UpdateRoomStatusDto } from "./dto/update-room-status.dto";

/**
 * 房间资源接口（P0-04-03 · FR-2）
 *
 * 权限点：`room:list / room:create / room:update / room:delete`
 * （PermissionGuard 校验；ROOT 角色直放——tenant_admin/admin 均为 ROOT，
 * 无需权限种子即可访问，非 ROOT 角色的授权走角色-权限配置）。
 *
 * 租户上下文：类级 `@RequireTenant()` + `TenantContextGuard`（成对使用）——
 * 无租户上下文（平台 admin 等）一律 403 + A0302，fail-closed。
 * 路由顺序：`GET /rooms/availability` 是静态段，必须声明在 `GET /rooms/:id`
 * 之前，否则会被 `:id` 参数路由吞掉（ParseUUIDPipe 报 400）。
 */
@ApiTags("12.房间资源")
@Controller("rooms")
@UseGuards(TenantContextGuard)
@RequireTenant()
export class RoomController {
  constructor(private readonly roomService: RoomService) {}

  @ApiOperation({ summary: "创建房间" })
  @Post()
  @Permissions("room:create")
  async createRoom(@Body() formData: CreateRoomDto) {
    return await this.roomService.createRoom(formData);
  }

  @ApiOperation({ summary: "房间分页列表（storeId/roomType/status/roomNo 前缀筛选）" })
  @Get()
  @Permissions("room:list")
  async getRoomPage(@Query() query: QueryRoomDto) {
    return await this.roomService.getRoomPage(query);
  }

  @ApiOperation({ summary: "房态看板数据源（按 status 分组统计 + 房间清单）" })
  @Get("availability")
  @Permissions("room:list")
  async getRoomAvailability(@Query("storeId", ParseUUIDPipe) storeId: string) {
    return await this.roomService.getRoomAvailability(storeId);
  }

  @ApiOperation({ summary: "房间详情" })
  @Get(":id")
  @Permissions("room:list")
  async getRoomDetail(@Param("id", ParseUUIDPipe) id: string) {
    return await this.roomService.getRoomDetail(id);
  }

  @ApiOperation({ summary: "更新房间（version 乐观锁；storeId 不可迁移、status 不走此口）" })
  @Put(":id")
  @Permissions("room:update")
  async updateRoom(@Param("id", ParseUUIDPipe) id: string, @Body() formData: UpdateRoomDto) {
    return await this.roomService.updateRoom(id, formData);
  }

  @ApiOperation({ summary: "删除房间（软删）" })
  @Delete(":id")
  @Permissions("room:delete")
  async deleteRoom(@Param("id", ParseUUIDPipe) id: string) {
    await this.roomService.softDeleteRoom(id);
    return { success: true };
  }

  @ApiOperation({ summary: "房态维护切换（仅空闲1↔维护4；1/2/3 由 stay 状态机流转）" })
  @Patch(":id/status")
  @Permissions("room:update")
  async switchRoomStatus(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() formData: UpdateRoomStatusDto
  ) {
    await this.roomService.switchRoomStatus(id, formData);
    return { success: true };
  }
}
