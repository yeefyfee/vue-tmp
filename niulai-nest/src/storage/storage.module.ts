import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { StorageService } from "./storage.service";
import { StorageController } from "./storage.controller";
import { StorageItem } from "./entities/storage-item.entity";
import { StorageCategory } from "./entities/storage-category.entity";
import { StorageTag } from "./entities/storage-tag.entity";
import { StorageItemTag } from "./entities/storage-item-tag.entity";

/**
 * 个人物品收纳模块
 *
 * 提供物品、分类、标签的完整管理能力，数据按 ownerId 隔离。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([StorageItem, StorageCategory, StorageTag, StorageItemTag]),
  ],
  controllers: [StorageController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
