import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import { Permissions } from "../common/decorators/auth.decorator";
import { RequireTenant } from "../tenant/decorators/require-tenant.decorator";
import { TenantContextGuard } from "../tenant/guards/tenant-context.guard";
import { BookingService } from "./booking.service";
import { BOOKING_ACTOR_SCOPE_HEADER } from "./booking.constants";
import { BookingPermissions } from "./booking-permissions.constants";
import { BookingCalendarQueryDto } from "./dto/booking-calendar-query.dto";
import { BookingReferenceQueryDto } from "./dto/booking-reference-query.dto";
import { BookingTransitionDto } from "./dto/booking-transition.dto";
import { CancelBookingDto } from "./dto/cancel-booking.dto";
import { CapacityCheckDto } from "./dto/capacity-check.dto";
import { ConflictCheckDto } from "./dto/conflict-check.dto";
import { CreateBookingDto } from "./dto/create-booking.dto";
import { QueryBookingDto } from "./dto/query-booking.dto";
import { RescheduleBookingDto } from "./dto/reschedule-booking.dto";

/**
 * 预约接口（P0-08-05）
 *  - MVP-WEB-06-01 预约列表与状态展示：`GET /bookings` + `GET /bookings/:id`
 *  - MVP-WEB-06-02 预约创建表单：`POST /bookings` + 两个参考数据端点
 *  - MVP-WEB-06-03 预约日历：`GET /bookings/calendar` + `POST /bookings/calendar/conflict-check`
 *  - MVP-WEB-06-04 容量校验：`POST /bookings/capacity-check`
 *  - MVP-WEB-06-05 状态流转：`POST /bookings/:id/{confirm,checkin,start,complete,reschedule,cancel,no-show}`
 *
 * 权限点：
 *  - `booking:list`   列表与详情共用（PRD「全部内部角色」可读）；
 *                     **日历读端点与冲突检测端点亦复用本码** —— 冲突检测是**只读**查询
 *                     （返回候选时段的重叠事实，不写库），语义落在「能看预约的人可以问
 *                     某时段是否可用」，故不另立权限码。
 *  - `booking:create` 创建 + 创建表单参考数据（员工 / 服务项下拉）；
 *                     **容量预校验亦复用本码** —— 它是创建流程的**前置校验**。
 *  - `booking:confirm` / `booking:checkin` / `booking:start` / `booking:complete` /
 *    `booking:reschedule` / `booking:cancel` / `booking:no-show`
 *                     MVP-WEB-06-05 七个状态流转动作**各立一码**：PRD《Booking API》端点清单
 *                     对每个动作单独标注了可见角色（如 `start` 含美容师、`no-show` 不含），
 *                     合成一个 `booking:transition` 会让「美容师能开始服务但不能确认预约」
 *                     这类区分无法表达（PRD《页面功能》验收要点明确要求「操作按钮随状态机
 *                     渲染，非法状态下按钮不出现」）。
 *
 * 租户上下文：类级 `@RequireTenant()` + `TenantContextGuard`（成对使用）——
 * 无租户上下文（平台 admin 等）一律 403 + A0302，fail-closed。
 *
 * 🔴 路由顺序（踩坑 37）：静态段（`calendar`、`calendar/conflict-check`、
 * `capacity-check`、`reference/staffs`、`reference/service-items`）必须声明在参数路由
 * `:id` **之前**，否则会被 `:id` 吞掉（ParseUUIDPipe → 400）。06-05 的流转端点是
 * `POST :id/<action>`（多一段 + 方法不同），不受此约束。
 *
 * 未落：无（06-05 已收口预约域全部端点）。
 */
@ApiTags("13.预约")
@Controller("bookings")
@UseGuards(TenantContextGuard)
@RequireTenant()
export class BookingController {
  constructor(private readonly bookingService: BookingService) {}

  @ApiOperation({
    summary: "预约分页列表（storeId/status/petId/customerId/employeeId/bookingNo/日期区间筛选）",
  })
  @Get()
  @Permissions(BookingPermissions.BOOKING_LIST)
  async getBookingPage(@Query() query: QueryBookingDto) {
    return await this.bookingService.getBookingPage(query);
  }

  @ApiOperation({ summary: "创建表单 · 员工下拉（可选按门店收窄）" })
  @Get("reference/staffs")
  @Permissions(BookingPermissions.BOOKING_CREATE)
  async getReferenceStaffs(@Query() query: BookingReferenceQueryDto) {
    return await this.bookingService.listReferenceStaffs(query.storeId);
  }

  @ApiOperation({ summary: "创建表单 · 服务项下拉（类目树叶子，可选按业务大类收窄）" })
  @Get("reference/service-items")
  @Permissions(BookingPermissions.BOOKING_CREATE)
  async getReferenceServiceItems(@Query() query: BookingReferenceQueryDto) {
    return await this.bookingService.listReferenceServiceItems(query.catType);
  }

  @ApiOperation({ summary: "创建预约（初始状态 pending）" })
  @Post()
  @Permissions(BookingPermissions.BOOKING_CREATE)
  async createBooking(@Body() dto: CreateBookingDto) {
    return await this.bookingService.createBooking(dto);
  }

  @ApiOperation({
    summary:
      "预约日历（非分页；门店 + 日期窗口闭区间，窗口上限 31 天；可按员工/状态/服务类型筛选）",
  })
  @Get("calendar")
  @Permissions(BookingPermissions.BOOKING_LIST)
  async getCalendar(@Query() query: BookingCalendarQueryDto) {
    return await this.bookingService.getCalendar(query);
  }

  @ApiOperation({
    summary:
      "冲突检测（只读；同一宠物时段重复 / 同一资源超载；改期场景以 excludeBookingId 排除自身）",
  })
  @Post("calendar/conflict-check")
  @Permissions(BookingPermissions.BOOKING_LIST)
  async checkConflict(@Body() dto: ConflictCheckDto) {
    return await this.bookingService.checkConflict(dto);
  }

  @ApiOperation({
    summary:
      "容量预校验（只读；请求体与创建一致；返回 available / conflicts（房间·员工·宠物）/ suggestions 可替代时段）",
  })
  @Post("capacity-check")
  @Permissions(BookingPermissions.BOOKING_CREATE)
  async checkCapacity(@Body() dto: CapacityCheckDto) {
    return await this.bookingService.checkCapacity(dto);
  }

  @ApiOperation({ summary: "预约详情" })
  @Get(":id")
  @Permissions(BookingPermissions.BOOKING_LIST)
  async getBookingDetail(@Param("id", ParseUUIDPipe) id: string) {
    return await this.bookingService.getBookingDetail(id);
  }

  /* ─── MVP-WEB-06-05 状态流转（7 个动作）───
   * 均为 `POST /bookings/:id/<action>`，比 `GET :id` 多一段且方法不同 ⇒ 不存在被
   * `:id` 吞掉的顺序问题（与 06-04 的静态段不同）；仍集中放在详情之后，让「读端点」
   * 与「写端点」各自成块。
   */

  @ApiOperation({ summary: "确认预约（pending → confirmed；容量二次校验，冲突 30001）" })
  @Post(":id/confirm")
  @Permissions(BookingPermissions.BOOKING_CONFIRM)
  async confirmBooking(@Param("id", ParseUUIDPipe) id: string, @Body() dto: BookingTransitionDto) {
    return await this.bookingService.confirmBooking(id, dto);
  }

  @ApiOperation({ summary: "到店登记（confirmed → in_service）" })
  @Post(":id/checkin")
  @Permissions(BookingPermissions.BOOKING_CHECKIN)
  async checkInBooking(@Param("id", ParseUUIDPipe) id: string, @Body() dto: BookingTransitionDto) {
    return await this.bookingService.checkInBooking(id, dto);
  }

  @ApiOperation({ summary: "开始服务（confirmed → in_service；无需到店登记的直通路径）" })
  @Post(":id/start")
  @Permissions(BookingPermissions.BOOKING_START)
  async startBooking(@Param("id", ParseUUIDPipe) id: string, @Body() dto: BookingTransitionDto) {
    return await this.bookingService.startBooking(id, dto);
  }

  @ApiOperation({ summary: "完成服务（in_service → completed）" })
  @Post(":id/complete")
  @Permissions(BookingPermissions.BOOKING_COMPLETE)
  async completeBooking(@Param("id", ParseUUIDPipe) id: string, @Body() dto: BookingTransitionDto) {
    return await this.bookingService.completeBooking(id, dto);
  }

  @ApiOperation({
    summary: "改期（新时段容量校验 → 原单置 rescheduled + 新单互链；累计超限需店长 30003）",
  })
  @Post(":id/reschedule")
  @Permissions(BookingPermissions.BOOKING_RESCHEDULE)
  async rescheduleBooking(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RescheduleBookingDto
  ) {
    return await this.bookingService.rescheduleBooking(id, dto);
  }

  @ApiOperation({
    summary: "取消预约（服务未开始；回 feeRule 计费规则；宠主端受 2 小时窗口限制 30004）",
  })
  @Post(":id/cancel")
  @Permissions(BookingPermissions.BOOKING_CANCEL)
  async cancelBooking(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CancelBookingDto,
    @Headers(BOOKING_ACTOR_SCOPE_HEADER) actorScope?: string
  ) {
    return await this.bookingService.cancelBooking(id, dto, actorScope ?? null);
  }

  @ApiOperation({ summary: "标记爽约（pending / confirmed → no_show）" })
  @Post(":id/no-show")
  @Permissions(BookingPermissions.BOOKING_NO_SHOW)
  async noShowBooking(@Param("id", ParseUUIDPipe) id: string, @Body() dto: BookingTransitionDto) {
    return await this.bookingService.noShowBooking(id, dto);
  }
}
