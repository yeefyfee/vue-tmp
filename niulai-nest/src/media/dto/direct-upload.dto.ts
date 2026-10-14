import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

import { MEDIA_REF_ID_MAX_LENGTH, MEDIA_REF_TYPE_MAX_LENGTH } from "@peluvida/shared";

/**
 * 服务端直传附带字段（P0-08-02 · POST /media/upload，multipart）
 *
 * 与文件同处 multipart body；字段值均为字符串（multer 不做类型转换）。
 */
export class DirectUploadDto {
  @ApiProperty({
    description: "多态关联对象类型（如 pet / health_record）",
    maxLength: MEDIA_REF_TYPE_MAX_LENGTH,
  })
  @IsString()
  @MaxLength(MEDIA_REF_TYPE_MAX_LENGTH)
  refType: string;

  @ApiProperty({
    description: "多态关联对象 id（uuid / bigint 字符串）",
    maxLength: MEDIA_REF_ID_MAX_LENGTH,
  })
  @IsString()
  @MaxLength(MEDIA_REF_ID_MAX_LENGTH)
  refId: string;

  @ApiProperty({ description: "门店 id（可空=租户级）", required: false })
  @IsOptional()
  @IsString()
  storeId?: string;

  @ApiProperty({
    description: "宠主端可见（true/false，缺省 true）",
    required: false,
    enum: ["true", "false"],
  })
  @IsOptional()
  @IsIn(["true", "false"])
  visibleToOwner?: string;

  @ApiProperty({ description: "展示排序（小在前，缺省 0）", required: false })
  @IsOptional()
  @IsString()
  sort?: string;

  @ApiProperty({ description: "水印文字（缺省不施加水印；图片专属）", required: false })
  @IsOptional()
  @IsString()
  watermark?: string;
}
