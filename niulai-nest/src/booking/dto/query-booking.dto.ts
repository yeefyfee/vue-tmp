import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

import { BaseQueryDto } from "../../common/dto/base-query.dto";
import { BOOKING_STATUS_VALUES } from "../booking.constants";

/**
 * 预约分页查询参数（P0-08-05；MVP-WEB-06-01 预约列表与状态展示）
 *
 * 筛选维度：storeId / status / petId / customerId / employeeId / bookingNo（前缀）
 *          / 预约日期区间（bookingDateStart ~ bookingDateEnd，闭区间，按应用时区解析）。
 * 分页与排序沿用 `BaseQueryDto`（pageNum/pageSize/sortBy/order），
 * 排序白名单见 `booking.constants.ts`（非法值回落默认 bookingDate）。
 *
 * ⚠️ `bookingNo` 刻意**只有 `@MaxLength`、无最小长度**：空串在业务上等价「不过滤」，
 *    若写成 `@Length(1, 32)` 会让前端清空搜索框后发出 `bookingNo=`（空串）直接
 *    触发 A0400 真 400（踩坑 129-④）；前端另有「空串归一为 undefined」的兜底。
 */
export class QueryBookingDto extends BaseQueryDto {
  @ApiProperty({ description: "门店 ID（uuid）", required: false, format: "uuid" })
  @IsOptional()
  @IsUUID("all", { message: "门店 ID 格式不正确" })
  storeId?: string;

  @ApiProperty({
    description: "预约状态（值域见 @peluvida/shared BookingStatus）",
    required: false,
    enum: BOOKING_STATUS_VALUES,
  })
  @IsOptional()
  @IsString()
  @IsIn(BOOKING_STATUS_VALUES, { message: "预约状态不合法" })
  status?: string;

  @ApiProperty({ description: "宠物 ID（uuid）", required: false, format: "uuid" })
  @IsOptional()
  @IsUUID("all", { message: "宠物 ID 格式不正确" })
  petId?: string;

  @ApiProperty({ description: "客户（宠主）ID（uuid）", required: false, format: "uuid" })
  @IsOptional()
  @IsUUID("all", { message: "客户 ID 格式不正确" })
  customerId?: string;

  @ApiProperty({ description: "指定员工 ID（uuid）", required: false, format: "uuid" })
  @IsOptional()
  @IsUUID("all", { message: "员工 ID 格式不正确" })
  employeeId?: string;

  @ApiProperty({ description: "预约单号（前缀匹配）", required: false, maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32, { message: "预约单号长度不得超过 32" })
  bookingNo?: string;

  @ApiProperty({ description: "预约日期起（YYYY-MM-DD，闭区间）", required: false })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  bookingDateStart?: string;

  @ApiProperty({ description: "预约日期止（YYYY-MM-DD，闭区间）", required: false })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  bookingDateEnd?: string;
}
