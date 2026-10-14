/**
 * 预约状态机（Booking）
 *
 * 主链路：pending → confirmed → in_service → completed
 * 分支：cancelled / no_show / rescheduled
 * 改期生成新单并互链（prev_booking_id），旧单进入 rescheduled。
 */

import type { StatusMeta } from "./meta";

export const BookingStatus = {
  PENDING: "pending",
  CONFIRMED: "confirmed",
  IN_SERVICE: "in_service",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  NO_SHOW: "no_show",
  RESCHEDULED: "rescheduled",
} as const;

export type BookingStatus = (typeof BookingStatus)[keyof typeof BookingStatus];

export const BOOKING_STATUS_META: Readonly<Record<BookingStatus, StatusMeta>> = {
  [BookingStatus.PENDING]: { value: "pending", label: "待确认", color: "warning" },
  [BookingStatus.CONFIRMED]: { value: "confirmed", label: "已确认", color: "info" },
  [BookingStatus.IN_SERVICE]: { value: "in_service", label: "服务中", color: "info" },
  [BookingStatus.COMPLETED]: { value: "completed", label: "已完成", color: "success" },
  [BookingStatus.CANCELLED]: { value: "cancelled", label: "已取消", color: "neutral" },
  [BookingStatus.NO_SHOW]: { value: "no_show", label: "未到店", color: "danger" },
  [BookingStatus.RESCHEDULED]: { value: "rescheduled", label: "已改期", color: "neutral" },
};

/** 允许的状态流转（用于前端拦截非法操作、后端状态机守卫共用） */
export const BOOKING_STATUS_TRANSITIONS: Readonly<Record<BookingStatus, readonly BookingStatus[]>> =
  {
    [BookingStatus.PENDING]: [
      BookingStatus.CONFIRMED,
      BookingStatus.CANCELLED,
      BookingStatus.NO_SHOW,
    ],
    [BookingStatus.CONFIRMED]: [
      BookingStatus.IN_SERVICE,
      BookingStatus.CANCELLED,
      BookingStatus.NO_SHOW,
      BookingStatus.RESCHEDULED,
    ],
    [BookingStatus.IN_SERVICE]: [BookingStatus.COMPLETED],
    [BookingStatus.COMPLETED]: [],
    [BookingStatus.CANCELLED]: [],
    [BookingStatus.NO_SHOW]: [],
    [BookingStatus.RESCHEDULED]: [],
  };

/** 终态集合（不可再流转） */
export const BOOKING_TERMINAL_STATUSES: readonly BookingStatus[] = [
  BookingStatus.COMPLETED,
  BookingStatus.CANCELLED,
  BookingStatus.NO_SHOW,
  BookingStatus.RESCHEDULED,
];

export function canTransitionBooking(from: BookingStatus, to: BookingStatus): boolean {
  return BOOKING_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

// ─────────────────────────────────────────────────────────────
// 状态流转动作（MVP-WEB-06-05；PRD《Booking API》端点清单）
// ─────────────────────────────────────────────────────────────

/**
 * 状态流转动作（后端 `POST /bookings/:id/<action>` 的动作段）。
 *
 * ⚠️ 取值即**端点路径段**（`no-show` 用连字符，与 PRD 端点清单逐字一致）——
 * 前端动作按钮 / 错误码 details / 时间线 action 都复用本枚举，不私写字面量。
 */
export const BookingAction = {
  /** 确认预约（pending → confirmed；须容量二次校验通过） */
  CONFIRM: "confirm",
  /** 到店登记（confirmed → in_service；寄养须先完成入住登记） */
  CHECKIN: "checkin",
  /** 开始服务（confirmed → in_service；无需到店登记的直通路径） */
  START: "start",
  /** 完成服务（in_service → completed；须已生成关联订单） */
  COMPLETE: "complete",
  /** 改期（confirmed → rescheduled，同时生成新单承担新时段） */
  RESCHEDULE: "reschedule",
  /** 取消（pending / confirmed → cancelled；须服务未开始） */
  CANCEL: "cancel",
  /** 标记爽约（pending / confirmed → no_show） */
  NO_SHOW: "no-show",
} as const;

export type BookingAction = (typeof BookingAction)[keyof typeof BookingAction];

/** 全部动作值（DTO `@IsIn` / 遍历用） */
export const BOOKING_ACTION_VALUES: readonly string[] = Object.values(BookingAction);

/** 单个动作的元数据 */
export interface BookingActionMeta {
  /** 目标状态 */
  readonly target: BookingStatus;
  /** 允许的来源状态（状态机守卫的判据） */
  readonly from: readonly BookingStatus[];
  /** 人类可读动作名（错误文案 / 审计备注用） */
  readonly label: string;
}

/**
 * 动作 →（来源状态，目标状态）映射。
 *
 * 🔴 **`from` 不得与 {@link BOOKING_STATUS_TRANSITIONS} 冲突**：本表的 `from` 是
 * 状态机的**再表述**（为「一个动作一次流转」这个视角服务），真正的合法转移关系
 * 仍以 `BOOKING_STATUS_TRANSITIONS` 为唯一事实源；文件末尾有一致性守卫在模块加载期
 * 校验二者相符，任一侧改动而另一侧未跟上即**立刻抛错**（踩坑 126-bis：同一判据
 * 不留两个来源 —— 这里允许「表述重复」，但用守卫把「漂移」变成启动期错误）。
 *
 * `checkin` 与 `start` 都落到 `in_service`：平台状态枚举把业务叙事里的「已到店」
 * 并入 `in_service`（PRD《Booking API》状态流转表 `confirmed → checkin → in_service`），
 * 两个端点因此是同目标的**两条前置路径**（寄养走到店登记 / 洗护美容直接开始），
 * 由审计与时间线的 action 字段区分，不新增状态值。
 */
export const BOOKING_ACTION_META: Readonly<Record<BookingAction, BookingActionMeta>> = {
  [BookingAction.CONFIRM]: {
    target: BookingStatus.CONFIRMED,
    from: [BookingStatus.PENDING],
    label: "确认预约",
  },
  [BookingAction.CHECKIN]: {
    target: BookingStatus.IN_SERVICE,
    from: [BookingStatus.CONFIRMED],
    label: "到店登记",
  },
  [BookingAction.START]: {
    target: BookingStatus.IN_SERVICE,
    from: [BookingStatus.CONFIRMED],
    label: "开始服务",
  },
  [BookingAction.COMPLETE]: {
    target: BookingStatus.COMPLETED,
    from: [BookingStatus.IN_SERVICE],
    label: "完成服务",
  },
  [BookingAction.RESCHEDULE]: {
    target: BookingStatus.RESCHEDULED,
    from: [BookingStatus.CONFIRMED],
    label: "改期",
  },
  [BookingAction.CANCEL]: {
    target: BookingStatus.CANCELLED,
    from: [BookingStatus.PENDING, BookingStatus.CONFIRMED],
    label: "取消预约",
  },
  [BookingAction.NO_SHOW]: {
    target: BookingStatus.NO_SHOW,
    from: [BookingStatus.PENDING, BookingStatus.CONFIRMED],
    label: "标记爽约",
  },
};

/**
 * 判定「来源状态 → 动作」是否被允许（三端共用的状态机守卫判据）。
 *
 * 前端用它决定动作按钮是否渲染（PRD《页面功能》验收要点：「操作按钮随状态机渲染，
 * 非法状态下按钮不出现」）；后端用它拦截非法流转（错误码 30002）。
 */
export function isBookingActionAllowed(from: BookingStatus, action: BookingAction): boolean {
  const meta = BOOKING_ACTION_META[action];
  return !!meta && meta.from.includes(from);
}

/** 取动作的目标状态（未登记动作返回 undefined） */
export function getBookingActionTarget(action: BookingAction): BookingStatus | undefined {
  return BOOKING_ACTION_META[action]?.target;
}

/** 某状态下可执行的动作清单（前端动作区渲染用） */
export function listBookingActionsFrom(from: BookingStatus): readonly BookingAction[] {
  const actions = Object.keys(BOOKING_ACTION_META) as BookingAction[];
  return actions.filter((action) => isBookingActionAllowed(from, action));
}

// ── 单一事实源守卫（模块加载期执行；不一致即抛错，把漂移拦在启动期）──
for (const action of Object.keys(BOOKING_ACTION_META) as BookingAction[]) {
  const meta = BOOKING_ACTION_META[action];
  for (const from of meta.from) {
    if (!canTransitionBooking(from, meta.target)) {
      throw new Error(
        `[BookingAction] 动作 ${action} 声明的 ${from} → ${meta.target} 与 ` +
          `BOOKING_STATUS_TRANSITIONS 不符：状态机不允许该转移`
      );
    }
  }
}
