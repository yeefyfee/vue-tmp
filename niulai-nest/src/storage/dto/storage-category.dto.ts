import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsOptional, IsString, Length, Max, Min } from "class-validator";
import { PartialType } from "@nestjs/swagger";
import { BaseQueryDto } from "@/common/dto/base-query.dto";

/**
 * 新增/修改分类
 */
export class StorageCategoryFormDto {
  @ApiProperty({ description: "分类名称" })
  @IsString()
  @Length(1, 50, { message: "分类名称长度需在 1-50 之间" })
  name: string;

  @ApiProperty({ description: "分类图标标识", required: false })
  @IsOptional()
  @IsString()
  icon?: string;

  @ApiProperty({ description: "分类主题色", required: false })
  @IsOptional()
  @IsString()
  color?: string;

  @ApiProperty({ description: "显示顺序", required: false, default: 0 })
  @IsOptional()
  @IsInt()
  sort?: number;

  @ApiProperty({ description: "状态(1-正常 0-禁用)", required: false, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1)
  status?: number;

  @ApiProperty({ description: "备注", required: false })
  @IsOptional()
  @IsString()
  remark?: string;
}

export class UpdateStorageCategoryDto extends PartialType(StorageCategoryFormDto) {}

/**
 * 分类分页查询参数
 */
export class StorageCategoryQueryDto extends BaseQueryDto {
  @ApiProperty({ description: "关键词(分类名称)", required: false })
  @IsOptional()
  @IsString()
  keywords?: string;
}
