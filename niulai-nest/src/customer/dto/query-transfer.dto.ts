import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsOptional, IsString, IsUUID } from "class-validator";

import { BaseQueryDto } from "../../common/dto/base-query.dto";

/**
 * 宠物转移申请分页查询参数（P0-05-03 · FR-2）
 *
 * 筛选维度：status（精确，1 待审批 / 2 已通过 / 3 已拒绝 / 4 已撤销）/ petId（精确）；
 * 分页与排序沿用 `BaseQueryDto`（pageNum/pageSize/sortBy/order），
 * 排序字段白名单在 service 层收敛（sortBy 合法域：createdAt）。
 */
export class QueryTransferDto extends BaseQueryDto {
  @ApiProperty({
    description: "状态：1 待审批 / 2 已通过 / 3 已拒绝 / 4 已撤销",
    required: false,
    enum: [1, 2, 3, 4],
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2, 3, 4], { message: "状态仅允许 1（待审批）/ 2（已通过）/ 3（已拒绝）/ 4（已撤销）" })
  status?: number;

  @ApiProperty({ description: "宠物 id（精确匹配）", required: false, format: "uuid" })
  @IsOptional()
  @IsUUID(undefined, { message: "宠物 id 必须是合法 UUID" })
  petId?: string;

  @ApiProperty({ description: "创建时间起（含，ISO 8601）", required: false })
  @IsOptional()
  @IsString()
  createdAtStart?: string;

  @ApiProperty({ description: "创建时间止（含当天末尾，ISO 8601 或 yyyy-MM-dd）", required: false })
  @IsOptional()
  @IsString()
  createdAtEnd?: string;
}
