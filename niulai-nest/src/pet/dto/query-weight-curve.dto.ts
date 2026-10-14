import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from "class-validator";

import {
  DATE_ONLY_PATTERN,
  WEIGHT_CURVE_DEFAULT_LIMIT,
  WEIGHT_CURVE_MAX_LIMIT,
} from "../pet-health.constants";

/**
 * 体重曲线查询参数（P0-06-04 · FR-3）
 *
 * - `from` / `to`：按称重日区间过滤（闭区间，含端点）；
 * - `order`：排序方向，默认 `asc`（时间序列曲线口径），支持 `desc`；
 * - `limit`：返回条数上限（默认 100，最大 500）。
 */
export class QueryWeightCurveDto {
  @ApiProperty({ description: "称重日起（含，yyyy-MM-dd）", required: false })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY_PATTERN, { message: "称重日起格式须为 yyyy-MM-dd" })
  from?: string;

  @ApiProperty({ description: "称重日止（含，yyyy-MM-dd）", required: false })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY_PATTERN, { message: "称重日止格式须为 yyyy-MM-dd" })
  to?: string;

  @ApiProperty({
    description: "排序方向（asc=时间升序，默认；desc=时间降序）",
    required: false,
    enum: ["asc", "desc", "ASC", "DESC"],
    default: "asc",
  })
  @IsOptional()
  @IsString()
  @IsIn(["asc", "desc", "ASC", "DESC"], { message: "排序方向仅允许 asc / desc" })
  order?: string;

  @ApiProperty({
    description: `返回条数上限（默认 ${WEIGHT_CURVE_DEFAULT_LIMIT}，最大 ${WEIGHT_CURVE_MAX_LIMIT}）`,
    required: false,
    minimum: 1,
    maximum: WEIGHT_CURVE_MAX_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: "limit 必须是整数" })
  @Min(1, { message: "limit 最小为 1" })
  @Max(WEIGHT_CURVE_MAX_LIMIT, { message: `limit 最大为 ${WEIGHT_CURVE_MAX_LIMIT}` })
  limit?: number;
}
