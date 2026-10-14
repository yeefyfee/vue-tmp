/**
 * 宠物健康域常量（P0-06-03 FR-2 / P0-06-04 FR-3）
 *
 * ⚠️ 本地常量说明（口径出处待上收）：
 * `health_record.record_type` 与 `timeline_event.event_type` 的合法值域本应作为
 * 「三端与后端共享的唯一来源」登记在 `@peluvida/shared`（对齐 PetType / CustomerSource
 * 的既有惯例），但本轮任务显式**禁改 packages/shared/**（并行任务在改），故先在
 * 宠物域内定义本地常量；待 shared 解锁后按同样的命名/取值上收，本文件随之删除
 * （取值已与 DB 列注释 1疫苗/2驱虫/3过敏/4用药/5绝育/6慢病、event_type 6=体重 对齐）。
 */

/** 健康记录类型（health_record.record_type，SmallInt） */
export const HealthRecordType = {
  /** 疫苗 */
  VACCINE: 1,
  /** 驱虫 */
  DEWORM: 2,
  /** 过敏 */
  ALLERGY: 3,
  /** 用药 */
  MEDICATION: 4,
  /** 绝育 */
  STERILIZATION: 5,
  /** 慢病 */
  CHRONIC: 6,
} as const;

export type HealthRecordType = (typeof HealthRecordType)[keyof typeof HealthRecordType];

/** 记录类型合法值域（DTO @IsIn / 校验遍历用） */
export const HEALTH_RECORD_TYPE_VALUES = Object.values(HealthRecordType) as readonly number[];

/** 记录类型中文名映射（提醒文案 / validity 判定展示用） */
export const HEALTH_RECORD_TYPE_NAMES: Readonly<Record<number, string>> = {
  [HealthRecordType.VACCINE]: "疫苗",
  [HealthRecordType.DEWORM]: "驱虫",
  [HealthRecordType.ALLERGY]: "过敏",
  [HealthRecordType.MEDICATION]: "用药",
  [HealthRecordType.STERILIZATION]: "绝育",
  [HealthRecordType.CHRONIC]: "慢病",
};

/**
 * 需跟踪到期日的记录类型（疫苗 / 驱虫）——到期提醒扫描只针对这两类。
 * 其余类型（过敏/用药/绝育/慢病）无复种到期语义，不参与提醒。
 */
export const EXPIRE_TRACKED_RECORD_TYPES: readonly number[] = [
  HealthRecordType.VACCINE,
  HealthRecordType.DEWORM,
];

/**
 * 疫苗/驱虫有效性判定涉及的记录类型——供后续寄养入住校验消费
 * （GET /pets/:id/health/validity）。
 */
export const VALIDITY_TRACKED_RECORD_TYPES: readonly number[] = [
  HealthRecordType.VACCINE,
  HealthRecordType.DEWORM,
];

/** 到期提醒扫描窗口：到期日落在「今天 ~ 未来 N 天（含）」的记录纳入提醒 */
export const HEALTH_REMINDER_WINDOW_DAYS = 30;

/**
 * 🔴 红色预警阈值（天）——PRD《Web端 · 页面功能》「宠物档案页 → 健康」页签：
 * 「疫苗记录（含下次到期日倒计时）、驱虫、过敏源、长期用药；**到期低于 14 天
 * 自动红色预警**」；对应《Web端 · 验收要点》「疫苗到期低于 14 天在宠物档案头部
 * 出现红色预警」。前端 `HEALTH_EXPIRE_WARNING_DAYS` 与后端此常量同口径，
 * 属「三端共享」候选（待 shared 解锁后上收）。
 */
export const HEALTH_EXPIRY_URGENT_DAYS = 14;

/**
 * 到期紧急度分级（**派生值**，不落库）：
 *  - `expired`：`daysLeft < 0`（已过期 ⇒ 消费侧 BR-1「寄养/日托入住前校验疫苗
 *    在有效期内，过期阻断入住」的输入）；
 *  - `urgent`：`0 ≤ daysLeft ≤ HEALTH_EXPIRY_URGENT_DAYS`（红色预警）；
 *  - `soon`：`HEALTH_EXPIRY_URGENT_DAYS < daysLeft ≤ windowDays`（窗口内提醒）。
 */
export const HEALTH_EXPIRY_LEVELS = ["expired", "urgent", "soon"] as const;

export type HealthExpiryLevel = (typeof HEALTH_EXPIRY_LEVELS)[number];

/**
 * 跨宠物到期提醒的**扫描保护上限**：一次最多取这么多条候选记录（按到期日升序 ⇒
 * 最紧急的先保留）。到期记录是「待处理清单」而非历史流水，正常量级远小于此值；
 * 触顶时返回结果仍自洽（`summary` 只统计取到的行），避免无界结果集。
 */
export const HEALTH_EXPIRY_MAX_SCAN = 500;

/**
 * 幂等键保留窗口：到期日后保留 M 天（覆盖「到期前提醒 → 到期后」的重复扫描，
 * 避免同一条到期记录被反复入队推送）。
 */
export const HEALTH_REMINDER_RETENTION_DAYS = 30;

/** 幂等键最小 TTL（秒）：防止到期日已过导致 TTL 归零/为负 */
export const HEALTH_REMINDER_MIN_TTL_SECONDS = 3600;

/** 时间线事件类型：6 = 体重（timeline_event.event_type） */
export const TIMELINE_EVENT_TYPE_WEIGHT = 6;

/** 体重曲线默认返回条数 */
export const WEIGHT_CURVE_DEFAULT_LIMIT = 100;

/** 体重曲线最大返回条数（防大结果集拖垮响应） */
export const WEIGHT_CURVE_MAX_LIMIT = 500;

/**
 * 🔴 体重环比预警阈值（%）——PRD《宠物管理》业务规则 BR-4：
 * 「单次称重与上次记录差超过 15% 时，在下次服务前提示前台确认健康状态」。
 *
 * 口径：环比 = (本次 - 上次) / 上次 * 100（**带正负号**，四舍五入保留 1 位小数）；
 * `|环比| > 阈值` 即触发预警（严格大于，`恰好 15%` 不触发）。
 * 「上次」= 按称重日升序紧邻的前一条（补录历史时以时间序为准，而非插入序）。
 */
export const WEIGHT_DELTA_ALERT_PERCENT = 15;

/** `yyyy-MM-dd` 日期串正则（与 DTO @Matches 同源，避免口径漂移） */
export const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 体重数值串正则（0~999.99，最多两位小数；与 CreatePetDto.weightKg 同口径） */
export const WEIGHT_KG_PATTERN = /^\d{1,3}(\.\d{1,2})?$/;
