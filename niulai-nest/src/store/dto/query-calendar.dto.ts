import { ApiProperty } from "@nestjs/swagger";
import { Matches } from "class-validator";

/**
 * 门店日历按月查询参数（P0-04-04 · FR-3）
 *
 * month 固定 `yyyy-MM` 形态（01~12 月硬约束），服务端按应用无关的
 * 纯日期算术换算为 DATE 列闭开区间查询。
 */
export class QueryCalendarDto {
  @ApiProperty({ description: "查询月份（yyyy-MM，如 2026-10）", required: true })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: "月份格式必须为 yyyy-MM（01~12）" })
  month: string;
}
