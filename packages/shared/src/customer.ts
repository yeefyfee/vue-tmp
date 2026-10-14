/**
 * 客户域枚举（P0-05）—— 客户来源 / 宠物类型 / 触达渠道 / 黑名单状态
 *
 * 口径：与业务新表 SmallInt 列对齐的数字枚举（对齐 Store.type / Room.roomType 风格），
 * 三端与后端共享的唯一合法值域来源；DB 列不设 CHECK，合法性由本常量 + DTO @IsIn 约束。
 */

/** 客户来源（customer.source；SmallInt，可空=未登记） */
export const CustomerSource = {
  /** 门店自然进店 */
  WALK_IN: 1,
  /** 老客转介绍 */
  REFERRAL: 2,
  /** 线上团购/平台引流 */
  GROUP_BUY: 3,
  /** 小程序注册 */
  MINIAPP: 4,
  /** 其他 */
  OTHER: 9,
} as const;

export type CustomerSource = (typeof CustomerSource)[keyof typeof CustomerSource];

/** 客户来源合法值域（DTO @IsIn / 校验遍历用） */
export const CUSTOMER_SOURCE_VALUES = Object.values(CustomerSource) as readonly CustomerSource[];

/** 宠物类型（customer_pet.pet_type；SmallInt，P0-06 宠物域建模前的冗余快照口径） */
export const PetType = {
  /** 犬 */
  DOG: 1,
  /** 猫 */
  CAT: 2,
  /** 其他 */
  OTHER: 9,
} as const;

export type PetType = (typeof PetType)[keyof typeof PetType];

/** 宠物类型合法值域（DTO @IsIn / 校验遍历用） */
export const PET_TYPE_VALUES = Object.values(PetType) as readonly PetType[];

/** 触达渠道（reach_log.channel；SmallInt） */
export const ReachChannel = {
  /** 站内信 */
  INAPP: 1,
  /** 微信服务号 */
  SERVICE_ACCOUNT: 2,
  /** 小程序订阅消息 */
  SUBSCRIBE_MESSAGE: 3,
  /** 短信 */
  SMS: 4,
} as const;

export type ReachChannel = (typeof ReachChannel)[keyof typeof ReachChannel];

/** 触达渠道合法值域（DTO @IsIn / 校验遍历用） */
export const REACH_CHANNEL_VALUES = Object.values(ReachChannel) as readonly ReachChannel[];

/** 黑名单状态（blacklist.status；SmallInt） */
export const BlacklistStatus = {
  /** 解除 */
  RELEASED: 0,
  /** 生效 */
  ACTIVE: 1,
} as const;

export type BlacklistStatus = (typeof BlacklistStatus)[keyof typeof BlacklistStatus];

/** 黑名单状态合法值域（DTO @IsIn / 校验遍历用） */
export const BLACKLIST_STATUS_VALUES = Object.values(BlacklistStatus) as readonly BlacklistStatus[];

/** 性别（customer.gender；SmallInt，可空=未登记） */
export const CustomerGender = {
  /** 未知 */
  UNKNOWN: 0,
  /** 男 */
  MALE: 1,
  /** 女 */
  FEMALE: 2,
} as const;

export type CustomerGender = (typeof CustomerGender)[keyof typeof CustomerGender];

/** 性别合法值域（DTO @IsIn / 校验遍历用） */
export const CUSTOMER_GENDER_VALUES = Object.values(CustomerGender) as readonly CustomerGender[];

// ─────────────────────────────────────────────────────────────
// P0-05-04 触达 FR-3 / P0-05-06 来源枚举 FR-5 + 分层 lifecycle FR-6 增量
// ─────────────────────────────────────────────────────────────

/** 客户生命周期分层（customer.lifecycle；SmallInt，非空，默认 1 新客） */
export const CustomerLifecycle = {
  /** 新客（建档初期，尚未产生有效消费） */
  NEW: 1,
  /** 活跃（近期有到店 / 消费 / 互动） */
  ACTIVE: 2,
  /** 沉睡（长期无互动但尚未判定流失） */
  DORMANT: 3,
  /** 流失（长期未回流，视为流失） */
  LOST: 4,
} as const;

export type CustomerLifecycle = (typeof CustomerLifecycle)[keyof typeof CustomerLifecycle];

/** 生命周期合法值域（DTO @IsIn / 校验遍历用） */
export const CUSTOMER_LIFECYCLE_VALUES = Object.values(
  CustomerLifecycle
) as readonly CustomerLifecycle[];

/** 触达结果（reach_log.result；SmallInt，可空=未回执） */
export const ReachResult = {
  /** 成功（已送达） */
  SUCCESS: 1,
  /** 失败（渠道异常 / 被拒） */
  FAILED: 2,
} as const;

export type ReachResult = (typeof ReachResult)[keyof typeof ReachResult];

/** 触达结果合法值域 */
export const REACH_RESULT_VALUES = Object.values(ReachResult) as readonly ReachResult[];

/** 统一枚举下拉项（value/label），供 source-options 等选项接口消费 */
export interface EnumOption<T extends number = number> {
  value: T;
  label: string;
}

/** 客户来源选项（label 对齐 PRD FR-5 文案） */
export const CUSTOMER_SOURCE_OPTIONS: readonly EnumOption<CustomerSource>[] = [
  { value: CustomerSource.WALK_IN, label: "自然进店" },
  { value: CustomerSource.REFERRAL, label: "老客转介绍" },
  { value: CustomerSource.GROUP_BUY, label: "线上团购" },
  { value: CustomerSource.MINIAPP, label: "小程序注册" },
  { value: CustomerSource.OTHER, label: "其他" },
];

/** 客户生命周期选项 */
export const CUSTOMER_LIFECYCLE_OPTIONS: readonly EnumOption<CustomerLifecycle>[] = [
  { value: CustomerLifecycle.NEW, label: "新客" },
  { value: CustomerLifecycle.ACTIVE, label: "活跃" },
  { value: CustomerLifecycle.DORMANT, label: "沉睡" },
  { value: CustomerLifecycle.LOST, label: "流失" },
];

/** 触达渠道选项 */
export const REACH_CHANNEL_OPTIONS: readonly EnumOption<ReachChannel>[] = [
  { value: ReachChannel.INAPP, label: "站内信" },
  { value: ReachChannel.SERVICE_ACCOUNT, label: "微信服务号" },
  { value: ReachChannel.SUBSCRIBE_MESSAGE, label: "小程序订阅消息" },
  { value: ReachChannel.SMS, label: "短信" },
];

/** 触达结果选项 */
export const REACH_RESULT_OPTIONS: readonly EnumOption<ReachResult>[] = [
  { value: ReachResult.SUCCESS, label: "成功" },
  { value: ReachResult.FAILED, label: "失败" },
];

/** 免打扰时段（跨夜由 start>end 表达） */
export interface CustomerReachDoNotDisturb {
  /** 是否启用免打扰 */
  enabled: boolean;
  /** 起始时间 HH:mm（含） */
  start: string;
  /** 结束时间 HH:mm（不含）；start>end 表示跨夜 */
  end: string;
}

/**
 * 客户触达偏好（customer.reach_preferences JSONB；结构见迁移 20261007170000）
 *
 * 语义：
 *  - allowedChannels=null（或空数组归一为 null）= 不设白名单 → 默认允许全部渠道；
 *    非空数组 = 仅允许其中的渠道；
 *  - blockedChannels = 明确拒绝渠道，优先级高于白名单（命中即拒）；
 *  - doNotDisturb = 免打扰时段（跨夜由 start>end 表达）。
 */
export interface CustomerReachPreference {
  allowedChannels: number[] | null;
  blockedChannels: number[];
  doNotDisturb: CustomerReachDoNotDisturb;
}

/** 触达偏好默认值（未配置时的兜底：不限制渠道、不免打扰） */
export const DEFAULT_CUSTOMER_REACH_PREFERENCE: CustomerReachPreference = {
  allowedChannels: null,
  blockedChannels: [],
  doNotDisturb: { enabled: false, start: "22:00", end: "08:00" },
};

/** HH:mm 校验（免打扰时段） */
const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * 归一并兜底触达偏好（PUT 整存整取语义 / 读取时兜底 DB 历史脏值）
 *
 * - 入参可为任意形态 JSON（DB 历史值 / 请求体），非法项被丢弃回落默认；
 * - allowedChannels 空数组归一为 null（= 不设白名单）；
 * - 渠道值仅保留在有效值域内的项，去重后升序。
 */
export function resolveCustomerReachPreference(
  input: unknown,
  fallback: CustomerReachPreference = DEFAULT_CUSTOMER_REACH_PREFERENCE
): CustomerReachPreference {
  const raw = (input && typeof input === "object" ? input : {}) as {
    allowedChannels?: unknown;
    blockedChannels?: unknown;
    doNotDisturb?: unknown;
  };

  const normalizeChannels = (value: unknown): number[] => {
    if (!Array.isArray(value)) {
      return [];
    }
    const valid = value
      .map((v) => Number(v))
      .filter((v) => (REACH_CHANNEL_VALUES as readonly number[]).includes(v));
    return Array.from(new Set(valid)).sort((a, b) => a - b);
  };

  const allowedRaw = raw.allowedChannels;
  let allowedChannels: number[] | null;
  if (allowedRaw === null) {
    allowedChannels = null;
  } else if (allowedRaw === undefined) {
    allowedChannels = fallback.allowedChannels;
  } else {
    const normalized = normalizeChannels(allowedRaw);
    allowedChannels = normalized.length > 0 ? normalized : null;
  }

  const blockedChannels =
    raw.blockedChannels === undefined
      ? [...fallback.blockedChannels]
      : normalizeChannels(raw.blockedChannels);

  const dndRaw = (
    raw.doNotDisturb && typeof raw.doNotDisturb === "object" ? raw.doNotDisturb : {}
  ) as { enabled?: unknown; start?: unknown; end?: unknown };
  const dndFallback = fallback.doNotDisturb;
  const start =
    typeof dndRaw.start === "string" && HHMM_PATTERN.test(dndRaw.start)
      ? dndRaw.start
      : dndFallback.start;
  const end =
    typeof dndRaw.end === "string" && HHMM_PATTERN.test(dndRaw.end) ? dndRaw.end : dndFallback.end;
  const enabled = dndRaw.enabled === undefined ? dndFallback.enabled : Boolean(dndRaw.enabled);

  return { allowedChannels, blockedChannels, doNotDisturb: { enabled, start, end } };
}

/** 通道是否可触达（依据偏好；免打扰时段判定需结合当前时间，由服务层完成） */
export function isChannelReachable(channel: number, preference: CustomerReachPreference): boolean {
  if (preference.blockedChannels.includes(channel)) {
    return false;
  }
  if (preference.allowedChannels && !preference.allowedChannels.includes(channel)) {
    return false;
  }
  return true;
}
