import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from "class-validator";

import {
  MEDIA_MAX_PER_ENTITY,
  MEDIA_REF_ID_MAX_LENGTH,
  MEDIA_REF_TYPE_MAX_LENGTH,
} from "@peluvida/shared";

/**
 * 预签名上传请求（P0-08-02 · POST /media/presign）
 *
 * 客户端先声明「要挂到哪个多态关联对象 + 文件元信息」，服务端校验配额并落一条
 * pending 记录、返回预签名上传地址（云端驱动）或指示走服务端直传（local/memory）。
 * 上传完成后调用 `POST /media/:id/confirm` 确认。
 */
export class PresignMediaDto {
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

  @ApiProperty({ description: "原始文件名（用于推断扩展名）", required: false })
  @IsOptional()
  @IsString()
  fileName?: string;

  @ApiProperty({ description: "MIME 类型（如 image/png）", required: false })
  @IsOptional()
  @IsString()
  mimeType?: string;

  @ApiProperty({ description: "文件字节数（用于配额 / 大小校验）", required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  fileSize?: number;

  @ApiProperty({ description: "门店 id（可空=租户级）", required: false })
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @ApiProperty({ description: "宠主端可见（缺省 true）", required: false })
  @IsOptional()
  @IsBoolean()
  visibleToOwner?: boolean;

  @ApiProperty({ description: "展示排序（小在前，缺省 0）", required: false })
  @IsOptional()
  @IsInt()
  sort?: number;

  @ApiProperty({ description: "水印文字（缺省不施加水印；图片专属）", required: false })
  @IsOptional()
  @IsString()
  watermark?: string;
}

/** 单实体媒体数量上限（供前端提示；与 shared MEDIA_MAX_PER_ENTITY 同源） */
export const MEDIA_PRESIGN_MAX_PER_ENTITY = MEDIA_MAX_PER_ENTITY;
