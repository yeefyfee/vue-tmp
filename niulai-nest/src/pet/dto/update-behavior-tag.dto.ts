import { ApiProperty } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Length, Min } from "class-validator";

import { BEHAVIOR_TAG_STATUS_VALUES } from "../behavior-tag.constants";

/**
 * 行为标签更新参数（P0-06-05 · FR-4）
 *
 * 全字段可选（部分更新）；`version` 除外 —— **乐观锁必填**：与库内 `version`
 * 不一致时抛 `BehaviorTagError.VERSION_CONFLICT`（A0612），防并发互相覆盖。
 *
 * ⚠️ 与 CreateBehaviorTagDto 同口径：不声明 tenantId 字段，伪造参数被白名单剥离。
 */
export class UpdateBehaviorTagDto {
  @ApiProperty({ description: "乐观锁版本号（创建时为 0，每次更新 +1）", required: true })
  @IsNotEmpty({ message: "版本号不能为空" })
  @Type(() => Number)
  @IsInt({ message: "版本号必须是整数" })
  @Min(0, { message: "版本号不能为负数" })
  version: number;

  @ApiProperty({ description: "标签名（租户内唯一）", required: false, maxLength: 32 })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @Length(1, 32, { message: "标签名长度须在1~32个字符之间" })
  name?: string;

  @ApiProperty({ description: "展示排序（小在前）", required: false, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: "排序必须是整数" })
  @Min(0, { message: "排序不能为负数" })
  sort?: number;

  @ApiProperty({
    description: "状态：1 启用 / 0 停用",
    required: false,
    enum: BEHAVIOR_TAG_STATUS_VALUES,
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn(BEHAVIOR_TAG_STATUS_VALUES, { message: "状态仅允许 1（启用）/ 0（停用）" })
  status?: number;
}
