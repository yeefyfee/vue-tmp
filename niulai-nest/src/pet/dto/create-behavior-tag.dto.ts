import { ApiProperty } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Length, Min } from "class-validator";

import { BEHAVIOR_TAG_STATUS_VALUES } from "../behavior-tag.constants";

/**
 * 行为标签创建参数（P0-06-05 · FR-4）
 *
 * 属性集对齐 schema `behavior_tag` 现有列：name / sort / status
 * （⚠️ 无 color 列 —— 任务书「属性建议」含 color，但库表未建该列且本轮无迁移
 * 权限，故不引入；如需配色展示，须由后续迁移增列，见报告遗留项）。
 *
 * ⚠️ 安全边界（对齐 CreatePetDto）：**不声明 tenantId 字段**，租户归属恒由
 * JWT 上下文注入（租户扩展层恒定覆盖；DTO 白名单剥离伪造的 tenant_id）。
 */
export class CreateBehaviorTagDto {
  @ApiProperty({ description: "标签名（租户内唯一）", maxLength: 32 })
  @IsNotEmpty({ message: "标签名不能为空" })
  @IsString()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @Length(1, 32, { message: "标签名长度须在1~32个字符之间" })
  name: string;

  @ApiProperty({
    description: "展示排序（小在前，缺省 0）",
    required: false,
    minimum: 0,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: "排序必须是整数" })
  @Min(0, { message: "排序不能为负数" })
  sort?: number;

  @ApiProperty({
    description: "状态：1 启用 / 0 停用（缺省 1）",
    required: false,
    enum: BEHAVIOR_TAG_STATUS_VALUES,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn(BEHAVIOR_TAG_STATUS_VALUES, { message: "状态仅允许 1（启用）/ 0（停用）" })
  status?: number;
}
