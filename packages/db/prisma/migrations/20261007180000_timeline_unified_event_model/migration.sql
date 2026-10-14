-- P0-06-06 统一事件模型 + P0-06-07 不可改删：timeline_event 父表扩展列 + 拦改删触发器
-- ============================================================
-- 目标：把 timeline_event 从「仅有 event_type(SmallInt) + content」升级为
--       统一事件模型（新增 事件名 / 结构化负载 / 多态关联 / 操作者类型 + 读索引），
--       并按 P0-06-07 追加「不可改删」行级触发器（纠错以「冲正事件」追加替代改删）。
--
-- 口径（对齐 audit_log 先例 20261005170000 / 宠物域 20261007150000）：
--  - timeline_event 为按月 RANGE(event_time) 声明式分区父表。
--    **父表 ALTER TABLE ADD COLUMN 自动下发到全部分区**，且后续经
--    `CREATE TABLE ... PARTITION OF` 挂载的新分区亦自动继承列 →
--    无需逐分区改列，也无需改动 scripts/timeline-partition-lib.ts（其建分区用
--    PARTITION OF，列定义继承自父表）。
--  - 新增列除 actor_type 外均可空，向后兼容既有行与既有写入点（如 weight 时间线）。
--  - 分区父表上的行级触发器（PG13+）自动克隆到「现有 + 后续挂载」的全部分区；
--    范式照抄 audit_log 的 append-only 触发器 + GUC 放行通道。
--
-- 触发器语义（P0-06-07）：BEFORE UPDATE/DELETE 一律拦截；会话/事务内
--   `SET app.timeline_maintenance = 'on'` 放行（受控维护后门，默认 fail-closed）。
--   业务不可改删 → 纠错一律通过「冲正事件」追加（应用层，原行保持不动）。
-- ============================================================

-- 1) 增列（父表 ALTER 自动下发全部子分区 + 后续新分区继承列）
ALTER TABLE "timeline_event"
  ADD COLUMN "event_name" VARCHAR(64),
  ADD COLUMN "payload"    JSONB,
  ADD COLUMN "ref_type"   VARCHAR(32),
  ADD COLUMN "ref_id"     VARCHAR(64),
  ADD COLUMN "actor_type" SMALLINT NOT NULL DEFAULT 1;

COMMENT ON COLUMN "timeline_event"."event_name" IS
  '统一事件名（`模块.动作`，如 health.record.created；合法值域见 @peluvida/shared TIMELINE_EVENT_NAMES）。NULL=历史行/未命名事件。';
COMMENT ON COLUMN "timeline_event"."payload" IS
  '结构化负载（事件上下文快照；写侧按需脱敏）。NULL=无负载。';
COMMENT ON COLUMN "timeline_event"."ref_type" IS
  '多态关联对象类型（如 health_record / weight / order / stay / pet；字符串以兼容 uuid 与 bigint 口径）。NULL=无关联。';
COMMENT ON COLUMN "timeline_event"."ref_id" IS
  '多态关联对象 id（字符串形态，兼容 uuid 与 bigint）。';
COMMENT ON COLUMN "timeline_event"."actor_type" IS
  '操作者类型：1 员工 / 2 系统 / 3 宠主（对齐 audit_log.operator_type 的 SmallInt 枚举风格）。';

-- 2) 读索引：按「租户 + 宠物 + 事件名 + 时间」筛选/排序（父表建索引 → 各分区本地索引自动生成）
CREATE INDEX "idx_timeline_tenant_pet_name_time"
  ON "timeline_event"("tenant_id", "pet_id", "event_name", "event_time");

-- 3) 不可改删触发器（照抄 audit_log 范式；父表触发器自动作用于全部分区）
--    不可改删为何不用 REVOKE：应用连接通常是表属主（RLS 迁移注释明示），
--    属主权限无法被 REVOKE 撤销，故由触发器承担（触发器对属主同样生效）。
--    superuser 仍可绕过（与 RLS 同一威胁模型）；生产应用连接用非 superuser 角色
--    （迁移 20261005090000 既定约束）同样覆盖本表。
CREATE OR REPLACE FUNCTION public.app_timeline_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- 受控维护通道（归档 / 合规纠错 / 运维）：会话或事务内
  -- SET app.timeline_maintenance = 'on' 放行；current_setting(..., true) 缺失时返回
  -- NULL，NULL ≠ 'on' ⇒ 默认拦截（fail-closed）。
  IF current_setting('app.timeline_maintenance', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'timeline_event is append-only (P0-06-07): % blocked; append a correction event instead', TG_OP
    USING ERRCODE = 'P0001';
END;
$$;

COMMENT ON FUNCTION public.app_timeline_block_mutation() IS
  'P0-06-07 时间线不可改删：BEFORE UPDATE/DELETE 拦截；GUC app.timeline_maintenance=''on'' 时放行（受控维护后门，默认拦截）。';

CREATE TRIGGER "timeline_event_no_mutation"
  BEFORE UPDATE OR DELETE ON "timeline_event"
  FOR EACH ROW EXECUTE FUNCTION public.app_timeline_block_mutation();
