-- AlterTable（MVP-WEB-07-04 优惠与权益分摊）
--
-- order_item 增加两列，承载「优惠分摊到明细行」的唯一落库载体：
--   · discount_amount：该行分摊到的优惠额（分，BIGINT，非负）—— order.discount_amount 恒等于
--     本单未软删明细行 discount_amount 之和（服务端裁定，分摊守恒；算法 = @peluvida/shared
--     的 Money.allocate，比例基数 = 各行小计 unit_price * quantity）。
--   · discount_source：折扣来源（SMALLINT，0 无 / 1 手动改价 / 2 会员等级 / 3 优惠券）——
--     值域唯一来源 @peluvida/shared OrderItemDiscountSource；当前仅 1 可达
--     （PUT /orders/:id/discount 固定落 MANUAL）。
--
-- 两列均带 NOT NULL DEFAULT ⇒ 对既有行零回填成本、向后兼容（07-01~07-03 读链路不受影响）。
-- RLS / 索引策略不变（既有 idx_order_item_tenant_order 已覆盖按单回查）。

ALTER TABLE "order_item" ADD COLUMN "discount_amount" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "order_item" ADD COLUMN "discount_source" SMALLINT NOT NULL DEFAULT 0;

-- Comment
COMMENT ON COLUMN "order_item"."discount_amount" IS
  '该行分摊到的优惠额（分）= 订单优惠按行小计比例分摊结果；order.discount_amount = Σ 未软删行 discount_amount';

COMMENT ON COLUMN "order_item"."discount_source" IS
  '折扣来源：0 无 / 1 手动改价 / 2 会员等级 / 3 优惠券（@peluvida/shared OrderItemDiscountSource）';
