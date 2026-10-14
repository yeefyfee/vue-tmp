import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Min,
} from "class-validator";

import {
  CUSTOMER_GENDER_VALUES,
  CUSTOMER_LIFECYCLE_VALUES,
  CUSTOMER_SOURCE_VALUES,
} from "@peluvida/shared";

/**
 * 萌主档案更新参数（P0-05-02 · FR-1）
 *
 * 全字段可选（部分更新）；`version` 除外 —— **乐观锁必填**：
 * 与库内 `version` 不一致时抛 `CUSTOMER_VERSION_CONFLICT`，防止并发互相覆盖。
 *
 * ⚠️ 与 CreateCustomerDto 同口径：**不声明 tenantId 字段**，请求参数伪造的
 * `tenant_id` 会被白名单剥离，租户归属恒由 JWT 上下文注入。
 */
export class UpdateCustomerDto {
  @ApiProperty({ description: "乐观锁版本号（创建时为 0，每次更新 +1）", required: true })
  @IsNotEmpty({ message: "版本号不能为空" })
  @Type(() => Number)
  @IsInt({ message: "版本号必须是整数" })
  @Min(0, { message: "版本号不能为负数" })
  version: number;

  @ApiProperty({ description: "客户（宠主）姓名", required: false, maxLength: 64 })
  @IsOptional()
  @IsString()
  @Length(1, 64, { message: "客户姓名长度须在1~64个字符之间" })
  name?: string;

  @ApiProperty({ description: "手机号（修改时校验租户内唯一）", required: false, maxLength: 20 })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{1,20}$/, { message: "手机号仅允许 1~20 位数字" })
  mobile?: string;

  @ApiProperty({ description: "归属门店 id（可空=租户级客户）", required: false, format: "uuid" })
  @IsOptional()
  @IsUUID(undefined, { message: "门店 id 必须是合法 UUID" })
  storeId?: string | null;

  @ApiProperty({
    description: "性别：1 男 / 2 女 / 0 未知",
    required: false,
    enum: CUSTOMER_GENDER_VALUES,
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn(CUSTOMER_GENDER_VALUES as unknown as number[], {
    message: "性别仅允许 0（未知）/ 1（男）/ 2（女）",
  })
  gender?: number;

  @ApiProperty({ description: "生日（yyyy-MM-dd）", required: false })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "生日格式须为 yyyy-MM-dd" })
  birthday?: string;

  @ApiProperty({
    description: "客户来源：1 自然进店 / 2 转介绍 / 3 团购 / 4 小程序 / 9 其他",
    required: false,
    enum: CUSTOMER_SOURCE_VALUES,
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn(CUSTOMER_SOURCE_VALUES as unknown as number[], { message: "客户来源取值不合法" })
  source?: number;

  @ApiProperty({
    description: "生命周期分层：1 新客 / 2 活跃 / 3 沉睡 / 4 流失",
    required: false,
    enum: CUSTOMER_LIFECYCLE_VALUES,
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn(CUSTOMER_LIFECYCLE_VALUES as unknown as number[], {
    message: "生命周期取值不合法（仅允许 1 新客 / 2 活跃 / 3 沉睡 / 4 流失）",
  })
  lifecycle?: number;

  @ApiProperty({ description: "备注", required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @Length(0, 500, { message: "备注长度不能超过500个字符" })
  remark?: string;
}
