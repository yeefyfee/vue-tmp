import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Length, Matches } from "class-validator";

import { CUSTOMER_GENDER_VALUES, CUSTOMER_SOURCE_VALUES } from "@peluvida/shared";

/**
 * 萌主档案创建参数（P0-05-02 · FR-1）
 *
 * ⚠️ 安全边界：**不声明 tenantId 字段** —— 租户归属只来自 JWT payload
 * （`RequestContext.getTenantId()`，租户扩展层恒定覆盖），DTO 白名单校验
 * （ValidationPipe whitelist）会直接剥离请求里伪造的 `tenant_id`/`tenantId`。
 */
export class CreateCustomerDto {
  @ApiProperty({ description: "客户（宠主）姓名", maxLength: 64 })
  @IsNotEmpty({ message: "客户姓名不能为空" })
  @IsString()
  @Length(1, 64, { message: "客户姓名长度须在1~64个字符之间" })
  name: string;

  @ApiProperty({ description: "手机号（租户内唯一）", maxLength: 20 })
  @IsNotEmpty({ message: "手机号不能为空" })
  @IsString()
  @Matches(/^[0-9]{1,20}$/, { message: "手机号仅允许 1~20 位数字" })
  mobile: string;

  @ApiProperty({ description: "归属门店 id（可空=租户级客户）", required: false, format: "uuid" })
  @IsOptional()
  @IsUUID(undefined, { message: "门店 id 必须是合法 UUID" })
  storeId?: string;

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

  @ApiProperty({ description: "备注", required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @Length(0, 500, { message: "备注长度不能超过500个字符" })
  remark?: string;
}
