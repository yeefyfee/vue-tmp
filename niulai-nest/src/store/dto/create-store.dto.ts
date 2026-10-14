import { ApiProperty } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  IsIn,
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
 * 门店档案创建参数（P0-04-02）
 *
 * ⚠️ 安全边界：**不声明 tenantId 字段** —— 租户归属只来自 JWT payload
 * （`RequestContext.getTenantId()`，扩展层恒定覆盖），DTO 白名单校验
 * （ValidationPipe whitelist）会直接剥离请求里伪造的 `tenant_id`/`tenantId`。
 */
export class CreateStoreDto {
  @ApiProperty({ description: "门店编码（租户内唯一，slug 形式）", maxLength: 32 })
  @IsNotEmpty({ message: "门店编码不能为空" })
  @IsString()
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, { message: "门店编码仅允许字母、数字、下划线、中划线" })
  @Length(1, 32, { message: "门店编码长度须在1~32个字符之间" })
  code: string;

  @ApiProperty({ description: "门店名称", maxLength: 64 })
  @IsNotEmpty({ message: "门店名称不能为空" })
  @IsString()
  @Length(1, 64, { message: "门店名称长度须在1~64个字符之间" })
  name: string;

  @ApiProperty({ description: "门店类型：1 直营 / 2 加盟", enum: [1, 2], default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2], { message: "门店类型仅允许 1（直营）或 2（加盟）" })
  type?: number = 1;

  @ApiProperty({ description: "省份（行政区划名）", maxLength: 32 })
  @IsNotEmpty({ message: "省份不能为空" })
  @IsString()
  @Length(1, 32, { message: "省份长度须在1~32个字符之间" })
  province: string;

  @ApiProperty({ description: "城市（行政区划名）", maxLength: 32 })
  @IsNotEmpty({ message: "城市不能为空" })
  @IsString()
  @Length(1, 32, { message: "城市长度须在1~32个字符之间" })
  city: string;

  @ApiProperty({ description: "区县（行政区划名）", maxLength: 32 })
  @IsNotEmpty({ message: "区县不能为空" })
  @IsString()
  @Length(1, 32, { message: "区县长度须在1~32个字符之间" })
  district: string;

  @ApiProperty({ description: "详细地址（不含省市区）", maxLength: 255 })
  @IsNotEmpty({ message: "详细地址不能为空" })
  @IsString()
  @Length(1, 255, { message: "详细地址长度须在1~255个字符之间" })
  address: string;

  @ApiProperty({ description: "经度（-180~180，7 位小数）", required: false })
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

  @ApiProperty({ description: "门店联系电话", maxLength: 20 })
  @IsNotEmpty({ message: "联系电话不能为空" })
  @IsString()
  @Length(1, 20, { message: "联系电话长度须在1~20个字符之间" })
  phone: string;

  @ApiProperty({
    description: '每周营业时段（FR-3），如 {"mon":[["09:00","18:00"]],"tue":[]}',
    required: false,
    type: Object,
  })
  @IsOptional()
  @IsObject({ message: "营业时段必须是 JSON 对象" })
  businessHours?: Record<string, unknown>;

  @ApiProperty({
    description: "门店级配置覆盖（FR-4）",
    required: false,
    type: Object,
  })
  @IsOptional()
  @IsObject({ message: "门店配置必须是 JSON 对象" })
  config?: Record<string, unknown>;

  @ApiProperty({ description: "状态：1 启用 / 0 停用", enum: [1, 0], default: 1 })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === null || value === "" ? 1 : Number(value)
  )
  @IsIn([1, 0], { message: "状态仅允许 1（启用）或 0（停用）" })
  status?: number = 1;
}
