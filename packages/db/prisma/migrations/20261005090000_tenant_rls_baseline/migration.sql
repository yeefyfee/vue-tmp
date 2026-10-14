-- PEL-11 租户隔离基线 · RLS 策略骨架
-- ============================================================
-- 决策 A2：租户隔离走「Prisma 扩展自动注入 + PostgreSQL RLS 兜底」双层。
-- 本迁移只落**骨架**：
--   ① 租户会话变量（GUC）的读取函数 `app_current_tenant_id()`；
--   ② 业务表 RLS 策略模板（以注释固化，业务表落地时由 CROSS-09 批量套用）。
-- 当前 14 张 sys_* / gen_* 表是平台级表（无 tenant_id 列），**不**启用 RLS。
-- 完整策略落地 + 双租户隔离测试归 CROSS-09 / P0-03-03（去重）。
-- ============================================================

-- ① 会话租户读取函数
-- 写入侧（CROSS-09，在 Prisma 事务内执行）：
--   SET LOCAL app.tenant_id = '<tenantId>';
-- SET LOCAL 是事务级：连接归还池时自动还原，不存在跨请求残留。
CREATE OR REPLACE FUNCTION public.app_current_tenant_id()
RETURNS bigint AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION public.app_current_tenant_id() IS
  'PEL-11 租户隔离基线：读取当前会话租户（GUC app.tenant_id）；未设置返回 NULL（fail-closed 交给策略判断）';

-- ② RLS 策略模板（业务表落地时套用，注意 USING 管读、WITH CHECK 管写）
-- ALTER TABLE <business_table> ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY tenant_isolation ON <business_table>
--   USING ("tenant_id" = public.app_current_tenant_id())
--   WITH CHECK ("tenant_id" = public.app_current_tenant_id());
-- ⚠️ 未设置 app.tenant_id 时函数返回 NULL，NULL 比较恒为假 ⇒ 查不到任何行
--    （fail-closed：无上下文的连接看不到租户数据，而非看到全部）。
-- ⚠️ 表属主默认绕过 RLS；应用连接应使用非属主角色，或按需 ALTER TABLE ... FORCE ROW LEVEL SECURITY。
