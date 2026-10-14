import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, Length } from "class-validator";

/** 拒绝宠物转移申请参数（P0-05-03 · FR-2） */
export class RejectTransferDto {
  @ApiProperty({ description: "拒绝理由", maxLength: 255 })
  @IsNotEmpty({ message: "拒绝理由不能为空" })
  @IsString()
  @Length(1, 255, { message: "拒绝理由长度须在1~255个字符之间" })
  rejectReason: string;
}
