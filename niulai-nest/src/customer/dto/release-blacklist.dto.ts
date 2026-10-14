import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, Length } from "class-validator";

/**
 * 解除黑名单参数（MVP-WEB-04-02 · 补齐 PRD《客户管理》BR-2 / 验收要点 3）
 *
 * PRD《客户管理》BR-2：「黑名单操作需店长以上权限；**移出黑名单必须填写原因**
 * 并记录审计日志」；《Customer API》§黑名单：「移出黑名单必须填写原因；加入与
 * 移出均写审计日志」。故 `reason` 为**必填**（1~255，对齐 DB 列
 * `blacklist.release_reason VARCHAR(255)`），与拉黑原因同为业务留痕字段。
 *
 * ⚠️ 安全边界（对齐 CreateBlacklistDto 口径）：不声明 customerId / blacklistId /
 * operatorId —— 客户由路径 `:id`、记录由路径 `:blacklistId` 锚定，操作人由服务端
 * 从上下文注入；伪造字段被 DTO 白名单剥离。
 */
export class ReleaseBlacklistDto {
  @ApiProperty({ description: "解除原因", maxLength: 255, example: "误操作，已与客户核实" })
  @IsNotEmpty({ message: "解除原因不能为空" })
  @IsString()
  @Length(1, 255, { message: "解除原因长度须在1~255个字符之间" })
  reason: string;
}
