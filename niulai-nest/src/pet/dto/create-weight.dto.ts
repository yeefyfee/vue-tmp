import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, Matches } from "class-validator";

import { DATE_ONLY_PATTERN, WEIGHT_KG_PATTERN } from "../pet-health.constants";

/**
 * 体重记录参数（P0-06-04 · FR-3）
 *
 * ⚠️ 与 CreatePetDto 同口径：不声明 tenantId，租户归属只来自 JWT 上下文。
 */
export class CreateWeightDto {
  @ApiProperty({ description: "称重日期（yyyy-MM-dd）" })
  @IsNotEmpty({ message: "称重日期不能为空" })
  @IsString()
  @Matches(DATE_ONLY_PATTERN, { message: "称重日期格式须为 yyyy-MM-dd" })
  weighedAt: string;

  @ApiProperty({ description: "体重 kg（0.01~999.99，两位小数）" })
  @IsNotEmpty({ message: "体重不能为空" })
  @IsString()
  @Matches(WEIGHT_KG_PATTERN, { message: "体重须为 0~999.99 的数值（最多两位小数）" })
  weightKg: string;
}
