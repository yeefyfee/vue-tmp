import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsIn, IsOptional, IsString, Matches } from "class-validator";

import { TenantPlan } from "@peluvida/shared";
import { BaseQueryDto } from "../../common/dto/base-query.dto";

/**
 * 租户分页查询参数（P0-03-04 · 平台侧）
 *
 * 筛选维度：code（前缀匹配）/ name（模糊）/ status / plan；
 * 分页与排序沿用 `BaseQueryDto`（pageNum/pageSize/sortBy/order）。
 */
export class QueryTenantDto extends BaseQueryDto {
  @ApiProperty({ description: "租户编码（前缀匹配）", required: false, maxLength: 32 })
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]*$/, { message: "租户编码仅允许字母、数字、下划线、中划线" })
  code?: string;

  @ApiProperty({ description: "租户名称（模糊匹配）", required: false, maxLength: 64 })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ description: "状态：1 启用 / 0 停用", required: false, enum: [1, 0] })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === null || value === "" ? value : Number(value)
  )
  @IsIn([1, 0], { message: "状态仅允许 1（启用）或 0（停用）" })
  status?: number;

  @ApiProperty({
    description: "套餐标识（starter/professional/business）",
    required: false,
    enum: Object.values(TenantPlan),
  })
  @IsOptional()
  @IsIn(Object.values(TenantPlan) as string[], {
    message: "套餐仅允许 starter / professional / business",
  })
  plan?: string;
}
