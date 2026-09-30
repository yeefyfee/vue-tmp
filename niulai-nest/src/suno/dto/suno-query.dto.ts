import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsOptional, IsString } from "class-validator";

import { BaseQueryDto } from "@/common/dto/base-query.dto";

/** 任务分页查询 */
export class SunoTaskQueryDto extends BaseQueryDto {
  @ApiProperty({ description: "关键字（标题）", required: false })
  @IsOptional()
  @IsString()
  keywords?: string;

  @ApiProperty({ description: "任务状态", required: false })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiProperty({ description: "任务类型", required: false })
  @IsOptional()
  @IsString()
  taskType?: string;

  @ApiProperty({ description: "业务分类(music/sound/post)", required: false })
  @IsOptional()
  @IsString()
  bizCategory?: string;
}

/** 作品分页查询 */
export class SunoAssetQueryDto extends BaseQueryDto {
  @ApiProperty({ description: "关键字（标题）", required: false })
  @IsOptional()
  @IsString()
  keywords?: string;

  @ApiProperty({ description: "资产类型(music/sound/video)", required: false })
  @IsOptional()
  @IsString()
  assetType?: string;

  @ApiProperty({ description: "仅看收藏(1-是)", required: false })
  @IsOptional()
  @Type(() => Number)
  isLiked?: number;
}

/** 后期处理请求 */
export class PostProcessDto {
  @ApiProperty({ description: "音乐ID(custom_id)", required: false })
  @IsOptional()
  @IsString()
  clipId?: string;

  @ApiProperty({ description: "音乐ID(suno_id，与 clipId 等价)", required: false })
  @IsOptional()
  @IsString()
  sunoId?: string;

  @ApiProperty({ description: "数字任务ID", required: false })
  @IsOptional()
  @Type(() => Number)
  taskId?: number;

  @ApiProperty({ description: "歌词内容（歌词对齐用）", required: false })
  @IsOptional()
  @IsString()
  lyrics?: string;

  @ApiProperty({ description: "模型名（升采样用）", required: false })
  @IsOptional()
  @IsString()
  modelName?: string;

  @ApiProperty({ description: "开始秒数（裁剪用）", required: false })
  @IsOptional()
  @Type(() => Number)
  startTime?: number;

  @ApiProperty({ description: "结束秒数（裁剪用）", required: false })
  @IsOptional()
  @Type(() => Number)
  endTime?: number;

  @ApiProperty({ description: "倍速（变速用）", required: false })
  @IsOptional()
  @Type(() => Number)
  speed?: number;
}
