/**
 * 租户套餐与能力开关（P0-03-01，Q10 决策）
 *
 * 套餐（plan）仅作展示 / 计费标识：**业务代码一律只判断能力开关
 * （Tenant.feature_flags），禁止对 Starter / Professional / Business 字符串
 * 做运行时分支**——能力集变更只需改 preset 与租户数据，不改代码。
 */

/** 租户能力开关键（feature_flags 的合法键全集） */
export const TenantCapability = {
  /** 寄养 */
  FOSTER: "foster",
  /** 会员 */
  MEMBER: "member",
  /** 营销 */
  MARKETING: "marketing",
  /** 多店 */
  MULTI_STORE: "multi_store",
  /** 总部 */
  HEADQUARTERS: "headquarters",
  /** Open API */
  OPEN_API: "open_api",
} as const;

export type TenantCapability = (typeof TenantCapability)[keyof typeof TenantCapability];

/** 全部能力键（用于校验 feature_flags 的键合法性） */
export const TENANT_CAPABILITY_KEYS = Object.values(
  TenantCapability
) as readonly TenantCapability[];

/** feature_flags 的结构：能力键 → 开关布尔；未出现的键视为不具备 */
export type TenantFeatureFlags = Partial<Record<TenantCapability, boolean>>;

/** 租户套餐标识（仅展示 / 计费用，业务运行时分支禁用——Q10） */
export const TenantPlan = {
  STARTER: "starter",
  PROFESSIONAL: "professional",
  BUSINESS: "business",
} as const;

export type TenantPlan = (typeof TenantPlan)[keyof typeof TenantPlan];

/** 各套餐预设能力集（开通租户时据此写入 feature_flags；此后运行时只读 flags） */
export const TENANT_PLAN_PRESETS: Readonly<Record<TenantPlan, TenantFeatureFlags>> = {
  [TenantPlan.STARTER]: {},
  [TenantPlan.PROFESSIONAL]: {
    [TenantCapability.FOSTER]: true,
    [TenantCapability.MEMBER]: true,
    [TenantCapability.MARKETING]: true,
  },
  [TenantPlan.BUSINESS]: {
    [TenantCapability.FOSTER]: true,
    [TenantCapability.MEMBER]: true,
    [TenantCapability.MARKETING]: true,
    [TenantCapability.MULTI_STORE]: true,
    [TenantCapability.HEADQUARTERS]: true,
    [TenantCapability.OPEN_API]: true,
  },
};

/**
 * 判定租户是否具备某能力（业务代码统一入口）。
 *
 * fail-closed：flags 非对象 / 键不存在 / 值非布尔 true，一律视为不具备——
 * 与租户上下文缺失（A0302）同口径，宁可错拒不放误放。
 */
export function tenantHasCapability(flags: unknown, capability: TenantCapability): boolean {
  if (typeof flags !== "object" || flags === null) {
    return false;
  }
  return (flags as Record<string, unknown>)[capability] === true;
}
