import { ApiProperty } from "@nestjs/swagger";
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from "class-validator";

/**
 * 新增物品
 */
export class CreateStorageItemDto {
  @ApiProperty({ description: "物品名称" })
  @IsString()
  @Length(1, 100, { message: "物品名称长度需在 1-100 之间" })
  name: string;

  @ApiProperty({ description: "所属分类ID", required: false })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiProperty({ description: "封面图URL", required: false })
  @IsOptional()
  @IsString()
  coverUrl?: string;

  @ApiProperty({ description: "图片URL列表", required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageUrls?: string[];

  @ApiProperty({ description: "标签ID列表", required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tagIds?: string[];

  @ApiProperty({ description: "数量", required: false, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999999)
  quantity?: number;

  @ApiProperty({ description: "单位", required: false })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiProperty({ description: "单价", required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiProperty({ description: "购置日期(yyyy-MM-dd)", required: false })
  @IsOptional()
  @IsString()
  purchaseDate?: string;

  @ApiProperty({ description: "过期日期(yyyy-MM-dd)", required: false })
  @IsOptional()
  @IsString()
  expireDate?: string;

  @ApiProperty({ description: "存放位置描述", required: false })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiProperty({ description: "备注", required: false })
  @IsOptional()
  @IsString()
  remark?: string;

  @ApiProperty({ description: "状态(1-在库 0-已归档)", required: false, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1)
  status?: number;
}
