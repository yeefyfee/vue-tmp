import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsInt, IsOptional, IsString, Length, Matches } from "class-validator";

/**
 * 门店日历例外日创建参数（P0-04-04 · FR-3）
 *
 * type=1/2（节假日/临时闭店）：openTime/closeTime 刻意置 NULL（全天闭店）；
 * type=3（特殊营业）：openTime/closeTime 必填且 close > open —— 该条件依赖
 * type 分支，由 service 层校验（非法抛 A0400）。
 *
 * ⚠️ 与门店档案 DTO 同口径：不声明 tenantId/storeId 归属字段，storeId 来自
 * 路由参数并经租户归属校验，tenantId 恒由 JWT 上下文注入。
 */
export class CreateCalendarEntryDto {
  @ApiProperty({ description: "例外日期（yyyy-MM-dd）", required: true })
  @IsString({ message: "日期必须是字符串" })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "日期格式必须为 yyyy-MM-dd" })
  date: string;

  @ApiProperty({
    description: "类型：1 节假日闭店 / 2 临时闭店 / 3 特殊营业",
    required: true,
    enum: [1, 2, 3],
  })
  @IsInt({ message: "类型必须是整数" })
  @IsIn([1, 2, 3], { message: "类型仅允许 1（节假日闭店）/ 2（临时闭店）/ 3（特殊营业）" })
  type: number;

  @ApiProperty({ description: "特殊营业开始时间 HH:mm（仅 type=3 必填）", required: false })
  @IsOptional()
  @IsString({ message: "开始时间必须是字符串" })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "开始时间格式必须为 HH:mm" })
  openTime?: string;

  @ApiProperty({ description: "特殊营业结束时间 HH:mm（仅 type=3 必填）", required: false })
  @IsOptional()
  @IsString({ message: "结束时间必须是字符串" })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "结束时间格式必须为 HH:mm" })
  closeTime?: string;

  @ApiProperty({
    description: "备注（如「春节假期」「设备检修」）",
    required: false,
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @Length(0, 255, { message: "备注长度不能超过 255 个字符" })
  remark?: string;
}
