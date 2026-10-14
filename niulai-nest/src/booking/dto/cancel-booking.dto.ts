import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from "class-validator";

/**
 * 取消请求体（MVP-WEB-06-05 · PRD《Booking API》取消段）
 *
 * PRD：请求体 `reason`（必填）。「开始前 24 小时内取消按门店规则计费，响应返回
 * `fee_rule` 字段说明适用规则与金额」——故取消是**唯一有业务出参**的流转动作
 * （其余动作回显流转后的详情），出参含 `feeRule`。
 *
 * 「宠主端」判据**不放在请求体**：它由请求头 `X-Actor-Scope: owner` 承载
 * （见 `booking.constants.ts` 的边界说明）——请求体字段可被商家端伪造，
 * 会把「宠主 2 小时窗口」这条限制变成一句空话。
 */
export class CancelBookingDto {
  @ApiProperty({ description: "取消原因（必填）" })
  @IsString({ message: "取消原因必须是字符串" })
  @IsNotEmpty({ message: "取消原因不能为空" })
  @MaxLength(255, { message: "取消原因长度不得超过 255" })
  reason!: string;

  @ApiProperty({
    description: "乐观锁版本号（可选；传则要求与库内一致，否则按 30002 处理）",
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: "版本号必须是整数" })
  @Min(0, { message: "版本号不能为负数" })
  version?: number;
}
