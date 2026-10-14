-- 宠物域六表落库（P0-06-01：pet / health_record / weight / behavior_tag /
-- pet_behavior_tag / timeline_event，含 timeline_event 按月分区）
-- ============================================================
-- 口径对齐业务域既有迁移 20261005160000 / 20261006090000 / 20261007114800：
--   uuid 主键（库层 gen_random_uuid）+ tenant_id BIGINT + 业务表间关联 Uuid
--   + 引用 sys_user 的列保持 BIGINT? + TIMESTAMPTZ(3) 逐列显式 + JSONB
--   + 软删 deleted_at + 乐观锁 version；无数据库外键（跨表一致性业务层保证）。
-- 末尾对六表调用 RLS 策略模板（ENABLE + FORCE + 幂等策略 tenant_isolation，
-- 模板函数 app_enable_tenant_rls(regclass) 幂等，见迁移 20261005150000）。
--
-- timeline_event 分区（对齐 audit_log 先例 20261005170000）：
--   ① 声明式分区 PARTITION BY RANGE (event_time)：预建当月（2026-10）/
--     下月（2026-11）+ DEFAULT 兜底（断档落 DEFAULT 不报错；分区滚动维护
--     归 CROSS-21，脚本见 scripts/ensure-timeline-partitions.ts）；
--   ② 分区表主键必须含分区键 ⇒ 复合主键 (id, event_time)；
--     id 取 BIGSERIAL 自增（高写入事件流，uuid 无谓膨胀）；
--   ③ **无 append-only 拦改删触发器**（与 audit_log 的关键差异）：timeline
--     允许运维级修正（P0-06-07 的业务不可改删由「业务层不提供改删接口 +
--     冲正事件」承担，不需要数据库层触发器）⇒ 测试/清理可直接 DELETE；
--   ④ RLS 走模板函数（分区父表上 ENABLE/FORCE，策略自动覆盖全部分区）。
-- ============================================================

-- CreateTable
CREATE TABLE "pet" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" BIGINT NOT NULL,
    "store_id" UUID,
    "owner_customer_id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "pet_type" SMALLINT NOT NULL,
    "breed" VARCHAR(64),
    "gender" SMALLINT,
    "birthday" DATE,
    "weight_kg" DECIMAL(5,2),
    "coat_color" VARCHAR(32),
    "sterilized" BOOLEAN,
    "chip_no" VARCHAR(64),
    "photo_url" VARCHAR(500),
    "photos" JSONB,
    "profile_completeness" INTEGER NOT NULL DEFAULT 0,
    "remark" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "pet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_pet_tenant_id" ON "pet"("tenant_id");
CREATE INDEX "idx_pet_tenant_owner" ON "pet"("tenant_id", "owner_customer_id");

-- CreateTable
CREATE TABLE "health_record" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" BIGINT NOT NULL,
    "pet_id" UUID NOT NULL,
    "record_type" SMALLINT NOT NULL,
    "record_date" DATE NOT NULL,
    "expire_date" DATE,
    "content" VARCHAR(500),
    "operator_id" BIGINT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "health_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_health_record_tenant_id" ON "health_record"("tenant_id");
CREATE INDEX "idx_health_record_tenant_pet" ON "health_record"("tenant_id", "pet_id");
-- 到期提醒扫描锚点（P0-06-03：疫苗/驱虫 expire_date 临近扫描）
CREATE INDEX "idx_health_record_tenant_type_expire" ON "health_record"("tenant_id", "record_type", "expire_date");

-- CreateTable
CREATE TABLE "weight" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" BIGINT NOT NULL,
    "pet_id" UUID NOT NULL,
    "weighed_at" DATE NOT NULL,
    "weight_kg" DECIMAL(5,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "weight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_weight_tenant_id" ON "weight"("tenant_id");
-- 体重曲线按宠物 + 时间序列读（P0-06-04 FR-3）
CREATE INDEX "idx_weight_tenant_pet_date" ON "weight"("tenant_id", "pet_id", "weighed_at");

-- CreateTable
CREATE TABLE "behavior_tag" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" BIGINT NOT NULL,
    "name" VARCHAR(32) NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "behavior_tag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uk_behavior_tag_tenant_name" ON "behavior_tag"("tenant_id", "name");
CREATE INDEX "idx_behavior_tag_tenant_id" ON "behavior_tag"("tenant_id");

-- CreateTable
CREATE TABLE "pet_behavior_tag" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" BIGINT NOT NULL,
    "pet_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "pet_behavior_tag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uk_pet_behavior_tag" ON "pet_behavior_tag"("pet_id", "tag_id");
CREATE INDEX "idx_pet_behavior_tag_tenant_id" ON "pet_behavior_tag"("tenant_id");
CREATE INDEX "idx_pet_behavior_tag_tenant_pet" ON "pet_behavior_tag"("tenant_id", "pet_id");

-- CreateTable（timeline_event：分区父表；PG 分区表的主键约束必须包含分区键
--   ⇒ 复合主键 (id, event_time)；id 用 BIGSERIAL 自增）
CREATE TABLE "timeline_event" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" BIGINT NOT NULL,
    "pet_id" UUID NOT NULL,
    "event_type" SMALLINT NOT NULL,
    "content" VARCHAR(500),
    "operator_id" BIGINT,
    "event_time" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "visible_to_owner" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "timeline_event_pkey" PRIMARY KEY ("id", "event_time")
) PARTITION BY RANGE ("event_time");

COMMENT ON TABLE "timeline_event" IS
  'P0-06-01 宠物时间线：各业务模块统一事件流，按月 RANGE 分区（event_time）+ RLS（模板双向策略）。无拦改删触发器（业务不可改删由应用层 + 冲正事件承担，P0-06-07）；visible_to_owner 控制宠主端可见。';

-- CreatePartitions（命名惯例 timeline_event_pYYYY_MM；范围边界左闭右开 [from, to)）
-- 当月（2026-10）与下月（2026-11）预建；此后每月分区由
-- scripts/ensure-timeline-partitions.ts 幂等预建（CROSS-21 滚动维护）。
-- ⚠️ DEFAULT 分区有数据后新建同范围月分区会因重叠失败，搬移流程归 CROSS-21
--    （与 audit_log 同一固有约束）。
CREATE TABLE "timeline_event_p2026_10" PARTITION OF "timeline_event"
    FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');
CREATE TABLE "timeline_event_p2026_11" PARTITION OF "timeline_event"
    FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');
-- DEFAULT 兜底：断档时数据落这里而不是报错
CREATE TABLE "timeline_event_default" PARTITION OF "timeline_event" DEFAULT;

-- CreateIndex：索引建在分区父表上，PG 自动在每个分区建本地索引（含 DEFAULT
-- 分区与后续新挂载分区）。复合主键 (id, event_time) 已隐含 (id) 前缀索引能力。
CREATE INDEX "idx_timeline_tenant_pet_time" ON "timeline_event"("tenant_id", "pet_id", "event_time");
CREATE INDEX "idx_timeline_pet_time" ON "timeline_event"("pet_id", "event_time");

-- RLS：宠物域六表启用租户隔离（ENABLE + FORCE + 幂等策略 tenant_isolation）
-- 分区父表上的 RLS 自动覆盖现有与后续挂载的全部分区（与 audit_log 同构）。
SELECT public.app_enable_tenant_rls('pet'::regclass);
SELECT public.app_enable_tenant_rls('health_record'::regclass);
SELECT public.app_enable_tenant_rls('weight'::regclass);
SELECT public.app_enable_tenant_rls('behavior_tag'::regclass);
SELECT public.app_enable_tenant_rls('pet_behavior_tag'::regclass);
SELECT public.app_enable_tenant_rls('timeline_event'::regclass);
