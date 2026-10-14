import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

/**
 * 订单明细项输入（MVP-WEB-07-03 订单生成与组合明细）
 *
 * `itemType=1`（服务）时 `refId` 指向 `service_category` 叶子 id，
 * `itemName` / `unitPrice` 落库即固化为价格快照（PRD《订单管理》）。
 * `itemType=2/3`（商品/套餐）尚无被引实体模型 ⇒ `refId` 由调用方给任意 uuid，
 * `itemName` / `unitPrice` 仍为必填快照。
 */
export class OrderItemInputDto {
  @ApiProperty({ description: "明细类型（1=服务 / 2=商品 / 3=套餐）", minimum: 1, maximum: 3 })
  @IsInt({ message: "明细类型必须为整数" })
  @Min(1, { message: "明细类型最小为 1" })
  @Max(3, { message: "明细类型最大为 3" })
  itemType!: number;

  @ApiProperty({ description: "关联对象 ID（uuid）", format: "uuid" })
  @IsUUID("all", { message: "关联对象 ID 格式不正确" })
  refId!: string;

  @ApiProperty({ description: "明细名称（价格快照）", maxLength: 64 })
  @IsString({ message: "明细名称必须为字符串" })
  @MaxLength(64, { message: "明细名称长度不得超过 64" })
  itemName!: string;

  @ApiProperty({ description: "单价（分，非负整数字符串承载 BigInt）", example: "12800" })
  @IsString({ message: "单价必须为字符串" })
  @Matches(/^\d{1,10}$/, { message: "单价必须为非负整数字符串（分）" })
  unitPrice!: string;

  @ApiProperty({ description: "数量", minimum: 1, maximum: 999, default: 1 })
  @IsInt({ message: "数量必须为整数" })
  @Min(1, { message: "数量最小为 1" })
  @Max(999, { message: "数量最大为 999" })
  quantity!: number;
}

/**
 * 创建订单请求体（MVP-WEB-07-03 订单生成）
 *
 * 订单创建固定为 `draft` 状态（PRD：draft 锁定价格快照）；
 * `totalAmount` / `payableAmount` 由服务端按明细合计计算，不接受调用方传值。
 */
export class CreateOrderDto {
  @ApiProperty({ description: "门店 ID（uuid）", format: "uuid" })
  @IsUUID("all", { message: "门店 ID 格式不正确" })
  storeId!: string;

  @ApiProperty({ description: "客户 ID（uuid）", format: "uuid" })
  @IsUUID("all", { message: "客户 ID 格式不正确" })
  customerId!: string;

  @ApiProperty({ description: "宠物 ID（uuid）", format: "uuid" })
  @IsUUID("all", { message: "宠物 ID 格式不正确" })
  petId!: string;

  @ApiProperty({ description: "来源预约 ID（uuid，可选）", required: false, format: "uuid" })
  @IsOptional()
  @IsUUID("all", { message: "来源预约 ID 格式不正确" })
  sourceBookingId?: string;

  @ApiProperty({ description: "订单明细列表", type: [OrderItemInputDto] })
  @ValidateNested({ each: true })
  @ArrayMinSize(1, { message: "订单明细不能为空" })
  @Type(() => OrderItemInputDto)
  items!: OrderItemInputDto[];

  @ApiProperty({ description: "备注（可选）", required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: "备注长度不得超过 500" })
  remark?: string;

  @ApiProperty({ description: "赊账标记（可选，默认 false）", required: false, default: false })
  @IsOptional()
  @IsString()
  creditFlag?: string;
}

/**
 * 编辑订单请求体（MVP-WEB-07-03）
 *
 * 仅 `draft` / `pending_payment` 状态可编辑（PRD 验收要点）。
 * `version` 为乐观锁基准（必填）；`items` 为**全量替换**语义。
 */
export class UpdateOrderDto {
  @ApiProperty({ description: "乐观锁版本号（必填）" })
  @IsInt({ message: "版本号必须为整数" })
  @Min(0, { message: "版本号最小为 0" })
  version!: number;

  @ApiProperty({ description: "订单明细列表（全量替换）", type: [OrderItemInputDto] })
  @ValidateNested({ each: true })
  @ArrayMinSize(1, { message: "订单明细不能为空" })
  @Type(() => OrderItemInputDto)
  items!: OrderItemInputDto[];

  @ApiProperty({ description: "备注（可选）", required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: "备注长度不得超过 500" })
  remark?: string;

  @ApiProperty({ description: "赊账标记（可选）", required: false })
  @IsOptional()
  @IsString()
  creditFlag?: string;
}
