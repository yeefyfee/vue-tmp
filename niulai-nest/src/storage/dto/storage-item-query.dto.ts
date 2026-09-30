import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { Transform } from "class-transformer";
import { BaseQueryDto } from "@/common/dto/base-query.dto";

/**
 * 物品分页查询参数
 */
export class StorageItemQueryDto extends BaseQueryDto {
  @ApiProperty({ description: "关键词(名称/备注/位置模糊匹配)", required: false })
  @IsOptional()
  @IsString()
  keywords?: string;

  @ApiProperty({ description: "分类ID", required: false })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiProperty({ description: "标签ID(命中任一标签即可)", required: false })
  @IsOptional()
  @IsString()
  tagId?: string;

  @ApiProperty({ description: "状态(1-在库 0-已归档)", required: false })
  @IsOptional()
  @Transform(({ value }) => (value === "" || value === null ? undefined : Number(value)))
  @IsInt()
  @Min(0)
  @Max(1)
  status?: number;

  @ApiProperty({ description: "排序字段(createTime|name|quantity|expireDate)", required: false })
  @IsOptional()
  @IsString()
  sortBy?: string;
}
