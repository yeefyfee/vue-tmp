import { Column, Entity } from "typeorm";
import { BaseEntity } from "@/common/entities/base.entity";

/**
 * 收纳物品
 *
 * 一个物品归属唯一分类(category_id)，并通过 storage_item_tag 关联多个标签。
 */
@Entity("storage_item")
export class StorageItem extends BaseEntity {
  @Column({ length: 100, comment: "物品名称" })
  name: string;

  @Column({ name: "category_id", type: "bigint", nullable: true, comment: "所属分类ID" })
  categoryId?: string | null;

  @Column({ name: "cover_url", length: 500, nullable: true, comment: "封面图URL" })
  coverUrl?: string | null;

  @Column({ name: "image_urls", type: "json", nullable: true, comment: "图片URL列表" })
  imageUrls?: string[] | null;

  @Column({ name: "quantity", type: "int", default: 1, comment: "数量" })
  quantity: number;

  @Column({ name: "unit", length: 20, nullable: true, comment: "单位(个/件/盒...)" })
  unit?: string | null;

  @Column({ name: "price", type: "decimal", precision: 12, scale: 2, nullable: true, comment: "单价" })
  price?: number | null;

  @Column({ name: "purchase_date", type: "date", nullable: true, comment: "购置日期" })
  purchaseDate?: Date | null;

  @Column({ name: "expire_date", type: "date", nullable: true, comment: "过期日期" })
  expireDate?: Date | null;

  @Column({ name: "location", length: 200, nullable: true, comment: "存放位置描述" })
  location?: string | null;

  @Column({ name: "remark", type: "text", nullable: true, comment: "备注" })
  remark?: string | null;

  @Column({ name: "status", type: "tinyint", default: 1, comment: "状态(1-在库 0-已归档)" })
  status: number;

  @Column({ name: "owner_id", type: "bigint", comment: "归属用户ID" })
  ownerId: string;
}
