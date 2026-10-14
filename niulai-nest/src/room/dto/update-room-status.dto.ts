import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn } from "class-validator";

/**
 * 房态人工写入口参数（P0-04-03 · FR-2）
 *
 * 运行时房态口径：1 空闲 available / 2 在住 occupied / 3 清扫中 cleaning / 4 维护中 maintenance。
 * 其中 1/2/3 由 stay 状态机自动流转（后续任务），**人工写入口仅允许 4↔1 维护切换**。
 *
 * DTO 层先做「合法房态值域」校验（1~4）；服务层再收敛目标值 ∈ {1, 4}，
 * 其他目标值（含 2/3）拒绝并抛 `ROOM_STATUS_INVALID`（A0433，新错误码口径）。
 */
export class UpdateRoomStatusDto {
  @ApiProperty({
    description: "目标房态：仅允许 1（空闲）/ 4（维护中）；2/3 由 stay 状态机流转，人工不可写",
    enum: [1, 4],
    required: true,
  })
  @Type(() => Number)
  @IsIn([1, 2, 3, 4], { message: "房态仅允许 1~4" })
  status: number;
}
