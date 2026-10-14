-- 客户域增量迁移（P0-05-04 触达 FR-3 / P0-05-05 黑名单 FR-4 / P0-05-06 来源+生命周期 FR-5·FR-6）
-- ============================================================
-- 口径：**仅对既有表增列 + 增索引，不新建表** —— customer / reach_log / blacklist
-- 三表已在迁移 20261007114800_customer_domain_tables 由 app_enable_tenant_rls() 开启
-- RLS（ENABLE + FORCE + 幂等策略）。增列不改变 RLS 归属，故无需重新登记
-- TENANT_SCOPED_MODELS（三模型已在该名单内）。
--
-- 列口径对齐 schema.prisma（本迁移与线上结构 1:1 对照，回读校验见报告）：
--  - customer.lifecycle        SMALLINT   NOT NULL DEFAULT 1（FR-6 生命周期分层；默认 1 新客）
--  - customer.reach_preferences JSONB     NOT NULL DEFAULT '{}'（FR-3 触达偏好；Prisma 不写 @db.Jsonb）
--  - reach_log.template        VARCHAR(64) NULL（FR-3 触达模板标识/名称）
--  - reach_log.result          SMALLINT   NULL（FR-3 触达结果 1 成功 / 2 失败）
--  - reach_log.reached_at      TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP（FR-3 实际触达时间）
-- 索引：customer(tenant,lifecycle) / reach_log(tenant,customer,reached_at) /
--       blacklist(tenant,customer,status)（硬拦截命中查询加速）。
-- 末尾幂等重申 app_enable_tenant_rls()（模板幂等，防御性；策略早已存在）。
-- ============================================================

-- FR-6：客户生命周期分层 + FR-3：触达偏好（JSONB，整存整取）
ALTER TABLE "customer"
    ADD COLUMN "lifecycle" SMALLINT NOT NULL DEFAULT 1,
    ADD COLUMN "reach_preferences" JSONB NOT NULL DEFAULT '{}';

CREATE INDEX "idx_customer_tenant_lifecycle" ON "customer"("tenant_id", "lifecycle");

-- FR-3：触达日志增列（模板 / 结果 / 实际触达时间）
ALTER TABLE "reach_log"
    ADD COLUMN "template" VARCHAR(64),
    ADD COLUMN "result" SMALLINT,
    ADD COLUMN "reached_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "idx_reach_log_tenant_customer_time" ON "reach_log"("tenant_id", "customer_id", "reached_at");

-- FR-4：黑名单硬拦截命中索引（checkBlocked：customer + 生效状态）
CREATE INDEX "idx_blacklist_tenant_customer_status" ON "blacklist"("tenant_id", "customer_id", "status");

-- RLS 幂等重申（三表策略早已由 20261007114800 启用；此处防御性重申，模板函数幂等）
SELECT public.app_enable_tenant_rls('customer'::regclass);
SELECT public.app_enable_tenant_rls('reach_log'::regclass);
SELECT public.app_enable_tenant_rls('blacklist'::regclass);
