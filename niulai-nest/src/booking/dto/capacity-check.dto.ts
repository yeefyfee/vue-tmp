import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from "class-validator";

/**
 * 容量预校验请求体（MVP-WEB-06-04 容量校验 API）
 *
 * 契约来源：PRD《Booking API》·「创建与容量校验」——
 * 「容量预校验端点**请求体与创建一致**，响应返回 `available`（布尔）、
 *   `conflicts`（冲突明细：房间、员工、时段容量）与 `suggestions`（可替代时段列表）」。
 *
 * 故字段与 `CreateBookingDto` **逐字对齐**（含 `serviceId` 必填、寄养类房间必填）：
 * 本端点回答的是「这一次创建**能不能成**」，请求体若与创建不一致，答案就不适用于创建。
 *
 * 与创建请求体的**唯一**差异：多一个 `excludeBookingId` ——
 * 改期（06-05）复跑同一校验时，被改期的单自身当然与目标时段重叠，必须排除自己；
 * 创建场景不传即可（缺省 null）。刻意**不**把服务项做成可选（那是 `conflict-check`
 * 的形态：冲突检测算的是「宠物 / 员工 / 房间 / 时间」四维几何，与服务项无关）。
 */
export class CapacityCheckDto {
  @ApiProperty({ description: "门店 ID（uuid）", format: "uuid" })
  @IsUUID("all", { message: "门店 ID 格式不正确" })
  storeId!: string;

  @ApiProperty({ description: "宠物 ID（uuid）", format: "uuid" })
  @IsUUID("all", { message: "宠物 ID 格式不正确" })
  petId!: string;

  @ApiProperty({ description: "服务项 ID（uuid，服务类目树叶子）", format: "uuid" })
  @IsUUID("all", { message: "服务项 ID 格式不正确" })
  serviceId!: string;

  @ApiProperty({ description: "指定员工 ID（uuid，可选）", required: false, format: "uuid" })
  @IsOptional()
  @IsUUID("all", { message: "员工 ID 格式不正确" })
  employeeId?: string;

  @ApiProperty({
    description: "指定房间 ID（uuid；寄养类服务必填）",
    required: false,
    format: "uuid",
  })
  @IsOptional()
  @IsUUID("all", { message: "房间 ID 格式不正确" })
  roomId?: string;

  @ApiProperty({
    description: "候选开始时间（墙钟串 yyyy-MM-dd HH:mm，按门店时区解释）",
    example: "2026-10-15 09:30",
  })
  @IsString({ message: "开始时间必须为字符串" })
  @Matches(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/, {
    message: "开始时间格式应为 yyyy-MM-dd HH:mm",
  })
  startAt!: string;

  @ApiProperty({
    description: "服务时长（分钟，可选，默认 60）",
    required: false,
    minimum: 15,
    maximum: 1440,
  })
  @IsOptional()
  @IsInt({ message: "服务时长必须为整数" })
  @Min(15, { message: "服务时长不得少于 15 分钟" })
  @Max(1440, { message: "服务时长不得超过 1440 分钟" })
  durationMinutes?: number;

  @ApiProperty({
    description: "改期场景下排除的预约自身 ID（uuid，可选）",
    required: false,
    format: "uuid",
  })
  @IsOptional()
  @IsUUID("all", { message: "排除预约 ID 格式不正确" })
  excludeBookingId?: string;

  @ApiProperty({ description: "备注（可选；本端点不消费，仅为与创建请求体对齐）", required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255, { message: "备注长度不得超过 255" })
  remark?: string;
}
