/**
 * RBAC 常量与权限码工具（Phase 0 权限体系）
 *
 * 权限码格式：`module:resource:action`（如 `order:order:create`）。
 * 三重校验：认证层 → 权限层 → 数据层（data_scope）。
 */

/** 权限码分隔符 */
export const PERMISSION_CODE_SEPARATOR = ":";

/** 数据范围（三级） */
export const DataScope = {
  /** 总部全量 */
  ALL: "all",
  /** 本门店 */
  STORE: "store",
  /** 仅本人 */
  SELF: "self",
} as const;

export type DataScope = (typeof DataScope)[keyof typeof DataScope];

export const DATA_SCOPE_LABEL: Readonly<Record<DataScope, string>> = {
  [DataScope.ALL]: "总部全量",
  [DataScope.STORE]: "本门店",
  [DataScope.SELF]: "仅本人",
};

/** 系统预置角色（9 个） */
export const SystemRoleCode = {
  SUPER_ADMIN: "super_admin",
  HQ_ADMIN: "hq_admin",
  STORE_MANAGER: "store_manager",
  RECEPTIONIST: "receptionist",
  GROOMER: "groomer",
  BOARDING_STAFF: "boarding_staff",
  FINANCE: "finance",
  OPERATOR: "operator",
  STAFF: "staff",
} as const;

export type SystemRoleCode = (typeof SystemRoleCode)[keyof typeof SystemRoleCode];

/** 角色中文名（与 PRD 的 9 个角色一一对应） */
export const SYSTEM_ROLE_LABEL: Readonly<Record<SystemRoleCode, string>> = {
  [SystemRoleCode.SUPER_ADMIN]: "超级管理员",
  [SystemRoleCode.HQ_ADMIN]: "总部管理员",
  [SystemRoleCode.STORE_MANAGER]: "店长",
  [SystemRoleCode.RECEPTIONIST]: "前台",
  [SystemRoleCode.GROOMER]: "美容师",
  [SystemRoleCode.BOARDING_STAFF]: "寄养员",
  [SystemRoleCode.FINANCE]: "财务",
  [SystemRoleCode.OPERATOR]: "运营",
  [SystemRoleCode.STAFF]: "普通员工",
};

export interface PermissionCodeParts {
  readonly module: string;
  readonly resource: string;
  readonly action: string;
}

/** 组装权限码 */
export function buildPermissionCode(module: string, resource: string, action: string): string {
  return [module, resource, action].join(PERMISSION_CODE_SEPARATOR);
}

/** 解析权限码；格式非法返回 null */
export function parsePermissionCode(code: string): PermissionCodeParts | null {
  const parts = code.split(PERMISSION_CODE_SEPARATOR);
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) {
    return null;
  }
  return { module: parts[0], resource: parts[1], action: parts[2] };
}

/** 判定字符串是否为合法权限码（`module:resource:action`） */
export function isPermissionCode(value: unknown): value is string {
  return typeof value === "string" && parsePermissionCode(value) !== null;
}
