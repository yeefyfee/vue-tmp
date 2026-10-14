import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from "class-validator";

/**
 * 冲突检测请求体（MVP-WEB-06-03 预约日历 · 拖拽改期前置校验）
 *
 * PRD《页面功能》预约日历：「拖拽卡片改期（**先本地预览，落库前做冲突检测**）」⇒
 * 把一个**候选排期**（门店 / 宠物 / 服务项 / 开始时间 / 时长 / 员工 / 房间）交给服务端，
 * 由服务端裁定「这个位置能不能放」。语义与创建 / 改期的**引用校验链一致**：门店 → 宠物
 * → 服务项 → 房间（同店）→ 员工（在职）→ 时间合法（含日历有效性回读），
 * 任一非法即沿用创建端错误码（A0802~A0808），**不新造错误码**（同一条规则不留给第二处判据，
 * 踩坑 126-bis）。
 *
 * 与创建请求体的三点差异：
 *  - `serviceId` **可选** —— 冲突检测算的是「宠物 / 员工 / 房间 / 时间」四维的交叠，
 *    **不依赖服务项**；且 06-01 播下的演示预约（`BK-DEMO-*`）`service_id` 为 NULL
 *    （服务项当时未建模，只有 `service_name` 快照）⇒ 若强行必填，拖动这些卡片会因
 *    DTO 校验（A0400）而非业务规则失败，等于「日历对既有数据不可用」；
 *  - `roomId` **不**因寄养类而必填 —— 检测常在「还没挑房间」时先问宠物 / 员工是否冲突，
 *    故此处 `requireFosterRoom = false`（对齐 PRD「先预览」）；
 *  - 多一个 `excludeBookingId` —— **改期**场景下被拖动的单自身当然与目标时段重叠，
 *    必须排除，否则任何改期都会被判成「与自己冲突」。
 */
export class ConflictCheckDto {
  @ApiProperty({ description: "门店 ID（uuid）", format: "uuid" })
  @IsUUID("all", { message: "门店 ID 格式不正确" })
  storeId!: string;

  @ApiProperty({ description: "宠物 ID（uuid）", format: "uuid" })
  @IsUUID("all", { message: "宠物 ID 格式不正确" })
  petId!: string;

  @ApiProperty({
    description: "服务项 ID（uuid，可选；冲突几何不依赖服务项）",
    required: false,
    format: "uuid",
  })
  @IsOptional()
  @IsUUID("all", { message: "服务项 ID 格式不正确" })
  serviceId?: string;

  @ApiProperty({ description: "指定员工 ID（uuid，可选）", required: false, format: "uuid" })
  @IsOptional()
  @IsUUID("all", { message: "员工 ID 格式不正确" })
  employeeId?: string;

  @ApiProperty({ description: "指定房间 ID（uuid，可选）", required: false, format: "uuid" })
  @IsOptional()
  @IsUUID("all", { message: "房间 ID 格式不正确" })
  roomId?: string;

  @ApiProperty({ description: "候选开始时间（墙钟串 yyyy-MM-dd HH:mm）" })
  @IsString()
  @MaxLength(32, { message: "开始时间长度不得超过 32" })
  startAt!: string;

  @ApiProperty({ description: "服务时长（分钟，可选，默认 60）", required: false })
  @IsOptional()
  @IsInt({ message: "服务时长不合法" })
  @Min(15, { message: "服务时长不合法" })
  @Max(1440, { message: "服务时长不合法" })
  durationMinutes?: number;

  @ApiProperty({
    description: "改期场景下排除的预约自身 ID（uuid，可选）",
    required: false,
    format: "uuid",
  })
  @IsOptional()
  @IsUUID("all", { message: "排除预约 ID 格式不正确" })
  excludeBookingId?: string;
}
