import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { Transform } from "class-transformer";

/**
 * 物品统计概览
 */
export class StorageOverviewDto {
  @ApiProperty({ description: "物品总数" })
  itemCount: number;

  @ApiProperty({ description: "在库数量" })
  inStockCount: number;

  @ApiProperty({ description: "已归档数量" })
  archivedCount: number;

  @ApiProperty({ description: "分类数量" })
  categoryCount: number;

  @ApiProperty({ description: "标签数量" })
  tagCount: number;

  @ApiProperty({ description: "物品总价值" })
  totalValue: number;

  @ApiProperty({ description: "数量合计" })
  totalQuantity: number;

  @ApiProperty({ description: "30 天内过期物品数" })
  expiringSoonCount: number;
}

/**
 * 数量调整参数
 */
export class StorageItemQuantityDto {
  @ApiProperty({ description: "变化量(正数增加/负数减少)" })
  @IsInt()
  @Min(-999999)
  @Max(999999)
  @Transform(({ value }) => Number(value))
  delta: number;
}
