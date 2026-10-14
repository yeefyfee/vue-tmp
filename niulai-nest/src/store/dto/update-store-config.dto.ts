import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from "class-validator";

/**
 * 门店配置部分更新参数（P0-04-05 · FR-4）
 *
 * 全字段可选（浅 merge 到现有 config 上）；`version` 除外 —— **乐观锁必填**：
 * 与库内 store.version 不一致时抛 `STORE_VERSION_CONFLICT`（A0423）。
 * 各字段范围/格式在此声明式校验（ValidationPipe 白名单剥离未知键），
 * service 层对「合并后的完整配置」再跑一遍 shared 单键校验兜底（非法抛 A0437）。
 *
 * ⚠️ 与门店档案 DTO 同口径：不声明 tenantId 字段，归属恒由 JWT 上下文注入。
 */
export class UpdateStoreConfigDto {
  @ApiProperty({ description: "乐观锁版本号（取自 GET config 返回的 version）", required: true })
  @IsNotEmpty({ message: "版本号不能为空" })
  @Type(() => Number)
  @IsInt({ message: "版本号必须是整数" })
  @Min(0, { message: "版本号不能为负数" })
  version: number;

  @ApiProperty({
    description: "预约时段粒度（分钟）：15 / 30 / 60",
    required: false,
    enum: [15, 30, 60],
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: "预约时段粒度必须是整数" })
  @IsIn([15, 30, 60], { message: "预约时段粒度仅允许 15 / 30 / 60 分钟" })
  slotGranularityMin?: number;

  @ApiProperty({ description: "预约提前量（小时）：0~720", required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: "预约提前量必须是整数" })
  @Min(0, { message: "预约提前量不能小于 0 小时" })
  @Max(720, { message: "预约提前量不能大于 720 小时" })
  bookingLeadHours?: number;

  @ApiProperty({ description: "取消截止（小时）：0~168", required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: "取消截止必须是整数" })
  @Min(0, { message: "取消截止不能小于 0 小时" })
  @Max(168, { message: "取消截止不能大于 168 小时" })
  cancelCutoffHours?: number;

  @ApiProperty({ description: "寄养入住时间（HH:mm）", required: false })
  @IsOptional()
  @IsString({ message: "寄养入住时间必须是字符串" })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "寄养入住时间格式必须为 HH:mm" })
  boardingCheckinTime?: string;

  @ApiProperty({ description: "寄养退房时间（HH:mm）", required: false })
  @IsOptional()
  @IsString({ message: "寄养退房时间必须是字符串" })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "寄养退房时间格式必须为 HH:mm" })
  boardingCheckoutTime?: string;

  @ApiProperty({ description: "推送开关", required: false })
  @IsOptional()
  @IsBoolean({ message: "推送开关必须是布尔值" })
  pushEnabled?: boolean;
}
