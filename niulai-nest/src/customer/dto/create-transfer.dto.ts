import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString, IsUUID, Length } from "class-validator";

/**
 * 发起宠物转移申请参数（P0-05-03 · FR-2）
 *
 * ⚠️ 安全边界：不声明 tenantId / fromCustomerId —— 转出方由宠物当前归属推导
 * （服务端快照），租户归属只认 JWT payload；伪造字段被 DTO 白名单剥离。
 */
export class CreateTransferDto {
  @ApiProperty({ description: "目标客户（新主人）id", format: "uuid" })
  @IsNotEmpty({ message: "目标客户 id 不能为空" })
  @IsUUID(undefined, { message: "目标客户 id 必须是合法 UUID" })
  toCustomerId: string;

  @ApiProperty({ description: "申请理由", required: false, maxLength: 255 })
  @IsOptional()
  @IsString()
  @Length(1, 255, { message: "申请理由长度须在1~255个字符之间" })
  reason?: string;
}
