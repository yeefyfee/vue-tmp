import { ApiProperty } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from "class-validator";

/**
 * 门店档案更新参数（P0-04-02）
 *
 * 全字段可选（部分更新）；`version` 除外 —— **乐观锁必填**：
 * 与库内 `version` 不一致时抛 `STORE_VERSION_CONFLICT`，防止并发互相覆盖。
 *
 * ⚠️ 与 CreateStoreDto 同口径：**不声明 tenantId 字段**，请求参数伪造的
 * `tenant_id` 会被白名单剥离，租户归属恒由 JWT 上下文注入。
 */
export class UpdateStoreDto {
  @ApiProperty({ description: "乐观锁版本号（创建时为 0，每次更新 +1）", required: true })
  @IsNotEmpty({ message: "版本号不能为空" })
  @Type(() => Number)
  @IsInt({ message: "版本号必须是整数" })
  @Min(0, { message: "版本号不能为负数" })
  version: number;

  @ApiProperty({ description: "门店名称", required: false, maxLength: 64 })
  @IsOptional()
  @IsString()
  @Length(1, 64, { message: "门店名称长度须在1~64个字符之间" })
  name?: string;

  @ApiProperty({ description: "门店编码（修改时校验租户内唯一）", required: false, maxLength: 32 })
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, { message: "门店编码仅允许字母、数字、下划线、中划线" })
  @Length(1, 32, { message: "门店编码长度须在1~32个字符之间" })
  code?: string;

  @ApiProperty({ description: "门店类型：1 直营 / 2 加盟", required: false, enum: [1, 2] })
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2], { message: "门店类型仅允许 1（直营）或 2（加盟）" })
  type?: number;

  @ApiProperty({ description: "省份（行政区划名）", required: false, maxLength: 32 })
  @IsOptional()
  @IsString()
  @Length(1, 32, { message: "省份长度须在1~32个字符之间" })
  province?: string;

  @ApiProperty({ description: "城市（行政区划名）", required: false, maxLength: 32 })
  @IsOptional()
  @IsString()
  @Length(1, 32, { message: "城市长度须在1~32个字符之间" })
  city?: string;

  @ApiProperty({ description: "区县（行政区划名）", required: false, maxLength: 32 })
  @IsOptional()
  @IsString()
  @Length(1, 32, { message: "区县长度须在1~32个字符之间" })
  district?: string;

  @ApiProperty({ description: "详细地址（不含省市区）", required: false, maxLength: 255 })
  @IsOptional()
  @IsString()
  @Length(1, 255, { message: "详细地址长度须在1~255个字符之间" })
  address?: string;

  @ApiProperty({ description: "经度（-180~180）", required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: "经度必须是数字" })
  @Min(-180, { message: "经度不能小于-180" })
  @Max(180, { message: "经度不能大于180" })
  longitude?: number;

  @ApiProperty({ description: "纬度（-90~90）", required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: "纬度必须是数字" })
  @Min(-90, { message: "纬度不能小于-90" })
  @Max(90, { message: "纬度不能大于90" })
  latitude?: number;

  @ApiProperty({ description: "门店联系电话", required: false, maxLength: 20 })
  @IsOptional()
  @IsString()
  @Length(1, 20, { message: "联系电话长度须在1~20个字符之间" })
  phone?: string;

  @ApiProperty({ description: "每周营业时段（FR-3）", required: false, type: Object })
  @IsOptional()
  @IsObject({ message: "营业时段必须是 JSON 对象" })
  businessHours?: Record<string, unknown>;

  @ApiProperty({ description: "门店级配置覆盖（FR-4）", required: false, type: Object })
  @IsOptional()
  @IsObject({ message: "门店配置必须是 JSON 对象" })
  config?: Record<string, unknown>;

  @ApiProperty({ description: "状态：1 启用 / 0 停用", required: false, enum: [1, 0] })
  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === null ? value : Number(value)))
  @IsIn([1, 0], { message: "状态仅允许 1（启用）或 0（停用）" })
  status?: number;
}
