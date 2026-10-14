/**
 * 门店配置（P0-04-05 · FR-4）—— shared 层唯一口径
 *
 * 职责：
 *  - 定义门店级配置覆盖（store.config JSONB）的键位、类型与默认值；
 *  - `resolveStoreConfig(raw)`：把库内半结构化 JSON 合并为**完整结构化配置**
 *    （缺键补默认、非法值 fail-safe 回落默认——绝不因脏数据炸业务链路）；
 *  - `isValidStoreConfigValue`：单键校验（nest 侧 PATCH 部分更新时逐键校验用，
 *    校验失败抛业务码 A0437，而非像 resolve 一样静默回落——写入口径从严、
 *    读取口径从容）。
 *
 * 约束：本文件只放「纯常量 + 纯函数」，不引入任何运行时依赖与 IO。
 */

/** 配置键位（store.config JSONB 的合法键集合；新增键在此登记） */
export const STORE_CONFIG_KEYS = [
  "slotGranularityMin",
  "bookingLeadHours",
  "cancelCutoffHours",
  "boardingCheckinTime",
  "boardingCheckoutTime",
  "pushEnabled",
] as const;

export type StoreConfigKey = (typeof STORE_CONFIG_KEYS)[number];

/** 预约时段粒度可选值（分钟） */
export const SLOT_GRANULARITY_OPTIONS = [15, 30, 60] as const;

/** 预约提前量范围（小时） */
export const BOOKING_LEAD_HOURS_RANGE = { min: 0, max: 720 } as const;

/** 取消截止范围（小时） */
export const CANCEL_CUTOFF_HOURS_RANGE = { min: 0, max: 168 } as const;

/** 墙钟时间 HH:mm（24 小时制） */
export const WALL_CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 门店结构化配置（resolveStoreConfig 的输出恒为完整六键） */
export interface StoreConfig {
  /** 预约时段粒度（分钟）：15 / 30 / 60 */
  slotGranularityMin: number;
  /** 预约提前量（小时）：0~720 */
  bookingLeadHours: number;
  /** 取消截止（小时）：距开始不足该时长禁止取消，0~168 */
  cancelCutoffHours: number;
  /** 寄养入住时间（HH:mm） */
  boardingCheckinTime: string;
  /** 寄养退房时间（HH:mm） */
  boardingCheckoutTime: string;
  /** 推送开关 */
  pushEnabled: boolean;
}

/** 平台默认值（门店 config 为 NULL / 缺键 / 非法时逐键回落到此） */
export const DEFAULT_STORE_CONFIG: Readonly<StoreConfig> = Object.freeze({
  slotGranularityMin: 30,
  bookingLeadHours: 2,
  cancelCutoffHours: 24,
  boardingCheckinTime: "10:00",
  boardingCheckoutTime: "18:00",
  pushEnabled: true,
});

/** 平台默认值的可变副本（调用方可自由改写，不污染常量本体） */
export function cloneDefaultStoreConfig(): StoreConfig {
  return { ...DEFAULT_STORE_CONFIG };
}

/** 值是否为「安全整数」的通用判定（排除 NaN / Infinity / 小数） */
function isSafeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/**
 * 单键校验（严格口径：写侧 PATCH 逐键校验，非法即报 A0437）。
 *
 * @param key   配置键（必须在 STORE_CONFIG_KEYS 内）
 * @param value 待校验值（来自 JSONB 反序列化，可能是任意类型）
 */
export function isValidStoreConfigValue(key: StoreConfigKey, value: unknown): boolean {
  switch (key) {
    case "slotGranularityMin":
      return isSafeInt(value) && (SLOT_GRANULARITY_OPTIONS as readonly number[]).includes(value);
    case "bookingLeadHours":
      return (
        isSafeInt(value) &&
        value >= BOOKING_LEAD_HOURS_RANGE.min &&
        value <= BOOKING_LEAD_HOURS_RANGE.max
      );
    case "cancelCutoffHours":
      return (
        isSafeInt(value) &&
        value >= CANCEL_CUTOFF_HOURS_RANGE.min &&
        value <= CANCEL_CUTOFF_HOURS_RANGE.max
      );
    case "boardingCheckinTime":
    case "boardingCheckoutTime":
      return typeof value === "string" && WALL_CLOCK_TIME_PATTERN.test(value);
    case "pushEnabled":
      return typeof value === "boolean";
    default:
      return false;
  }
}

/** 判定是否为普通对象（排除数组 / null / 原始值） */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

/**
 * 把库内 `store.config`（半结构化 JSONB，可能为 NULL / 脏数据）合并为
 * **完整结构化配置**。
 *
 * 口径（fail-safe）：
 *  - raw 非 plain object（含 NULL / 数组 / 字符串）→ 全默认；
 *  - 逐键取值：合法 → 采用；缺失或非法 → 回落默认（不炸、不透传脏值）；
 *  - raw 中不在 STORE_CONFIG_KEYS 内的键一律忽略（白名单收敛）。
 *
 * 恒返回**新对象**，调用方可自由改写，不影响常量 DEFAULT_STORE_CONFIG。
 */
export function resolveStoreConfig(raw: unknown): StoreConfig {
  const resolved = cloneDefaultStoreConfig();
  if (!isPlainObject(raw)) {
    return resolved;
  }
  for (const key of STORE_CONFIG_KEYS) {
    const value = raw[key];
    if (isValidStoreConfigValue(key, value)) {
      // isValidStoreConfigValue 已按键收窄类型，这里安全赋值
      (resolved as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return resolved;
}
