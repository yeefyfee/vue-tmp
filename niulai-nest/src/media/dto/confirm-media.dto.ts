import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsOptional, IsString, Min } from "class-validator";

/**
 * 上传确认请求（P0-08-02 · POST /media/:id/confirm）
 *
 * 前端 / 云端回调携带对象落存储后的元信息（大小 / MIME / 尺寸）确认，服务端将记录
 * 由 pending 置为 confirmed（upload_status=2，写 confirmed_at），并按需生成缩略图 / 施加水印。
 */
export class ConfirmMediaDto {
  @ApiProperty({ description: "文件字节数（覆盖预签名声明值）", required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  fileSize?: number;

  @ApiProperty({ description: "MIME 类型（覆盖预签名声明值）", required: false })
  @IsOptional()
  @IsString()
  mimeType?: string;

  @ApiProperty({ description: "图片宽度（像素；可空，缺省由对象头探测）", required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  width?: number;

  @ApiProperty({ description: "图片高度（像素；可空）", required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  height?: number;

  @ApiProperty({ description: "对象 ETag / 校验值（可选，留痕）", required: false })
  @IsOptional()
  @IsString()
  etag?: string;
}
