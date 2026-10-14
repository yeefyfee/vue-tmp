/**
 * 宠物域纯函数工具（MVP-WEB-05-01 / 05-02 / 05-03 / 05-04）
 *
 * 目标：把「值 → i18n key」「生日 → 年龄」「到期日 → 紧急度」「体重环比 → 预警」
 * 「事件流 → 按天分组」这类可测、无副作用的换算集中一处，供列表页与档案页复用
 * （避免两处各写一份口径而漂移）。
 *
 * 本文件**不 import i18n 与任何 Vue API**（对齐 `composables/useUnsavedGuard.ts`
 * 的既有约定：纯逻辑不持有语言上下文，由调用方 `t(key, params)` 渲染）。
 */

import type { HealthExpiryLevel, TimelineEventItem } from "@/api/pet/types";

import {
  BehaviorTagStatus,
  HealthRecordType,
  PetGender,
  PetType,
  TimelineActorType,
  TimelineEventType,
} from "@/enums";

/** 宠物类型 → i18n key（未知/空值回落 `pet.value.unset`） */
export function petTypeLabelKey(petType: number | null | undefined): string {
  if (petType === PetType.DOG) return "pet.value.petTypeDog";
  if (petType === PetType.CAT) return "pet.value.petTypeCat";
  if (petType === PetType.OTHER) return "pet.value.petTypeOther";
  return "pet.value.unset";
}

/** 宠物性别 → i18n key（`null` = 未登记） */
export function petGenderLabelKey(gender: number | null | undefined): string {
  if (gender === PetGender.MALE) return "pet.value.genderMale";
  if (gender === PetGender.FEMALE) return "pet.value.genderFemale";
  return "pet.value.unset";
}

/** 健康记录类型 → i18n key（值域外回落 `pet.value.unset`） */
export function healthRecordTypeLabelKey(recordType: number | null | undefined): string {
  switch (recordType) {
    case HealthRecordType.VACCINE:
      return "pet.healthRecordTypeValue.vaccine";
    case HealthRecordType.DEWORM:
      return "pet.healthRecordTypeValue.deworm";
    case HealthRecordType.ALLERGY:
      return "pet.healthRecordTypeValue.allergy";
    case HealthRecordType.MEDICATION:
      return "pet.healthRecordTypeValue.medication";
    case HealthRecordType.STERILIZATION:
      return "pet.healthRecordTypeValue.sterilization";
    case HealthRecordType.CHRONIC:
      return "pet.healthRecordTypeValue.chronic";
    default:
      return "pet.value.unset";
  }
}

/** 时间线事件类型 → i18n key（`pet.timeline.eventType.*`） */
export function timelineEventTypeLabelKey(eventType: number | null | undefined): string {
  switch (eventType) {
    case TimelineEventType.CHECK_IN:
      return "pet.timeline.eventType.checkIn";
    case TimelineEventType.CHECK_OUT:
      return "pet.timeline.eventType.checkOut";
    case TimelineEventType.FEEDING:
      return "pet.timeline.eventType.feeding";
    case TimelineEventType.GROOMING:
      return "pet.timeline.eventType.grooming";
    case TimelineEventType.MEDICAL:
      return "pet.timeline.eventType.medical";
    case TimelineEventType.WEIGHT:
      return "pet.timeline.eventType.weight";
    case TimelineEventType.PHOTO:
      return "pet.timeline.eventType.photo";
    default:
      return "pet.timeline.eventType.system";
  }
}

/** 时间线操作者类型 → i18n key（`pet.timeline.actorType.*`） */
export function timelineActorTypeLabelKey(actorType: number | null | undefined): string {
  if (actorType === TimelineActorType.SYSTEM) return "pet.timeline.actorType.system";
  if (actorType === TimelineActorType.OWNER) return "pet.timeline.actorType.owner";
  return "pet.timeline.actorType.staff";
}

/** 行为标签状态 → i18n key（复用宠物域通用启用/停用口径） */
export function behaviorTagStatusLabelKey(status: number | null | undefined): string {
  return status === BehaviorTagStatus.DISABLED
    ? "pet.value.statusDisabled"
    : "pet.value.statusEnabled";
}

/** 时间线事件类型 → el-tag 颜色（视觉分组：入驻/离店/照护/医疗/体重/照片/系统） */
export function timelineEventTagType(
  eventType: number | null | undefined
): "primary" | "success" | "warning" | "danger" | "info" {
  switch (eventType) {
    case TimelineEventType.CHECK_IN:
      return "success";
    case TimelineEventType.CHECK_OUT:
      return "info";
    case TimelineEventType.FEEDING:
    case TimelineEventType.GROOMING:
      return "primary";
    case TimelineEventType.MEDICAL:
      return "danger";
    case TimelineEventType.WEIGHT:
      return "warning";
    default:
      return "info";
  }
}

/** 宠物年龄（按自然月/年逐位借位，非按天数近似） */
export interface PetAge {
  years: number;
  months: number;
}

/**
 * 由生日（`yyyy-MM-dd`）计算年龄
 *
 * - 解析失败 / 生日为空 / 生日晚于当前时间 ⇒ 返回 `null`（调用方渲染「年龄未知」）；
 * - **不依赖时区**：只做年月日分量运算（与后端 DATE 列的「无时间语义」口径一致）。
 */
export function calcPetAge(
  birthday: string | null | undefined,
  now: Date = new Date()
): PetAge | null {
  if (!birthday) return null;
  const matched = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(birthday));
  if (!matched) return null;

  const [, year, month, day] = matched;
  const birthYear = Number(year);
  const birthMonth = Number(month);
  const birthDay = Number(day);
  if (!birthYear || !birthMonth || !birthDay) return null;

  let years = now.getFullYear() - birthYear;
  let months = now.getMonth() + 1 - birthMonth;
  if (now.getDate() < birthDay) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  if (years < 0) return null;
  return { years, months };
}

/**
 * 年龄 → i18n key + 插值参数
 *
 * 不满 1 岁只报月；满 1 岁整年不带月；其余「X 岁 Y 个月」。
 */
export function petAgeLabel(age: PetAge | null): {
  key: string;
  params: Record<string, number>;
} {
  if (!age) return { key: "pet.value.ageUnknown", params: {} };
  if (age.years <= 0) {
    return { key: "pet.value.ageMonthsOnly", params: { months: age.months } };
  }
  if (age.months === 0) {
    return { key: "pet.value.ageYears", params: { years: age.years } };
  }
  return {
    key: "pet.value.ageYearsMonths",
    params: { years: age.years, months: age.months },
  };
}

/**
 * 疫苗/驱虫到期预警阈值（天）
 *
 * PRD《页面功能》宠物档案页：「疫苗到期低于 14 天在宠物档案头部出现红色预警」。
 */
export const HEALTH_EXPIRE_WARNING_DAYS = 14;

/** 有效期内但将在阈值内到期（`0 <= daysLeft <= threshold`；已过期 daysLeft < 0 另判） */
export function isExpiringSoon(
  daysLeft: number | null | undefined,
  threshold: number = HEALTH_EXPIRE_WARNING_DAYS
): boolean {
  return typeof daysLeft === "number" && daysLeft >= 0 && daysLeft <= threshold;
}

// ── 到期提醒（MVP-WEB-05-02）─────────────────────────────────────────────

/**
 * 由「到期日（`yyyy-MM-dd`）」算剩余天数（**与后端同口径**）
 *
 * 后端口径：`daysLeft = floor((@db.Date 的 UTC 午夜瞬时 − 今日 UTC 午夜) / 86400000)`，
 * 其中「今日」取 `toDayString(new Date())`（应用时区 Asia/Shanghai）。前端按
 * **本地日历日**取「今天」再与到期日的日历日求差 —— 与后端在 Asia/Shanghai 下
 * 完全一致（故不引入 UTC 漂移）；到期日为空 / 格式非法 ⇒ `null`。
 *
 * 用于健康记录表内的「到期倒计时」列（服务端只在 `validity` 与到期提醒端点
 * 下发 `daysLeft`，全量记录列表不携带该派生列）。
 */
export function daysLeftFromExpire(
  expireDate: string | null | undefined,
  now: Date = new Date()
): number | null {
  if (!expireDate) return null;
  const matched = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(expireDate));
  if (!matched) return null;
  const target = Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]));
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / (24 * 60 * 60 * 1000));
}

/**
 * 到期紧急度分级（**与后端 `HealthRecordService.resolveExpiryLevel` 同口径**）
 *
 * `expired`（<0 已过期）/ `urgent`（0~14 红色预警）/ `soon`（>14 窗口内）。
 * 服务端也会下发 `level`；本函数用于前端本地推导（如健康记录表倒计时列），
 * 两处判据必须一致 —— 变异测试即以「改这里让分级漂移」为注入点。
 */
export function healthExpiryLevel(
  daysLeft: number | null | undefined,
  urgentDays: number = HEALTH_EXPIRE_WARNING_DAYS
): HealthExpiryLevel {
  if (typeof daysLeft !== "number") return "soon";
  if (daysLeft < 0) return "expired";
  if (daysLeft <= urgentDays) return "urgent";
  return "soon";
}

/** 紧急度 → i18n key（`pet.healthExpiry.level.*`） */
export function healthExpiryLevelLabelKey(level: HealthExpiryLevel): string {
  return `pet.healthExpiry.level.${level}`;
}

/** 紧急度 → el-tag 类型（已过期=danger / 14 天内=warning / 窗口内=info） */
export function healthExpiryLevelTagType(level: HealthExpiryLevel): "danger" | "warning" | "info" {
  if (level === "expired") return "danger";
  if (level === "urgent") return "warning";
  return "info";
}

/**
 * 剩余天数 → i18n key + 插值参数
 *
 *  - `daysLeft < 0` ⇒「已过期 N 天」(`pet.healthExpiry.expiredDays`)
 *  - `0` ⇒「今日到期」(`pet.healthExpiry.dueToday`)
 *  - `> 0` ⇒「剩余 N 天」(`pet.healthExpiry.daysLeft`)
 *  - `null`（无到期日）⇒「未设到期」(`pet.healthExpiry.noExpire`)
 */
export function healthDaysLeftLabel(daysLeft: number | null | undefined): {
  key: string;
  params: Record<string, number>;
} {
  if (typeof daysLeft !== "number") {
    return { key: "pet.healthExpiry.noExpire", params: {} };
  }
  if (daysLeft < 0) {
    return { key: "pet.healthExpiry.expiredDays", params: { days: Math.abs(daysLeft) } };
  }
  if (daysLeft === 0) {
    return { key: "pet.healthExpiry.dueToday", params: {} };
  }
  return { key: "pet.healthExpiry.daysLeft", params: { days: daysLeft } };
}

// ── 体重曲线（MVP-WEB-05-03）──────────────────────────────────────────────

/**
 * 体重环比预警阈值（%）—— 与后端 `WEIGHT_DELTA_ALERT_PERCENT` 同口径
 *
 * PRD《宠物管理》BR-4：「单次称重与上次记录差超过 15% 时，在下次服务前提示前台
 * 确认健康状态」。
 *
 * 🔴 权威判据是**服务端下发的 `deltaAlert`**（它由库里真值算出，是唯一裁决）；本常量
 * 仅供**本地回退**使用 —— 即 wire 上缺 `deltaAlert` 时才由 `deltaPercent` 自行推导。
 * 两处判据必须一致（变异测试即以「改这里让阈值漂移」为注入点）。
 */
export const WEIGHT_DELTA_ALERT_PERCENT = 15;

/**
 * 日期展示归一：`2026-06-12 08:00:00` / `2026-06-12T00:00:00.000Z` → `2026-06-12`
 *
 * 服务端 `@db.Date` 列表列以**应用时区**（Asia/Shanghai）序列化为
 * `yyyy-MM-dd HH:mm:ss`，故不能直接当 `yyyy-MM-dd` 用（截取前 10 位即可）。
 */
export function toDayString(value: string | null | undefined): string {
  if (!value) return "";
  const matched = /^(\d{4}-\d{2}-\d{2})/.exec(String(value));
  return matched ? matched[1] : "";
}

/**
 * 体重展示：统一两位小数（与 `pet.weight_kg` `decimal(5,2)` 口径一致）
 *
 * 体重行的 `weightKg` 由 Decimal 序列化而来，尾零会被省略（`"12.5"` / `"10"`），
 * 直接展示会与头部快照（`"12.50"`）不一致 ⇒ 一律 `toFixed(2)`。
 */
export function formatWeightKg(weightKg: string | number | null | undefined): string {
  if (weightKg === null || weightKg === undefined || weightKg === "") return "";
  const num = Number(weightKg);
  if (!Number.isFinite(num)) return String(weightKg);
  return num.toFixed(2);
}

/**
 * 环比值归一（**必须走这一步**）
 *
 * 🔴 后端全局响应拦截器（`common/utils/serialize.util.ts` → `transformDatesInObject`）
 * 把「非安全整数」的 number 一律序列化为**字符串**（`Number.isSafeInteger(x)` 为假即
 * `x.toString()`，本意是 BigInt 安全，但顺带把小数也转成了串）⇒ 同一个 `deltaPercent`
 * 在 wire 上可能是 `8`（number），也可能是 `"20.4"`（string）。
 *
 * 若不归一会直接踩坑：`typeof deltaPercent !== "number"` 会把**有效环比**误判为
 * 「首次记录」（种子数据里 4/5 个点都带小数 ⇒ 整列退化成「首次记录」）。
 *
 * @returns 归一后的 `number`；`null` / `""` / 非数值 ⇒ `null`（真·无环比）
 */
export function toDeltaPercent(deltaPercent: number | string | null | undefined): number | null {
  if (deltaPercent === null || deltaPercent === undefined || deltaPercent === "") return null;
  const num = Number(deltaPercent);
  return Number.isFinite(num) ? num : null;
}

/** 环比是否触发 BR-4 预警（`|环比| > 15%`；无环比不预警，与后端同口径） */
export function isWeightDeltaAlert(deltaPercent: number | string | null | undefined): boolean {
  const num = toDeltaPercent(deltaPercent);
  return num !== null && Math.abs(num) > WEIGHT_DELTA_ALERT_PERCENT;
}

/**
 * 环比 → i18n key + 插值参数（带符号语义，`Math.abs` 交由文案模板决定正负号）
 *
 *  - `null`（真·无上一条）⇒「首次记录」(`pet.weight.deltaFirst`)
 *  - `> 0` ⇒「较上次 +N%」(`pet.weight.deltaUp`)
 *  - `< 0` ⇒「较上次 -N%」(`pet.weight.deltaDown`)
 *  - `0` ⇒「与上次持平」(`pet.weight.deltaFlat`)
 */
export function weightDeltaLabel(deltaPercent: number | string | null | undefined): {
  key: string;
  params: Record<string, number>;
} {
  const num = toDeltaPercent(deltaPercent);
  if (num === null) {
    return { key: "pet.weight.deltaFirst", params: {} };
  }
  if (num > 0) {
    return { key: "pet.weight.deltaUp", params: { percent: num } };
  }
  if (num < 0) {
    return { key: "pet.weight.deltaDown", params: { percent: Math.abs(num) } };
  }
  return { key: "pet.weight.deltaFlat", params: {} };
}

/**
 * 环比 → el-tag 类型（预警 = danger，其余 = info）
 *
 * 🔴 **优先采信服务端 `deltaAlert`**：同一组件内图表打点标红已用 `point.deltaAlert`，
 * 明细表若改用本地阈值重算，两处就成了双源判据 —— 任一侧阈值单边漂移会出现
 * 「图上红点、表里灰签」。故入参传 `deltaAlert ?? deltaPercent`：boolean 直接采信，
 * number/string（wire 缺字段）才回退本地重算。
 */
export function weightDeltaTagType(
  value: boolean | number | string | null | undefined
): "danger" | "info" {
  const alert = typeof value === "boolean" ? value : isWeightDeltaAlert(value);
  return alert ? "danger" : "info";
}

// ── 时间线（MVP-WEB-05-04）───────────────────────────────────────────────

/**
 * 冲正事件名（与 `@peluvida/shared` 的 `TIMELINE_REVISION_EVENT_NAME` 同值）
 *
 * 直接写字面量而非 import，是为了让本文件保持「零运行时依赖」的纯函数性质
 * （shared 是 workspace 包，import 会引入打包器解析面）。值由 05-04 单测锚定。
 */
export const TIMELINE_REVISION_EVENT_NAME = "timeline.event.revised";

/** 该事件是否为「冲正事件」（TR-4：纠错以**新事件**冲正并引用原事件） */
export function isTimelineRevisionEvent(
  event: Pick<TimelineEventItem, "eventName"> | null | undefined
): boolean {
  return event?.eventName === TIMELINE_REVISION_EVENT_NAME;
}

/** 按天分组的一组事件（TR-6：按天分组，同一天事件聚合为一张状态卡） */
export interface TimelineDayGroup {
  /** 日历日 `yyyy-MM-dd`（服务端 Asia/Shanghai 墙钟日，与 `toDayString` 同口径） */
  dateKey: string;
  /** 该日事件（保持入参顺序，默认 `eventTime desc`） */
  events: TimelineEventItem[];
  /** 该日事件类型分布（按类型**首现**顺序，携带计数）—— 供状态卡头部摘要 chips */
  typeCounts: Array<{ eventType: number; count: number }>;
}

/**
 * 时间线按天分组（PRD《宠物管理》TR-6）
 *
 * 「展示按天分组，同一天连续照护事件聚合为一张状态卡，避免碎片化」。
 *
 * 分组键取 `eventTime` 的**前 10 位**（走 {@link toDayString}）—— 服务端把 DateTime
 * 序列化为 **Asia/Shanghai 墙钟串**（`yyyy-MM-dd HH:mm:ss`，见
 * `common/utils/serialize.util.ts`），故按字符截取与列表展示
 * （`formatTableDateTime` 同口径按字符串分量渲染）天然一致；**刻意不做 `new Date`
 * 解析**，避免浏览器本地时区与墙钟口径差异把日界算错。
 *
 * 组顺序 = 日期键**首现**顺序（即入参 `eventTime desc` ⇒ 日期新→旧）；无法识别日期
 * 的脏数据（`dateKey === ""`）恒排末尾，**不丢事件**。
 */
export function groupTimelineByDay(events: TimelineEventItem[]): TimelineDayGroup[] {
  const groups: TimelineDayGroup[] = [];
  const byKey = new Map<string, TimelineDayGroup>();

  for (const event of events) {
    const dateKey = toDayString(event.eventTime);
    let group = byKey.get(dateKey);
    if (!group) {
      group = { dateKey, events: [], typeCounts: [] };
      byKey.set(dateKey, group);
      groups.push(group);
    }
    group.events.push(event);

    const counted = group.typeCounts.find((item) => item.eventType === event.eventType);
    if (counted) {
      counted.count += 1;
    } else {
      group.typeCounts.push({ eventType: event.eventType, count: 1 });
    }
  }

  return groups.sort((a, b) => {
    if (a.dateKey === b.dateKey) return 0;
    if (a.dateKey === "") return 1;
    if (b.dateKey === "") return -1;
    return 0;
  });
}

/** 相对日标签（由调用方注入语言，本文件不持 i18n 上下文） */
export interface TimelineDayLabels {
  today: string;
  yesterday: string;
  beforeYesterday: string;
}

/**
 * 日历日 → 展示文案（今天 / 昨天 / 前天 / `yyyy-MM-dd`）
 *
 * 与 `utils/format.ts` 的 `formatTableDateTime` 同口径：只做**年月日分量**运算，
 * 不依赖时区（`dateKey` 已是墙钟日）。
 */
export function timelineDayLabel(
  dateKey: string,
  labels: TimelineDayLabels,
  now: Date = new Date()
): string {
  const matched = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateKey ?? ""));
  if (!matched) return String(dateKey ?? "");
  const [, year, month, day] = matched;
  const absolute = `${year}-${month}-${day}`;
  const target = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(target.getTime())) return absolute;

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((startOfToday.getTime() - target.getTime()) / 86400000);
  if (diffDays === 0) return labels.today;
  if (diffDays === 1) return labels.yesterday;
  if (diffDays === 2) return labels.beforeYesterday;
  return absolute;
}
