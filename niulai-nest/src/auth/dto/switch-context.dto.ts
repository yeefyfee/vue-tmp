import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

/**
 * 切换门店上下文请求体（P0-02-06 · POST /auth/switch-context）
 *
 * 仅接受门店ID；租户归属/启用状态由服务端按令牌上下文校验，
 * 不接受任何租户参数（租户只来自 JWT payload，PEL-11）。
 */
export class SwitchContextRequestDto {
  @ApiProperty({
    description: "目标门店ID（UUID，须为当前租户下启用状态门店）",
    format: "uuid",
    example: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  })
  @IsUUID(undefined, { message: "storeId 必须为合法 UUID" })
  storeId: string;
}

/**
 * 可切换门店选项（GET /auth/organizations 列表项）
 */
export class StoreOptionDto {
  @ApiProperty({ description: "门店ID" })
  id: string;

  @ApiProperty({ description: "门店名称" })
  name: string;

  @ApiProperty({ description: "门店编码" })
  code: string;

  @ApiProperty({ description: "状态（1 启用 / 0 停用）" })
  status: number;
}

/**
 * 切换门店上下文响应（POST /auth/switch-context）
 */
export class SwitchContextResultDto {
  @ApiProperty({ description: "内嵌 activeStoreId 的新访问令牌（refresh token 沿用原值）" })
  accessToken: string;

  @ApiProperty({
    description: "当前生效门店摘要",
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
    },
  })
  activeStore: { id: string; name: string };
}
