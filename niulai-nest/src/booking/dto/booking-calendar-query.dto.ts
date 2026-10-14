import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from "class-validator";

import { BOOKING_STATUS_VALUES } from "../booking.constants";

/**
 * 预约日历查询参数（MVP-WEB-06-03 预约日历）
 *
 * 与 `GET /bookings` 的**分页**列表刻意分成两个端点：
 *  - 列表页要分页 + 白名单排序 + 地址栏还原 ⇒ `QueryBookingDto`；
 *  - 日历（日 / 周 / 资源三视图）要「**整窗**」数据（一次渲染全部卡片，跨资源分组），
 *    分页会截断排期 ⇒ 独立端点，非分页，但以 `dateStart`~`dateEnd` 窗口 + 上限兜底。
 *
 * `storeId` / `dateStart` / `dateEnd` 为**必填**（日历恒针对「某门店的某段日期」；
 * 缺省「全部门店 + 全时间」既无业务意义也无性能边界）。
 * 筛选维度对齐《页面功能》预约日历「顶部提供日期导航、今日按钮、筛选（服务类型、
 * 员工、状态）」：`catType`（服务大类型）/ `employeeId`（员工）/ `status`（状态）。
 */
export class BookingCalendarQueryDto {
  @ApiProperty({ description: "门店 ID（uuid，必填）", format: "uuid" })
  @IsUUID("all", { message: "门店 ID 格式不正确" })
  storeId!: string;

  @ApiProperty({ description: "窗口起（yyyy-MM-dd，闭区间，必填）" })
  @IsString()
  @MaxLength(32, { message: "日期长度不得超过 32" })
  dateStart!: string;

  @ApiProperty({ description: "窗口止（yyyy-MM-dd，闭区间，必填）" })
  @IsString()
  @MaxLength(32, { message: "日期长度不得超过 32" })
  dateEnd!: string;

  @ApiProperty({ description: "指定员工 ID（uuid）", required: false, format: "uuid" })
  @IsOptional()
  @IsUUID("all", { message: "员工 ID 格式不正确" })
  employeeId?: string;

  @ApiProperty({
    description: "预约状态（值域见 @peluvida/shared BookingStatus）",
    required: false,
    enum: BOOKING_STATUS_VALUES,
  })
  @IsOptional()
  @IsString()
  @IsIn(BOOKING_STATUS_VALUES, { message: "预约状态不合法" })
  status?: string;

  @ApiProperty({
    description: "服务业务大类（1 洗护 / 2 美容 / 3 寄养 / 4 日托 …）",
    required: false,
  })
  @IsOptional()
  @IsInt({ message: "服务类型不合法" })
  @Min(1, { message: "服务类型不合法" })
  catType?: number;
}
