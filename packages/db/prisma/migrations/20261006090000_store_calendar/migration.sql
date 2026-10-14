-- 门店日历（P0-04-04 · FR-3 日期级营业例外）
-- ============================================================
-- 单表迁移：store_calendar（节假日闭店 / 临时闭店 / 特殊营业）。
-- 口径对齐业务域既有四表迁移 20261005160000_biz_domain_core_tables：
--   uuid 主键（库层 gen_random_uuid）+ tenant_id BIGINT + store_id UUID 关联
--   + TIMESTAMPTZ(3) 逐列显式 + 软删 deleted_at + 乐观锁 version；无数据库外键。
-- 末尾调用 RLS 策略模板（ENABLE + FORCE + 幂等策略 tenant_isolation，
-- 模板函数 app_enable_tenant_rls(regclass) 幂等，见迁移 20261005150000）。
-- ============================================================

-- CreateTable
CREATE TABLE "store_calendar" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" BIGINT NOT NULL,
    "store_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "type" SMALLINT NOT NULL,
    "open_time" VARCHAR(5),
    "close_time" VARCHAR(5),
    "remark" VARCHAR(255),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "store_calendar_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- 同租户同门店同日期仅一条（软删不腾位，与 store/room 唯一索引口径一致）
CREATE UNIQUE INDEX "uk_store_calendar_tenant_store_date" ON "store_calendar"("tenant_id", "store_id", "date");
CREATE INDEX "idx_store_calendar_tenant_store" ON "store_calendar"("tenant_id", "store_id");

-- RLS：门店日历启用租户隔离（ENABLE + FORCE + 幂等策略 tenant_isolation）
SELECT public.app_enable_tenant_rls('store_calendar'::regclass);
