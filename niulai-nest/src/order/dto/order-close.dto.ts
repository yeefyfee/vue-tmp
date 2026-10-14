import { ApiProperty } from "@nestjs/swagger";
import { IsInt, Min } from "class-validator";

/**
 * 订单关闭请求体（MVP-WEB-07-06 订单关闭）
 *
 * `PUT /orders/:id/close`（待支付态「取消」→ closed）。
 *
 * 载荷只有 `version`：目标状态与关闭原因由服务端裁定 —— 状态固定 `pending_payment → closed`、
 * 原因固定 `customer_cancel`（客户取消），不接受调用方传目标状态或原因，
 * 避免绕过状态机直改字段（与 07-05 `OrderTransitionDto` 同口径）。
 */
export class CloseOrderDto {
  @ApiProperty({ description: "乐观锁版本号（必填）" })
  @IsInt({ message: "版本号必须为整数" })
  @Min(0, { message: "版本号最小为 0" })
  version!: number;
}
