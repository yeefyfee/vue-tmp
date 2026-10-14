-- 业务域 P0 四表落库（store / service_category / room / staff）
-- ============================================================
-- 权威口径：设计草案 v2（.workbuddy/tmp/biz-domain-models-draft.md）。
--   uuid 主键（库层 gen_random_uuid）+ tenant_id BIGINT + 业务表间关联 Uuid +
--   引用 sys_user 的列保持 BIGINT? + TIMESTAMPTZ(3) + JSONB；无数据库外键。
-- 末尾对四表调用 RLS 策略模板（ENABLE + FORCE + 幂等策略 tenant_isolation），
-- 模板函数见迁移 20261005150000_tenant_rls_policy_template。
-- ============================================================

-- CreateTable
CREATE TABLE "store" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" BIGINT NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "type" SMALLINT NOT NULL DEFAULT 1,
    "province" VARCHAR(32) NOT NULL,
    "city" VARCHAR(32) NOT NULL,
    "district" VARCHAR(32) NOT NULL,
    "address" VARCHAR(255) NOT NULL,
    "longitude" DECIMAL(10,7),
    "latitude" DECIMAL(9,7),
    "phone" VARCHAR(20) NOT NULL,
    "business_hours" JSONB NOT NULL DEFAULT '{}',
    "config" JSONB,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "store_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uk_store_tenant_code" ON "store"("tenant_id", "code");
CREATE INDEX "idx_store_tenant_id" ON "store"("tenant_id");

-- CreateTable
CREATE TABLE "service_category" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" BIGINT NOT NULL,
    "store_id" UUID,
    "name" VARCHAR(64) NOT NULL,
    "parent_id" UUID,
    "cat_type" SMALLINT NOT NULL,
    "sort" SMALLINT NOT NULL DEFAULT 0,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "service_category_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uk_service_category_scope" ON "service_category"("tenant_id", "store_id", "parent_id", "name");
CREATE INDEX "idx_service_category_tenant_id" ON "service_category"("tenant_id");
CREATE INDEX "idx_service_category_tenant_store" ON "service_category"("tenant_id", "store_id");
CREATE INDEX "idx_service_category_parent_id" ON "service_category"("parent_id");
-- 可选：纯库层唯一性补强（部分唯一索引，Prisma 无法表达、需迁移手写；parent_id NULL 的根类目仍由应用层兜底）
-- CREATE UNIQUE INDEX "uk_service_category_tenant_scope" ON "service_category"("tenant_id", "parent_id", "name") WHERE "store_id" IS NULL;
-- CREATE UNIQUE INDEX "uk_service_category_store_scope" ON "service_category"("tenant_id", "store_id", "parent_id", "name") WHERE "store_id" IS NOT NULL;

-- CreateTable
CREATE TABLE "room" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" BIGINT NOT NULL,
    "store_id" UUID NOT NULL,
    "name" VARCHAR(64),
    "room_no" VARCHAR(16) NOT NULL,
    "room_type" SMALLINT NOT NULL DEFAULT 1,
    "capacity" SMALLINT NOT NULL DEFAULT 1,
    "allow_pet_size" JSONB,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "room_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uk_room_store_no" ON "room"("tenant_id", "store_id", "room_no");
CREATE INDEX "idx_room_tenant_id" ON "room"("tenant_id");
CREATE INDEX "idx_room_store_status" ON "room"("tenant_id", "store_id", "status");

-- CreateTable
CREATE TABLE "staff" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" BIGINT NOT NULL,
    "store_id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "mobile" VARCHAR(20) NOT NULL,
    "id_card" VARCHAR(32),
    "job_role" SMALLINT NOT NULL,
    "roles" JSONB NOT NULL DEFAULT '[]',
    "sys_user_id" BIGINT,
    "joined_at" DATE,
    "left_at" DATE,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "staff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uk_staff_store_mobile" ON "staff"("tenant_id", "store_id", "mobile");
CREATE INDEX "idx_staff_tenant_id" ON "staff"("tenant_id");
CREATE INDEX "idx_staff_store_status" ON "staff"("tenant_id", "store_id", "status");
CREATE INDEX "idx_staff_sys_user_id" ON "staff"("sys_user_id");

-- RLS：业务域四表启用租户隔离（ENABLE + FORCE + 幂等策略 tenant_isolation）
SELECT public.app_enable_tenant_rls('store');
SELECT public.app_enable_tenant_rls('service_category');
SELECT public.app_enable_tenant_rls('room');
SELECT public.app_enable_tenant_rls('staff');
