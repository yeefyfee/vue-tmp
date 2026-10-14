/**
 * 宠物时间线 · 统一事件模型（P0-06-06）
 *
 * 口径：timeline_event.event_type / actor_type 为 SmallInt 数字枚举，event_name
 * 为 `模块.动作` 字符串事件名 —— 本文件是**三端与后端共享的唯一合法值域来源**
 * （对齐 PetType / CustomerSource / TimelineEventType 的既有惯例）。DB 列不设
 * CHECK，合法性由本常量 + DTO / service 校验约束。
 *
 * 约束：本包只放「纯常量 + 纯函数」，不引入任何运行时依赖与 IO。
 */

// ─────────────────────────────────────────────────────────────
// 事件类型（timeline_event.event_type；1~8 与 DB 列注释一致，禁改取值）
// ─────────────────────────────────────────────────────────────

/** 时间线事件类型（timeline_event.event_type；SmallInt） */
export const TimelineEventType = {
  /** 入驻 */
  CHECK_IN: 1,
  /** 离店 */
  CHECK_OUT: 2,
  /** 喂养 */
  FEEDING: 3,
  /** 洗护 */
  GROOMING: 4,
  /** 医疗 */
  MEDICAL: 5,
  /** 体重 */
  WEIGHT: 6,
  /** 照片 */
  PHOTO: 7,
  /** 系统 */
  SYSTEM: 8,
} as const;

export type TimelineEventType = (typeof TimelineEventType)[keyof typeof TimelineEventType];

/** 事件类型合法值域（DTO @IsIn / 校验遍历用） */
export const TIMELINE_EVENT_TYPE_VALUES: readonly number[] = Object.values(TimelineEventType);

/** 事件类型中文名映射（展示 / 断言用） */
export const TIMELINE_EVENT_TYPE_NAMES: Readonly<Record<number, string>> = {
  [TimelineEventType.CHECK_IN]: "入驻",
  [TimelineEventType.CHECK_OUT]: "离店",
  [TimelineEventType.FEEDING]: "喂养",
  [TimelineEventType.GROOMING]: "洗护",
  [TimelineEventType.MEDICAL]: "医疗",
  [TimelineEventType.WEIGHT]: "体重",
  [TimelineEventType.PHOTO]: "照片",
  [TimelineEventType.SYSTEM]: "系统",
};

// ─────────────────────────────────────────────────────────────
// 操作者类型（timeline_event.actor_type）
// ─────────────────────────────────────────────────────────────

/** 操作者类型（timeline_event.actor_type；SmallInt） */
export const TimelineActorType = {
  /** 员工 */
  STAFF: 1,
  /** 系统（自动任务 / 队列消费） */
  SYSTEM: 2,
  /** 宠主（宠主端自助操作） */
  OWNER: 3,
} as const;

export type TimelineActorType = (typeof TimelineActorType)[keyof typeof TimelineActorType];

/** 操作者类型合法值域 */
export const TIMELINE_ACTOR_TYPE_VALUES: readonly number[] = Object.values(TimelineActorType);

// ─────────────────────────────────────────────────────────────
// 事件名命名空间（`模块.动作`）
// ─────────────────────────────────────────────────────────────

/** 事件名模块前缀（`模块.动作` 的模块段，便于按模块聚合/筛选） */
export const TimelineEventModule = {
  PET: "pet",
  HEALTH: "health",
  WEIGHT: "weight",
  TIMELINE: "timeline",
  ORDER: "order",
  STAY: "stay",
  BOOKING: "booking",
} as const;

export type TimelineEventModule = (typeof TimelineEventModule)[keyof typeof TimelineEventModule];

/** 单个事件名元数据（默认事件类型 / 可见性 / 操作者类型） */
export interface TimelineEventNameMeta {
  /** 归属模块（`模块.动作` 的模块段） */
  module: string;
  /** 默认事件类型（event_type） */
  eventType: TimelineEventType;
  /** 默认宠主端可见性（写入侧未显式指定时的兜底） */
  visibleToOwner: boolean;
  /** 默认操作者类型（写入侧未显式指定时的兜底） */
  actorType: TimelineActorType;
  /** 人类可读描述 */
  description: string;
}

/**
 * 统一事件名常量表（`模块.动作` → 默认元数据）。
 *
 * 新增写入点 = 在此登记一行事件名（唯一来源），并在对应业务服务经
 * TimelineWriteService 接入。未登记的事件名不被 isKnownTimelineEventName 认可，
 * 写侧兜底为 SYSTEM 类型 + 宠主可见。
 */
export const TIMELINE_EVENT_NAMES = {
  "pet.created": {
    module: TimelineEventModule.PET,
    eventType: TimelineEventType.CHECK_IN,
    visibleToOwner: true,
    actorType: TimelineActorType.STAFF,
    description: "宠物档案创建",
  },
  "pet.updated": {
    module: TimelineEventModule.PET,
    eventType: TimelineEventType.SYSTEM,
    visibleToOwner: true,
    actorType: TimelineActorType.STAFF,
    description: "宠物档案更新",
  },
  "pet.tags.changed": {
    module: TimelineEventModule.PET,
    eventType: TimelineEventType.SYSTEM,
    visibleToOwner: false,
    actorType: TimelineActorType.STAFF,
    description: "宠物行为标签变更（内部运营记录）",
  },
  "health.record.created": {
    module: TimelineEventModule.HEALTH,
    eventType: TimelineEventType.MEDICAL,
    visibleToOwner: true,
    actorType: TimelineActorType.STAFF,
    description: "健康档案建档",
  },
  "health.record.updated": {
    module: TimelineEventModule.HEALTH,
    eventType: TimelineEventType.MEDICAL,
    visibleToOwner: true,
    actorType: TimelineActorType.STAFF,
    description: "健康档案更正",
  },
  "weight.recorded": {
    module: TimelineEventModule.WEIGHT,
    eventType: TimelineEventType.WEIGHT,
    visibleToOwner: true,
    actorType: TimelineActorType.STAFF,
    description: "体重记录",
  },
  "timeline.event.revised": {
    module: TimelineEventModule.TIMELINE,
    eventType: TimelineEventType.SYSTEM,
    visibleToOwner: false,
    actorType: TimelineActorType.STAFF,
    description: "时间线事件冲正（追加式纠错，原事件不变）",
  },
  // ── 预约域（MVP-WEB-06-05 改期 / 取消 / 爽约与状态流转）──
  // PRD《Booking API》验收要点「预约关键动作全部写入宠物时间线并触发宠主通知」
  //   ⇒ 7 个状态流转动作各登记一个事件名（通知派发归 06-06，此处只落事件）。
  // event_type 一律取 SYSTEM：预约动作横跨洗护 / 寄养 / 日托 / 训练等服务类型，
  //   归到任何一个具体业务类型（洗护 GROOMING / 入驻 CHECK_IN…）都会对另一类说谎；
  //   语义由 event_name + content + payload 承载（时间线按 event_name 筛选）。
  "booking.confirmed": {
    module: TimelineEventModule.BOOKING,
    eventType: TimelineEventType.SYSTEM,
    visibleToOwner: true,
    actorType: TimelineActorType.STAFF,
    description: "预约确认",
  },
  "booking.checked_in": {
    module: TimelineEventModule.BOOKING,
    eventType: TimelineEventType.SYSTEM,
    visibleToOwner: true,
    actorType: TimelineActorType.STAFF,
    description: "预约到店登记",
  },
  "booking.started": {
    module: TimelineEventModule.BOOKING,
    eventType: TimelineEventType.SYSTEM,
    visibleToOwner: true,
    actorType: TimelineActorType.STAFF,
    description: "预约开始服务",
  },
  "booking.completed": {
    module: TimelineEventModule.BOOKING,
    eventType: TimelineEventType.SYSTEM,
    visibleToOwner: true,
    actorType: TimelineActorType.STAFF,
    description: "预约完成服务",
  },
  "booking.rescheduled": {
    module: TimelineEventModule.BOOKING,
    eventType: TimelineEventType.SYSTEM,
    visibleToOwner: true,
    actorType: TimelineActorType.STAFF,
    description: "预约改期",
  },
  "booking.cancelled": {
    module: TimelineEventModule.BOOKING,
    eventType: TimelineEventType.SYSTEM,
    visibleToOwner: true,
    actorType: TimelineActorType.STAFF,
    description: "预约取消",
  },
  "booking.no_show": {
    module: TimelineEventModule.BOOKING,
    eventType: TimelineEventType.SYSTEM,
    visibleToOwner: true,
    actorType: TimelineActorType.STAFF,
    description: "预约爽约",
  },
} as const satisfies Readonly<Record<string, TimelineEventNameMeta>>;

/** 事件名联合类型（常量表的键） */
export type TimelineEventName = keyof typeof TIMELINE_EVENT_NAMES;

/** 全量事件名清单（登记顺序） */
export const TIMELINE_EVENT_NAME_VALUES: readonly string[] = Object.keys(TIMELINE_EVENT_NAMES);

/** 冲正事件的固定事件名（写侧 / 读侧共用，避免字面量漂移） */
export const TIMELINE_REVISION_EVENT_NAME = "timeline.event.revised";

// ─────────────────────────────────────────────────────────────
// payload 类型（结构化负载；仅作契约声明，运行时不校验）
// ─────────────────────────────────────────────────────────────

/** 健康档案事件负载 */
export interface TimelinePayloadHealthRecord {
  recordId: string;
  recordType: number;
  recordDate: string;
  expireDate?: string | null;
}

/** 体重事件负载 */
export interface TimelinePayloadWeight {
  weightId?: string;
  weightKg: string;
  weighedAt: string;
}

/** 行为标签变更事件负载 */
export interface TimelinePayloadTagsChanged {
  addedTagIds: string[];
  removedTagIds: string[];
}

/** 冲正事件负载（记录被冲正的原事件与修正内容） */
export interface TimelinePayloadRevised {
  /** 被冲正的原事件 id（BigInt 字符串化） */
  originalEventId: string;
  /** 被冲正的原事件名 */
  originalEventName?: string | null;
  /** 冲正原因 */
  reason?: string | null;
  /** 修正内容（字段级差分；结构由各业务自定） */
  changes?: Record<string, unknown> | null;
}

/** 宠物创建事件负载 */
export interface TimelinePayloadPetCreated {
  petName: string;
  petType: number;
  ownerCustomerId: string;
}

/**
 * 预约状态流转事件负载（MVP-WEB-06-05）。
 *
 * `action` 取 `@peluvida/shared` 的 `BookingAction`；`fromStatus` / `toStatus`
 * 取 `BookingStatus`。改期事件额外带 `newBookingId` / `newBookingNo`（新旧单互链的
 * 正向指针，便于时间线条目直接跳新单）。
 */
export interface TimelinePayloadBookingChanged {
  bookingId: string;
  bookingNo: string;
  action: string;
  fromStatus: string;
  toStatus: string;
  /** 动作原因（取消 / 改期 / 爽约的 `reason`） */
  reason?: string | null;
  /** 改期生成的新单 id */
  newBookingId?: string;
  /** 改期生成的新单号 */
  newBookingNo?: string;
}

// ─────────────────────────────────────────────────────────────
// 纯函数（解析 / 兜底）
// ─────────────────────────────────────────────────────────────

/** 拼接事件名（`模块.动作`），并归一空白 */
export function buildTimelineEventName(module: string, action: string): string {
  return `${String(module).trim()}.${String(action).trim()}`;
}

/** 事件名是否已登记（KNOWN 集合） */
export function isKnownTimelineEventName(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(TIMELINE_EVENT_NAMES, name);
}

/** 取事件名元数据（未登记返回 undefined） */
export function getTimelineEventNameMeta(name: string): TimelineEventNameMeta | undefined {
  return (TIMELINE_EVENT_NAMES as Record<string, TimelineEventNameMeta>)[name];
}

/**
 * 解析事件类型：显式值优先，否则回落事件名默认，再回落 SYSTEM。
 * 显式值不在合法值域内时同样回落（fail-safe，写侧不透传脏值）。
 */
export function resolveTimelineEventType(
  eventName: string,
  explicit?: number | null
): TimelineEventType {
  if (
    explicit !== undefined &&
    explicit !== null &&
    TIMELINE_EVENT_TYPE_VALUES.includes(explicit)
  ) {
    return explicit as TimelineEventType;
  }
  const meta = getTimelineEventNameMeta(eventName);
  return meta ? meta.eventType : TimelineEventType.SYSTEM;
}

/**
 * 解析操作者类型：显式值优先，否则回落事件名默认，再回落 SYSTEM。
 * 显式值不在合法值域内时同样回落。
 */
export function resolveTimelineActorType(
  eventName: string,
  explicit?: number | null
): TimelineActorType {
  if (
    explicit !== undefined &&
    explicit !== null &&
    TIMELINE_ACTOR_TYPE_VALUES.includes(explicit)
  ) {
    return explicit as TimelineActorType;
  }
  const meta = getTimelineEventNameMeta(eventName);
  return meta ? meta.actorType : TimelineActorType.SYSTEM;
}

/**
 * 解析宠主端可见性：显式布尔优先；否则回落事件名默认；未登记事件名默认可见（true）。
 *
 * 说明：显式 false 会覆盖事件名默认的 true（允许逐条事件细粒度隐藏）。
 */
export function resolveTimelineVisibility(eventName: string, explicit?: boolean | null): boolean {
  if (typeof explicit === "boolean") {
    return explicit;
  }
  const meta = getTimelineEventNameMeta(eventName);
  return meta ? meta.visibleToOwner : true;
}
