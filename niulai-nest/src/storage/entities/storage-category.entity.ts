import { Column, Entity } from "typeorm";
import { BaseEntity } from "@/common/entities/base.entity";

/**
 * 收纳分类
 *
 * 物品分类采用「单分类」结构：每个物品归属一个分类，
 * 分类本身为扁平列表（不做多级树），通过 sort 控制展示顺序。
 */
@Entity("storage_category")
export class StorageCategory extends BaseEntity {
  @Column({ length: 50, comment: "分类名称" })
  name: string;

  @Column({ name: "icon", length: 100, nullable: true, comment: "分类图标标识" })
  icon?: string | null;

  @Column({ name: "color", length: 20, nullable: true, comment: "分类主题色(如 #4F7CFF)" })
  color?: string | null;

  @Column({ name: "sort", type: "smallint", default: 0, comment: "显示顺序" })
  sort: number;

  @Column({ name: "status", type: "tinyint", default: 1, comment: "状态(1-正常 0-禁用)" })
  status: number;

  @Column({ length: 255, nullable: true, comment: "备注" })
  remark?: string | null;

  @Column({ name: "owner_id", type: "bigint", nullable: true, comment: "归属用户ID(NULL 表示公共分类)" })
  ownerId?: string | null;
}
