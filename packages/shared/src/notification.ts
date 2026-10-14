/**
 * 预约事件 → 通知派发触发规则（MVP-WEB-06-06）
 *
 * 本文件定义「预约状态流转动作」到「通知场景码」的映射规则：
 * - 每个 booking action 对应一个通知场景（scenario）
 * - 场景码是消息模板（TASK-145）的查找键
 * - 优先级决定推送策略（P0 即时 / P1 常规 / P2 静默）
 * - 目标受众决定 SSE 推送范围（staff 员工 / customer 宠主 / both 双向）
 *
 * 约束：本包只放「纯常量 + 纯函数」，不引入任何运行时依赖与 IO。
 *
 * 与时间线的关系：
 * - timeline.ts 定义「事件名」（booking.confirmed 等）→ 宠物时间线落事件
 * - 本文件定义「触发规则」（CONFIRM → booking.confirmed 场景）→ 通知派发
 * - 二者通过 BookingAction 关联：action → timeline event name + notification scenario
 */

import { BookingAction } from "./status/booking";

// ─────────────────────────────────────────────────────────────
// 通知优先级
// ─────────────────────────────────────────────────────────────

/** 通知优先级（决定推送策略与 UI 呈现） */
export const NotificationPriority = {
  /** 即时（强提醒：弹窗 + 声音 + 徽章） */
  P0: 0,
  /** 常规（弱提醒：徽章 + 列表） */
  P1: 1,
  /** 静默（仅入列表，不主动提醒） */
  P2: 2,
} as const;

export type NotificationPriority = (typeof NotificationPriority)[keyof typeof NotificationPriority];

/** 优先级合法值域 */
export const NOTIFICATION_PRIORITY_VALUES: readonly number[] = Object.values(NotificationPriority);

/** 优先级中文名 */
export const NOTIFICATION_PRIORITY_NAMES: Readonly<Record<NotificationPriority, string>> = {
  [NotificationPriority.P0]: "即时",
  [NotificationPriority.P1]: "常规",
  [NotificationPriority.P2]: "静默",
};

// ─────────────────────────────────────────────────────────────
// 通知目标受众
// ─────────────────────────────────────────────────────────────

/** 通知目标受众（决定 SSE 推送范围） */
export const NotificationAudience = {
  /** 仅员工（工作台 / 消息中心） */
  STAFF: "staff",
  /** 仅宠主（小程序 / 服务号） */
  CUSTOMER: "customer",
  /** 双向（员工 + 宠主） */
  BOTH: "both",
} as const;

export type NotificationAudience = (typeof NotificationAudience)[keyof typeof NotificationAudience];

/** 受众合法值域 */
export const NOTIFICATION_AUDIENCE_VALUES: readonly string[] = Object.values(NotificationAudience);

// ─────────────────────────────────────────────────────────────
// 通知场景码（消息模板查找键；TASK-145 消费）
// ─────────────────────────────────────────────────────────────

/**
 * 预约通知场景码（16 个场景码的子集；本模块承载 booking 域 7 个）
 *
 * 命名规则：`booking.<action>` 对齐 timeline event name，
 * 便于「时间线事件 → 通知场景」的 1:1 映射。
 */
export const BookingNotificationScenario = {
  /** 预约确认 */
  BOOKING_CONFIRMED: "booking.confirmed",
  /** 预约到店登记 */
  BOOKING_CHECKED_IN: "booking.checked_in",
  /** 预约开始服务 */
  BOOKING_STARTED: "booking.started",
  /** 预约完成服务 */
  BOOKING_COMPLETED: "booking.completed",
  /** 预约改期 */
  BOOKING_RESCHEDULED: "booking.rescheduled",
  /** 预约取消 */
  BOOKING_CANCELLED: "booking.cancelled",
  /** 预约爽约 */
  BOOKING_NO_SHOW: "booking.no_show",
} as const;

export type BookingNotificationScenario =
  (typeof BookingNotificationScenario)[keyof typeof BookingNotificationScenario];

/** 全部预约通知场景值 */
export const BOOKING_NOTIFICATION_SCENARIO_VALUES: readonly string[] = Object.values(
  BookingNotificationScenario
);

// ─────────────────────────────────────────────────────────────
// 触发规则（BookingAction → 通知配置）
// ─────────────────────────────────────────────────────────────

/** 单个通知触发规则的元数据 */
export interface BookingNotificationTriggerMeta {
  /** 通知场景码（消息模板查找键） */
  readonly scenario: BookingNotificationScenario;
  /** 通知优先级 */
  readonly priority: NotificationPriority;
  /** 目标受众 */
  readonly audience: NotificationAudience;
  /** 是否写入宠主通知（customer 受众时须 true） */
  readonly notifyCustomer: boolean;
}

/**
 * 预约动作 → 通知触发规则映射
 *
 * PRD《Booking API》验收要点：「预约关键动作全部写入宠物时间线并触发宠主通知」
 * - 状态流转动作 → 时间线事件（timeline.ts 已登记）
 * - 状态流转动作 → 通知派发（本表定义规则）
 *
 * 优先级裁决：
 * - P0（即时）：取消 / 爽约 — 影响员工排班与宠主行程，须即时知晓
 * - P1（常规）：确认 / 改期 — 重要但不紧急
 * - P2（静默）：到店 / 开始 / 完成 — 过程性事件，入列表即可
 */
export const BOOKING_NOTIFICATION_TRIGGERS: Readonly<
  Record<BookingAction, BookingNotificationTriggerMeta>
> = {
  [BookingAction.CONFIRM]: {
    scenario: BookingNotificationScenario.BOOKING_CONFIRMED,
    priority: NotificationPriority.P1,
    audience: NotificationAudience.BOTH,
    notifyCustomer: true,
  },
  [BookingAction.CHECKIN]: {
    scenario: BookingNotificationScenario.BOOKING_CHECKED_IN,
    priority: NotificationPriority.P2,
    audience: NotificationAudience.STAFF,
    notifyCustomer: false,
  },
  [BookingAction.START]: {
    scenario: BookingNotificationScenario.BOOKING_STARTED,
    priority: NotificationPriority.P2,
    audience: NotificationAudience.STAFF,
    notifyCustomer: false,
  },
  [BookingAction.COMPLETE]: {
    scenario: BookingNotificationScenario.BOOKING_COMPLETED,
    priority: NotificationPriority.P2,
    audience: NotificationAudience.BOTH,
    notifyCustomer: true,
  },
  [BookingAction.RESCHEDULE]: {
    scenario: BookingNotificationScenario.BOOKING_RESCHEDULED,
    priority: NotificationPriority.P1,
    audience: NotificationAudience.BOTH,
    notifyCustomer: true,
  },
  [BookingAction.CANCEL]: {
    scenario: BookingNotificationScenario.BOOKING_CANCELLED,
    priority: NotificationPriority.P0,
    audience: NotificationAudience.BOTH,
    notifyCustomer: true,
  },
  [BookingAction.NO_SHOW]: {
    scenario: BookingNotificationScenario.BOOKING_NO_SHOW,
    priority: NotificationPriority.P0,
    audience: NotificationAudience.BOTH,
    notifyCustomer: true,
  },
};

// ─────────────────────────────────────────────────────────────
// 纯函数（消费侧用）
// ─────────────────────────────────────────────────────────────

/**
 * 获取预约动作的通知触发规则
 *
 * @param action 预约动作（confirm/checkin/start/complete/reschedule/cancel/no-show）
 * @returns 通知触发规则元数据；未知动作返回 null
 */
export function getBookingNotificationTrigger(
  action: string
): BookingNotificationTriggerMeta | null {
  return BOOKING_NOTIFICATION_TRIGGERS[action as BookingAction] ?? null;
}

/**
 * 判断预约动作是否应通知宠主
 *
 * @param action 预约动作
 * @returns true 表示应通知宠主
 */
export function shouldNotifyBookingCustomer(action: string): boolean {
  return getBookingNotificationTrigger(action)?.notifyCustomer ?? false;
}

/**
 * 获取预约动作的通知优先级
 *
 * @param action 预约动作
 * @returns 优先级；未知动作返回 P2（静默）
 */
export function getBookingNotificationPriority(action: string): NotificationPriority {
  return getBookingNotificationTrigger(action)?.priority ?? NotificationPriority.P2;
}

// ─────────────────────────────────────────────────────────────
// SSE 通知 topic（前端订阅用）
// ─────────────────────────────────────────────────────────────

/**
 * 预约通知 SSE topic（前端 useSse.on 订阅的事件名）
 *
 * 与 SSE_TOPICS 的 DASHBOARD 不同：
 * - DASHBOARD 是「数据变了，请刷新」的信号，不含业务数据
 * - BOOKING_NOTIFICATION 是「有通知要告诉你」，含通知内容
 */
export const SSE_TOPIC_BOOKING_NOTIFICATION = "booking-notification";

/**
 * 预约通知 SSE 载荷（前端消费的结构）
 *
 * 🔴 **不含敏感业务数据**：仅含通知渲染所需的最小信息（场景码 + 预约号 + 宠物名），
 * 详情由前端持令牌回拉（与 DASHBOARD 同原则：报文泄露不泄露业务读数）。
 */
export interface BookingNotificationPayload {
  /** 通知场景码（前端据此选渲染模板 / 图标） */
  scenario: BookingNotificationScenario;
  /** 预约单号（展示 + 跳转锚点） */
  bookingNo: string;
  /** 宠物名（展示用） */
  petName: string;
  /** 通知优先级（前端决定提醒方式） */
  priority: NotificationPriority;
  /** 时间戳（ms） */
  timestamp: number;
}
