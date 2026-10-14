import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from "class-validator";

/**
 * 房间创建参数（P0-04-03 · FR-2）
 *
 * ⚠️ 安全边界：**不声明 tenantId 字段** —— 租户归属只来自 JWT payload
 * （`RequestContext.getTenantId()`，扩展层恒定覆盖），DTO 白名单校验
 * （ValidationPipe whitelist）会直接剥离请求里伪造的 `tenant_id`/`tenantId`。
 *
 * ⚠️ status 是运行时房态（1 空/2 在住/3 清扫/4 维护），**不在创建入参内**：
 * 创建即空闲（schema 默认 1），后续由 stay 状态机自动流转；
 * 人工写入口仅有维护切换端点（PATCH /rooms/:id/status，仅 4↔1）。
 */
export class CreateRoomDto {
  @ApiProperty({ description: "所属门店 ID（uuid，须为本租户内未软删门店）", format: "uuid" })
  @IsNotEmpty({ message: "所属门店不能为空" })
  @IsUUID("all", { message: "门店 ID 格式不正确" })
  storeId: string;

  @ApiProperty({ description: "房间编号（同门店内唯一，如 A03）", maxLength: 16 })
  @IsNotEmpty({ message: "房间编号不能为空" })
  @IsString()
  @Length(1, 16, { message: "房间编号长度须在1~16个字符之间" })
  roomNo: string;

  @ApiProperty({
    description: "房间名称（展示用，可空；看板优先显示名称）",
    required: false,
    maxLength: 64,
  })
  @IsOptional()
  @IsString()
  @Length(1, 64, { message: "房间名称长度须在1~64个字符之间" })
  name?: string;

  @ApiProperty({
    description:
      "房型：1 笼位 kennel / 2 独立房 suite / 3 猫房 cat / 4 狗房 dog / 5 VIP房 vip / 6 多宠房 multi",
    enum: [1, 2, 3, 4, 5, 6],
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2, 3, 4, 5, 6], { message: "房型仅允许 1~6" })
  roomType?: number = 1;

  @ApiProperty({ description: "容量（可同时容纳宠物数，多宠房 >1）", required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: "容量必须是整数" })
  @Min(1, { message: "容量不能小于1" })
  @Max(32767, { message: "容量超出上限" })
  capacity?: number = 1;

  @ApiProperty({
    description: '适用宠物体重段（PRD allow_pet_size），如 [{"min_kg":0,"max_kg":10}]',
    required: false,
    type: Object,
  })
  @IsOptional()
  @IsObject({ message: "适用体重段必须是 JSON 对象或数组" })
  allowPetSize?: Record<string, unknown> | Array<Record<string, unknown>>;
}
