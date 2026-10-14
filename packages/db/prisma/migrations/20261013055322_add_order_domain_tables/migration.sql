-- CreateTable
CREATE TABLE "order" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" BIGINT NOT NULL,
    "store_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "pet_id" UUID NOT NULL,
    "source_booking_id" UUID,
    "order_no" VARCHAR(32) NOT NULL,
    "total_amount" BIGINT NOT NULL,
    "discount_amount" BIGINT NOT NULL DEFAULT 0,
    "payable_amount" BIGINT NOT NULL,
    "credit_flag" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(16) NOT NULL DEFAULT 'draft',
    "remark" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" BIGINT NOT NULL,
    "order_id" UUID NOT NULL,
    "item_type" SMALLINT NOT NULL,
    "ref_id" UUID NOT NULL,
    "item_name" VARCHAR(64) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price" BIGINT NOT NULL,
    "refund_status" SMALLINT NOT NULL DEFAULT 0,
    "fulfill_status" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "order_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_order_tenant_id" ON "order"("tenant_id");

-- CreateIndex
CREATE INDEX "idx_order_tenant_store" ON "order"("tenant_id", "store_id");

-- CreateIndex
CREATE INDEX "idx_order_tenant_status" ON "order"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "idx_order_tenant_customer" ON "order"("tenant_id", "customer_id");

-- CreateIndex
CREATE INDEX "idx_order_tenant_created" ON "order"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "uk_order_tenant_no" ON "order"("tenant_id", "order_no");

-- CreateIndex
CREATE INDEX "idx_order_item_tenant_id" ON "order_item"("tenant_id");

-- CreateIndex
CREATE INDEX "idx_order_item_tenant_order" ON "order_item"("tenant_id", "order_id");

-- Comment
COMMENT ON TABLE "order" IS
  'MVP-WEB-07-01 订单：一单一宠一闭环；status 存 snake_case 字符串（@peluvida/shared OrderStatus）；RLS 走模板双向策略。';

COMMENT ON TABLE "order_item" IS
  'MVP-WEB-07-01 订单明细：服务/商品/套餐项；一单可多明细；RLS 走模板双向策略。';

-- RLS：订单表启用租户隔离（ENABLE + FORCE + 幂等策略 tenant_isolation）
SELECT public.app_enable_tenant_rls('order'::regclass);

-- RLS：订单明细表启用租户隔离
SELECT public.app_enable_tenant_rls('order_item'::regclass);
