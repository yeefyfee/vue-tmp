import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsBoolean, IsObject, IsOptional, IsString, MaxLength } from "class-validator";

/**
 * 冲正时间线事件参数（P0-06-07 · POST /pets/:petId/timeline/:eventId/revise）
 *
 * 语义：**不修改原事件**，追加一条 `timeline.event.revised` 冲正事件；payload 记录
 * 被冲正的原事件 id / 原事件名 / 冲正原因 / 修正差分；refType=timeline_event、
 * refId=原事件 id（多态关联指向原事件）。
 */
export class ReviseTimelineEventDto {
  @ApiProperty({ description: "冲正原因", required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: "冲正原因过长" })
  reason?: string;

  @ApiProperty({ description: "修正内容（字段级差分对象）", required: false, type: Object })
  @IsOptional()
  @IsObject({ message: "修正内容必须是对象" })
  changes?: Record<string, unknown>;

  @ApiProperty({
    description: "冲正事件的宠主端可见性（缺省继承原事件可见性）",
    required: false,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    return value;
  })
  @IsBoolean()
  visibleToOwner?: boolean;
}
