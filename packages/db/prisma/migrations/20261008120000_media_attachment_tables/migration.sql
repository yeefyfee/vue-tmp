-- 媒体/附件表落库（P0-08-01 媒体数据模型与多态挂接）
-- ============================================================
-- 口径对齐业务域既有迁移 20261007150000（宠物域）/ 20261007114800（客户域）/ 20261007180000（时间线）：
--   uuid 主键（库层 gen_random_uuid）+ tenant_id BIGINT + 业务表间关联 Uuid
--   + 引用 sys_user 的列保持 BIGINT? + TIMESTAMPTZ(3) 逐列显式 + 软删 deleted_at
--   + 乐观锁 version；**无数据库外键**（跨表一致性由业务层保证）。
-- 末尾调用 RLS 策略模板（ENABLE + FORCE + 幂等策略 tenant_isolation，
-- 模板函数 app_enable_tenant_rls(regclass) 幂等，见迁移 20261005150000）。
--
-- 多态挂接（P0-08-01）：
--   媒体不属于任何单一业务实体，改以 (ref_type, ref_id) 多态关联任意业务实体
--   —— 参照 timeline_event.ref_type / ref_id 的既有写法：
--     ref_type VARCHAR(32)（业务表名 slug，合法值域见 @peluvida/shared MEDIA_REF_TYPES）
--     ref_id   VARCHAR(64)（目标主键的字符串形态，兼容 uuid 与 bigint 双口径）。
--   例：宠物相册 → ref_type='pet', ref_id=<pet uuid>；
--       健康档案附件 → ref_type='health_record', ref_id=<health_record uuid>。
--
-- 上传两阶段（P0-08-02 预签名上传 + 上传确认/回调）：
--   upload_status：1 pending（已预签名，尚未确认落存储）/ 2 confirmed（已确认可用）。
--   object_key 唯一约束（uk_media_driver_object_key）防「同一驱动的同一对象」重复登记；
--   对象键含随机 uuid（buildMediaObjectKey），正常不冲突，唯一约束作并发兜底。
--
-- 图片处理（P0-08-03）：watermarked / thumbnail_url / width / height 承载水印与缩略图结果；
--   单实体最多 9 张（MEDIA_MAX_PER_ENTITY）由业务层按 (ref_type, ref_id) 计数强制。
--
-- 可见性（P0-08-04）：visible_to_owner 控制宠主端可见（对齐 timeline_event.visible_to_owner）。
-- ============================================================

-- CreateTable
CREATE TABLE "media" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" BIGINT NOT NULL,
    "store_id" UUID,
    "ref_type" VARCHAR(32) NOT NULL,
    "ref_id" VARCHAR(64) NOT NULL,
    "media_type" SMALLINT NOT NULL DEFAULT 1,
    "storage_driver" VARCHAR(16) NOT NULL DEFAULT 'local',
    "bucket" VARCHAR(128),
    "object_key" VARCHAR(512) NOT NULL,
    "url" VARCHAR(1024) NOT NULL,
    "thumbnail_url" VARCHAR(1024),
    "watermarked" BOOLEAN NOT NULL DEFAULT false,
    "mime_type" VARCHAR(128),
    "file_size" BIGINT,
    "width" INTEGER,
    "height" INTEGER,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "visible_to_owner" BOOLEAN NOT NULL DEFAULT true,
    "upload_status" SMALLINT NOT NULL DEFAULT 1,
    "uploaded_by" BIGINT,
    "confirmed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

COMMENT ON TABLE "media" IS
  'P0-08-01 媒体/附件：以 (ref_type, ref_id) 多态挂接任意业务实体（参照 timeline_event 多态写法）；两阶段上传（upload_status 1 pending / 2 confirmed）；图片水印/缩略图（P0-08-03）；visible_to_owner 控制宠主端可见（P0-08-04）；RLS 走模板双向策略。';

COMMENT ON COLUMN "media"."ref_type" IS
  '多态关联对象类型（业务表名 slug，如 pet / health_record / customer；合法值域见 @peluvida/shared MEDIA_REF_TYPES）。';
COMMENT ON COLUMN "media"."ref_id" IS
  '多态关联对象 id（字符串形态，兼容 uuid 与 bigint）。';
COMMENT ON COLUMN "media"."media_type" IS
  '媒体类型：1 图片 / 2 视频 / 3 文档 / 9 其他（@peluvida/shared MediaType）。';
COMMENT ON COLUMN "media"."storage_driver" IS
  '存储驱动：local / memory / s3 / oss（@peluvida/shared StorageDriver）；凭证走 env，不硬编码。';
COMMENT ON COLUMN "media"."upload_status" IS
  '上传状态：1 pending（已预签名未确认）/ 2 confirmed（已确认可用）。';
COMMENT ON COLUMN "media"."watermarked" IS
  '是否已施加水印（P0-08-03；图片专属，非图片恒 false）。';
COMMENT ON COLUMN "media"."thumbnail_url" IS
  '缩略图 URL（P0-08-03；图片专属，非图片 / 未生成时 NULL）。';
COMMENT ON COLUMN "media"."visible_to_owner" IS
  '宠主端可见（P0-08-04；对齐 timeline_event.visible_to_owner）。';

-- CreateIndex
-- 同一存储驱动的同一对象仅登记一次（对象键含随机 uuid，唯一约束作并发兜底）
CREATE UNIQUE INDEX "uk_media_driver_object_key" ON "media"("storage_driver", "object_key");
CREATE INDEX "idx_media_tenant_id" ON "media"("tenant_id");
-- 多态挂接读取锚点：按「租户 + 关联对象」取一组媒体（相册/附件列表 + 计数）
CREATE INDEX "idx_media_tenant_ref" ON "media"("tenant_id", "ref_type", "ref_id");
-- 相册排序读取锚点：按「租户 + 关联对象 + 展示排序」
CREATE INDEX "idx_media_tenant_ref_sort" ON "media"("tenant_id", "ref_type", "ref_id", "sort");

-- RLS：媒体表启用租户隔离（ENABLE + FORCE + 幂等策略 tenant_isolation）
SELECT public.app_enable_tenant_rls('media'::regclass);
