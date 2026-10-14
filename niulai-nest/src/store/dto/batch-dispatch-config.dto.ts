import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsObject, IsUUID } from "class-validator";

/**
 * 总部批量下发配置参数（P0-04-06 · FR-5 骨架）
 *
 * 形态：`{ storeIds: uuid[]; config: 键值子集 }`。
 *
 * 校验分层：
 *  - DTO（本类）只做**形状**校验：storeIds 是 uuid 数组、config 是对象——
 *    不做 ArrayMinSize / 键合法性声明式约束，交由 service 层统一给出
 *    业务码（空 storeIds / 空 config → A0440；非法配置键或值 → A0437），
 *    因为 ValidationPipe 的校验失败会统一转 200 + A0400（存量前端口径），
 *    无法表达「请求级业务拒绝」的精确语义。
 *  - config 内键/值合法性：service 层逐键走 shared
 *    `isValidStoreConfigValue`（与单店 PATCH 同一校验源，写侧从严）。
 *
 * ⚠️ 不声明 tenantId 字段，归属恒由 JWT 上下文注入（与门店档案 DTO 同口径）。
 */
export class BatchDispatchConfigDto {
  @ApiProperty({
    description: "目标门店 id 列表（uuid；空数组在 service 层拒绝 A0440）",
    required: true,
    type: [String],
  })
  @IsArray({ message: "storeIds 必须是数组" })
  @IsUUID("all", { each: true, message: "storeIds 必须全部为合法 uuid" })
  @Type(() => String)
  storeIds: string[];

  @ApiProperty({
    description:
      "要下发的配置键子集（键 ∈ STORE_CONFIG_KEYS 六键；值须通过单键校验，非法键/值 A0437）",
    required: true,
    example: { pushEnabled: false, slotGranularityMin: 30 },
  })
  @IsObject({ message: "config 必须是对象" })
  config: Record<string, unknown>;
}
