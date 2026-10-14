import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from "class-validator";

import { BaseQueryDto } from "../../common/dto/base-query.dto";
import {
  EXPIRE_TRACKED_RECORD_TYPES,
  HEALTH_EXPIRY_LEVELS,
  HEALTH_REMINDER_WINDOW_DAYS,
} from "../pet-health.constants";
import type { HealthExpiryLevel } from "../pet-health.constants";

/**
 * 跨宠物健康到期提醒查询参数（MVP-WEB-05-02 · FR-2 / BR-1）
 *
 * 语义：**租户级**「待处理到期清单」——列出「疫苗(1)/驱虫(2) 且 expireDate 落在
 * `(-∞, 今日 + windowDays]`」的未软删记录（**含已过期**），据此支撑：
 *  ① PRD《Web端 · 页面功能》「到期低于 14 天自动红色预警」（`level=urgent`）；
 *  ② PRD《宠物管理》BR-1「寄养与日托入住前校验疫苗在有效期内，过期阻断入住并提示
 *     宠主补打」——已过期项即补打提醒的输入（`level=expired`）。
 *
 * ⚠️ 与 `HealthExpiryReminderService.scanAndEnqueue`（后台扫描入队）**口径差异**：
 * 扫描器只覆盖「今日 ~ 今日+N」的**未来**窗口（入队去重推送）；本查询**额外包含
 * 已过期项**（前台需要看到「谁该补打了」），故不直接复用扫描器结果。
 *
 * 分页沿用 `BaseQueryDto`（camelCase `pageNum/pageSize`，出参恒 snake_case，踩坑 53）；
 * `level` 为**派生维度**（由 `expireDate - 今日` 计算），故在 service 内内存过滤。
 */
export class QueryHealthExpiryReminderDto extends BaseQueryDto {
  @ApiProperty({
    description: "提醒窗口（天）：到期日 ≤ 今日+N 的记录纳入（含已过期）",
    required: false,
    default: HEALTH_REMINDER_WINDOW_DAYS,
    minimum: 1,
    maximum: 365,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: "提醒窗口必须是整数天" })
  @Min(1, { message: "提醒窗口最小 1 天" })
  @Max(365, { message: "提醒窗口最大 365 天" })
  windowDays?: number = HEALTH_REMINDER_WINDOW_DAYS;

  @ApiProperty({
    description: "紧急度筛选：expired 已过期 / urgent 14 天内 / soon 提醒窗口内",
    required: false,
    enum: HEALTH_EXPIRY_LEVELS,
  })
  @IsOptional()
  @IsIn([...HEALTH_EXPIRY_LEVELS], { message: "紧急度仅允许 expired/urgent/soon" })
  level?: HealthExpiryLevel;

  @ApiProperty({
    description: "记录类型（缺省=疫苗+驱虫）：1疫苗 2驱虫",
    required: false,
    enum: [...EXPIRE_TRACKED_RECORD_TYPES],
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn([...EXPIRE_TRACKED_RECORD_TYPES], { message: "记录类型仅允许 1（疫苗）或 2（驱虫）" })
  recordType?: number;

  @ApiProperty({ description: "限定宠物 id（缺省=全租户）", required: false })
  @IsOptional()
  @IsUUID("4", { message: "宠物 id 必须是合法 UUID" })
  petId?: string;
}
