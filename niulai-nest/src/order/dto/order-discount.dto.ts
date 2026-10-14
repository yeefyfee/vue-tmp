import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsString, Matches, Min } from "class-validator";

/**
 * 设置订单优惠请求体（MVP-WEB-07-04 优惠与权益分摊）
 *
 * `PUT /orders/:id/discount` 的载荷。**唯一判据是订单级优惠额**（`discountAmount`，分）——
 * 服务端按明细行小计比例分摊后写 `order_item.discount_amount`，不接受「按行给优惠」
 * 的第二套输入（同一判据不留两源）。
 *
 * `discountAmount = "0"` 表示**清除优惠**（行优惠归零、来源回 `NONE`）。
 */
export class UpdateOrderDiscountDto {
  @ApiProperty({ description: "乐观锁版本号（必填）" })
  @IsInt({ message: "版本号必须为整数" })
  @Min(0, { message: "版本号最小为 0" })
  version!: number;

  @ApiProperty({
    description: "订单优惠额（分，非负整数字符串；0 = 清除优惠）",
    example: "800",
  })
  @IsString({ message: "优惠金额必须为字符串" })
  @Matches(/^\d{1,10}$/, { message: "优惠金额必须为非负整数字符串（分）" })
  discountAmount!: string;
}
