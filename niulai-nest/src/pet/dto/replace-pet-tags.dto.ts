import { ApiProperty } from "@nestjs/swagger";
import { ArrayMaxSize, IsArray, IsUUID } from "class-validator";

/**
 * 宠物-行为标签全量替换参数（P0-06-05 · FR-4）
 *
 * **语义为「全量替换」**（非增量）：以本数组为「宠物最终拥有的标签集合」，
 * 与库内既有 `pet_behavior_tag` 关联做差集后增删（服务层先清后建）。
 * 空数组 `[]` = 清空该宠物全部行为标签。
 *
 * 与既有 `UpdatePetDto.behaviorTagIds` 保持**同一范式**（P0-06-02 已实现的全量
 * 替换），因此对同一宠物「打/取消标签」的推荐入口为：
 *  - 组合在档案更新里：`PUT /pets/:id`（携带 behaviorTagIds）；
 *  - 只改标签的独立入口：`PUT /pets/:id/tags`（本 DTO）——避免为了改标签而
 *    被迫回传 version（标签替换不参与 pet 乐观锁）。
 *
 * ⚠️ 采用「全量替换」而非「POST/DELETE /pets/:id/tags/:tagId 单点操作」：
 * 与既有 behaviorTagIds 语义统一，避免两套口径并存（任务书二选一，此处选全量替换）。
 */
export class ReplacePetTagsDto {
  @ApiProperty({ description: "宠物最终拥有的行为标签 id 全量集合（空数组=清空）", type: [String] })
  @IsArray({ message: "behaviorTagIds 必须是 id 数组" })
  @ArrayMaxSize(20, { message: "行为标签最多 20 个" })
  @IsUUID(undefined, { each: true, message: "行为标签 id 必须是合法 UUID" })
  behaviorTagIds: string[];
}
