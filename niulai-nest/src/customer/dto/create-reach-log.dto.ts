import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsOptional, IsString, Length, Matches } from "class-validator";

import { REACH_CHANNEL_VALUES, REACH_RESULT_VALUES } from "@peluvida/shared";

/**
 * 记录实测触达参数（P0-05-04 · FR-3）
 *
 * ⚠️ 安全边界：不声明 tenantId / customerId / operatorId —— 客户归属由路径 :id 锚定
 * （scoped 校验属当前租户）、租户只认 JWT、操作人由服务端从上下文注入；伪造字段被
 * DTO 白名单剥离。
 */
export class CreateReachLogDto {
  @ApiProperty({
    description: "触达渠道：1 站内信 / 2 服务号 / 3 订阅消息 / 4 短信",
    enum: REACH_CHANNEL_VALUES,
  })
  @Type(() => Number)
  @IsIn(REACH_CHANNEL_VALUES as unknown as number[], { message: "触达渠道取值不合法" })
  channel: number;

  @ApiProperty({ description: "触达模板标识 / 名称（可空）", required: false, maxLength: 64 })
  @IsOptional()
  @IsString()
  @Length(1, 64, { message: "触达模板长度须在1~64个字符之间" })
  template?: string;

  @ApiProperty({ description: "触达内容摘要（可空）", required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @Length(1, 500, { message: "触达内容长度须在1~500个字符之间" })
  content?: string;

  @ApiProperty({
    description: "触达结果：1 成功 / 2 失败（可空=未回执）",
    required: false,
    enum: REACH_RESULT_VALUES,
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn(REACH_RESULT_VALUES as unknown as number[], { message: "触达结果取值不合法" })
  result?: number;

  @ApiProperty({
    description: "实际触达时间（yyyy-MM-dd 或 yyyy-MM-dd HH:mm:ss，可空=取写入时刻）",
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/, {
    message: "触达时间格式须为 yyyy-MM-dd 或 yyyy-MM-dd HH:mm:ss",
  })
  reachedAt?: string;
}
