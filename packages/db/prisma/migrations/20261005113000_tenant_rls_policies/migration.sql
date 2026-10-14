-- CROSS-09 租户隔离 · RLS 策略机具
-- ============================================================
-- 决策 A2 的 DB 层兜底：凡带 `tenant_id` 列并经本函数启用 RLS 的表，
-- PostgreSQL 强制按会话 GUC `app.tenant_id` 过滤（读写双向），
-- 与 Prisma 扩展的应用层注入（tenant-scope.extension.ts）构成双层防线。
--
-- 使用方式（新业务表迁移中调用一次即可）：
--   SELECT public.app_enable_tenant_rls('public.<business_table>'::regclass);
--
-- 语义要点：
--   ① USING 管读、WITH CHECK 管写；未设置 GUC 时 `app_current_tenant_id()`
--      返回 NULL，比较恒为假 ⇒ 无上下文连接看不到任何行、写不进任何行（fail-closed）。
--   ② FORCE ROW LEVEL SECURITY：表属主也受策略约束（应用连接通常即属主）。
--   ③ ⚠️ superuser 与 BYPASSRLS 角色始终绕过 RLS——生产环境应用连接
--      必须使用非 superuser 角色（部署编排见 CROSS-20；开发库 admin 为 superuser，
--      RLS 实测须用临时非属主角色，见 scripts/verify-tenant-rls.ts）。
--   ④ 幂等：重复调用先 DROP POLICY IF EXISTS 再重建。
--   ⑤ 当前 14 张 sys_* / gen_* 平台级表无 tenant_id 列，不调用本函数（零影响）。
-- ============================================================

CREATE OR REPLACE FUNCTION public.app_enable_tenant_rls(target regclass)
RETURNS void AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', target);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', target);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s '
      || 'USING ("tenant_id" = public.app_current_tenant_id()) '
      || 'WITH CHECK ("tenant_id" = public.app_current_tenant_id())',
    target
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.app_enable_tenant_rls(regclass) IS
  'CROSS-09：为带 tenant_id 的业务表启用 RLS 并挂统一租户隔离策略 tenant_isolation（USING/WITH CHECK 均基于 app_current_tenant_id()，fail-closed）';
