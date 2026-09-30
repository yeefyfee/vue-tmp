import { Column, Entity, Index } from "typeorm";
import { BaseEntity } from "@/common/entities/base.entity";

/**
 * Suno 作品资产
 *
 * 任务完成后落库，是「我的作品库」的数据源。
 */
@Entity("suno_asset")
@Index("idx_owner", ["ownerId", "isDeleted", "createTime"])
export class SunoAsset extends BaseEntity {
  @Column({ name: "task_pk", type: "bigint", nullable: true, comment: "关联任务主键ID" })
  taskPk?: string | null;

  @Column({ name: "custom_id", length: 64, comment: "Suno 音乐ID(UUID)" })
  customId: string;

  @Column({ length: 255, nullable: true, comment: "作品标题" })
  title?: string | null;

  @Column({ name: "image_url", length: 500, nullable: true, comment: "封面图地址" })
  imageUrl?: string | null;

  @Column({ name: "audio_url", length: 500, nullable: true, comment: "音频地址" })
  audioUrl?: string | null;

  @Column({ name: "video_url", length: 500, nullable: true, comment: "MV 视频地址" })
  videoUrl?: string | null;

  @Column({ type: "int", default: 0, comment: "音频时长(秒)" })
  duration: number;

  @Column({ length: 512, nullable: true, comment: "风格标签" })
  tags?: string | null;

  @Column({ type: "text", nullable: true, comment: "歌词" })
  lyrics?: string | null;

  @Column({ length: 64, nullable: true, comment: "生成模型版本" })
  mv?: string | null;

  @Column({
    name: "asset_type",
    length: 16,
    default: "music",
    comment: "资产类型(music/sound/video)",
  })
  assetType: string;

  @Column({
    name: "is_instrumental",
    type: "tinyint",
    default: 0,
    comment: "是否纯音乐(1-是 0-否)",
  })
  isInstrumental: number;

  @Column({ name: "is_liked", type: "tinyint", default: 0, comment: "是否收藏(1-是 0-否)" })
  isLiked: number;

  @Column({ name: "owner_id", type: "bigint", comment: "归属用户ID" })
  ownerId: string;
}
