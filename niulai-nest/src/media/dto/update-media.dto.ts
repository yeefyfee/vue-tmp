import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsInt, IsOptional, Min } from "class-validator";

/**
 * 媒体更新请求（P0-08-04 · PUT /media/:id）
 *
 * 仅允许调整「展示元信息」（可见性 / 排序）；version 乐观锁防并发覆盖。
 */
export class UpdateMediaDto {
  @ApiProperty({ description: "宠主端可见（P0-08-04）", required: false })
  @IsOptional()
  @IsBoolean()
  visibleToOwner?: boolean;

  @ApiProperty({ description: "展示排序（小在前）", required: false })
  @IsOptional()
  @IsInt()
  sort?: number;

  @ApiProperty({ description: "乐观锁版本（当前记录的 version，必填）" })
  @IsInt()
  @Min(0)
  version: number;
}
