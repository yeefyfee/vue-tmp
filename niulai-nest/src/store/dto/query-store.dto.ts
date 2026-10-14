import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsIn, IsOptional, IsString, Matches } from "class-validator";

import { BaseQueryDto } from "../../common/dto/base-query.dto";

/**
 * 门店档案分页查询参数（P0-04-02）
 *
 * 筛选维度：code（精确+前缀）/ name（模糊）/ status / createdAt 区间；
 * 分页与排序沿用 `BaseQueryDto`（pageNum/pageSize/sortBy/order）。
 */
export class QueryStoreDto extends BaseQueryDto {
  @ApiProperty({ description: "门店编码（前缀匹配）", required: false, maxLength: 32 })
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]*$/, { message: "门店编码仅允许字母、数字、下划线、中划线" })
  code?: string;

  @ApiProperty({ description: "门店名称（模糊匹配）", required: false, maxLength: 64 })
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

  @ApiProperty({ description: "创建时间起（含，ISO 8601）", required: false })
  @IsOptional()
  @IsString()
  createdAtStart?: string;

  @ApiProperty({ description: "创建时间止（含当天末尾，ISO 8601 或 yyyy-MM-dd）", required: false })
  @IsOptional()
  @IsString()
  createdAtEnd?: string;
}
