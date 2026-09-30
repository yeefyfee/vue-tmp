import { Column, Entity, Index } from "typeorm";
import { BaseEntity } from "@/common/entities/base.entity";

/**
 * Suno 任务
 *
 * 一次「提交」对应一条 suno_task 明细；Suno 每次返回 2 个 task_id，
 * 因此同一提交会写入 2 条任务记录（batch_no 相同）。
 */
@Entity("suno_task")
@Index("idx_owner_status", ["ownerId", "status", "isDeleted"])
export class SunoTask extends BaseEntity {
  @Column({ name: "batch_no", length: 40, comment: "提交批次号" })
  batchNo: string;

  @Column({ name: "task_id", type: "bigint", nullable: true, comment: "Suno 平台任务ID" })
  taskId?: string | null;

  @Column({ name: "custom_id", length: 64, nullable: true, comment: "Suno 音乐ID(UUID)" })
  customId?: string | null;

  @Column({
    name: "parent_custom_id",
    length: 64,
    nullable: true,
    comment: "来源音乐ID(延长/翻唱/上传)",
  })
  parentCustomId?: string | null;

  @Column({ name: "task_type", length: 32, comment: "任务类型" })
  taskType: string;

  @Column({
    name: "biz_category",
    length: 16,
    default: "music",
    comment: "业务分类(music/sound/post)",
  })
  bizCategory: string;

  @Column({ length: 255, nullable: true, comment: "作品标题" })
  title?: string | null;

  @Column({ type: "text", nullable: true, comment: "歌词/提示词" })
  prompt?: string | null;

  @Column({ length: 512, nullable: true, comment: "风格标签" })
  tags?: string | null;

  @Column({ length: 64, nullable: true, comment: "模型版本" })
  mv?: string | null;

  @Column({
    name: "gpt_description_prompt",
    type: "text",
    nullable: true,
    comment: "灵感模式描述",
  })
  gptDescriptionPrompt?: string | null;

  @Column({
    name: "make_instrumental",
    type: "tinyint",
    default: 0,
    comment: "是否纯音乐(1-是 0-否)",
  })
  makeInstrumental: number;

  @Column({ name: "is_max_mode", type: "tinyint", default: 0, comment: "是否 MAX 模式" })
  isMaxMode: number;

  @Column({ name: "aug_creativity", type: "tinyint", nullable: true, comment: "创意度 0-4" })
  augCreativity?: number | null;

  @Column({ name: "request_params", type: "json", nullable: true, comment: "请求参数快照" })
  requestParams?: Record<string, unknown> | null;

  @Column({
    length: 20,
    default: "pending",
    comment: "任务状态(pending/processing/completed/failed)",
  })
  status: string;

  @Column({ length: 512, nullable: true, comment: "失败原因" })
  errormsg?: string | null;

  @Column({
    name: "points_refunded",
    type: "tinyint",
    default: 0,
    comment: "积分是否已退还",
  })
  pointsRefunded: number;

  @Column({ name: "owner_id", type: "bigint", comment: "归属用户ID" })
  ownerId: string;
}
