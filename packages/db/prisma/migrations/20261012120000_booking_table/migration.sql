-- 预约表落库（P0-08-05 预约数据模型；MVP-WEB-06-01 预约列表与状态展示的落库基础）
-- ============================================================
-- 口径对齐业务域既有迁移 20261008120000（媒体）/ 20261007150000（宠物域）/ 20261007114800（客户域）：
--   uuid 主键（库层 gen_random_uuid）+ tenant_id BIGINT + 业务表间关联 Uuid
--   + 引用 sys_user 的列保持 BIGINT? + TIMESTAMPTZ(3) 逐列显式 + 软删 deleted_at
--   + 乐观锁 version；**无数据库外键**（跨表一致性由业务层保证）。
-- 末尾调用 RLS 策略模板（ENABLE + FORCE + 幂等策略 tenant_isolation，
-- 模板函数 app_enable_tenant_rls(regclass) 幂等，见迁移 20261005150000）。
--
-- 状态列口径（与既有 store/room 的 SmallInt 数字状态刻意不同）：
--   status VARCHAR(16) 存 snake_case 字符串
--   （pending / confirmed / in_service / completed / cancelled / no_show / rescheduled）。
--   唯一来源为 @peluvida/shared 的 BOOKING_STATUS_META —— 其 StatusMeta.value 注释明确
--   「与后端枚举、DB 存储值一致，snake_case」；预约状态机是三端共享的字符串契约，
--   存数字会引入第二套「数字 ↔ 字符串」映射（踩坑 126-bis 双源漂移）。
--
-- 悬空 uuid 列说明（对齐 customer_pet.pet_id 的既有先例）：
--   service_id 指向尚未建模的服务项（service_item）表 ⇒ 先落列避免后续迁移改表；
--   service_name 冗余快照存展示用（服务项表建模前无实体表可关联）。
--
-- 关联列（均无外键，业务表间关联）：
--   store_id → store.id / customer_id → customer.id / pet_id → pet.id /
--   employee_id → staff.id / room_id → room.id / prev_booking_id → booking.id（改期互链）。
--
-- 未落表说明：PRD 字段设计中另有 booking_time_slot（时段占用表），
--   其写入方是容量校验（MVP-WEB-06-04）与创建/改期事务 ⇒ 随该任务一并落库，
--   避免先建「无人写入、无法验证」的空表。
-- ============================================================

-- CreateTable
CREATE TABLE "booking" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" BIGINT NOT NULL,
    "store_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "pet_id" UUID NOT NULL,
    "service_id" UUID,
    "service_name" VARCHAR(64),
    "booking_no" VARCHAR(32) NOT NULL,
    "booking_date" DATE NOT NULL,
    "start_time" TIMESTAMPTZ(3) NOT NULL,
    "end_time" TIMESTAMPTZ(3) NOT NULL,
    "employee_id" UUID,
    "room_id" UUID,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "prev_booking_id" UUID,
    "remark" VARCHAR(255),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "booking_pkey" PRIMARY KEY ("id")
);

COMMENT ON TABLE "booking" IS
  'P0-08-05 预约单：统一预约引擎（服务/宠物/客户/门店/员工/房间/时间/容量/状态）；status 存 snake_case 字符串（@peluvida/shared BookingStatus）；prev_booking_id 承载改期互链；RLS 走模板双向策略。';

COMMENT ON COLUMN "booking"."service_id" IS
  '服务项 id（⚠️ 悬空 uuid：service_item 表尚未建模；无外键）。';
COMMENT ON COLUMN "booking"."service_name" IS
  '服务项名称冗余快照（列表展示用；服务项表建模前无实体表可关联）。';
COMMENT ON COLUMN "booking"."status" IS
  '状态（snake_case 字符串）：pending 待确认 / confirmed 已确认 / in_service 服务中 / completed 已完成 / cancelled 已取消 / no_show 未到店 / rescheduled 已改期（值域唯一来源 @peluvida/shared BookingStatus）。';
COMMENT ON COLUMN "booking"."booking_date" IS
  '预约日期（DATE，无时间语义；应用层以 UTC 午夜瞬时承载）。';
COMMENT ON COLUMN "booking"."prev_booking_id" IS
  '改期前的关联预约 id（BR-1 改期互链：原单置 rescheduled，新单反向指向原单）。';

-- CreateIndex
-- 业务单号租户内唯一（应用层生成 BK+yyyymmdd+序号；唯一索引作并发兜底）
CREATE UNIQUE INDEX "uk_booking_tenant_no" ON "booking"("tenant_id", "booking_no");
CREATE INDEX "idx_booking_tenant_id" ON "booking"("tenant_id");
-- 列表主查询锚点：按「租户 + 门店 + 预约日期」取某日排期（前台作业面核心读路径）
CREATE INDEX "idx_booking_tenant_store_date" ON "booking"("tenant_id", "store_id", "booking_date");
-- 状态筛选 / 状态看板分组锚点
CREATE INDEX "idx_booking_tenant_status" ON "booking"("tenant_id", "status");
-- 宠物维度读取锚点（宠物档案「服务历史」、宠物时间线回查）
CREATE INDEX "idx_booking_tenant_pet" ON "booking"("tenant_id", "pet_id");

-- RLS：预约表启用租户隔离（ENABLE + FORCE + 幂等策略 tenant_isolation）
SELECT public.app_enable_tenant_rls('booking'::regclass);
