import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from "class-validator";

/**
 * 创建预约请求体（P0-08-05；MVP-WEB-06-02 预约创建表单）
 *
 * 契约来源：PRD《Booking API》·「创建请求参数」表
 *  `store_id` / `pet_id` / `service_item_id` / `employee_id` / `room_id` / `start_at` / `remark`。
 *
 * 字段名映射（后端统一 camelCase，DB 列名保持 snake_case 由 Prisma 映射）：
 *  - PRD `service_item_id` → **`serviceId`**：DB 列即 `booking.service_id`，
 *    本轮以「服务类目树的叶子」承载服务项语义（schema 注释：「两级树，叶子挂服务项」；
 *    `service_item` 表属《服务管理》模块尚未建模）⇒ 刻意不再引出第三个字段名，
 *    避免同一列出现 PRD 名 / DB 名 / API 名三套口径。
 *
 * ⚠️ PRD 请求体**无** `customer_id`：客户由 `pet_id` 反查（`pet.owner_customer_id`），
 *    前端只选「客户 + 宠物」两级联动，天然保证一致性，不给调用方传错的机会。
 * ⚠️ PRD 请求体**无** `duration`：服务时长的权威来源应是服务项的时长字段（属服务管理
 *    模块），本轮以可选 `durationMinutes` 承接（缺省 60 分钟），记为边界。
 * ⚠️ `startAt` 走**墙钟串**口径（`yyyy-MM-dd HH:mm[:ss]`，按应用时区解释为瞬时），
 *    与 `booking_date`（DATE 列 UTC 午夜）刻意区分：前者是带时刻的排期锚点，
 *    后者是日历分组键（对齐 store_calendar 的既有双口径）。
 */
export class CreateBookingDto {
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
    description: "开始时间（墙钟串 yyyy-MM-dd HH:mm 或 yyyy-MM-dd HH:mm:ss，按门店时区解释）",
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

  @ApiProperty({ description: "备注（可选）", required: false, maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255, { message: "备注长度不得超过 255" })
  remark?: string;
}
