-- 客户域四表落库（P0-05-01：customer / customer_pet / reach_log / blacklist）
-- ============================================================
-- 口径对齐业务域既有迁移 20261005160000 / 20261006090000：
--   uuid 主键（库层 gen_random_uuid）+ tenant_id BIGINT + 业务表间关联 Uuid
--   + 引用 sys_user 的列保持 BIGINT? + TIMESTAMPTZ(3) 逐列显式 + JSONB
--   + 软删 deleted_at + 乐观锁 version；无数据库外键。
-- 末尾对四表调用 RLS 策略模板（ENABLE + FORCE + 幂等策略 tenant_isolation，
-- 模板函数 app_enable_tenant_rls(regclass) 幂等，见迁移 20261005150000）。
--
-- ⚠️ 部分唯一索引（取舍记录）：
--   customer 的手机号租户内唯一采用「部分唯一索引」
--     uk_customer_tenant_mobile ON customer(tenant_id, mobile) WHERE deleted_at IS NULL
--   而非 store.code 的普通全量唯一口径——手机号是强复用资源，客户档案软删后
--   同手机号应可重新建档（区别于门店 code 一旦占用基本不复用的语义）。
--   PG 部分唯一索引 Prisma schema 无法表达（schema 侧不声明 @@unique，避免生成
--   冲突的全量唯一索引），唯一性由三层保证：应用层 findFirst 查重（A0501 友好码）
--   → 部分唯一索引并发兜底（P2002 → A0501）→ RLS 租户隔离。
-- ============================================================

-- CreateTable
CREATE TABLE "customer" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" BIGINT NOT NULL,
    "store_id" UUID,
    "name" VARCHAR(64) NOT NULL,
    "mobile" VARCHAR(20) NOT NULL,
    "gender" SMALLINT,
    "birthday" DATE,
    "source" SMALLINT,
    "remark" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- 手机号租户内唯一：部分唯一索引（软删释放手机号，见文件头取舍记录）
CREATE UNIQUE INDEX "uk_customer_tenant_mobile" ON "customer"("tenant_id", "mobile") WHERE "deleted_at" IS NULL;
CREATE INDEX "idx_customer_tenant_id" ON "customer"("tenant_id");
CREATE INDEX "idx_customer_tenant_mobile" ON "customer"("tenant_id", "mobile");

-- CreateTable
CREATE TABLE "customer_pet" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" BIGINT NOT NULL,
    "customer_id" UUID NOT NULL,
    -- 悬空 uuid：宠物实体表 P0-06 落地前无被引用表（口径允许，见 schema 注释）
    "pet_id" UUID NOT NULL,
    "pet_name" VARCHAR(64),
    "pet_type" SMALLINT,
    "is_primary" BOOLEAN,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "customer_pet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_customer_pet_tenant_id" ON "customer_pet"("tenant_id");
CREATE INDEX "idx_customer_pet_tenant_customer" ON "customer_pet"("tenant_id", "customer_id");

-- CreateTable
CREATE TABLE "reach_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" BIGINT NOT NULL,
    "customer_id" UUID NOT NULL,
    "channel" SMALLINT NOT NULL,
    "content" VARCHAR(500),
    "operator_id" BIGINT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "reach_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_reach_log_tenant_id" ON "reach_log"("tenant_id");
CREATE INDEX "idx_reach_log_tenant_customer" ON "reach_log"("tenant_id", "customer_id");

-- CreateTable
CREATE TABLE "blacklist" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" BIGINT NOT NULL,
    "customer_id" UUID NOT NULL,
    "store_id" UUID,
    "reason" VARCHAR(255) NOT NULL,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "operator_id" BIGINT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "blacklist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_blacklist_tenant_id" ON "blacklist"("tenant_id");
CREATE INDEX "idx_blacklist_tenant_customer" ON "blacklist"("tenant_id", "customer_id");
CREATE INDEX "idx_blacklist_tenant_status" ON "blacklist"("tenant_id", "status");

-- RLS：客户域四表启用租户隔离（ENABLE + FORCE + 幂等策略 tenant_isolation）
SELECT public.app_enable_tenant_rls('customer'::regclass);
SELECT public.app_enable_tenant_rls('customer_pet'::regclass);
SELECT public.app_enable_tenant_rls('reach_log'::regclass);
SELECT public.app_enable_tenant_rls('blacklist'::regclass);
