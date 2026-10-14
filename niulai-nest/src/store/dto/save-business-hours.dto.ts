import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsNotEmpty, IsObject, Min } from "class-validator";

/**
 * 每周营业时段整存整取参数（P0-04-04 · FR-3）
 *
 * businessHours 结构校验（7 天键 / HH:mm / close > open / 每天 ≤3 段）在
 * service 层做（`BusinessHoursService.validateWeekly`，非法抛 A0436）——
 * class-validator 不便表达「对象键集合恒等于 7 天」这种形状约束，收口到
 * 纯函数校验便于单测全覆盖。
 *
 * ⚠️ 与门店档案 DTO 同口径：不声明 tenantId 字段，归属恒由 JWT 上下文注入。
 */
export class SaveBusinessHoursDto {
  @ApiProperty({
    description: "乐观锁版本号（取自 GET business-hours 返回的 version）",
    required: true,
  })
  @IsNotEmpty({ message: "版本号不能为空" })
  @Type(() => Number)
  @IsInt({ message: "版本号必须是整数" })
  @Min(0, { message: "版本号不能为负数" })
  version: number;

  @ApiProperty({
    description:
      '每周营业时段，如 {"mon":[["09:00","18:00"]],"tue":[],...}（7 天键必填，每天最多 3 段）',
    required: true,
    type: Object,
  })
  @IsNotEmpty({ message: "营业时段不能为空" })
  @IsObject({ message: "营业时段必须是 JSON 对象" })
  businessHours: Record<string, unknown>;
}
