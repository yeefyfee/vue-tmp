import { ApiProperty } from "@nestjs/swagger";
import { IsOptional, IsString, Length } from "class-validator";
import { PartialType } from "@nestjs/swagger";

/**
 * 新增/修改标签
 */
export class StorageTagFormDto {
  @ApiProperty({ description: "标签名称" })
  @IsString()
  @Length(1, 50, { message: "标签名称长度需在 1-50 之间" })
  name: string;

  @ApiProperty({ description: "标签颜色", required: false })
  @IsOptional()
  @IsString()
  color?: string;
}

export class UpdateStorageTagDto extends PartialType(StorageTagFormDto) {}
