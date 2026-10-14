-- 预约时段占用表落库（MVP-WEB-06-04 容量校验 API）
-- ============================================================
-- 上游：20261012120000_booking_table 明确「booking_time_slot（时段占用表）其写入方是
--   容量校验（MVP-WEB-06-04）与创建/改期事务 ⇒ 随该任务一并落库」，本迁移即兑现该承诺。
--
-- 口径对齐业务域既有迁移（媒体 / 宠物域 / 客户域 / booking）：
--   uuid 主键（库层 gen_random_uuid）+ tenant_id BIGINT + 业务表间关联 Uuid
--   + 引用 sys_user 的列保持 BIGINT? + TIMESTAMPTZ(3) 逐列显式 + 软删 deleted_at
--   + 乐观锁 version；**无数据库外键**（沿用全仓口径）。
--
-- 🔴 三处关键裁决（详见 schema.prisma 的模型注释）：
--   ① **占用事实的物化投影 + 触发器自动维护**：本表不是「第二套业务状态」，而是
--      `booking` 占用事实的投影 —— 预约进释放态（cancelled / no_show / rescheduled）
--      或被软删即无占用行；区间与资源变更即重建。写入点收敛到**数据库触发器**
--      （而非在创建 / 改期 / 取消 / 种子 / 测试脚本等 N 个应用写点各写一次），
--      使「漏写 ⇒ 容量静默算错」在结构上不可能发生。
--   ② **容量判定的唯一来源**：`capacity-check`(06-04) 与 `conflict-check`(06-03)
--      都只读本表；不再按 `booking.status` 现算（同一判据不留两处来源，踩坑 126-bis）。
--   ③ **物理删除**：占用行是派生运行时态（历史由 booking 承载）⇒ 触发器硬删，
--      deleted_at / version 仅为对齐公共字段口径保留（恒 NULL / 0）；软删会让
--      uk_booking_time_slot_booking_resource 这个「重建幂等锚点」失效（软删不腾位）。
--
-- 触发器与 RLS 的相互关系：本表经 app_enable_tenant_rls() 启用 **ENABLE + FORCE** RLS，
--   表属主（应用连接常是 owner）同样受策略约束 ⇒ 触发器内的读写会受
--   `tenant_id = app_current_tenant_id()` 谓词过滤。故触发器函数在开工前先
--   `set_config('app.tenant_id', <本行租户>, true)` 对齐会话租户（SET LOCAL 语义，
--   事务结束自动还原），确保在非超级用户连接下也能正确维护本租户的占用行。
-- ============================================================

-- CreateTable
CREATE TABLE "booking_time_slot" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" BIGINT NOT NULL,
    "resource_type" VARCHAR(16) NOT NULL,
    "resource_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "start_time" TIMESTAMPTZ(3) NOT NULL,
    "end_time" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "booking_time_slot_pkey" PRIMARY KEY ("id")
);

COMMENT ON TABLE "booking_time_slot" IS
  'MVP-WEB-06-04 预约时段占用表（PRD《预约管理》字段设计）：booking 占用事实的物化投影，由触发器 trg_booking_time_slot_sync 在同事务内自动维护（INSERT/UPDATE/DELETE 三向）；resource_type ∈ {employee,room}；容量校验（capacity-check）与冲突检测（conflict-check）均只读本表 ⇒ 占用判定的唯一来源。';
COMMENT ON COLUMN "booking_time_slot"."resource_type" IS
  '资源类型：employee 员工 / room 房间（值域唯一来源 booking.constants.ts 的 BOOKING_RESOURCE_TYPES，与 PRD 枚举一致）。';
COMMENT ON COLUMN "booking_time_slot"."resource_id" IS
  '资源 id（→ staff.id / room.id；业务表关联 → uuid；无外键）。';
COMMENT ON COLUMN "booking_time_slot"."booking_id" IS
  '关联预约 id（→ booking.id）：本表为预约的从属占用行，生命周期完全跟随预约（触发器级联清理，避免孤儿行静默污染容量判定）。';
COMMENT ON COLUMN "booking_time_slot"."start_time" IS
  '占用区间开始（TIMESTAMPTZ(3)）：与 booking.start_time 逐字一致，不做取整 / 拆分（「逐日」是读侧聚合口径）。';

-- CreateIndex
-- 重建幂等锚点：同一预约对同一资源只应有一行占用
CREATE UNIQUE INDEX "uk_booking_time_slot_booking_resource"
  ON "booking_time_slot"("booking_id", "resource_type", "resource_id");
CREATE INDEX "idx_booking_time_slot_tenant_id" ON "booking_time_slot"("tenant_id");
-- 容量校验主查询锚点：按「租户 + 资源 + 区间」取重叠占用
CREATE INDEX "idx_booking_time_slot_resource_range"
  ON "booking_time_slot"("tenant_id", "resource_type", "resource_id", "start_time");
-- 按预约回查占用行（触发器同步 / 排障）
CREATE INDEX "idx_booking_time_slot_booking" ON "booking_time_slot"("tenant_id", "booking_id");

-- ────────────────────────────────────────────────────────────
-- 回填：既有「占用态」预约的占用行
--  （迁移前的历史数据不会经过触发器 ⇒ 必须显式回填；幂等靠唯一索引 + ON CONFLICT）
--  释放态（cancelled / no_show / rescheduled）与软删预约**不产生**占用行（BR-1 / FR-3 / BR-3）。
-- ────────────────────────────────────────────────────────────
INSERT INTO "booking_time_slot" ("tenant_id", "resource_type", "resource_id", "booking_id", "start_time", "end_time")
SELECT b."tenant_id", 'employee', b."employee_id", b."id", b."start_time", b."end_time"
FROM "booking" b
WHERE b."deleted_at" IS NULL
  AND b."employee_id" IS NOT NULL
  AND b."status" NOT IN ('cancelled', 'no_show', 'rescheduled')
ON CONFLICT ("booking_id", "resource_type", "resource_id") DO NOTHING;

INSERT INTO "booking_time_slot" ("tenant_id", "resource_type", "resource_id", "booking_id", "start_time", "end_time")
SELECT b."tenant_id", 'room', b."room_id", b."id", b."start_time", b."end_time"
FROM "booking" b
WHERE b."deleted_at" IS NULL
  AND b."room_id" IS NOT NULL
  AND b."status" NOT IN ('cancelled', 'no_show', 'rescheduled')
ON CONFLICT ("booking_id", "resource_type", "resource_id") DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 触发器：把 booking 的占用事实投影到 booking_time_slot
--   INSERT  → 若占用态且未软删，按 employee_id / room_id 各写一行
--   UPDATE  → 先清该预约全部占用行，再按新值重建（区间 / 资源 / 状态任一变更都收敛）
--   DELETE  → 清该预约全部占用行（级联，替代外键）
--   AFTER 触发器：RETURN NULL 即可（返回值被忽略）
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.app_sync_booking_time_slot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  -- 「已释放时段」的预约状态（值域唯一来源：@peluvida/shared BookingStatus，
  -- 与 booking.constants.ts 的 BOOKING_RELEASED_STATUSES 保持一致）
  released_statuses text[] := ARRAY['cancelled', 'no_show', 'rescheduled'];
  target_tenant bigint;
  target_booking uuid;
  occupied boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_tenant := OLD."tenant_id";
    target_booking := OLD."id";
    occupied := false;
  ELSE
    target_tenant := NEW."tenant_id";
    target_booking := NEW."id";
    occupied := NEW."deleted_at" IS NULL AND NOT (NEW."status" = ANY (released_statuses));
  END IF;

  -- 对齐会话租户：本表 ENABLE + FORCE RLS，属主连接同样受 tenant_isolation 谓词约束
  -- （SET LOCAL 语义，事务结束自动还原；超级用户连接下为无害空操作）
  PERFORM set_config('app.tenant_id', target_tenant::text, true);

  IF TG_OP <> 'INSERT' THEN
    DELETE FROM "booking_time_slot" WHERE "booking_id" = target_booking;
  END IF;

  IF occupied THEN
    IF NEW."employee_id" IS NOT NULL THEN
      INSERT INTO "booking_time_slot" ("tenant_id", "resource_type", "resource_id", "booking_id", "start_time", "end_time")
      VALUES (NEW."tenant_id", 'employee', NEW."employee_id", NEW."id", NEW."start_time", NEW."end_time")
      ON CONFLICT ("booking_id", "resource_type", "resource_id") DO NOTHING;
    END IF;
    IF NEW."room_id" IS NOT NULL THEN
      INSERT INTO "booking_time_slot" ("tenant_id", "resource_type", "resource_id", "booking_id", "start_time", "end_time")
      VALUES (NEW."tenant_id", 'room', NEW."room_id", NEW."id", NEW."start_time", NEW."end_time")
      ON CONFLICT ("booking_id", "resource_type", "resource_id") DO NOTHING;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.app_sync_booking_time_slot() IS
  'MVP-WEB-06-04：把 booking 的「占用事实」投影为 booking_time_slot 占用行（三向同步）。占用态 = 未软删且 status ∉ {cancelled,no_show,rescheduled}；employee_id / room_id 非空各写一行；区间与 booking 逐字一致。函数内先对齐 app.tenant_id（本表 FORCE RLS）。';

DROP TRIGGER IF EXISTS "trg_booking_time_slot_sync" ON "booking";
CREATE TRIGGER "trg_booking_time_slot_sync"
  AFTER INSERT OR UPDATE OR DELETE ON "booking"
  FOR EACH ROW
  EXECUTE FUNCTION public.app_sync_booking_time_slot();

-- RLS：占用表启用租户隔离（ENABLE + FORCE + 幂等策略 tenant_isolation）
SELECT public.app_enable_tenant_rls('booking_time_slot'::regclass);
