/**
 * 订单分页查询参数（MVP-WEB-07-01 订单列表）
 *
 * 筛选维度：storeId / status / orderNo（前缀）/ 创建日期区间（createdAtStart ~ createdAtEnd，闭区间）。
 * 分页与排序沿用 `BaseQueryDto`（pageNum/pageSize/sortBy/order），
 * 排序白名单见 `order.constants.ts`（非法值回落默认 createdAt）。
 */

import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

import { BaseQueryDto } from "../../common/dto/base-query.dto";
import { ORDER_STATUS_VALUES } from "../order.constants";

export class QueryOrderDto extends BaseQueryDto {
  @ApiProperty({ description: "门店 ID（uuid）", required: false, format: "uuid" })
  @IsOptional()
  @IsUUID("all", { message: "门店 ID 格式不正确" })
  storeId?: string;

  @ApiProperty({
    description: "订单状态（值域见 @peluvida/shared OrderStatus）",
    required: false,
    enum: ORDER_STATUS_VALUES,
  })
  @IsOptional()
  @IsString()
  @IsIn(ORDER_STATUS_VALUES, { message: "订单状态不合法" })
  status?: string;

  @ApiProperty({ description: "订单单号（前缀匹配）", required: false, maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32, { message: "订单单号长度不得超过 32" })
  orderNo?: string;

  @ApiProperty({ description: "创建日期起（YYYY-MM-DD，闭区间）", required: false })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  createdAtStart?: string;

  @ApiProperty({ description: "创建日期止（YYYY-MM-DD，闭区间）", required: false })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  createdAtEnd?: string;
}
