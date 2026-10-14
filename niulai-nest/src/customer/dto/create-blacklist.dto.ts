import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Length } from "class-validator";

/** 黑名单范围合法值域（P0-05-05 FR-4） */
export const BLACKLIST_SCOPE_VALUES = ["store", "tenant"] as const;
export type BlacklistScope = (typeof BLACKLIST_SCOPE_VALUES)[number];

/**
 * 拉黑参数（P0-05-05 · FR-4 门店/租户两级黑名单）
 *
 * - scope=tenant：租户级黑名单（storeId 忽略，落 NULL），对**所有门店**生效；
 * - scope=store ：门店级黑名单，storeId **必填**（service 校验租户内有效，否则 A0524），
 *   仅对指定门店生效。
 *
 * ⚠️ 不声明 customerId/tenantId：客户由路径 :id 锚定，租户只认 JWT。
 */
export class CreateBlacklistDto {
  @ApiProperty({ description: "范围：store 门店级 / tenant 租户级", enum: BLACKLIST_SCOPE_VALUES })
  @IsNotEmpty({ message: "黑名单范围不能为空" })
  @IsIn(BLACKLIST_SCOPE_VALUES as unknown as string[], {
    message: "黑名单范围仅允许 store（门店级）/ tenant（租户级）",
  })
  scope: BlacklistScope;

  @ApiProperty({ description: "门店 id（scope=store 时必填）", required: false, format: "uuid" })
  @IsOptional()
  @IsUUID(undefined, { message: "门店 id 必须是合法 UUID" })
  storeId?: string;

  @ApiProperty({ description: "拉黑原因", maxLength: 255 })
  @IsNotEmpty({ message: "拉黑原因不能为空" })
  @IsString()
  @Length(1, 255, { message: "拉黑原因长度须在1~255个字符之间" })
  reason: string;
}
