import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsOptional, IsString, Matches } from "class-validator";

import { BaseQueryDto } from "../../common/dto/base-query.dto";
import { DATE_ONLY_PATTERN, HEALTH_RECORD_TYPE_VALUES } from "../pet-health.constants";

/**
 * 健康档案列表查询参数（P0-06-03 · FR-2）
 *
 * 筛选维度：recordType（精确）+ recordDate 区间（from/to）+ expireDate 区间
 * （expireFrom/expireTo）；分页与排序沿用 `BaseQueryDto`。排序字段在 service 内
 * 收敛为「recordDate + createdAt」（时间倒序为默认），不接受任意字段透传。
 */
export class QueryHealthRecordDto extends BaseQueryDto {
  @ApiProperty({
    description: "记录类型：1疫苗 2驱虫 3过敏 4用药 5绝育 6慢病",
    required: false,
    enum: HEALTH_RECORD_TYPE_VALUES,
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn(HEALTH_RECORD_TYPE_VALUES, { message: "记录类型取值不合法" })
  recordType?: number;

  @ApiProperty({ description: "记录日期起（含，yyyy-MM-dd）", required: false })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY_PATTERN, { message: "记录日期起格式须为 yyyy-MM-dd" })
  from?: string;

  @ApiProperty({ description: "记录日期止（含，yyyy-MM-dd）", required: false })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY_PATTERN, { message: "记录日期止格式须为 yyyy-MM-dd" })
  to?: string;

  @ApiProperty({ description: "到期日起（含，yyyy-MM-dd）", required: false })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY_PATTERN, { message: "到期日起格式须为 yyyy-MM-dd" })
  expireFrom?: string;

  @ApiProperty({ description: "到期日止（含，yyyy-MM-dd）", required: false })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY_PATTERN, { message: "到期日止格式须为 yyyy-MM-dd" })
  expireTo?: string;
}
