/**
 * 状态元信息（StatusMeta）
 *
 * 三端渲染状态的统一结构：值 + 文案 + 语义色。
 * 任何「状态 → 文案 / 颜色」的映射都必须使用本类型，禁止在页面内私写映射表。
 */

import type { SemanticColorToken } from "../tokens";

export interface StatusMeta {
  /** 状态值（与后端枚举、DB 存储值一致，snake_case） */
  readonly value: string;
  /** 中文文案（三端唯一） */
  readonly label: string;
  /** 语义色令牌（取值见 SEMANTIC_COLORS） */
  readonly color: SemanticColorToken;
}

/**
 * 从状态映射表按状态值取元信息。
 *
 * @param map   该领域的状态映射表（如 BOOKING_STATUS_META）
 * @param value 状态值（可能来自后端，故为 string）
 * @returns 命中则返回 StatusMeta，未命中返回 undefined（调用方需处理未知状态）
 */
export function getStatusMeta<T extends string>(
  map: Readonly<Record<T, StatusMeta>>,
  value: string
): StatusMeta | undefined {
  return (map as Readonly<Record<string, StatusMeta>>)[value];
}

/**
 * 构建「状态 → 文案」的纯文案映射，供表格 / 标签直接查表。
 */
export function toLabelMap<T extends string>(
  map: Readonly<Record<T, StatusMeta>>
): Readonly<Record<T, string>> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(map) as T[]) {
    out[key] = map[key].label;
  }
  return out as Readonly<Record<T, string>>;
}
