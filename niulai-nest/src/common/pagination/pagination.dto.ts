import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@peluvida/shared";

import type { OrderDirection } from "./pagination.types";

/** 合法排序方向值域（供 DTO 校验与 Swagger 枚举复用） */
export const ORDER_DIRECTIONS: readonly OrderDirection[] = ["asc", "desc"] as const;

/**
 * 统一分页 / 排序查询参数（P0-07-02）
 *
 * 口径与 `@peluvida/shared` 分页契约对齐：
 *  - 请求参数为 snake_case `page / page_size`（不沿用系统域历史 `pageNum / pageSize`）；
 *  - `page` 默认 1、`page_size` 默认 20、上限 100；
 *  - `sort` 为排序字段名（各端点须在 service 侧以白名单收敛）；
 *  - `order` 仅接受小写 `asc | desc`，缺省 `desc`。
 *
 * 与全局 `ValidationPipe`（`transform: true` + `enableImplicitConversion`）协同：
 * `@Type(() => Number)` 显式把 query 字符串转数字，`@IsInt/@Min/@Max` 做边界校验。
 * 各业务列表 DTO 继承本类并追加自身筛选维度即可。
 *
 * 用法示例（controller）：
 * ```ts
 * // export class QueryPetDto extends PaginationQueryDto {
 * //   @IsOptional() @IsString() name?: string;
 * // }
 * // @Get() list(@Query() query: QueryPetDto) { return this.petService.page(query); }
 * ```
 */
export class PaginationQueryDto {
  @ApiProperty({
    description: "页码（≥1）",
    required: false,
    default: DEFAULT_PAGE,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = DEFAULT_PAGE;

  @ApiProperty({
    description: `每页条数（1~${MAX_PAGE_SIZE}）`,
    required: false,
    default: DEFAULT_PAGE_SIZE,
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  page_size?: number = DEFAULT_PAGE_SIZE;

  @ApiProperty({
    description: "排序字段名（须落在各端点白名单内，非法值回退默认字段）",
    required: false,
  })
  @IsOptional()
  @IsString()
  sort?: string;

  @ApiProperty({
    description: "排序方向 asc | desc（默认 desc）",
    required: false,
    enum: ORDER_DIRECTIONS as unknown as string[],
    default: "desc",
  })
  @IsOptional()
  @IsIn(ORDER_DIRECTIONS as unknown as string[])
  order?: OrderDirection;
}
