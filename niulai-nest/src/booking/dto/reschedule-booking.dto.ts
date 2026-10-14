import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Max,
  Min,
} from "class-validator";

/**
 * 改期请求体（MVP-WEB-06-05 · PRD《Booking API》改期段）
 *
 * PRD 契约：`start_at`（新时间，必填）、`room_id`（寄养改房时必填）、`reason`（必填）。
 *
 * 服务端流程（PRD 第 1~4 条）：
 *  ① 对新时段执行容量校验，失败返回 30001 并附 `suggestions`；
 *  ② 通过后**原预约置 `rescheduled`**，并**生成新预约**承担新时段（`prev_booking_id` 互链）；
 *  ③ 同一链累计改期**超过 3 次**需店长角色二次确认，否则 30003；
 *  ④ 写时间线（通知派发归 06-06）。
 *
 * 两个字段的取值口径与创建端刻意对齐：
 *  · `startAt` 与创建端同用**墙钟串**（`yyyy-MM-dd HH:mm`），由 `parseBookingStart`
 *    回读年月日分量（拒 `2026-02-31` 这类「格式合法但日历不存在」的值 → A0808）；
 *  · `durationMinutes` 与创建端同义（服务项时长未建模前以入参承接，缺省 60 分钟）。
 */
export class RescheduleBookingDto {
  @ApiProperty({ description: "新的开始时间（墙钟串 yyyy-MM-dd HH:mm）" })
  @IsString({ message: "开始时间必须是字符串" })
  @IsNotEmpty({ message: "开始时间不能为空" })
  @Matches(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/, {
    message: "开始时间格式必须为 yyyy-MM-dd HH:mm",
  })
  startAt!: string;

  @ApiProperty({
    description: "新的房间 ID（uuid，可选；寄养改房时必填）",
    required: false,
    format: "uuid",
  })
  @IsOptional()
  @IsUUID("all", { message: "房间 ID 格式不正确" })
  roomId?: string;

  @ApiProperty({ description: "改期原因（必填）" })
  @IsString({ message: "改期原因必须是字符串" })
  @IsNotEmpty({ message: "改期原因不能为空" })
  @MaxLength(255, { message: "改期原因长度不得超过 255" })
  reason!: string;

  @ApiProperty({ description: "新时段服务时长（分钟，可选，默认 60）", required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: "服务时长不合法" })
  @Min(15, { message: "服务时长不合法" })
  @Max(1440, { message: "服务时长不合法" })
  durationMinutes?: number;

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
