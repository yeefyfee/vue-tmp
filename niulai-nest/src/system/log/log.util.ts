import { ActionTypeEnum, type ActionTypeValue } from "../../common/enums/action-type.enum";
import { LogModuleEnum, type LogModuleValue } from "../../common/enums/log-module.enum";

/**
 * `sys_log` 各字符列的物理上限（与 `prisma/schema.prisma` 保持一致）。
 * PostgreSQL 对 `varchar(n)` 是**严格**校验（超出直接报错，不像旧 MySQL 非严格模式
 * 会静默截断），而日志写入在调用侧普遍 `catch` 吞掉异常，一旦超长就会「日志静默丢失」。
 * 因此写入前统一截断：宁可少几个字符，也不要丢掉整条记录。
 */
export const LOG_COLUMN_LIMITS = {
  title: 100,
  operatorName: 50,
  requestUri: 255,
  requestMethod: 10,
  ip: 45,
  province: 100,
  city: 100,
  device: 100,
  os: 100,
  browser: 100,
  errorMsg: 255,
} as const;

/** 按上限截断，空值保持空值 */
export function clampLogText(value: string | null | undefined, limit: number): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.length > limit ? text.slice(0, limit) : text;
}

/**
 * 统一日志标题口径：显式给定优先，否则拼成「模块label-操作label」。
 * 拦截器与手动写入两条路径共用，避免同一类日志出现两种标题。
 */
export function resolveLogTitle(
  module: LogModuleValue,
  actionType: ActionTypeValue,
  title?: string | null
): string {
  const explicit = title?.trim();
  if (explicit) return explicit;
  return `${LogModuleEnum.getLabel(module)}-${ActionTypeEnum.getLabel(actionType)}`;
}
