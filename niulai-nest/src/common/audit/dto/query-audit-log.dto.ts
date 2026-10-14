import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

import { AUDIT_ACTION_KEYS, AUDIT_ENTITY_TYPE_KEYS } from "@peluvida/shared";

/**
 * 审计日志分页查询参数（P0-02-08 子任务 4）
 *
 * 分页口径（决策 A4 / Q5）：请求参数统一 `page / page_size`（snake_case），
 * 不沿用系统域的 pageNum / pageSize 历史命名（shared/pagination.ts 统一口径）。
 *
 * 筛选维度与索引对齐（勿改列名组合，避免无索引扫描）：
 *  - entityType + entityId   → idx_audit_entity(tenant_id, entity_type, entity_id, created_at)
 *  - operatorId              → idx_audit_operator(tenant_id, operator_id, created_at)
 *  - 仅时间区间              → idx_audit_tenant_time(tenant_id, created_at)
 */
export class QueryAuditLogDto {
  @ApiProperty({ description: "页码", required: false, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiProperty({
    description: "每页条数（上限 100）",
    required: false,
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  page_size?: number = 20;

  @ApiProperty({
    description: "审计对象类型（业务表名 slug，值域见 shared AuditEntityType）",
    required: false,
    enum: AUDIT_ENTITY_TYPE_KEYS as unknown as string[],
  })
  @IsOptional()
  @IsString()
  @IsIn(AUDIT_ENTITY_TYPE_KEYS as unknown as string[], {
    message: "entityType 不在合法值域内（见 AuditEntityType）",
  })
  entityType?: string;

  @ApiProperty({ description: "审计对象 ID（业务表主键字符串形态，精确匹配）", required: false })
  @IsOptional()
  @IsString()
  @MaxLength(64, { message: "entityId 最长 64 字符" })
  entityId?: string;

  @ApiProperty({ description: "操作人 ID（sys_user.id，纯数字字符串）", required: false })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: "operatorId 必须为纯数字字符串" })
  operatorId?: string;

  @ApiProperty({
    description: "审计动作（SmallInt，值域见 shared AuditAction）",
    required: false,
    enum: AUDIT_ACTION_KEYS as unknown as number[],
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn(AUDIT_ACTION_KEYS as unknown as number[], {
    message: "action 不在合法值域内（见 AuditAction）",
  })
  action?: number;

  @ApiProperty({
    description: "起始时间（含边界；ISO 8601 / yyyy-MM-dd [HH:mm[:ss]]）",
    required: false,
  })
  @IsOptional()
  @IsString()
  @MinLength(4)
  startDate?: string;

  @ApiProperty({
    description: "截止时间（含当天末尾 23:59:59.999；ISO 8601 / yyyy-MM-dd）",
    required: false,
  })
  @IsOptional()
  @IsString()
  @MinLength(4)
  endDate?: string;
}
