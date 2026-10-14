import { ApiProperty } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from "class-validator";

import { CUSTOMER_LIFECYCLE_VALUES } from "@peluvida/shared";

import { BaseQueryDto } from "../../common/dto/base-query.dto";

/**
 * 萌主档案分页查询参数（P0-05-02 · FR-1）
 *
 * 筛选维度：keyword（姓名 **或** 手机号模糊，见下）/ mobile（精确）/ name（模糊）/
 * storeId（精确）/ lifecycle / createdAt 区间；
 * 分页与排序沿用 `BaseQueryDto`（pageNum/pageSize/sortBy/order），
 * 排序字段白名单在 service 层收敛（sortBy 合法域：createdAt/name/mobile）。
 */
export class QueryCustomerDto extends BaseQueryDto {
  /**
   * 通用关键字（姓名或手机号，模糊）
   *
   * PRD《Customer API》验收要点：「列表 `keyword` 同时命中姓名与手机号」——
   * 前台只有一个搜索框，输入「张」或「138」都应命中，故它是 `OR` 语义而非
   * 两个字段的 `AND`（`name` / `mobile` 两个独立筛选保留精确语义，见下）。
   */
  @ApiProperty({
    description: "关键字（同时模糊匹配姓名与手机号）",
    required: false,
    maxLength: 64,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64, { message: "关键字长度不得超过 64 个字符" })
  keyword?: string;

  @ApiProperty({ description: "手机号（精确匹配）", required: false, maxLength: 20 })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{0,20}$/, { message: "手机号仅允许数字" })
  mobile?: string;

  @ApiProperty({ description: "客户姓名（模糊匹配）", required: false, maxLength: 64 })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ description: "归属门店 id（精确匹配）", required: false, format: "uuid" })
  @IsOptional()
  @IsUUID(undefined, { message: "门店 id 必须是合法 UUID" })
  storeId?: string;

  @ApiProperty({
    description: "生命周期分层：1 新客 / 2 活跃 / 3 沉睡 / 4 流失",
    required: false,
    enum: CUSTOMER_LIFECYCLE_VALUES,
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn(CUSTOMER_LIFECYCLE_VALUES as unknown as number[], { message: "生命周期取值不合法" })
  lifecycle?: number;

  @ApiProperty({ description: "创建时间起（含，ISO 8601）", required: false })
  @IsOptional()
  @IsString()
  createdAtStart?: string;

  @ApiProperty({ description: "创建时间止（含当天末尾，ISO 8601 或 yyyy-MM-dd）", required: false })
  @IsOptional()
  @IsString()
  createdAtEnd?: string;
}
