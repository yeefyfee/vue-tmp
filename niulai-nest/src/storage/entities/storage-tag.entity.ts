import { Column, Entity } from "typeorm";
import { BaseEntity } from "@/common/entities/base.entity";

/**
 * 收纳标签
 *
 * 物品与标签是多对多关系，物品侧通过 storage_item_tag 中间表维护。
 */
@Entity("storage_tag")
export class StorageTag extends BaseEntity {
  @Column({ length: 50, comment: "标签名称" })
  name: string;

  @Column({ name: "color", length: 20, nullable: true, comment: "标签颜色(如 #FF7A45)" })
  color?: string | null;

  @Column({ name: "owner_id", type: "bigint", nullable: true, comment: "归属用户ID(NULL 表示公共标签)" })
  ownerId?: string | null;
}
