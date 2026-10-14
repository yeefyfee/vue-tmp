/**
 * 订单模块权限点登记表（MVP-WEB-07-01~04）
 *
 * 权限机制（与 booking / store / pet 域一致）：
 *  - 权限码是「字符串标识」；运行时由 `PermissionGuard` 从 `@Permissions(...)`
 *    元数据读取，经 `RolePermService.getPermsByRoleCodes()` 校验；
 *  - 「登记权限点」= 代码侧以唯一常量声明权限码，DB 侧 `sys_menu` 由 seed 落库。
 */

export const OrderPermissions = {
  ORDER_LIST: "order:list",
  ORDER_CREATE: "order:create",
  ORDER_UPDATE: "order:update",
  ORDER_DELETE: "order:delete",
  /** 手动改价折扣（MVP-WEB-07-04；PRD《权限规则》关键操作矩阵默认角色 = 店长） */
  ORDER_DISCOUNT: "order:discount",
  /** 开始服务（paid → in_progress；MVP-WEB-07-05 履约联动） */
  ORDER_START: "order:start",
  /** 完成服务（in_progress → completed；MVP-WEB-07-05 履约联动） */
  ORDER_COMPLETE: "order:complete",
  /** 关闭订单（pending_payment → closed；MVP-WEB-07-06 订单关闭） */
  ORDER_CLOSE: "order:close",
} as const;

export type OrderPermission = (typeof OrderPermissions)[keyof typeof OrderPermissions];

export const ORDER_PERMISSION_CODES: readonly OrderPermission[] = Object.values(OrderPermissions);

export const ORDER_PERMISSION_LABELS: Readonly<Record<OrderPermission, string>> = {
  [OrderPermissions.ORDER_LIST]: "订单-查询",
  [OrderPermissions.ORDER_CREATE]: "订单-新建",
  [OrderPermissions.ORDER_UPDATE]: "订单-编辑",
  [OrderPermissions.ORDER_DELETE]: "订单-删除",
  [OrderPermissions.ORDER_DISCOUNT]: "订单-改价折扣",
  [OrderPermissions.ORDER_START]: "订单-开始服务",
  [OrderPermissions.ORDER_COMPLETE]: "订单-完成服务",
  [OrderPermissions.ORDER_CLOSE]: "订单-关闭",
};
