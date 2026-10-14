-- P0-03-03 · RLS 策略模板函数（PeluVida OS 租户隔离兜底层）
-- ============================================================
-- 上游骨架（20261005090000_tenant_rls_baseline）已固化：
--   ① GUC 读取函数 app_current_tenant_id()（app.tenant_id 未设置/空串 → NULL，fail-closed）；
--   ② 策略模板仅以注释形式存在（USING 管读 / WITH CHECK 管写）。
-- 本迁移把 ② 固化为**通用模板函数**：业务表建好后一行
--   SELECT public.app_enable_tenant_rls('store');
-- 即完成 ENABLE + FORCE + 幂等创建策略 tenant_isolation。
-- ⚠️ 系统域 14 表（sys_* / gen_*，无 tenant_id 列）绝不调用本函数；
--    本迁移也刻意不对任何现有表调用（业务表尚未落地，见 CROSS-09）。
-- ============================================================

CREATE OR REPLACE FUNCTION public.app_enable_tenant_rls(target regclass)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- ① 启用 RLS：无策略时行为不变；策略就位后按谓词过滤读与写
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
  -- ② FORCE：表属主（应用连接常是 owner）同样受策略约束，堵死绕过租户过滤的口子
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', target);
  -- ③ 幂等重建策略：DROP IF EXISTS + CREATE，重复调用恒收敛到同一份定义
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', target);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s
       USING ("tenant_id" = public.app_current_tenant_id())
       WITH CHECK ("tenant_id" = public.app_current_tenant_id())',
    target
  );
END;
$$;

COMMENT ON FUNCTION public.app_enable_tenant_rls(regclass) IS
  'P0-03-03 RLS 策略模板：对目标表启用 + 强制 RLS 并幂等创建租户隔离策略 tenant_isolation；GUC app.tenant_id 未设置/空串时谓词为 NULL ⇒ 任何行不可见（fail-closed）。仅限带 tenant_id 列的业务表调用。';

-- 注意：此处刻意不对任何现有表调用——
-- sys_* / gen_* 是平台级表（无 tenant_id 列），启用即全表不可见（事故级）。
