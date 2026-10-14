import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from "class-validator";

/**
 * 房间更新参数（P0-04-03 · FR-2）
 *
 * `version` 乐观锁必填：与库内 `version` 不一致时抛 `ROOM_VERSION_CONFLICT`。
 *
 * ⚠️ 不可更新字段（刻意收敛）：
 *  - `storeId`：房间物理归属门店，不支持跨店迁移（换店 = 删旧建新）；
 *  - `status`：运行时房态，人工写入口仅维护切换端点（PATCH /rooms/:id/status，仅 4↔1），
 *    1/2/3 由 stay 状态机自动流转（后续任务）。
 *
 * ⚠️ 与 CreateRoomDto 同口径：**不声明 tenantId 字段**，请求参数伪造的
 * `tenant_id` 会被白名单剥离，租户归属恒由 JWT 上下文注入。
 */
export class UpdateRoomDto {
  @ApiProperty({ description: "乐观锁版本号（创建时为 0，每次更新 +1）", required: true })
  @IsNotEmpty({ message: "版本号不能为空" })
  @Type(() => Number)
  @IsInt({ message: "版本号必须是整数" })
  @Min(0, { message: "版本号不能为负数" })
  version: number;

  @ApiProperty({
    description: "房间编号（变更时校验同门店内唯一）",
    required: false,
    maxLength: 16,
  })
  @IsOptional()
  @IsString()
  @Length(1, 16, { message: "房间编号长度须在1~16个字符之间" })
  roomNo?: string;

  @ApiProperty({ description: "房间名称（展示用）", required: false, maxLength: 64 })
  @IsOptional()
  @IsString()
  @Length(1, 64, { message: "房间名称长度须在1~64个字符之间" })
  name?: string;

  @ApiProperty({
    description: "房型：1 笼位 / 2 独立房 / 3 猫房 / 4 狗房 / 5 VIP房 / 6 多宠房",
    required: false,
    enum: [1, 2, 3, 4, 5, 6],
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2, 3, 4, 5, 6], { message: "房型仅允许 1~6" })
  roomType?: number;

  @ApiProperty({ description: "容量（可同时容纳宠物数）", required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: "容量必须是整数" })
  @Min(1, { message: "容量不能小于1" })
  @Max(32767, { message: "容量超出上限" })
  capacity?: number;

  @ApiProperty({ description: "适用宠物体重段", required: false, type: Object })
  @IsOptional()
  @IsObject({ message: "适用体重段必须是 JSON 对象或数组" })
  allowPetSize?: Record<string, unknown> | Array<Record<string, unknown>>;
}
