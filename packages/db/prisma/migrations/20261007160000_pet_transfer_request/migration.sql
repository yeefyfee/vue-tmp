-- 宠物转移申请单表落库（P0-05-03 · FR-2 多宠物归属，转移需审批）
-- ============================================================
-- 口径对齐业务域既有迁移 20261005160000 / 20261006090000 / 20261007114800 /
-- 20261007150000：
--   uuid 主键（库层 gen_random_uuid）+ tenant_id BIGINT + 业务表间关联 Uuid
--   + 引用 sys_user 的列保持 BIGINT? + TIMESTAMPTZ(3) 逐列显式
--   + 软删 deleted_at + 乐观锁 version；无数据库外键（跨表一致性业务层保证）。
-- 末尾对表调用 RLS 策略模板（ENABLE + FORCE + 幂等策略 tenant_isolation，
-- 模板函数 app_enable_tenant_rls(regclass) 幂等，见迁移 20261005150000）。
--
-- ⚠️ 业务不变式「同一 pet 同时仅一条 status=1 待审批申请」——部分唯一索引取舍：
--   uk_pet_transfer_request_pending ON pet_transfer_request(tenant_id, pet_id)
--     WHERE status = 1
--   取「WHERE status = 1」而非「WHERE deleted_at IS NULL AND status = 1」：
--   转移申请的正常生命周期是**状态流转**（1→2/3/4），pending（status=1）行从不
--   软删（撤销走 status=4），故两谓词等价；取更严的 status=1 可确保即使出现
--   误软删的 pending 行也不会与该宠物新的 pending 申请并存（不变式最强）。
--   PG 部分唯一索引 Prisma schema 无法表达（schema 侧不声明 @@unique，避免生成
--   冲突的全量唯一索引），唯一性由三层保证：应用层 findFirst 查重（A0515 友好码）
--   → 部分唯一索引并发兜底（P2002 → A0515）→ RLS 租户隔离。
-- ============================================================

-- CreateTable
CREATE TABLE "pet_transfer_request" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" BIGINT NOT NULL,
    "pet_id" UUID NOT NULL,
    "from_customer_id" UUID NOT NULL,
    "to_customer_id" UUID NOT NULL,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "reason" VARCHAR(255),
    "applied_by" BIGINT,
    "approved_by" BIGINT,
    "approved_at" TIMESTAMPTZ(3),
    "reject_reason" VARCHAR(255),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "pet_transfer_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- 在途申请唯一性：部分唯一索引（同一 pet 同时仅一条 status=1 待审批，见文件头取舍）
CREATE UNIQUE INDEX "uk_pet_transfer_request_pending" ON "pet_transfer_request"("tenant_id", "pet_id") WHERE "status" = 1;
CREATE INDEX "idx_pet_transfer_request_tenant_id" ON "pet_transfer_request"("tenant_id");
CREATE INDEX "idx_pet_transfer_request_tenant_status" ON "pet_transfer_request"("tenant_id", "status");
CREATE INDEX "idx_pet_transfer_request_tenant_pet" ON "pet_transfer_request"("tenant_id", "pet_id");

-- RLS：宠物转移申请单表启用租户隔离（ENABLE + FORCE + 幂等策略 tenant_isolation）
SELECT public.app_enable_tenant_rls('pet_transfer_request'::regclass);
