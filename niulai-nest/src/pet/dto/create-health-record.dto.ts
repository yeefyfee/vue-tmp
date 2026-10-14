import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsNotEmpty, IsOptional, IsString, Length, Matches } from "class-validator";

import { DATE_ONLY_PATTERN, HEALTH_RECORD_TYPE_VALUES } from "../pet-health.constants";

/**
 * 健康档案建档参数（P0-06-03 · FR-2）
 *
 * ⚠️ 安全边界（对齐 CreatePetDto 口径）：**不声明 tenantId 字段** —— 租户归属只来自
 * JWT payload（`RequestContext.getTenantId()`，租户扩展层恒定覆盖），DTO 白名单
 * 校验（ValidationPipe whitelist）剥离请求里伪造的 `tenant_id`/`tenantId`。
 */
export class CreateHealthRecordDto {
  @ApiProperty({
    description: "记录类型：1疫苗 2驱虫 3过敏 4用药 5绝育 6慢病",
    enum: HEALTH_RECORD_TYPE_VALUES,
  })
  @Type(() => Number)
  @IsIn(HEALTH_RECORD_TYPE_VALUES, {
    message: "记录类型仅允许 1~6（疫苗/驱虫/过敏/用药/绝育/慢病）",
  })
  recordType: number;

  @ApiProperty({ description: "记录日期（yyyy-MM-dd）" })
  @IsNotEmpty({ message: "记录日期不能为空" })
  @IsString()
  @Matches(DATE_ONLY_PATTERN, { message: "记录日期格式须为 yyyy-MM-dd" })
  recordDate: string;

  @ApiProperty({ description: "到期日期（疫苗/驱虫复种到期；yyyy-MM-dd）", required: false })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY_PATTERN, { message: "到期日期格式须为 yyyy-MM-dd" })
  expireDate?: string;

  @ApiProperty({
    description: "内容摘要（疫苗厂家/批次、用药剂量等）",
    required: false,
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @Length(0, 500, { message: "内容摘要长度不能超过500个字符" })
  content?: string;

  @ApiProperty({
    description: "操作人（sys_user id，数字字符串；缺省=当前登录用户）",
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: "操作人 id 必须为数字字符串" })
  operatorId?: string;
}
