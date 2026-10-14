-- P0-02-08 · 审计日志 audit_log 落库（按月声明式分区 + append-only + RLS）
-- ============================================================
-- 权威设计：评估报告 .workbuddy/tmp/p0-02-08-audit-assessment.md（方案 B）。
-- 口径：uuid 主键（库层 gen_random_uuid）+ tenant_id BIGINT + TIMESTAMPTZ(3) +
--       JSONB diff；无数据库外键（业务表关联口径，见 schema 头注释）。
-- 三层强制力：
--   ① 声明式分区 PARTITION BY RANGE (created_at)：P0 预建当月 / 下月 + DEFAULT 兜底
--     （跨月写入正常、断档落 DEFAULT 不报错；分区滚动维护归 CROSS-21）；
--   ② BEFORE UPDATE/DELETE 触发器拦改删（append-only；GUC app.audit_maintenance='on'
--     时放行，为归档 / 合规导出留受控后门——触发器无条件执行，不受属主身份影响）；
--   ③ RLS 用模板函数 app_enable_tenant_rls()（迁移 20261005150000）：
--     ENABLE + FORCE + 双向策略 tenant_isolation（USING 管读 / WITH CHECK 管写）。
--     与 store 四表同构；写侧契约「INSERT 的 tenant_id 必须等于事务内 GUC
--     app.tenant_id」由应用层 AuditService 保证（withTenantContext 或事务内
--     set_config），未设 GUC 的连接写入会被 WITH CHECK 拒绝（fail-closed）。
--     平台级对象（sys_role / sys_menu 等无租户归属）写审计时 tenant_id 记 0 哨兵、
--     事务内 GUC 同步设为 '0'（Q6 平台视角查询通道后置）。
-- ============================================================

-- CreateTable（分区父表；PG 分区表的主键约束必须包含分区键 ⇒ 复合主键 (id, created_at)）
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" BIGINT NOT NULL,
    "store_id" UUID,
    "entity_type" VARCHAR(64) NOT NULL,
    "entity_id" VARCHAR(64) NOT NULL,
    "action" SMALLINT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "operator_id" BIGINT,
    "operator_type" SMALLINT NOT NULL DEFAULT 1,
    "operator_name" VARCHAR(50),
    "ip" VARCHAR(45),
    "trace_id" VARCHAR(64),
    "idempotency_key" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id", "created_at")
) PARTITION BY RANGE ("created_at");

COMMENT ON TABLE "audit_log" IS
  'P0-02-08 审计日志：业务关键操作变更留痕，append-only（触发器拦改删）+ 按月 RANGE 分区（created_at）+ RLS（模板双向策略）。tenant_id=0 为平台级对象哨兵。';

-- CreatePartitions（命名惯例 audit_log_pYYYY_MM；范围边界左闭右开 [from, to)）
-- 当月（2026-10）与下月（2026-11）预建；此后每月分区由 CROSS-21 的滚动维护预建。
-- ⚠️ DEFAULT 分区有数据后，新建覆盖范围的月分区需先搬运其数据再挂载（ALTER TABLE ...
--    DETACH / 转移 / ATTACH），否则新分区与 DEFAULT 的范围重叠导致建分区失败——
--    这是分区方案的固有约束，滚动维护任务（CROSS-21）必须处理。
CREATE TABLE "audit_log_p2026_10" PARTITION OF "audit_log"
    FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');
CREATE TABLE "audit_log_p2026_11" PARTITION OF "audit_log"
    FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');
-- DEFAULT 兜底：预建断档时数据落这里而不是报错（跨月边界实测见迁移验证说明）
CREATE TABLE "audit_log_default" PARTITION OF "audit_log" DEFAULT;

-- CreateIndex：索引建在分区父表上，PG 自动在每个分区建本地索引（含 DEFAULT 分区），
-- 后续新挂载的分区也会自动获得。复合主键 (id, created_at) 已隐含 (id) 前缀索引能力。
CREATE INDEX "idx_audit_entity" ON "audit_log" ("tenant_id", "entity_type", "entity_id", "created_at");
CREATE INDEX "idx_audit_operator" ON "audit_log" ("tenant_id", "operator_id", "created_at");
CREATE INDEX "idx_audit_tenant_time" ON "audit_log" ("tenant_id", "created_at");

-- RLS：租户隔离（ENABLE + FORCE + 幂等策略 tenant_isolation，与 store 四表同构）
-- 不可改删为何不用 REVOKE：PG 中表属主的权限无法被 REVOKE 撤销，而本项目应用连接
-- 通常即属主（RLS 迁移注释明示，因此才需要 FORCE RLS）——REVOKE 形同虚设；
-- 改属主又牵连部署编排。故不可改删由下方触发器承担（触发器对属主同样生效）。
SELECT public.app_enable_tenant_rls('audit_log');

-- 不可改删触发器（评估报告 3.2 定论）
-- 行级「删除」被拦死后，留存到期 / 归档走分区 DETACH PARTITION（DDL，不触发行级触发器），
-- 与 append-only 天然不冲突——分区方案与 append-only 的最佳配合点。
-- superuser 仍可绕过（与 RLS 同一威胁模型）；生产应用连接用非 superuser 角色的
-- 既定约束（迁移 20261005090000 注释）同样覆盖本表。
-- PG13+ 分区父表上的行级触发器自动克隆到现有与后续挂载的全部分区，无需逐分区建。
CREATE OR REPLACE FUNCTION public.app_audit_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- 受控维护通道（归档 / 合规导出）：会话或事务内 SET app.audit_maintenance = 'on' 放行；
  -- current_setting(..., true) 缺失时返回 NULL，NULL ≠ 'on' ⇒ 默认拦截（fail-closed）。
  IF current_setting('app.audit_maintenance', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'audit_log is append-only (P0-02-08): % blocked', TG_OP
    USING ERRCODE = 'P0001';
END;
$$;

COMMENT ON FUNCTION public.app_audit_block_mutation() IS
  'P0-02-08 审计日志不可改删：BEFORE UPDATE/DELETE 拦截；GUC app.audit_maintenance=''on'' 时放行（归档/合规导出受控后门，默认拦截）。';

CREATE TRIGGER "audit_log_no_mutation"
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION public.app_audit_block_mutation();
