import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsOptional, IsString, Min } from "class-validator";

/**
 * 上传回调请求（P0-08-02 · POST /media/callback）
 *
 * 云存储（如阿里云 OSS）在对象上传完成后回调本服务端；body 携带对象定位与元信息。
 * 以 `mediaId` 或 `objectKey` 二者之一定位待确认的 pending 记录并确认。
 */
export class MediaCallbackDto {
  @ApiProperty({ description: "媒体 id（与 objectKey 二选一）", required: false })
  @IsOptional()
  @IsString()
  mediaId?: string;

  @ApiProperty({ description: "对象键（与 mediaId 二选一）", required: false })
  @IsOptional()
  @IsString()
  objectKey?: string;

  @ApiProperty({ description: "文件字节数", required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  size?: number;

  @ApiProperty({ description: "MIME 类型", required: false })
  @IsOptional()
  @IsString()
  mimeType?: string;

  @ApiProperty({ description: "图片宽度（像素）", required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  width?: number;

  @ApiProperty({ description: "图片高度（像素）", required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  height?: number;
}
