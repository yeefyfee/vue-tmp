import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsArray, IsNumber, IsOptional, IsString } from "class-validator";

import { BaseQueryDto } from "../../../common/dto/base-query.dto";

/**
 * 用户查询参数
 */
export class UserQueryDto extends BaseQueryDto {
  @ApiProperty({ description: "关键字(用户名/昵称/手机号)", required: false })
  @IsOptional()
  @IsString()
  keywords?: string;

  /**
   * 用户状态筛选。
   *
   * 🔴 空串必须归一到 `undefined`：前端筛选栏的 `el-select` 带 `clearable`，
   * **清空时 emit 的是 `''`**，而 `Number('') === 0` ⇒ 原写法会让「清空状态筛选」
   * 变成「只看禁用用户」。同文件 `deptId` 的 Transform 本来就有这个分支，`status` 是漏掉的那个。
   */
  @ApiProperty({ description: "用户状态(1-正常 0-禁用)", required: false })
  @IsOptional()
  @IsNumber()
  @Transform(({ value }) =>
    value === undefined || value === null || value === "" ? undefined : Number(value)
  )
  status?: number;

  @ApiProperty({ description: "部门ID", required: false })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === null || value === "" ? undefined : String(value)
  )
  @IsString()
  deptId?: string;

  @ApiProperty({ description: "角色ID集合", required: false, type: [Number] })
  @IsOptional()
  @IsArray()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === "") return undefined;
    if (Array.isArray(value)) return value.map((v) => String(v));
    return [String(value)];
  })
  @IsString({ each: true })
  roleIds?: string[];

  @ApiProperty({ description: "创建时间范围", required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  createTime?: string[];

  /**
   * 是否在列表中展示系统管理员（ROOT 角色）账号，`true` / `1` 为真。
   *
   * 🔴 这里**故意声明为 `string`**，而不是 `boolean`：
   * 全局 ValidationPipe 开着 `transformOptions.enableImplicitConversion`，它会按
   * TS 的 `design:type` 做隐式转换 —— 而 `Boolean("false") === true`（非空字符串恒为真）！
   * 一旦声明为 `boolean`，query 里的 `includeRoot=false` 会在进入 `@Transform` 之前
   * 就被隐式转成 `true`，最终表现为「关闭开关反而显示超管」。
   * 声明成 string 后隐式转换退化为 `String(...)`（原样保留），再由服务层严格归一。
   */
  @ApiProperty({ description: "是否包含系统管理员(ROOT)用户(true/1 为真)", required: false })
  @IsOptional()
  @IsString()
  includeRoot?: string;
}
