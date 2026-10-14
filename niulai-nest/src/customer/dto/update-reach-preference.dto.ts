import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from "class-validator";

import { REACH_CHANNEL_VALUES } from "@peluvida/shared";

/** 免打扰时段参数（HH:mm，跨夜由 start>end 表达） */
export class CustomerReachDoNotDisturbDto {
  @ApiProperty({ description: "是否启用免打扰", required: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiProperty({ description: "起始时间 HH:mm（含）", required: false, example: "22:00" })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "免打扰起始时间格式须为 HH:mm" })
  start?: string;

  @ApiProperty({ description: "结束时间 HH:mm（不含）", required: false, example: "08:00" })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "免打扰结束时间格式须为 HH:mm" })
  end?: string;
}

/**
 * 设置客户触达偏好参数（P0-05-04 · FR-3）
 *
 * **PUT 整存整取语义**：请求即为目标偏好全量；未提供字段回落默认
 * （见 shared `DEFAULT_CUSTOMER_REACH_PREFERENCE`）。校验合法值域：渠道须在
 * `REACH_CHANNEL_VALUES` 内（`@IsIn each`），时段须为 HH:mm。
 */
export class UpdateReachPreferenceDto {
  @ApiProperty({
    description: "允许渠道白名单（null / 空数组 = 不设白名单，默认允许全部）",
    required: false,
    isArray: true,
    enum: REACH_CHANNEL_VALUES,
  })
  @IsOptional()
  @IsArray()
  @IsIn(REACH_CHANNEL_VALUES as unknown as number[], {
    each: true,
    message: "允许渠道取值不合法",
  })
  allowedChannels?: number[] | null;

  @ApiProperty({
    description: "明确拒绝渠道（优先级高于白名单）",
    required: false,
    isArray: true,
    enum: REACH_CHANNEL_VALUES,
  })
  @IsOptional()
  @IsArray()
  @IsIn(REACH_CHANNEL_VALUES as unknown as number[], {
    each: true,
    message: "拒绝渠道取值不合法",
  })
  blockedChannels?: number[];

  @ApiProperty({ description: "免打扰时段", required: false, type: CustomerReachDoNotDisturbDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CustomerReachDoNotDisturbDto)
  doNotDisturb?: CustomerReachDoNotDisturbDto;
}
