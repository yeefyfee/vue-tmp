import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsNumber, IsObject, IsOptional, IsString, Length } from "class-validator";

import { TenantPlan } from "@peluvida/shared";

/**
 * 租户更新参数（P0-03-04 · 平台侧 PATCH /tenants/:id）
 *
 * 可更新字段：name / status / plan / featureFlags（DTO 白名单剥离其余伪造参数）。
 *
 * plan → feature_flags 同步规则（service 层裁决）：
 *  - 请求带 `plan` 且**未显式带** `featureFlags` → feature_flags 整体覆写为
 *    该套餐预设（shared `TENANT_PLAN_PRESETS`），保证「切换套餐后能力开关随之变化」；
 *  - 请求同时显式带 `featureFlags` → 以请求值为准（平台定制覆盖预设）；
 *  - 仅带 `featureFlags` 不带 `plan` → 精修当前能力开关，plan 不动。
 */
export class UpdateTenantDto {
  @ApiProperty({ description: "租户名称（展示）", required: false, maxLength: 64 })
  @IsOptional()
  @IsString()
  @Length(1, 64, { message: "租户名称长度需在 1~64 之间" })
  name?: string;

  @ApiProperty({ description: "状态：1 启用 / 0 停用", required: false, enum: [1, 0] })
  @IsOptional()
  @IsNumber({}, { message: "状态必须是数字" })
  @IsIn([1, 0], { message: "状态仅允许 1（启用）或 0（停用）" })
  status?: number;

  @ApiProperty({
    description: "套餐标识（变更时 feature_flags 同步为套餐预设，除非显式带 featureFlags）",
    required: false,
    enum: Object.values(TenantPlan),
  })
  @IsOptional()
  @IsIn(Object.values(TenantPlan) as string[], {
    message: "套餐仅允许 starter / professional / business",
  })
  plan?: string;

  @ApiProperty({
    description: "能力开关覆盖（键为 TenantCapability 合法键，值为布尔）",
    required: false,
    type: Object,
  })
  @IsOptional()
  @IsObject({ message: "featureFlags 必须是对象" })
  featureFlags?: Record<string, unknown>;
}
