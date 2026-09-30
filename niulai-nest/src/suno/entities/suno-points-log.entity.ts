import { Column, Entity, Index } from "typeorm";
import { BaseEntity } from "@/common/entities/base.entity";

/**
 * Suno 积分流水
 *
 * 本地记录每次调用的积分变动，便于成本核算与对账。
 */
@Entity("suno_points_log")
@Index("idx_owner", ["ownerId", "isDeleted"])
export class SunoPointsLog extends BaseEntity {
  @Column({ name: "owner_id", type: "bigint", comment: "归属用户ID" })
  ownerId: string;

  @Column({ name: "biz_id", length: 64, nullable: true, comment: "关联业务ID" })
  bizId?: string | null;

  @Column({ name: "biz_type", length: 32, nullable: true, comment: "业务类型" })
  bizType?: string | null;

  @Column({ type: "int", default: 0, comment: "变动积分数(消耗为正数)" })
  points: number;

  @Column({
    name: "change_type",
    type: "tinyint",
    default: 1,
    comment: "变动类型(1-消耗 2-充值 3-手动调整 4-退还)",
  })
  changeType: number;

  @Column({ type: "int", nullable: true, comment: "变动后平台余额快照" })
  balance?: number | null;

  @Column({ length: 255, nullable: true, comment: "备注" })
  remark?: string | null;
}
