import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from "class-validator";

import { PET_TYPE_VALUES } from "@peluvida/shared";

/**
 * 宠物档案创建参数（P0-06-02 · FR-1）
 *
 * ⚠️ 安全边界（对齐 CreateCustomerDto 口径）：**不声明 tenantId 字段** ——
 * 租户归属只来自 JWT payload（`RequestContext.getTenantId()`，租户扩展层恒定
 * 覆盖），DTO 白名单校验（ValidationPipe whitelist）剥离请求里伪造的
 * `tenant_id`/`tenantId`。
 */
export class CreatePetDto {
  @ApiProperty({ description: "宠物名", maxLength: 64 })
  @IsNotEmpty({ message: "宠物名不能为空" })
  @IsString()
  @Length(1, 64, { message: "宠物名长度须在1~64个字符之间" })
  name: string;

  @ApiProperty({ description: "主人客户档案 id", format: "uuid" })
  @IsNotEmpty({ message: "主人客户档案 id 不能为空" })
  @IsUUID(undefined, { message: "主人客户档案 id 必须是合法 UUID" })
  ownerCustomerId: string;

  @ApiProperty({ description: "宠物类型：1 犬 / 2 猫 / 9 其他", enum: PET_TYPE_VALUES })
  @Type(() => Number)
  @IsIn(PET_TYPE_VALUES as unknown as number[], {
    message: "宠物类型仅允许 1（犬）/ 2（猫）/ 9（其他）",
  })
  petType: number;

  @ApiProperty({ description: "归属门店 id（可空=租户级档案）", required: false, format: "uuid" })
  @IsOptional()
  @IsUUID(undefined, { message: "门店 id 必须是合法 UUID" })
  storeId?: string;

  @ApiProperty({ description: "品种", required: false, maxLength: 64 })
  @IsOptional()
  @IsString()
  @Length(1, 64, { message: "品种长度须在1~64个字符之间" })
  breed?: string;

  @ApiProperty({ description: "性别：1 公 / 2 母", required: false, enum: [1, 2] })
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2], { message: "性别仅允许 1（公）/ 2（母）" })
  gender?: number;

  @ApiProperty({ description: "生日（yyyy-MM-dd）", required: false })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "生日格式须为 yyyy-MM-dd" })
  birthday?: string;

  @ApiProperty({ description: "当前体重 kg（0.01~999.99，两位小数）", required: false })
  @IsOptional()
  @Matches(/^\d{1,3}(\.\d{1,2})?$/, { message: "体重须为 0~999.99 的数值（最多两位小数）" })
  weightKg?: string;

  @ApiProperty({ description: "毛色", required: false, maxLength: 32 })
  @IsOptional()
  @IsString()
  @Length(1, 32, { message: "毛色长度须在1~32个字符之间" })
  coatColor?: string;

  @ApiProperty({ description: "是否绝育（null=未登记）", required: false })
  @IsOptional()
  @IsBoolean({ message: "绝育标记必须是布尔值" })
  sterilized?: boolean;

  @ApiProperty({ description: "芯片号", required: false, maxLength: 64 })
  @IsOptional()
  @IsString()
  @Length(1, 64, { message: "芯片号长度须在1~64个字符之间" })
  chipNo?: string;

  @ApiProperty({ description: "主图 URL", required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @Length(1, 500, { message: "主图 URL 长度不能超过500个字符" })
  photoUrl?: string;

  @ApiProperty({ description: "多图 URL 数组（≤9 张）", required: false, type: [String] })
  @IsOptional()
  @IsArray({ message: "多图必须是 URL 数组" })
  @ArrayMaxSize(9, { message: "多图最多 9 张" })
  @IsString({ each: true, message: "多图数组每一项必须是字符串 URL" })
  photos?: string[];

  @ApiProperty({
    description: "行为标签 id 数组（可空=不挂标签）",
    required: false,
    type: [String],
  })
  @IsOptional()
  @IsArray({ message: "行为标签必须是 id 数组" })
  @ArrayMaxSize(20, { message: "行为标签最多 20 个" })
  @IsUUID(undefined, { each: true, message: "行为标签 id 必须是合法 UUID" })
  behaviorTagIds?: string[];

  @ApiProperty({ description: "备注", required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @Length(0, 500, { message: "备注长度不能超过500个字符" })
  remark?: string;
}
