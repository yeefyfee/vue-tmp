import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
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

import { PET_TYPE_VALUES } from "@peluvida/shared";

/**
 * 宠物档案更新参数（P0-06-02 · FR-1）
 *
 * 全字段可选（部分更新）；`version` 除外 —— **乐观锁必填**：
 * 与库内 `version` 不一致时抛 `PET_VERSION_CONFLICT`，防止并发互相覆盖。
 *
 * ⚠️ 与 CreatePetDto 同口径：**不声明 tenantId 字段**，请求参数伪造的
 * `tenant_id` 会被白名单剥离，租户归属恒由 JWT 上下文注入。
 */
export class UpdatePetDto {
  @ApiProperty({ description: "乐观锁版本号（创建时为 0，每次更新 +1）", required: true })
  @IsNotEmpty({ message: "版本号不能为空" })
  @Type(() => Number)
  @IsInt({ message: "版本号必须是整数" })
  @Min(0, { message: "版本号不能为负数" })
  version: number;

  @ApiProperty({ description: "宠物名", required: false, maxLength: 64 })
  @IsOptional()
  @IsString()
  @Length(1, 64, { message: "宠物名长度须在1~64个字符之间" })
  name?: string;

  @ApiProperty({ description: "主人客户档案 id", required: false, format: "uuid" })
  @IsOptional()
  @IsUUID(undefined, { message: "主人客户档案 id 必须是合法 UUID" })
  ownerCustomerId?: string;

  @ApiProperty({
    description: "宠物类型：1 犬 / 2 猫 / 9 其他",
    required: false,
    enum: PET_TYPE_VALUES,
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn(PET_TYPE_VALUES as unknown as number[], {
    message: "宠物类型仅允许 1（犬）/ 2（猫）/ 9（其他）",
  })
  petType?: number;

  @ApiProperty({ description: "归属门店 id（可空=租户级档案）", required: false, format: "uuid" })
  @IsOptional()
  @IsUUID(undefined, { message: "门店 id 必须是合法 UUID" })
  storeId?: string | null;

  @ApiProperty({ description: "品种", required: false, maxLength: 64 })
  @IsOptional()
  @IsString()
  @Length(1, 64, { message: "品种长度须在1~64个字符之间" })
  breed?: string | null;

  @ApiProperty({ description: "性别：1 公 / 2 母", required: false, enum: [1, 2] })
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2], { message: "性别仅允许 1（公）/ 2（母）" })
  gender?: number | null;

  @ApiProperty({ description: "生日（yyyy-MM-dd）", required: false })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "生日格式须为 yyyy-MM-dd" })
  birthday?: string | null;

  @ApiProperty({ description: "当前体重 kg（0.01~999.99，两位小数）", required: false })
  @IsOptional()
  @Matches(/^\d{1,3}(\.\d{1,2})?$/, { message: "体重须为 0~999.99 的数值（最多两位小数）" })
  weightKg?: string | null;

  @ApiProperty({ description: "毛色", required: false, maxLength: 32 })
  @IsOptional()
  @IsString()
  @Length(1, 32, { message: "毛色长度须在1~32个字符之间" })
  coatColor?: string | null;

  @ApiProperty({ description: "是否绝育（null=清除登记）", required: false })
  @IsOptional()
  @IsBoolean({ message: "绝育标记必须是布尔值" })
  sterilized?: boolean | null;

  @ApiProperty({ description: "芯片号", required: false, maxLength: 64 })
  @IsOptional()
  @IsString()
  @Length(1, 64, { message: "芯片号长度须在1~64个字符之间" })
  chipNo?: string | null;

  @ApiProperty({ description: "主图 URL", required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @Length(1, 500, { message: "主图 URL 长度不能超过500个字符" })
  photoUrl?: string | null;

  @ApiProperty({
    description: "多图 URL 数组（≤9 张；空数组=清空）",
    required: false,
    type: [String],
  })
  @IsOptional()
  @IsArray({ message: "多图必须是 URL 数组" })
  @ArrayMaxSize(9, { message: "多图最多 9 张" })
  @IsString({ each: true, message: "多图数组每一项必须是字符串 URL" })
  photos?: string[] | null;

  @ApiProperty({
    description: "行为标签 id 数组（空数组=清空全部关联）",
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
  remark?: string | null;
}
