/**
 * 照护任务状态机（CareTask）
 *
 * 主链路：todo → doing → done
 * 分支：skipped / overdue
 * 规则：超时 30min 自动 overdue 并推送店长；用药任务强制拍照；
 *      打卡与异常实时写入 Pet Timeline。
 */

import type { StatusMeta } from "./meta";

export const CareTaskStatus = {
  TODO: "todo",
  DOING: "doing",
  DONE: "done",
  SKIPPED: "skipped",
  OVERDUE: "overdue",
} as const;

export type CareTaskStatus = (typeof CareTaskStatus)[keyof typeof CareTaskStatus];

export const CARE_TASK_STATUS_META: Readonly<Record<CareTaskStatus, StatusMeta>> = {
  [CareTaskStatus.TODO]: { value: "todo", label: "待执行", color: "neutral" },
  [CareTaskStatus.DOING]: { value: "doing", label: "执行中", color: "info" },
  [CareTaskStatus.DONE]: { value: "done", label: "已完成", color: "success" },
  [CareTaskStatus.SKIPPED]: { value: "skipped", label: "已跳过", color: "neutral" },
  [CareTaskStatus.OVERDUE]: { value: "overdue", label: "已超时", color: "danger" },
};

export const CARE_TASK_STATUS_TRANSITIONS: Readonly<
  Record<CareTaskStatus, readonly CareTaskStatus[]>
> = {
  [CareTaskStatus.TODO]: [CareTaskStatus.DOING, CareTaskStatus.SKIPPED, CareTaskStatus.OVERDUE],
  [CareTaskStatus.DOING]: [CareTaskStatus.DONE, CareTaskStatus.SKIPPED],
  [CareTaskStatus.OVERDUE]: [CareTaskStatus.DOING, CareTaskStatus.DONE, CareTaskStatus.SKIPPED],
  [CareTaskStatus.DONE]: [],
  [CareTaskStatus.SKIPPED]: [],
};

/** 超时自动转 overdue 的宽限分钟数 */
export const CARE_TASK_OVERDUE_GRACE_MINUTES = 30;

export function canTransitionCareTask(from: CareTaskStatus, to: CareTaskStatus): boolean {
  return CARE_TASK_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/** 照护任务类型 */
export const CareTaskType = {
  BREAKFAST: "breakfast",
  WALK: "walk",
  WATER: "water",
  LUNCH: "lunch",
  CLEANING: "cleaning",
  DINNER: "dinner",
  NIGHT_PATROL: "night_patrol",
  MEDICATION: "medication",
} as const;

export type CareTaskType = (typeof CareTaskType)[keyof typeof CareTaskType];

export const CARE_TASK_TYPE_META: Readonly<Record<CareTaskType, StatusMeta>> = {
  [CareTaskType.BREAKFAST]: { value: "breakfast", label: "早餐", color: "neutral" },
  [CareTaskType.WALK]: { value: "walk", label: "遛宠", color: "neutral" },
  [CareTaskType.WATER]: { value: "water", label: "喂水", color: "neutral" },
  [CareTaskType.LUNCH]: { value: "lunch", label: "午餐", color: "neutral" },
  [CareTaskType.CLEANING]: { value: "cleaning", label: "清洁", color: "neutral" },
  [CareTaskType.DINNER]: { value: "dinner", label: "晚餐", color: "neutral" },
  [CareTaskType.NIGHT_PATROL]: { value: "night_patrol", label: "晚间巡检", color: "neutral" },
  [CareTaskType.MEDICATION]: { value: "medication", label: "用药", color: "warning" },
};

/**
 * 每日照护任务默认模板（种子数据）
 *
 * 原文给定的 7 类固定时点。⚠️ 自 MVP-WEB-09-06（照护任务模板管理）落地后，
 * 运行时以「门店可配置的模板」为准，本常量仅作为新建门店的默认种子。
 */
export const DEFAULT_DAILY_CARE_TEMPLATE: readonly {
  readonly type: CareTaskType;
  readonly time: string;
  readonly label: string;
}[] = [
  { type: CareTaskType.BREAKFAST, time: "07:30", label: "早餐" },
  { type: CareTaskType.WALK, time: "09:00", label: "遛宠" },
  { type: CareTaskType.WATER, time: "10:00", label: "喂水" },
  { type: CareTaskType.LUNCH, time: "12:00", label: "午餐" },
  { type: CareTaskType.CLEANING, time: "15:00", label: "清洁" },
  { type: CareTaskType.DINNER, time: "18:00", label: "晚餐" },
  { type: CareTaskType.NIGHT_PATROL, time: "21:30", label: "晚间巡检" },
];

/** 强制要求拍照留证的任务类型 */
export const CARE_TASK_PHOTO_REQUIRED_TYPES: readonly CareTaskType[] = [CareTaskType.MEDICATION];
