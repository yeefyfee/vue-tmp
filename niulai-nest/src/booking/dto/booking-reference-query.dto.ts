import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsOptional, IsUUID } from "class-validator";

/**
 * 预约创建表单 · 参考数据查询参数（P0-08-05；MVP-WEB-06-02）
 *
 * 供 `GET /bookings/reference/staffs` 与 `GET /bookings/reference/service-items`
 * 共用：两个参数都可选，不传即「全域」。
 *
 * `catType` 值域 = `service_category.cat_type`（1 洗护 / 2 美容 / 3 寄养 / 4 日托 /
 * 5 游泳 / 6 接送 / 7 训练 / 8 医疗合作 / 9 商品 / 10 套餐，见 schema 注释）。
 */
export class BookingReferenceQueryDto {
  @ApiProperty({
    description: "门店 ID（uuid，可选；用于收窄员工范围）",
    required: false,
    format: "uuid",
  })
  @IsOptional()
  @IsUUID("all", { message: "门店 ID 格式不正确" })
  storeId?: string;

  @ApiProperty({
    description: "业务大类（可选；用于收窄服务项范围）",
    required: false,
    enum: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { message: "业务大类仅允许 1~10" })
  catType?: number;
}
