import {
  BookingAction,
  BOOKING_ACTION_META,
  BookingStatus,
  isBookingActionAllowed,
  isKnownTimelineEventName,
} from "@peluvida/shared";

/**
 * 预约模块常量（P0-08-05；MVP-WEB-06-01 预约列表与状态展示）
 *
 * 状态值域**唯一来源**为 `@peluvida/shared` 的 `BookingStatus`（snake_case 字符串），
 * 本文件只做「后端校验所需」的再导出与派生，**不重新定义**状态字面量
 * （避免出现第二套映射 —— 踩坑 126-bis 双源漂移）。
 *
 * DB 侧 `booking.status` 为 VARCHAR(16)，存的就是这里的字符串值；
 * 三端文案与语义色统一走共享的 `BOOKING_STATUS_META`。
 */

/** 预约状态合法值域（DTO `@IsIn` 与 E2E 断言复用） */
export const BOOKING_STATUS_VALUES: readonly string[] = Object.values(BookingStatus);

/** 预约状态（字符串枚举再导出，便于服务层 / 控制器引用） */
export { BookingStatus };
export type BookingStatusValue = (typeof BookingStatus)[keyof typeof BookingStatus];

/**
 * 状态流转动作与状态机守卫（MVP-WEB-06-05）。
 *
 * 🔴 **唯一来源 = `@peluvida/shared`**（`BookingAction` / `BOOKING_ACTION_META` /
 * `isBookingActionAllowed`）——本文件只做再导出，**不重新定义**动作字面量与
 * 来源/目标状态（避免出现第二套映射，踩坑 126-bis）。前端用同一份常量决定动作按钮的
 * 渲染（「非法状态下按钮不出现」），后端用它拦截非法流转（30002）。
 */
export { BookingAction, BOOKING_ACTION_META, isBookingActionAllowed };

/**
 * 排序字段白名单：sortBy 必须落在集合内，否则回落默认值。
 * 防止把任意字符串透传给 orderBy（防注入 + 防无索引全表排序）。
 */
export const BOOKING_SORTABLE_FIELDS = [
  "bookingDate",
  "startTime",
  "createdAt",
  "bookingNo",
  "status",
] as const;
export type BookingSortableField = (typeof BOOKING_SORTABLE_FIELDS)[number];

/** 列表默认排序：预约日期倒序（最新的排期在最前） */
export const BOOKING_DEFAULT_SORT_BY: BookingSortableField = "bookingDate";

/**
 * 寄养类业务大类（`service_category.cat_type` = 3 寄养，见 schema 注释）。
 *
 * 用途：PRD《Booking API》把 `room_id` 标为「条件必填 —— 寄养类服务必填」，
 * 而「寄养类」的判据落在服务项的 `catType` 上（BR-5 同源）。
 */
export const BOOKING_FOSTER_CAT_TYPE = 3;

/**
 * 默认服务时长（分钟）。
 *
 * PRD 创建请求体只给 `start_at`，`end_time` 应由服务项时长推导；而服务项时长字段
 * 属《服务管理》模块（`service_item` 尚未建模）⇒ 本轮以请求体可选 `durationMinutes`
 * 承接，缺省 60 分钟。**边界**：服务项落地后应改为从服务项读取，不再信任入参。
 */
export const BOOKING_DEFAULT_DURATION_MINUTES = 60;

/** 业务单号前缀（`booking_no` = 前缀 + 应用时区 yyyyMMddHHmmss + 2 位随机） */
export const BOOKING_NO_PREFIX = "BK";

/** 单号随机后缀位数（碰撞由 `uk_booking_tenant_no` 兜底 + 有限重试） */
export const BOOKING_NO_SUFFIX_DIGITS = 2;

/** 单号生成最大重试次数（唯一约束冲突时更换随机后缀重试） */
export const BOOKING_NO_MAX_RETRY = 5;

/* ─────────────────── MVP-WEB-06-03 预约日历 / 冲突检测 ─────────────────── */

/**
 * 日历可查询窗口上限（天，闭区间含首尾）。
 *
 * 日历是**非分页**读端点（一天 / 一周 / 资源视图都要「整窗」数据），若不加界，
 * 一次 `dateStart=2000-01-01&dateEnd=2999-12-31` 就会把整表拉进内存 ⇒ 上限 31 天
 * （一次最多一个月），与 `el-date-picker` 的日/周粒度匹配。
 */
export const BOOKING_CALENDAR_MAX_RANGE_DAYS = 31;

/**
 * 「已释放时段」的预约状态 —— 这些单**不再占用**员工 / 房间资源。
 *
 * 依据：BR-1「改期生成新单并置原单为 `rescheduled`」+ FR-3「旧时段自动释放」
 * + BR-3 取消 ⇒ `cancelled` / `no_show` / `rescheduled` 三态均视为已释放；
 * 其余态（`pending` / `confirmed` / `in_service` / `completed`）一律**占用**资源。
 *
 * ⚠️ 值域仍取自 `@peluvida/shared`（本文件只做「占用/释放」这一**派生**），
 * 不新造状态字面量（踩坑 126-bis）。
 */
export const BOOKING_RELEASED_STATUSES: readonly string[] = [
  BookingStatus.CANCELLED,
  BookingStatus.NO_SHOW,
  BookingStatus.RESCHEDULED,
];

/** 占用资源的预约状态（= 全量状态 − 已释放态），冲突检测的筛选条件 */
export const BOOKING_OCCUPYING_STATUSES: readonly string[] = BOOKING_STATUS_VALUES.filter(
  (value) => !BOOKING_RELEASED_STATUSES.includes(value)
);

/**
 * 冲突规则（PRD《页面功能》预约日历：「冲突检测覆盖同一宠物时段重复、同一资源超载、
 * 员工排班空档三类规则」）。
 *
 * ⚠️ **边界**：第三类「员工排班空档」依赖**员工排班表**，而 schema 至今无
 * `shift` / `schedule` 表（《员工与排班》模块未建模）⇒ 本轮**只实现前两类**，
 * 排班规则的判据不可得（无法凭空推断某员工的班次窗口），记为边界，
 * 待排班模块落地后在 `checkConflict` 内补一条规则即可（出参形状不变）。
 */
export const BOOKING_CONFLICT_RULES = {
  /** 同一宠物在重叠时段已有其它占用态预约 */
  PET_OVERLAP: "pet_overlap",
  /** 同一资源（员工 / 房间）在重叠时段的占用数达到上限 */
  RESOURCE_OVERLOAD: "resource_overload",
} as const;
export type BookingConflictRule =
  (typeof BOOKING_CONFLICT_RULES)[keyof typeof BOOKING_CONFLICT_RULES];

/** 冲突涉及的资源类型（宠物维度无资源，故规则 `pet_overlap` 的 `resourceType` 为 null） */
export const BOOKING_RESOURCE_TYPES = {
  EMPLOYEE: "employee",
  ROOM: "room",
} as const;
export type BookingResourceType =
  (typeof BOOKING_RESOURCE_TYPES)[keyof typeof BOOKING_RESOURCE_TYPES];

/**
 * 员工并发服务上限（PRD《预约管理》BR-2：「员工按占用表计算并发上限（如美容师同时
 * 服务上限为 1）」）。
 *
 * ⚠️ **边界**：PRD 的「如」暗示按岗位 / 技能可分档配置，但分档依据落在
 * `employee_skill` 表（schema 注释明确「本期不建」）⇒ 本轮统一取 1（一名员工同一
 * 时段只接一单），待技能分档落地后改为按岗位取值。
 */
export const BOOKING_EMPLOYEE_CONCURRENCY_LIMIT = 1;

/* ─────────────────── MVP-WEB-06-04 容量校验 API ─────────────────── */

/**
 * 容量校验出参里「可替代时段」的步长（分钟）。
 *
 * 与前端日历的 30 分钟吸附（`booking.constants` 的对端 `utils/booking.ts`
 * `BOOKING_CALENDAR_SLOT_MINUTES`）同值：建议时段必须落在**能被日历吸附到的格点**上，
 * 否则「建议 10:17」这类落点用户根本无法用日历选出来。
 */
export const BOOKING_SUGGESTION_STEP_MINUTES = 30;

/** 「可替代时段」条数上限（按距请求时刻由近到远取） */
export const BOOKING_SUGGESTION_LIMIT = 5;

/**
 * 「可替代时段」的候选营业窗口（小时，半开区间 `[START, END)`）。
 *
 * ⚠️ **边界**：门店真实营业时段是 `store.business_hours`（周营业时段）+ `store_calendar`
 * （日期级例外），完整接入属于「门店营业时间」的既有领域；本轮容量建议先取固定
 * 08:00–20:00，并在出参 `window` 里**原样回显**（前端不私存这份常量），
 * 故后续改为读门店配置时前端零改动。
 */
export const BOOKING_SUGGESTION_DAY_START_HOUR = 8;
export const BOOKING_SUGGESTION_DAY_END_HOUR = 20;

/** 单次容量校验允许命中的重叠占用行上限（防极端脏数据把响应撑爆） */
export const BOOKING_OCCUPANCY_TAKE_LIMIT = 50;

/* ─────────────────── MVP-WEB-06-05 改期 / 取消 / 爽约与状态流转 ─────────────────── */

/**
 * 取消「紧窗口」（小时）——低于距开始这一时长即进入**店长审核**档，
 * 同时也是**宠主端**可自助取消的截止窗口。
 *
 * 依据：PRD《Booking API》取消段「宠主端取消仅允许 `confirmed` 状态且不晚于服务开始前
 * 2 小时」+《预约管理》BR-3「距开始大于 2 小时可免费取消；低于 2 小时转店长审核」。
 *
 * ⚠️ 与门店可配的**免费/计费分界**（`store.config.cancelCutoffHours`，平台默认 24 小时，
 * 见 `@peluvida/shared` 的 `resolveStoreConfig`）是两个不同口径：
 *  · `cancelCutoffHours` 决定「免费取消 vs 按门店规则计费」（**门店可配**）；
 *  · 本常量决定「计费 vs 需店长审核」以及宠主端能否自助取消（**平台固定**）。
 */
export const BOOKING_CANCEL_TIGHT_WINDOW_HOURS = 2;

/** 取消计费规则的档位（出参 `feeRule.policy`；前端据此选文案，不私写映射） */
export const BOOKING_CANCEL_FEE_POLICIES = {
  /** 距开始超过门店取消截止 ⇒ 免费取消 */
  FREE: "free",
  /** 落在门店取消截止之内、紧窗口之外 ⇒ 按门店规则计费（金额属服务定价域，本轮只回读规则） */
  CHARGED: "charged",
  /** 落在紧窗口之内 ⇒ 转店长审核 */
  REVIEW: "review",
} as const;
export type BookingCancelFeePolicy =
  (typeof BOOKING_CANCEL_FEE_POLICIES)[keyof typeof BOOKING_CANCEL_FEE_POLICIES];

/**
 * 同一预约链累计改期次数上限：**超过**该次数需店长角色二次确认
 * （PRD《Booking API》改期段第 3 条「同一预约累计改期超过 3 次，需店长角色二次确认，
 * 否则返回 30003」）。
 *
 * 计数口径：沿 `booking.prev_booking_id` 向上回溯到链首，回溯步数即「已发生的改期次数」；
 * `已发生次数 >= 上限` 时本次改期即「第 4 次」⇒ 触发二次确认。
 */
export const BOOKING_RESCHEDULE_CHAIN_LIMIT = 3;

/** 回溯改期链的最大步数（防脏数据成环把请求拖死） */
export const BOOKING_RESCHEDULE_CHAIN_MAX_HOPS = 20;

/** 具备「改期超限二次确认」资格的角色码（PRD：店长） */
export const BOOKING_MANAGER_ROLE_CODE = "manager";

/**
 * 宠主端标记请求头（值 `owner`）。
 *
 * ⚠️ **边界**：宠主端（OWNER 门户，飞书表 row173~183）尚未建设，Web 商家端不会发送本头
 * ⇒ 现状恒走「员工口径」。本头是**唯一入口**，把「谁是取消方」这一判据固定在请求入口，
 * 待宠主端落地后由该端网关统一注入（不改成从 body 取 —— 请求体字段可被商家端伪造，
 * 会把「宠主 2 小时窗口」这条限制变成一句空话）。
 */
export const BOOKING_ACTOR_SCOPE_HEADER = "x-actor-scope";

/** 宠主端标记值（`X-Actor-Scope: owner`） */
export const BOOKING_ACTOR_SCOPE_OWNER = "owner";

/**
 * 动作 → 时间线事件名（MVP-WEB-06-05）。
 *
 * PRD《Booking API》验收要点「预约关键动作全部写入宠物时间线并触发宠主通知」⇒
 * 每个状态流转动作对应一个已登记的事件名（登记处 = `@peluvida/shared`
 * `TIMELINE_EVENT_NAMES`，本表只做「动作 → 事件名」的映射）。
 *
 * 🔴 事件名**不能由动作名推导**（`checkin` 的事件名是 `booking.checked_in`），
 * 故显式列全；模块加载期守卫校验两点：① 键覆盖全部动作；② 每个事件名都已登记
 * （写了没登记 = 时间线里出现「未命名事件」，无法按事件名筛选）。
 */
export const BOOKING_TIMELINE_EVENT_NAMES: Readonly<Record<BookingAction, string>> = {
  [BookingAction.CONFIRM]: "booking.confirmed",
  [BookingAction.CHECKIN]: "booking.checked_in",
  [BookingAction.START]: "booking.started",
  [BookingAction.COMPLETE]: "booking.completed",
  [BookingAction.RESCHEDULE]: "booking.rescheduled",
  [BookingAction.CANCEL]: "booking.cancelled",
  [BookingAction.NO_SHOW]: "booking.no_show",
};

// ── 映射完整性守卫（模块加载期；不一致即抛错）──
for (const action of Object.values(BookingAction)) {
  const eventName = BOOKING_TIMELINE_EVENT_NAMES[action];
  if (!eventName) {
    throw new Error(`[Booking] 动作 ${action} 未映射时间线事件名（timeline 会漏记该动作）`);
  }
  if (!isKnownTimelineEventName(eventName)) {
    throw new Error(
      `[Booking] 时间线事件名 ${eventName} 未在 @peluvida/shared TIMELINE_EVENT_NAMES 登记`
    );
  }
}
