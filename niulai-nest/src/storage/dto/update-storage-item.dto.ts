import { PartialType } from "@nestjs/swagger";
import { CreateStorageItemDto } from "./create-storage-item.dto";

/**
 * 修改物品（全部字段可选）
 */
export class UpdateStorageItemDto extends PartialType(CreateStorageItemDto) {}
