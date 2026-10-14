import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, IsUUID, Matches } from "class-validator";

import { PET_TYPE_VALUES } from "@peluvida/shared";
import { BaseQueryDto } from "../../common/dto/base-query.dto";

/**
 * 宠物档案分页查询参数（P0-06-02 · FR-1）
 *
 * 筛选维度：petType / ownerCustomerId / storeId（精确）+ name（模糊）+ chipNo
 * （精确）+ createdAt 区间；分页与排序沿用 `BaseQueryDto`
 * （pageNum/pageSize/sortBy/order），排序字段白名单在 service 层收敛
 * （sortBy 合法域：createdAt/name）。
 */
export class QueryPetDto extends BaseQueryDto {
  @ApiProperty({
    description: "宠物类型：1 犬 / 2 猫 / 9 其他",
    required: false,
    enum: PET_TYPE_VALUES,
  })
  @IsOptional()
  @IsIn(PET_TYPE_VALUES as unknown as number[], { message: "宠物类型取值不合法" })
  petType?: number;

  @ApiProperty({ description: "主人客户档案 id（精确匹配）", required: false, format: "uuid" })
  @IsOptional()
  @IsUUID(undefined, { message: "主人客户档案 id 必须是合法 UUID" })
  ownerCustomerId?: string;

  @ApiProperty({ description: "归属门店 id（精确匹配）", required: false, format: "uuid" })
  @IsOptional()
  @IsUUID(undefined, { message: "门店 id 必须是合法 UUID" })
  storeId?: string;

  @ApiProperty({ description: "宠物名（模糊匹配）", required: false, maxLength: 64 })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ description: "芯片号（精确匹配）", required: false, maxLength: 64 })
  @IsOptional()
  @IsString()
  chipNo?: string;

  @ApiProperty({
    description: "按行为标签筛选（精确；命中挂有该标签的宠物）",
    required: false,
    format: "uuid",
  })
  @IsOptional()
  @IsUUID(undefined, { message: "行为标签 id 必须是合法 UUID" })
  behaviorTagId?: string;

  @ApiProperty({ description: "创建时间起（含，ISO 8601）", required: false })
  @IsOptional()
  @IsString()
  createdAtStart?: string;

  @ApiProperty({ description: "创建时间止（含当天末尾，ISO 8601 或 yyyy-MM-dd）", required: false })
  @IsOptional()
  @IsString()
  createdAtEnd?: string;
}
