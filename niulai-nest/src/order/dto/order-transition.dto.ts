import { ApiProperty } from "@nestjs/swagger";
import { IsInt, Min } from "class-validator";

/**
 * 订单履约流转请求体（MVP-WEB-07-05 履约联动）
 *
 * `PUT /orders/:id/start`（开始服务，paid → in_progress）与
 * `PUT /orders/:id/complete`（完成服务，in_progress → completed）共用。
 *
 * 载荷只有 `version`：状态由服务端按当前状态机裁定（不接受调用方传目标状态，
 * 避免绕过状态机直改字段）。`version` 作乐观锁基准，与订单其余写端点同口径。
 */
export class OrderTransitionDto {
  @ApiProperty({ description: "乐观锁版本号（必填）" })
  @IsInt({ message: "版本号必须为整数" })
  @Min(0, { message: "版本号最小为 0" })
  version!: number;
}
