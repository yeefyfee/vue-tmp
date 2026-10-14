import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

/**
 * 预约状态流转请求体（MVP-WEB-06-05）
 *
 * 适用动作：`confirm` / `checkin` / `start` / `complete` / `no-show`
 * （`reschedule` / `cancel` 因带业务必填字段另立 DTO）。
 *
 * PRD《Booking API》：「流转端点均为 POST，**请求体仅允许备注字段**」。故除 `remark`
 * 外只保留可选的 `version` 乐观锁 —— 它不是业务字段，而是**并发写入护栏**：
 * 与列表 / 详情读到的 `version` 不一致即说明期间有人改过这一单（含状态流转），
 * 由 service 层转成 30002（附 `current_status`）让前端刷新视图。
 *
 * 不带 `status` 字段：目标状态由**端点路径**唯一决定（`/confirm` 只能到 `confirmed`），
 * 若允许请求体传目标状态，就多出一个「可以不按端点走」的旁路（双源判据）。
 */
export class BookingTransitionDto {
  @ApiProperty({ description: "操作备注（可选）", required: false })
  @IsOptional()
  @IsString({ message: "备注必须是字符串" })
  @MaxLength(255, { message: "备注长度不得超过 255" })
  remark?: string;

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
