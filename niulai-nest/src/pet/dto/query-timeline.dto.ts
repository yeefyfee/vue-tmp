import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString } from "class-validator";

import { TIMELINE_EVENT_TYPE_VALUES } from "@peluvida/shared";
import { BaseQueryDto } from "../../common/dto/base-query.dto";

/**
 * 宠物时间线分页查询参数（P0-06-06 · FR-5）
 *
 * 筛选维度：eventType（精确）/ eventName（精确）/ refType + refId（多态关联精确）
 * / visibleToOwner（精确，宠主端可见性）/ eventTime 闭区间；
 * 默认按 eventTime desc 排序（分页与排序沿用 BaseQueryDto 的 pageNum/pageSize）。
 */
export class QueryTimelineDto extends BaseQueryDto {
  @ApiProperty({
    description: "事件类型：1 入驻 / 2 离店 / 3 喂养 / 4 洗护 / 5 医疗 / 6 体重 / 7 照片 / 8 系统",
    required: false,
    enum: TIMELINE_EVENT_TYPE_VALUES,
  })
  @IsOptional()
  @IsIn(TIMELINE_EVENT_TYPE_VALUES as unknown as number[], { message: "事件类型取值不合法" })
  eventType?: number;

  @ApiProperty({ description: "事件名（`模块.动作`，精确匹配）", required: false, maxLength: 64 })
  @IsOptional()
  @IsString()
  eventName?: string;

  @ApiProperty({ description: "多态关联对象类型（精确匹配）", required: false, maxLength: 32 })
  @IsOptional()
  @IsString()
  refType?: string;

  @ApiProperty({ description: "多态关联对象 id（精确匹配）", required: false, maxLength: 64 })
  @IsOptional()
  @IsString()
  refId?: string;

  @ApiProperty({
    description: "宠主端可见（true/false 精确匹配）",
    required: false,
    enum: ["true", "false"],
  })
  @IsOptional()
  // ⚠️ 声明为 string（而非 boolean）：全局 ValidationPipe 开启 enableImplicitConversion
  // 时会按 design:type 做隐式转换，`Boolean("false") === true` 会把 "false" 错转成 true
  // （踩坑：查询串布尔字段）。故这里保留字符串，由 service 显式解析。
  @IsIn(["true", "false"], { message: "visibleToOwner 仅支持 true/false" })
  visibleToOwner?: string;

  @ApiProperty({ description: "事件时间起（含，ISO 8601 或 yyyy-MM-dd）", required: false })
  @IsOptional()
  @IsString()
  eventTimeStart?: string;

  @ApiProperty({
    description: "事件时间止（含当天末尾，ISO 8601 或 yyyy-MM-dd）",
    required: false,
  })
  @IsOptional()
  @IsString()
  eventTimeEnd?: string;
}
