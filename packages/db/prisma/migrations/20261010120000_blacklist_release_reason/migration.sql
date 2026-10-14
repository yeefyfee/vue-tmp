-- 客户域增量迁移（MVP-WEB-04-02「客户详情（含宠物 / 触达 / 黑名单）」）
-- ============================================================
-- 口径：**仅对既有表增列，不新建表、不改索引** —— blacklist 表已在迁移
-- 20261007114800_customer_domain_tables 由 app_enable_tenant_rls() 开启 RLS
-- （ENABLE + FORCE + 幂等策略）。增列不改变 RLS 归属，故无需重新登记
-- TENANT_SCOPED_MODELS（Blacklist 已在该名单内），也无需重申策略。
--
-- 缺口来源（契约补齐，非新增功能）：
--   PRD《客户管理》BR-2「黑名单操作需店长以上权限；**移出黑名单必须填写原因**
--   并记录审计日志」+《Customer API》§黑名单「移出黑名单必须填写原因；加入与
--   移出均写审计日志」+《客户管理》§验收要点 3「移出需权限与原因」。
--   既有 `POST /customers/:id/blacklist/:blacklistId/release` 无入参、表无列，
--   解除原因无处落地 ⇒ 补列 + DTO（`reason` 必填 1~255）。
--
-- 列口径对齐 schema.prisma（1:1 对照）：
--   blacklist.release_reason VARCHAR(255) NULL
--     NULL = 未解除（status=1）；status=0 时非空 = 解除原因
--   （不另立 release_at 列：解除时刻由 updated_at 承载，避免冗余列）
--
-- 向后兼容：ADD COLUMN 可空、无默认值 ⇒ 既有行不受影响，旧调用方（不传
-- reason）在新的 DTO 校验下会得到 400，属**有意的接口收紧**（该端点尚无
-- 生产调用方，前端随本任务同步上线）。
-- ============================================================

ALTER TABLE "blacklist"
    ADD COLUMN "release_reason" VARCHAR(255);

COMMENT ON COLUMN "blacklist"."release_reason" IS '解除黑名单原因（NULL=未解除；PRD BR-2 要求移出必须填写原因）';
