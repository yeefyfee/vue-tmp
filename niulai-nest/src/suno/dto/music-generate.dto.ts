import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";

/**
 * 生成音乐/音效/延长/翻唱 统一提交 DTO
 *
 * 通过 task 字段区分任务类型：缺省 generate，可选 extend / cover。
 */
export class MusicGenerateDto {
  @ApiProperty({ description: "任务类型（缺省 generate，可选 extend/cover）", required: false })
  @IsOptional()
  @IsString()
  task?: string;

  @ApiProperty({ description: "歌名", required: false })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ description: "灵感模式描述", required: false })
  @IsOptional()
  @IsString()
  gptDescriptionPrompt?: string;

  @ApiProperty({ description: "自定义歌词", required: false })
  @IsOptional()
  @IsString()
  prompt?: string;

  @ApiProperty({ description: "风格标签", required: false })
  @IsOptional()
  @IsString()
  tags?: string;

  @ApiProperty({ description: "是否纯音乐", required: false })
  @IsOptional()
  @IsBoolean()
  makeInstrumental?: boolean;

  @ApiProperty({ description: "模型版本", required: false })
  @IsOptional()
  @IsString()
  mv?: string;

  @ApiProperty({ description: "延长来源音乐ID", required: false })
  @IsOptional()
  @IsString()
  continueClipId?: string;

  @ApiProperty({ description: "翻唱来源音乐ID", required: false })
  @IsOptional()
  @IsString()
  coverClipId?: string;

  @ApiProperty({ description: "MAX 模式（消耗双倍积分）", required: false })
  @IsOptional()
  @IsBoolean()
  isMaxMode?: boolean;

  @ApiProperty({ description: "创意度 0-4", required: false, minimum: 0, maximum: 4 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(4)
  augCreativity?: number;
}

/** 生成音效 DTO */
export class SoundGenerateDto {
  @ApiProperty({ description: "音效标题", required: false })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ description: "音效风格", required: false })
  @IsOptional()
  @IsString()
  tags?: string;

  @ApiProperty({ description: "模型版本（仅 chirp-crow / chirp-fenix）", required: false })
  @IsOptional()
  @IsString()
  mv?: string;

  @ApiProperty({ description: "BPM", required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  tempo?: number;

  @ApiProperty({ description: "音调", required: false })
  @IsOptional()
  @IsString()
  key?: string;

  @ApiProperty({ description: "是否循环", required: false })
  @IsOptional()
  @IsBoolean()
  loop?: boolean;
}

/** 上传参考音频 DTO */
export class MusicUploadDto {
  @ApiProperty({ description: "音频文件的公开 URL" })
  @IsNotEmpty({ message: "音频地址不能为空" })
  @IsString()
  audioUrl: string;

  @ApiProperty({ description: "作品标题（仅本地记录用）", required: false })
  @IsOptional()
  @IsString()
  title?: string;
}
