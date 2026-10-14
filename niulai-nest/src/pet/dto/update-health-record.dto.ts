import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from "class-validator";

import { DATE_ONLY_PATTERN, HEALTH_RECORD_TYPE_VALUES } from "../pet-health.constants";

/**
 * 健康档案更正参数（P0-06-03 · FR-2）
 *
 * 全字段可选（部分更新）；`version` 除外 —— **乐观锁必填**：与库内 `version`
 * 不一致时抛 `HEALTH_RECORD_VERSION_CONFLICT`（A0609）。
 *
 * 业务取舍：健康档案在临床语义上是 append-only（历史不可篡改），本接口仅用于
 * 「录入错误更正」，且以软删保留原值可追溯；正确做法应是新增一条更正记录，
 * 详见报告说明。
 */
export class UpdateHealthRecordDto {
  @ApiProperty({ description: "乐观锁版本号（创建时为 0，每次更新 +1）", required: true })
  @IsNotEmpty({ message: "版本号不能为空" })
  @Type(() => Number)
  @IsInt({ message: "版本号必须是整数" })
  @Min(0, { message: "版本号不能为负数" })
  version: number;

  @ApiProperty({
    description: "记录类型：1疫苗 2驱虫 3过敏 4用药 5绝育 6慢病",
    required: false,
    enum: HEALTH_RECORD_TYPE_VALUES,
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn(HEALTH_RECORD_TYPE_VALUES, {
    message: "记录类型仅允许 1~6（疫苗/驱虫/过敏/用药/绝育/慢病）",
  })
  recordType?: number;

  @ApiProperty({ description: "记录日期（yyyy-MM-dd）", required: false })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY_PATTERN, { message: "记录日期格式须为 yyyy-MM-dd" })
  recordDate?: string;

  @ApiProperty({ description: "到期日期（yyyy-MM-dd；null 语义由留空承载）", required: false })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY_PATTERN, { message: "到期日期格式须为 yyyy-MM-dd" })
  expireDate?: string | null;

  @ApiProperty({ description: "内容摘要", required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @Length(0, 500, { message: "内容摘要长度不能超过500个字符" })
  content?: string | null;

  @ApiProperty({ description: "操作人（sys_user id，数字字符串）", required: false })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: "操作人 id 必须为数字字符串" })
  operatorId?: string | null;
}
