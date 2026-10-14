/**
 * 审计日志（P0-02-08）—— 实体类型 / 动作 / 操作人类型枚举与校验
 *
 * 口径（与评估报告一致，开放问题按评估推荐默认，待拍板可调）：
 *  - entityType 是**业务表名 slug**（audit_log.entity_type 列的合法值域），
 *    随业务域任务增量登记，杜绝魔法字符串失控；
 *  - action 沿用 SmallInt 数字枚举风格（对齐 sys_log 的 SmallInt 列口径）；
 *  - operatorType 区分用户 / 系统动作（Q4：operatorId 可空 + operatorType 区分）；
 *  - 平台级对象（sys_role / sys_menu 等无租户归属）写审计时 tenant_id 记 0 哨兵
 *    （Q6：记被操作数据所属租户；平台视角查询通道后置）。
 *
 * 本包只放「纯常量 + 纯函数」：diff 与脱敏属写入行为，在 nest 侧
 * `src/common/audit/audit-diff.util.ts` 实现（可复用逻辑再下沉到这里）。
 */

/** 审计对象类型（audit_log.entity_type 合法值域；业务表名 slug） */
export const AuditEntityType = {
  /** 门店 */
  STORE: "store",
  /** 服务类目 */
  SERVICE_CATEGORY: "service_category",
  /** 寄养房间 */
  ROOM: "room",
  /** 门店日历（P0-04-04 · FR-3 日期级例外：节假日/临时闭店/特殊营业） */
  STORE_CALENDAR: "store_calendar",
  /** 员工 */
  STAFF: "staff",
  /** 萌主档案/客户（P0-05-02） */
  CUSTOMER: "customer",
  /** 角色（系统域） */
  ROLE: "sys_role",
  /** 菜单（系统域） */
  MENU: "sys_menu",
  /** 系统配置（系统域） */
  CONFIG: "sys_config",
  /** 用户（系统域） */
  USER: "sys_user",
  /** 租户（P0-03-04 挂账：PATCH /tenants/:id 平台侧更新留痕） */
  TENANT: "tenant",
  /** 预约（MVP-WEB-06-05：状态流转 / 改期 / 取消 / 爽约逐次留痕） */
  BOOKING: "booking",
  /** 订单（MVP-WEB-07-02：订单详情「操作日志」页签按该 slug 回查；写侧随 07-03+ 端点登记） */
  ORDER: "order",
} as const;

export type AuditEntityType = (typeof AuditEntityType)[keyof typeof AuditEntityType];

/** 全部实体类型（校验与遍历用） */
export const AUDIT_ENTITY_TYPE_KEYS = Object.values(AuditEntityType) as readonly AuditEntityType[];

/** 审计动作（audit_log.action 合法值域；SmallInt 数字枚举，随业务增量登记） */
export const AuditAction = {
  /** 新增 */
  CREATE: 1,
  /** 修改 */
  UPDATE: 2,
  /** 删除 */
  DELETE: 3,
  /** 启用 */
  ENABLE: 4,
  /** 停用 */
  DISABLE: 5,
  /** 导出 */
  EXPORT: 6,
  /** 授权（todo 点名的关键操作：角色授权 / 菜单授权） */
  GRANT: 7,
} as const;

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

/** 全部动作值（校验与遍历用） */
export const AUDIT_ACTION_KEYS = Object.values(AuditAction) as readonly AuditAction[];

/** 操作人类型（audit_log.operator_type） */
export const AuditOperatorType = {
  /** 系统动作（定时任务 / 系统触发；operator_id 为 NULL） */
  SYSTEM: 0,
  /** 用户动作（operator_id = sys_user.id） */
  USER: 1,
} as const;

export type AuditOperatorType = (typeof AuditOperatorType)[keyof typeof AuditOperatorType];

/**
 * 平台级对象的租户哨兵值（audit_log.tenant_id = 0）。
 *
 * tenant_id 列 NOT NULL，而 sys_role / sys_menu 等平台级对象没有租户归属；
 * 0 不是合法租户 id（自增从 1 起），租户查询永远看不到 0 行（RLS USING 谓词
 * tenant_id = GUC，GUC 为正数），平台视角的查询通道后置（Q6）。
 */
export const AUDIT_TENANT_ID_PLATFORM = 0n;

/** 校验值是否为合法实体类型 */
export function isAuditEntityType(value: unknown): value is AuditEntityType {
  return typeof value === "string" && (AUDIT_ENTITY_TYPE_KEYS as readonly string[]).includes(value);
}

/** 校验值是否为合法动作 */
export function isAuditAction(value: unknown): value is AuditAction {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    (AUDIT_ACTION_KEYS as readonly number[]).includes(value)
  );
}
