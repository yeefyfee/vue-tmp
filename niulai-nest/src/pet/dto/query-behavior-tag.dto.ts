import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsOptional, IsString, Length } from "class-validator";

import { BEHAVIOR_TAG_STATUS_VALUES } from "../behavior-tag.constants";
import { BaseQueryDto } from "../../common/dto/base-query.dto";

/**
 * 行为标签分页查询参数（P0-06-05 · FR-4）
 *
 * 筛选维度：name（模糊）+ status（精确，1 启用 / 0 停用）；分页与排序沿用
 * `BaseQueryDto`（pageNum/pageSize/sortBy/order），排序字段白名单在 service 层
 * 收敛（sortBy 合法域：createdAt/name/sort/status）。
 */
export class QueryBehaviorTagDto extends BaseQueryDto {
  @ApiProperty({ description: "标签名（模糊匹配）", required: false, maxLength: 32 })
  @IsOptional()
  @IsString()
  @Length(1, 32, { message: "标签名长度须在1~32个字符之间" })
  name?: string;

  @ApiProperty({
    description: "状态：1 启用 / 0 停用（精确匹配）",
    required: false,
    enum: BEHAVIOR_TAG_STATUS_VALUES,
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn(BEHAVIOR_TAG_STATUS_VALUES, { message: "状态仅允许 1（启用）/ 0（停用）" })
  status?: number;
}
