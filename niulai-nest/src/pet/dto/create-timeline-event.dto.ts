import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";

import { TIMELINE_ACTOR_TYPE_VALUES, TIMELINE_EVENT_TYPE_VALUES } from "@peluvida/shared";
import {
  TIMELINE_EVENT_NAME_MAX_LENGTH,
  TIMELINE_REF_ID_MAX_LENGTH,
  TIMELINE_REF_TYPE_MAX_LENGTH,
} from "../timeline.constants";

/**
 * 手工补录时间线事件参数（P0-06-06 · POST /pets/:petId/timeline）
 *
 * ⚠️ 不声明 tenantId：租户归属只来自 JWT 上下文（DTO 白名单剥离伪造值）。
 * eventType / actorType / visibleToOwner 缺省时按事件名回落（shared 事件名常量表）。
 */
export class CreateTimelineEventDto {
  @ApiProperty({ description: "事件名（`模块.动作`，如 health.record.created）", maxLength: 64 })
  @IsNotEmpty({ message: "事件名不能为空" })
  @IsString()
  @MaxLength(TIMELINE_EVENT_NAME_MAX_LENGTH, { message: "事件名过长" })
  eventName: string;

  @ApiProperty({
    description:
      "事件类型（缺省按事件名回落）：1 入驻 / 2 离店 / 3 喂养 / 4 洗护 / 5 医疗 / 6 体重 / 7 照片 / 8 系统",
    required: false,
    enum: TIMELINE_EVENT_TYPE_VALUES,
  })
  @IsOptional()
  @IsIn(TIMELINE_EVENT_TYPE_VALUES as unknown as number[], { message: "事件类型取值不合法" })
  eventType?: number;

  @ApiProperty({ description: "事件内容摘要", required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: "事件内容过长" })
  content?: string;

  @ApiProperty({ description: "结构化负载（对象）", required: false, type: Object })
  @IsOptional()
  @IsObject({ message: "负载必须是对象" })
  payload?: Record<string, unknown>;

  @ApiProperty({
    description: "多态关联对象类型（如 order / stay / health_record）",
    required: false,
    maxLength: 32,
  })
  @IsOptional()
  @IsString()
  @MaxLength(TIMELINE_REF_TYPE_MAX_LENGTH, { message: "关联类型过长" })
  refType?: string;

  @ApiProperty({
    description: "多态关联对象 id（字符串，兼容 uuid 与 bigint）",
    required: false,
    maxLength: 64,
  })
  @IsOptional()
  @IsString()
  @MaxLength(TIMELINE_REF_ID_MAX_LENGTH, { message: "关联 id 过长" })
  refId?: string;

  @ApiProperty({
    description: "操作者类型（缺省按事件名回落）：1 员工 / 2 系统 / 3 宠主",
    required: false,
    enum: TIMELINE_ACTOR_TYPE_VALUES,
  })
  @IsOptional()
  @IsIn(TIMELINE_ACTOR_TYPE_VALUES as unknown as number[], { message: "操作者类型取值不合法" })
  actorType?: number;

  @ApiProperty({ description: "操作人（BigInt 字符串；缺省=当前登录用户）", required: false })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: "操作人 id 必须是数字字符串" })
  operatorId?: string;

  @ApiProperty({ description: "宠主端可见（缺省按事件名回落）", required: false })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    return value;
  })
  @IsBoolean()
  visibleToOwner?: boolean;

  @ApiProperty({
    description: "事件时间（ISO 8601 或 yyyy-MM-dd；缺省=落库时刻）",
    required: false,
  })
  @IsOptional()
  @IsString()
  eventTime?: string;
}
