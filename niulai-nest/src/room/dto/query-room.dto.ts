import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsOptional, IsString, IsUUID } from "class-validator";

import { BaseQueryDto } from "../../common/dto/base-query.dto";

/**
 * 房间分页查询参数（P0-04-03 · FR-2）
 *
 * 筛选维度：storeId / roomType / status / roomNo（前缀）；
 * 分页与排序沿用 `BaseQueryDto`（pageNum/pageSize/sortBy/order），
 * 排序白名单 createdAt/roomNo/roomType/status 由 service 收敛，非法值回落。
 */
export class QueryRoomDto extends BaseQueryDto {
  @ApiProperty({ description: "所属门店 ID（uuid）", required: false, format: "uuid" })
  @IsOptional()
  @IsUUID("all", { message: "门店 ID 格式不正确" })
  storeId?: string;

  @ApiProperty({
    description: "房型：1 笼位 / 2 独立房 / 3 猫房 / 4 狗房 / 5 VIP房 / 6 多宠房",
    required: false,
    enum: [1, 2, 3, 4, 5, 6],
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2, 3, 4, 5, 6], { message: "房型仅允许 1~6" })
  roomType?: number;

  @ApiProperty({
    description: "房态：1 空闲 / 2 在住 / 3 清扫中 / 4 维护中",
    required: false,
    enum: [1, 2, 3, 4],
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2, 3, 4], { message: "房态仅允许 1~4" })
  status?: number;

  @ApiProperty({ description: "房间编号（前缀匹配）", required: false, maxLength: 16 })
  @IsOptional()
  @IsString()
  roomNo?: string;
}
