import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsUUID } from "class-validator";

/**
 * 绑定宠物归属参数（P0-05-03 · FR-2）
 *
 * ⚠️ 安全边界（对齐 CreateCustomerDto 口径）：**不声明 tenantId 字段** ——
 * 租户归属只来自 JWT payload（`RequestContext.getTenantId()`），DTO 白名单校验
 * （ValidationPipe whitelist）剥离请求里伪造的 `tenant_id`/`tenantId`。
 */
export class BindPetDto {
  @ApiProperty({ description: "宠物 id", format: "uuid" })
  @IsNotEmpty({ message: "宠物 id 不能为空" })
  @IsUUID(undefined, { message: "宠物 id 必须是合法 UUID" })
  petId: string;
}
