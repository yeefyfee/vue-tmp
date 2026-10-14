import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsOptional, IsString } from "class-validator";

import { REACH_CHANNEL_VALUES, REACH_RESULT_VALUES } from "@peluvida/shared";

import { BaseQueryDto } from "../../common/dto/base-query.dto";

/**
 * 触达日志分页查询参数（P0-05-04 · FR-3）
 *
 * 筛选维度：channel（精确）/ result（精确）/ reachedAt 时间**闭区间**；
 * 分页与排序沿用 `BaseQueryDto`（pageNum/pageSize/sortBy/order），排序字段白名单
 * 在 service 层收敛（sortBy 合法域：reachedAt/createdAt）。
 */
export class QueryReachLogDto extends BaseQueryDto {
  @ApiProperty({
    description: "触达渠道：1 站内信 / 2 服务号 / 3 订阅消息 / 4 短信",
    required: false,
    enum: REACH_CHANNEL_VALUES,
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn(REACH_CHANNEL_VALUES as unknown as number[], { message: "触达渠道取值不合法" })
  channel?: number;

  @ApiProperty({
    description: "触达结果：1 成功 / 2 失败",
    required: false,
    enum: REACH_RESULT_VALUES,
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn(REACH_RESULT_VALUES as unknown as number[], { message: "触达结果取值不合法" })
  result?: number;

  @ApiProperty({ description: "触达时间起（含，yyyy-MM-dd 或 ISO 8601）", required: false })
  @IsOptional()
  @IsString()
  reachedAtStart?: string;

  @ApiProperty({ description: "触达时间止（含当天末尾，yyyy-MM-dd 或 ISO 8601）", required: false })
  @IsOptional()
  @IsString()
  reachedAtEnd?: string;
}
