import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsOptional, IsUUID } from "class-validator";

import { BaseQueryDto } from "../../common/dto/base-query.dto";
import { BLACKLIST_SCOPE_VALUES, type BlacklistScope } from "./create-blacklist.dto";

/**
 * 黑名单分页查询参数（P0-05-05 · FR-4）
 *
 * 筛选维度：scope（store/tenant）、storeId（精确）、status（1 生效 / 0 解除）；
 * 分页与排序沿用 `BaseQueryDto`（默认 createdAt desc）。
 */
export class QueryBlacklistDto extends BaseQueryDto {
  @ApiProperty({
    description: "范围：store 门店级 / tenant 租户级",
    required: false,
    enum: BLACKLIST_SCOPE_VALUES,
  })
  @IsOptional()
  @IsIn(BLACKLIST_SCOPE_VALUES as unknown as string[], {
    message: "黑名单范围仅允许 store / tenant",
  })
  scope?: BlacklistScope;

  @ApiProperty({ description: "门店 id（精确匹配）", required: false, format: "uuid" })
  @IsOptional()
  @IsUUID(undefined, { message: "门店 id 必须是合法 UUID" })
  storeId?: string;

  @ApiProperty({ description: "状态：1 生效 / 0 解除", required: false, enum: [0, 1] })
  @IsOptional()
  @Type(() => Number)
  @IsIn([0, 1], { message: "黑名单状态仅允许 1（生效）/ 0（解除）" })
  status?: number;
}
