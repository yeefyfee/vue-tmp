import { ApiProperty } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";

/**
 * 工作台总览查询参数（MVP-WEB-03-02）
 *
 * `since` = 客户端上次拿到的 `revision` 指纹；命中则服务端只回轻量
 * `{ changed: false, revision }`（增量轮询）。
 *
 * ⚠️ `since` **声明为 string**：全局 `ValidationPipe` 开了 `enableImplicitConversion`，
 * 若声明成 boolean/number 会把不透明指纹字符串按隐式规则转换而失真（布尔陷阱见
 * 项目踩坑 101）。这里只做长度与类型约束，不做语义解析。
 */
export class DashboardOverviewQueryDto {
  @ApiProperty({
    description: "客户端上次的 revision 指纹（命中则返回 changed=false 的轻量响应）",
    required: false,
    maxLength: 128,
  })
  @IsOptional()
  @IsString()
  @MaxLength(128, { message: "since 长度不能超过 128" })
  since?: string;
}
