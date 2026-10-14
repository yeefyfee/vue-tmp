/**
 * 预约模块权限点登记表（P0-08-05；MVP-WEB-06-01）
 *
 * 权限机制（与 store / pet 域一致，已核实）：
 *  - 权限码是「字符串标识」；运行时由 `PermissionGuard` 从 `@Permissions(...)`
 *    元数据读取，经 `RolePermService.getPermsByRoleCodes()`（Redis 缓存 → 回源
 *    `sys_role_menu ⋈ sys_menu`，仅取 `sys_menu.type='B' AND perm IS NOT NULL`）校验；
 *  - `ROOT_ROLE_CODE`（tenant_admin / admin）直放 ⇒ 新权限点不阻塞超级管理员；
 *  - 「登记权限点」= 代码侧以唯一常量声明权限码（本文件为单一事实源），
 *    并在控制器 `@Permissions(...)` 引用；DB 侧 `sys_menu` / `sys_role_menu` 行
 *    由 seed（packages/db/prisma/seed.ts）落库。
 *
 * 🔴 已接线权限点：
 *    - `booking:list`   列表与详情共用（MVP-WEB-06-01，PRD「全部内部角色」可读）——
 *      **MVP-WEB-06-03 的日历读端点与冲突检测端点亦复用本码**：冲突检测是**只读**查询
 *      （返回候选时段的重叠事实，不写库），语义即「能看预约的人可以问某时段是否可用」；
 *      另立 `booking:calendar` 会产出「日历能看、列表不能看」的怪权限格。
 *    - `booking:create` 创建预约（MVP-WEB-06-02，PRD「店长、前台、宠主」）——
 *      **同时门控创建表单的参考数据端点**（员工 / 服务项下拉取数），
 *      因为它们只在创建表单里被消费，单独拆码会产出「定义了却无独立语义」的空码。
 *      **MVP-WEB-06-04 的容量预校验端点亦复用本码**：PRD《Booking API》端点清单把
 *      `capacity-check` 的权限角色标为「同上」（= 创建预约），且它本就是创建流程的
 *      前置校验（「这一次创建能不能成」）⇒ 与创建同权限；另立 `booking:capacity`
 *      会产出「能建单却不能预校验」的怪权限格。
 *    - `booking:confirm` / `booking:checkin` / `booking:start` / `booking:complete` /
 *      `booking:reschedule` / `booking:cancel` / `booking:no-show`（MVP-WEB-06-05）——
 *      七个状态流转动作**各立一码**。为什么不收成一个 `booking:transition`：
 *      PRD《Booking API》端点清单对每个动作**分别**标注了权限角色
 *      （`confirm`/`checkin`/`no-show` = 店长·前台；`start`/`complete` = 再加美容师；
 *      `reschedule`/`cancel` = 店长·前台·宠主）⇒ 合成一个码后「美容师可开始服务
 *      但不可确认预约」「宠主可取消但不可爽约」这两条区分**无法表达**；
 *      而《页面功能》验收要点明确要求「操作按钮随状态机渲染，非法状态下按钮不出现」，
 *      按钮的可见性正是靠权限码 + 状态机两个维度共同决定的。
 *
 * ⚠️ 边界：本仓角色体系只有 manager / staff 两档，无法把 PRD 里的「前台 / 美容师 /
 *    寄养员」拆开 ⇒ staff 角色被授予全部七个流转码（比 PRD 字面范围略宽），
 *    与 06-02 创建码的既有边界口径一致（「前台」在 seed 里隶属 staff）。
 *
 * 未接线：无（预约域端点已全部落地）。
 *
 * 命名口径：`域:对象:动作`（对齐 `store:list` / `pet:tag:list` 既有风格）。
 */
export const BookingPermissions = {
  /** 预约列表与详情（PRD《Booking API》：「全部内部角色」可读） */
  BOOKING_LIST: "booking:list",
  /** 创建预约（PRD《Booking API》：「店长、前台、宠主」）+ 创建表单参考数据端点 */
  BOOKING_CREATE: "booking:create",
  /** 确认预约（PRD：「店长、前台」） */
  BOOKING_CONFIRM: "booking:confirm",
  /** 到店登记（PRD：「店长、前台」） */
  BOOKING_CHECKIN: "booking:checkin",
  /** 开始服务（PRD：「店长、前台、美容师」） */
  BOOKING_START: "booking:start",
  /** 完成服务（PRD：「店长、前台、美容师」） */
  BOOKING_COMPLETE: "booking:complete",
  /** 改期（PRD：「店长、前台、宠主」） */
  BOOKING_RESCHEDULE: "booking:reschedule",
  /** 取消（PRD：「店长、前台、宠主」） */
  BOOKING_CANCEL: "booking:cancel",
  /** 标记爽约（PRD：「店长、前台」） */
  BOOKING_NO_SHOW: "booking:no-show",
} as const;

export type BookingPermission = (typeof BookingPermissions)[keyof typeof BookingPermissions];

/** 全量权限点清单（登记顺序 = 建议 sys_menu(type='B') 建单顺序） */
export const BOOKING_PERMISSION_CODES: readonly BookingPermission[] =
  Object.values(BookingPermissions);

/** 权限点中文名（供 `sys_menu.name` 登记与后台展示参考） */
export const BOOKING_PERMISSION_LABELS: Readonly<Record<BookingPermission, string>> = {
  [BookingPermissions.BOOKING_LIST]: "预约-查询",
  [BookingPermissions.BOOKING_CREATE]: "预约-新建",
  [BookingPermissions.BOOKING_CONFIRM]: "预约-确认",
  [BookingPermissions.BOOKING_CHECKIN]: "预约-到店登记",
  [BookingPermissions.BOOKING_START]: "预约-开始服务",
  [BookingPermissions.BOOKING_COMPLETE]: "预约-完成服务",
  [BookingPermissions.BOOKING_RESCHEDULE]: "预约-改期",
  [BookingPermissions.BOOKING_CANCEL]: "预约-取消",
  [BookingPermissions.BOOKING_NO_SHOW]: "预约-标记爽约",
};
