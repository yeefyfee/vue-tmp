import { Column, Entity, Index } from "typeorm";
import { BaseEntity } from "@/common/entities/base.entity";

/**
 * 物品-标签关联表
 *
 * 由 StorageService 在物品保存时整体重建，不做独立 CRUD 接口。
 */
@Entity("storage_item_tag")
@Index("uk_item_tag", ["itemId", "tagId"], { unique: true })
export class StorageItemTag extends BaseEntity {
  @Column({ name: "item_id", type: "bigint", comment: "物品ID" })
  itemId: string;

  @Column({ name: "tag_id", type: "bigint", comment: "标签ID" })
  tagId: string;
}
