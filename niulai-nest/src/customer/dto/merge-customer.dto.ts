import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsNotEmpty, IsOptional, IsUUID, Min } from "class-validator";

/**
 * 客户合并参数（P0-05-07 · FR-7）
 *
 * 语义：把 `sourceId`（被并入方）合并到 `targetId`（保留方）。
 * 合并后 source 归档（软删 + 备注追加），宠物归属 / 关联 / 触达记录迁往 target。
 *
 * ⚠️ 安全边界：不声明 tenantId —— 合并只在当前租户内进行（scoped 查询 fail-closed），
 * 伪造字段被 DTO 白名单（ValidationPipe whitelist）剥离。
 */
export class MergeCustomerDto {
  @ApiProperty({ description: "源客户（被并入方）id", format: "uuid" })
  @IsNotEmpty({ message: "源客户 id 不能为空" })
  @IsUUID(undefined, { message: "源客户 id 必须是合法 UUID" })
  sourceId: string;

  @ApiProperty({ description: "目标客户（保留方）id", format: "uuid" })
  @IsNotEmpty({ message: "目标客户 id 不能为空" })
  @IsUUID(undefined, { message: "目标客户 id 必须是合法 UUID" })
  targetId: string;

  @ApiProperty({
    description: "源客户期望版本号（可选，乐观锁；不符则拒绝合并）",
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: "版本号必须为整数" })
  @Min(0, { message: "版本号不能为负数" })
  version?: number;
}
