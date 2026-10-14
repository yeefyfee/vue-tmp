/**
 * 租户隔离基线 · 常量（PEL-11）
 *
 * 命名与决策 A2 对齐：新建 `tenant` 模块承担租户隔离边界，**不复用 `sys_dept`**
 * （部门是组织概念，租户是隔离边界）。
 */

/**
 * PostgreSQL 自定义会话参数（GUC）键名。
 *
 * RLS 策略通过 `current_setting('app.tenant_id', true)` 读取当前会话的租户；
 * 写入方式为 `SET LOCAL app.tenant_id = '<id>'`（事务级，连接归还时自动清空）。
 * 完整的「Prisma $extends 事务内 SET LOCAL + RLS 策略落地」归 CROSS-09。
 */
export const TENANT_GUC_KEY = "app.tenant_id";

/** Redis 键的多租户前缀（键格式：`tenant:<租户ID>:业务:对象:标识`，完整键规范见 CROSS-10） */
export const TENANT_REDIS_PREFIX = "tenant:";

/**
 * **租户隔离模型名单**（Prisma 模型名集合）。
 *
 * 名单内的模型在读写时必须带租户上下文，否则 fail-closed 拒绝（见
 * `tenant-scope.extension.ts`）。当前收录业务域 P0 四表
 * Store / ServiceCategory / Room / Staff（2026-10-05 落库）；
 * `sys_*` / `gen_*` 14 张是**平台级**表（无 `tenant_id` 列，不受租户隔离约束）；
 * 后续业务表（客户/宠物/订单…）落地时经 `registerTenantScopedModels()` 登记
 * （P0-03-01 / CROSS-09）。
 *
 * 🔴 该名单是安全边界：新业务表带 `tenant_id` 列却没登记 ⇒ 不会被自动隔离。
 */
const tenantScopedModels = new Set<string>([
  "Store",
  "ServiceCategory",
  "Room",
  "Staff",
  "StoreCalendar",
  // 客户域（P0-05-01）：customer / customer_pet / reach_log / blacklist
  "Customer",
  "CustomerPet",
  "ReachLog",
  "Blacklist",
  // 宠物域（P0-06-01）：pet / health_record / weight / behavior_tag /
  // pet_behavior_tag / timeline_event
  "Pet",
  "HealthRecord",
  "Weight",
  "BehaviorTag",
  "PetBehaviorTag",
  "TimelineEvent",
  // 客户域（P0-05-03）：pet_transfer_request（宠物转移申请，多宠物归属审批流）
  "PetTransferRequest",
  // 媒体域（P0-08-01）：media（媒体/附件，多态挂接任意业务实体）
  "Media",
  // 预约域（P0-08-05）：booking（预约单，统一预约引擎；MVP-WEB-06-01 落库）
  "Booking",
  // 预约域（MVP-WEB-06-04）：booking_time_slot（时段占用表，容量校验的占用判定唯一来源；
  // 由 booking 触发器维护，应用层只读 ⇒ 仍须登记，否则读不到本租户的占用行）
  "BookingTimeSlot",
  // 订单域（MVP-WEB-07-01）：order / order_item（订单列表 + 明细）
  "Order",
  "OrderItem",
]);

export const TENANT_SCOPED_MODELS: ReadonlySet<string> = tenantScopedModels;

/** 登记租户隔离模型（幂等）。供业务模块/迁移脚本在启动期或测试中调用 */
export function registerTenantScopedModels(...models: string[]): void {
  for (const m of models) {
    if (m && m.trim() !== "") {
      tenantScopedModels.add(m);
    }
  }
}
