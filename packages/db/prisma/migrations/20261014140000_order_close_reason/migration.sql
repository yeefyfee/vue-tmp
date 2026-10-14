-- AlterTable（MVP-WEB-07-06 订单关闭 / 超时未支付自动关闭）
--
-- order 增加两列，承载「关闭」这一终态的落库载体：
--   · close_reason：关闭原因（VARCHAR(24)，可空）—— 值域唯一来源 @peluvida/shared
--     ORDER_CLOSE_REASON（manual / payment_timeout / customer_cancel）；
--     仅 status='closed' 时写入，其余状态为 NULL。
--   · closed_at：关闭时刻（TIMESTAMPTZ(3)，可空）—— 与 close_reason 同步写入，
--     供详情页展示与后续按关闭时间统计。
--
-- 两列均可空 ⇒ 对既有行零回填成本、向后兼容（07-01~07-05 读链路不受影响）。
-- RLS / 索引策略不变：扫描按 (status) 过滤走既有 idx_order_tenant_status。

ALTER TABLE "order" ADD COLUMN "close_reason" VARCHAR(24);

ALTER TABLE "order" ADD COLUMN "closed_at" TIMESTAMPTZ(3);

-- Comment
COMMENT ON COLUMN "order"."close_reason" IS
  '关闭原因：manual 手动关闭 / payment_timeout 超时未支付 / customer_cancel 客户取消（@peluvida/shared ORDER_CLOSE_REASON）；仅 closed 态非空';

COMMENT ON COLUMN "order"."closed_at" IS
  '关闭时刻（与 close_reason 同步写入；仅 closed 态非空）';
