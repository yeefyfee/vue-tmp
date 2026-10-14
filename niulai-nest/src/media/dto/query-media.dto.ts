import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString } from "class-validator";

import { MEDIA_TYPE_VALUES, MEDIA_UPLOAD_STATUS_VALUES } from "@peluvida/shared";
import { PaginationQueryDto } from "../../common/pagination";

/**
 * 媒体分页查询参数（P0-08）
 *
 * 筛选维度：refType + refId（多态关联精确，二者一般成对使用）/ mediaType（精确）
 * / uploadStatus（精确）/ visibleToOwner（精确，宠主端可见性）。
 * 分页沿用 P0-07-02 统一基座（page / page_size，上限 100）；默认按 sort asc + createdAt desc。
 */
export class QueryMediaDto extends PaginationQueryDto {
  @ApiProperty({
    description: "多态关联对象类型（如 pet / health_record，精确匹配）",
    required: false,
    maxLength: 32,
  })
  @IsOptional()
  @IsString()
  refType?: string;

  @ApiProperty({
    description: "多态关联对象 id（精确匹配，兼容 uuid / bigint 字符串）",
    required: false,
    maxLength: 64,
  })
  @IsOptional()
  @IsString()
  refId?: string;

  @ApiProperty({
    description: "媒体类型：1 图片 / 2 视频 / 3 文档 / 9 其他",
    required: false,
    enum: MEDIA_TYPE_VALUES,
  })
  @IsOptional()
  @IsIn(MEDIA_TYPE_VALUES as unknown as number[], { message: "媒体类型取值不合法" })
  mediaType?: number;

  @ApiProperty({
    description: "上传状态：1 pending（待确认）/ 2 confirmed（已确认）",
    required: false,
    enum: MEDIA_UPLOAD_STATUS_VALUES,
  })
  @IsOptional()
  @IsIn(MEDIA_UPLOAD_STATUS_VALUES as unknown as number[], { message: "上传状态取值不合法" })
  uploadStatus?: number;

  @ApiProperty({
    description: "宠主端可见（true/false 精确匹配）",
    required: false,
    enum: ["true", "false"],
  })
  @IsOptional()
  // ⚠️ 声明为 string：全局 ValidationPipe enableImplicitConversion 下
  // `Boolean("false") === true` 会把 "false" 误转为 true（查询串布尔踩坑）；由 service 显式解析。
  @IsIn(["true", "false"], { message: "visibleToOwner 仅支持 true/false" })
  visibleToOwner?: string;
}
