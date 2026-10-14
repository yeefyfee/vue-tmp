import { BadRequestException } from "@nestjs/common";

/**
 * 主键（BigInt）转换工具（PEL-10c 移植约定）
 *
 * 为什么需要它：
 *  - 原 TypeORM 配置是 `supportBigNumbers: true, bigNumberStrings: true` —— 主键以**字符串**形态出入，
 *    前端与 DTO 全程按 string 处理。
 *  - Prisma 对 `bigint` 列返回的是 **JS BigInt**，`where` 也只接受 BigInt。
 *  ⇒ 边界处必须显式转换，否则会出现「查不到」或 `Do not know how to serialize a BigInt`。
 *
 * 统一走这里的函数，避免每个模块各写一份 `BigInt(x)`（那正是口径漂移的来源）。
 */

/** 宽松转换：非法/空值一律返回 null，用于可选外键字段 */
export function toBigInt(value: string | number | bigint | null | undefined): bigint | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    return BigInt(value as string | number | bigint);
  } catch {
    return null;
  }
}

/** 严格转换：非法值抛 400 —— 用于路径参数等「必须有值」的场景 */
export function requireBigInt(
  value: string | number | bigint | null | undefined,
  label = "ID"
): bigint {
  const parsed = toBigInt(value);
  if (parsed === null || parsed <= 0n) {
    throw new BadRequestException(`${label}格式不正确`);
  }
  return parsed;
}

/** 批量宽松转换，过滤掉非法项，用于 `in` 查询 */
export function toBigIntArray(
  values: Array<string | number | bigint> | null | undefined
): bigint[] {
  if (!Array.isArray(values)) return [];
  return values.map((v) => toBigInt(v)).filter((v): v is bigint => v !== null);
}

/** 转字符串，便于回填 DTO 或做字符串比较 */
export function bigIntToString(value: bigint | number | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.toString();
}
