/**
 * 预约域纯函数工具（MVP-WEB-06-01 预约列表与状态展示；06-05 状态流转动作派生）
 *
 * 目标：把「状态 → 文案 key / 语义色」「预约日期 → 日历日」「时段 → HH:mm 区间」这类
 * 可测、无副作用的换算集中一处，供列表页与详情抽屉复用（避免两处各写一份口径而漂移，
 * 对齐 `utils/pet.ts` 的既有约定）。
 *
 * 本文件**不 import i18n 与任何 Vue API**（纯逻辑不持有语言上下文，由调用方
 * `t(key, params)` 渲染）。
 *
 * 🔴 单源约束：状态值域与语义色**一律取 `@peluvida/shared` 的 `BookingStatus` /
 * `BOOKING_STATUS_META`**，页面与抽屉都不得私写状态映射表（踩坑 126-bis 双源漂移）。
 * 本文件只做两件「派生」事：值 → i18n key（补多语言文案，元信息表里的 label 只有中文）、
 * 语义色令牌 → Element Plus 标签类型（纯渲染适配）。键映射用
 * `Record<BookingStatus, string>` 声明，shared 新增状态时 TS 会立刻报缺键。
 */

import {
  BOOKING_STATUS_META,
  BookingStatus,
  getStatusMeta,
  listBookingActionsFrom,
  type BookingAction,
  type SemanticColorToken,
  type StatusMeta,
} from "@peluvida/shared";

// 仅取类型（编译期擦除，不引入 `@/api/booking` 的运行时依赖 ⇒ 不会与请求层成环）
import type {
  BookingCapacityCheckResult,
  BookingTransitionErrorDetails,
} from "@/api/booking/types";

/** 文案 key 映射（穷尽性由 `Record<BookingStatus, string>` 保证，漏一个即编译失败） */
const BOOKING_STATUS_LABEL_KEYS: Record<BookingStatus, string> = {
  [BookingStatus.PENDING]: "booking.value.statusPending",
  [BookingStatus.CONFIRMED]: "booking.value.statusConfirmed",
  [BookingStatus.IN_SERVICE]: "booking.value.statusInService",
  [BookingStatus.COMPLETED]: "booking.value.statusCompleted",
  [BookingStatus.CANCELLED]: "booking.value.statusCancelled",
  [BookingStatus.NO_SHOW]: "booking.value.statusNoShow",
  [BookingStatus.RESCHEDULED]: "booking.value.statusRescheduled",
};

/**
 * 状态筛选下拉选项（顺序 = `BookingStatus` 声明顺序，与状态机主链路一致）
 *
 * 值直接取共享枚举成员，标签为 i18n key，调用方 `t(option.labelKey)` 渲染。
 */
export const BOOKING_STATUS_OPTIONS: ReadonlyArray<{ value: BookingStatus; labelKey: string }> = (
  Object.values(BookingStatus) as BookingStatus[]
).map((value) => ({
  value,
  labelKey: BOOKING_STATUS_LABEL_KEYS[value],
}));

/** 语义色令牌 → Element Plus `el-tag` 类型（纯渲染适配；`neutral` 落 `info`） */
const TAG_TYPE_BY_COLOR: Record<
  SemanticColorToken,
  "primary" | "success" | "info" | "warning" | "danger"
> = {
  info: "primary",
  success: "success",
  warning: "warning",
  danger: "danger",
  neutral: "info",
};

/** 默认标签类型（未知状态兜底，与 `neutral` 同观感） */
const DEFAULT_TAG_TYPE = TAG_TYPE_BY_COLOR.neutral;

/** 取状态元信息；未知状态返回 `undefined`（调用方走兜底文案） */
export function bookingStatusMeta(status: string | null | undefined): StatusMeta | undefined {
  if (!status) return undefined;
  return getStatusMeta(BOOKING_STATUS_META, status);
}

/** 状态 → i18n key（未知 / 空值回落 `booking.value.unknownStatus`） */
export function bookingStatusLabelKey(status: string | null | undefined): string {
  if (!status) return "booking.value.unknownStatus";
  const key = BOOKING_STATUS_LABEL_KEYS[status as BookingStatus];
  if (!key) return "booking.value.unknownStatus";
  return key;
}

/** 状态 → `el-tag` 类型（未知状态回落中性色） */
export function bookingStatusTagType(
  status: string | null | undefined
): "primary" | "success" | "info" | "warning" | "danger" {
  const meta = bookingStatusMeta(status);
  if (!meta) return DEFAULT_TAG_TYPE;
  return TAG_TYPE_BY_COLOR[meta.color] ?? DEFAULT_TAG_TYPE;
}

/**
 * 预约日期（DATE 列）→ `yyyy-MM-dd`
 *
 * 后端把 `Date` 统一序列化为 `yyyy-MM-dd HH:mm:ss`（Asia/Shanghai）；`booking_date`
 * 是 DATE 列、以 UTC 午夜承载，落到北京时区后时间部分恒为 `08:00:00`，**日历日部分
 * 始终正确**。故按字符串取前 10 位，不构造 `Date`（避免无时区串被隐式按 UTC 解读，
 * 对齐 `utils/pet.ts` 的 `toDayString` 口径）。
 */
export function bookingDateLabel(value: string | null | undefined): string {
  if (!value) return "-";
  const text = String(value).replace("T", " ");
  const matched = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  return matched ? matched[1] : text;
}

/**
 * 预约时段 → `HH:mm - HH:mm`
 *
 * `start_time` / `end_time` 是 `timestamptz`，后端已按应用时区格式化为
 * `yyyy-MM-dd HH:mm:ss`，故同样按字符串取 `HH:mm`，不做时区换算。
 * 任一端缺失时返回 `-`（数据异常时宁可显式留空，也不臆造时间）。
 */
export function bookingTimeRangeLabel(
  startTime: string | null | undefined,
  endTime: string | null | undefined
): string {
  const start = toHourMinute(startTime);
  const end = toHourMinute(endTime);
  if (!start || !end) return "-";
  return `${start} - ${end}`;
}

/** 取时间串的 `HH:mm` 部分；无法识别返回 `null` */
function toHourMinute(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = String(value).replace("T", " ");
  const matched = /^\d{4}-\d{2}-\d{2} (\d{2}:\d{2})/.exec(text);
  return matched ? matched[1] : null;
}

/**
 * 后端时间串 → 表单用**墙钟串** `yyyy-MM-dd HH:mm`
 *
 * 后端已按应用时区把 `timestamptz` 格式化为 `yyyy-MM-dd HH:mm:ss` ⇒ 直接取前 16 位
 * 就是与写入端点（`startAt` 墙钟口径）**同语义**的值，可原样回填表单、也可原样提交
 * （不构造 `Date`、不做时区换算 ⇒ 没有「回填后被再解释一次」的漂移）。
 *
 * 无法识别（空 / 格式异常）时返回 `""`：调用方据此走「请选择时间」而非给出错值。
 */
export function bookingWallClock(value: string | null | undefined): string {
  if (!value) return "";
  const text = String(value).replace("T", " ");
  const matched = /^\d{4}-\d{2}-\d{2} (\d{2}:\d{2})/.exec(text);
  return matched ? `${matched[0]}` : "";
}

/**
 * 生成「相对今天偏移 N 天的某个整点」的**墙钟串**（`yyyy-MM-dd HH:mm`）
 *
 * 用途：预约创建表单的「开始时间」缺省值（默认次日 10:00），走组件 `ref` 一次性
 * 初始化，不参与响应式派生 —— 故用浏览器本地时间分量直接拼串即可（墙钟语义），
 * 不做时区换算；服务端按应用时区解释该串（`CreateBookingDto.startAt`）。
 *
 * ⚠️ 刻意不引 dayjs：它只是 element-plus 的传递依赖，直接 import 会把「未声明依赖」
 * 引入构建（package.json 未列出）。
 *
 * @param hour   小时（0~23）
 * @param minute 分钟（0~59）
 * @param dayOffset 相对今天的天数偏移（默认 0 = 今天）
 */
export function todayWallClockAt(hour: number, minute: number, dayOffset = 0): string {
  const target = new Date();
  target.setDate(target.getDate() + dayOffset);
  const pad = (n: number) => String(n).padStart(2, "0");
  const ymd = `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`;
  return `${ymd} ${pad(hour)}:${pad(minute)}`;
}

/* ════════════════════ MVP-WEB-06-03 预约日历 ════════════════════ */

/**
 * 日历时间轴口径（日 / 周 / 资源三视图共用）
 *
 * PRD《页面功能》预约日历：日视图「纵轴时段（**30 分钟粒度**），横轴资源」。
 * 营业时段取 **08:00–20:00**（12 小时 = 24 个 30 分钟格）——门店配置里的
 * 「营业时间」字段尚未建模，故取行业通用窗口并在卡片超出窗口时**裁剪**而不是溢出。
 */
export const BOOKING_CALENDAR_START_HOUR = 8;
export const BOOKING_CALENDAR_END_HOUR = 20;
export const BOOKING_CALENDAR_SLOT_MINUTES = 30;
/** 时间轴总分钟数（= 720） */
export const BOOKING_CALENDAR_TOTAL_MINUTES =
  (BOOKING_CALENDAR_END_HOUR - BOOKING_CALENDAR_START_HOUR) * 60;

/**
 * 日历卡片配色档
 *
 * 🔴 PRD《页面功能》预约日历**为卡片指定了专门的配色**：
 * 「pending 灰、confirmed 蓝、in_service 绿、completed 深灰、no_show 红」——
 * 这与 `BOOKING_STATUS_META.color`（状态**标签**语义色：pending=warning 等）
 * 是**两套不同用途的视觉**（卡片 vs 标签），不是同一判据的两处来源，
 * 故此处单独声明、并由 `Record<BookingStatus, …>` 保证穷尽性
 * （shared 新增状态 ⇒ 编译失败，不会静默落到兜底色）。
 * `cancelled` / `rescheduled` 未在 PRD 调色板内（二者语义上「已释放时段」），
 * 统一落 `muted`（半透明灰）以弱化呈现。
 */
export type BookingCalendarTone = "gray" | "blue" | "green" | "dark" | "red" | "muted";

const BOOKING_CALENDAR_TONE: Record<BookingStatus, BookingCalendarTone> = {
  [BookingStatus.PENDING]: "gray",
  [BookingStatus.CONFIRMED]: "blue",
  [BookingStatus.IN_SERVICE]: "green",
  [BookingStatus.COMPLETED]: "dark",
  [BookingStatus.NO_SHOW]: "red",
  [BookingStatus.CANCELLED]: "muted",
  [BookingStatus.RESCHEDULED]: "muted",
};

/** 状态 → 日历卡片配色档（未知状态落 `muted`） */
export function bookingCalendarTone(status: string | null | undefined): BookingCalendarTone {
  if (!status) return "muted";
  return BOOKING_CALENDAR_TONE[status as BookingStatus] ?? "muted";
}

/**
 * 从后端时间串取「当日分钟数」（`2026-10-12 09:30:00` → 570）
 *
 * 一律按**字符串分量**取值，不构造 `Date` —— 后端已按应用时区（Asia/Shanghai）
 * 格式化为 `yyyy-MM-dd HH:mm:ss`，构造 `Date` 会把无时区串隐式按 UTC 解读而漂移
 * （对齐 `bookingDateLabel` / `bookingTimeRangeLabel` 的既有口径，踩坑 126 系列）。
 */
export function bookingMinuteOfDay(value: string | null | undefined): number | null {
  if (!value) return null;
  const text = String(value).replace("T", " ");
  const matched = /^\d{4}-\d{2}-\d{2} (\d{2}):(\d{2})/.exec(text);
  if (!matched) return null;
  return Number(matched[1]) * 60 + Number(matched[2]);
}

/** 预约时长（分钟；任一端缺失或非正返回 0） */
export function bookingDurationMinutes(
  startTime: string | null | undefined,
  endTime: string | null | undefined
): number {
  const start = bookingMinuteOfDay(startTime);
  const end = bookingMinuteOfDay(endTime);
  if (start === null || end === null) return 0;
  return Math.max(0, end - start);
}

/** `08:00` 形式的时段标签（供时间轴刻度） */
export function bookingClockLabel(minuteOfDay: number): string {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * 卡片在**横向时间轨**上的几何（百分比）
 *
 * 超出营业时段的部分被**裁剪**到 [0, 100]（`clamp`），保证卡片不会溢出容器；
 * 完全落在窗口外的预约返回 `width = 0`（调用方据此不渲染 / 渲染为「窗口外」提示）。
 */
export function bookingTrackGeometry(
  startTime: string | null | undefined,
  endTime: string | null | undefined
): { left: number; width: number; outside: boolean } {
  const start = bookingMinuteOfDay(startTime);
  const end = bookingMinuteOfDay(endTime);
  const dayStart = BOOKING_CALENDAR_START_HOUR * 60;
  if (start === null || end === null || end <= start) {
    return { left: 0, width: 0, outside: true };
  }
  const total = BOOKING_CALENDAR_TOTAL_MINUTES;
  const leftMinute = Math.max(0, Math.min(total, start - dayStart));
  const rightMinute = Math.max(0, Math.min(total, end - dayStart));
  const width = rightMinute - leftMinute;
  return {
    left: (leftMinute / total) * 100,
    width: (width / total) * 100,
    outside: width <= 0,
  };
}

/**
 * 卡片在**纵向时间网格**上的几何（像素）
 *
 * 与 `bookingTrackGeometry` 同口径（按营业时段裁剪），只是换算目标由百分比改为像素。
 */
export function bookingGridGeometry(
  startTime: string | null | undefined,
  endTime: string | null | undefined,
  slotHeight: number
): { top: number; height: number; outside: boolean } {
  const geometry = bookingTrackGeometry(startTime, endTime);
  const total = BOOKING_CALENDAR_TOTAL_MINUTES / BOOKING_CALENDAR_SLOT_MINUTES;
  const totalHeight = total * slotHeight;
  return {
    top: (geometry.left / 100) * totalHeight,
    height: (geometry.width / 100) * totalHeight,
    outside: geometry.outside,
  };
}

/** 日期串 → `MM-DD`（非法回落原串） */
export function bookingMonthDayLabel(value: string | null | undefined): string {
  const day = bookingDateLabel(value);
  const matched = /^\d{4}-(\d{2})-(\d{2})$/.exec(day);
  return matched ? `${matched[1]}-${matched[2]}` : day;
}

/**
 * 日期串 → 周几序号（0 = 周日 … 6 = 周六）；非法返回 `null`
 *
 * 用 `Date.UTC` 解析 `yyyy-MM-dd`（**纯日期**，无时区歧义），不用本地 `new Date(str)`
 * —— 后者会把无时区串按 UTC 解读、再按本地时区取星期，跨时区会差一天。
 */
export function bookingWeekdayIndex(value: string | null | undefined): number | null {
  const day = bookingDateLabel(value);
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!matched) return null;
  return new Date(
    Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]))
  ).getUTCDay();
}

/** `yyyy-MM-dd`（纯日期）平移 N 天，返回 `yyyy-MM-dd`；非法入参回落原值 */
export function bookingShiftDay(value: string, delta: number): string {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(bookingDateLabel(value));
  if (!matched) return value;
  const base = Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]));
  const shifted = new Date(base + delta * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** 今天（浏览器本地日期，`yyyy-MM-dd` 墙钟口径） */
export function bookingToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 含首尾的日期串数组（非法 / 超长窗口回落空数组；上限 31 天对齐后端窗口约束） */
export function bookingDateSpan(start: string, end: string, maxDays = 31): string[] {
  const begin = bookingDateLabel(start);
  const finish = bookingDateLabel(end);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(begin) || !/^\d{4}-\d{2}-\d{2}$/.test(finish)) return [];
  const days: string[] = [];
  let cursor = begin;
  for (let i = 0; i < maxDays; i++) {
    days.push(cursor);
    if (cursor === finish) break;
    const next = bookingShiftDay(cursor, 1);
    if (next === cursor) break;
    cursor = next;
  }
  return days;
}

/* ═════════════════════ MVP-WEB-06-05 状态流转动作 ═════════════════════ */

/**
 * 动作 → 文案 key
 *
 * `Record<BookingAction, string>` 保证穷尽性：`@peluvida/shared` 新增动作时
 * TS 立刻报缺键，不会静默渲染空白按钮。
 */
const BOOKING_ACTION_LABEL_KEYS: Record<BookingAction, string> = {
  confirm: "booking.action.confirm",
  checkin: "booking.action.checkin",
  start: "booking.action.start",
  complete: "booking.action.complete",
  reschedule: "booking.action.reschedule",
  cancel: "booking.action.cancel",
  "no-show": "booking.action.noShow",
};

/**
 * 动作 → 后端权限码
 *
 * 🔴 与 `niulai-nest/src/booking/booking-permissions.constants.ts` 的
 * `BookingPermissions` **逐字对应**（`域:对象:动作` 口径）。权限码是字符串契约，
 * 前端没有编译期校验手段 ⇒ 此表是前端唯一副本，改后端权限码必须同步改这里
 * （凭据：`GET /users/me` 的 `data.perms[]` 下发的就是这些字符串）。
 *
 * 为什么按钮要「状态机 + 权限」双维度：PRD《页面功能》验收要点「操作按钮随状态机
 * 渲染，非法状态下按钮不出现」+《Booking API》端点清单对每个动作**分别**标注角色
 * （美容师可开始服务但不可确认预约等）⇒ 两个判据缺一即出现「点了必然报 403」的按钮。
 */
const BOOKING_ACTION_PERMISSIONS: Record<BookingAction, string> = {
  confirm: "booking:confirm",
  checkin: "booking:checkin",
  start: "booking:start",
  complete: "booking:complete",
  reschedule: "booking:reschedule",
  cancel: "booking:cancel",
  "no-show": "booking:no-show",
};

/**
 * 动作 → 按钮观感
 *
 * 前向主链路（确认 / 到店 / 开始 / 完成）用 `primary`；改期中性；取消与爽约是
 * 「不可逆的负向终态」⇒ `danger`（PRD《交互规范》：破坏性操作需视觉区分度）。
 */
const BOOKING_ACTION_BUTTON_TYPES: Record<BookingAction, "primary" | "danger" | "default"> = {
  confirm: "primary",
  checkin: "primary",
  start: "primary",
  complete: "primary",
  reschedule: "default",
  cancel: "danger",
  "no-show": "danger",
};

/** 动作 → i18n key（未知动作回落中性文案 key，不渲染裸英文动作名） */
export function bookingActionLabelKey(action: BookingAction): string {
  return BOOKING_ACTION_LABEL_KEYS[action] ?? "booking.value.unknownAction";
}

/** 动作 → 后端权限码（未知动作返回空串 ⇒ `hasPerm("")` 为 false，按钮不渲染） */
export function bookingActionPermission(action: BookingAction): string {
  return BOOKING_ACTION_PERMISSIONS[action] ?? "";
}

/** 动作 → 按钮观感（未知动作回落 `default`） */
export function bookingActionButtonType(action: BookingAction): "primary" | "danger" | "default" {
  return BOOKING_ACTION_BUTTON_TYPES[action] ?? "default";
}

/**
 * 某状态下的可执行动作清单（**已按状态机过滤**）
 *
 * 合法转移关系由 `@peluvida/shared` 唯一裁定（`listBookingActionsFrom` ⇒
 * `BOOKING_ACTION_META` ⇒ `BOOKING_STATUS_TRANSITIONS`，三者有模块加载期守卫），
 * 本函数只是「值域 + 已派生映射」的组装，不新增任何规则。
 *
 * @param status    当前状态
 * @param canAction 可选的第二维度过滤（通常传 `(a) => hasPerm(bookingActionPermission(a))`）
 */
export function bookingActionsForStatus(
  status: string | null | undefined,
  canAction?: (action: BookingAction) => boolean
): BookingAction[] {
  if (!status) return [];
  const actions = listBookingActionsFrom(status as BookingStatus);
  return canAction ? actions.filter((action) => canAction(action)) : [...actions];
}

/**
 * 取消计费档位 → 文案 key
 *
 * 档位是服务端裁定的**事实**（`feeRule.policy`），前端只负责多语言；不解析
 * `feeRule.description`（那是服务端自述文案，仅当 `policy` 落在已知值域之外时兜底）。
 */
const BOOKING_CANCEL_FEE_LABEL_KEYS: Record<string, string> = {
  free: "booking.cancel.policyFree",
  charged: "booking.cancel.policyCharged",
  review: "booking.cancel.policyReview",
};

/** 计费档位 → i18n key（未知档位回落 `booking.cancel.policyUnknown`） */
export function bookingCancelFeeLabelKey(policy: string | null | undefined): string {
  if (!policy) return "booking.cancel.policyUnknown";
  return BOOKING_CANCEL_FEE_LABEL_KEYS[policy] ?? "booking.cancel.policyUnknown";
}

/**
 * 读取接口错误的 `details`（`ApiError.payload.details`）
 *
 * 请求层把后端信封原样挂在 `payload` 上；`details` 只在调用方显式携带时出现
 * ⇒ 一律做形状守卫（非对象返回 `null`），调用方据此决定「就地纠正」还是走通用提示。
 */
function readErrorDetails(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") return null;
  const details = (payload as { details?: unknown }).details;
  if (!details || typeof details !== "object") return null;
  return details as Record<string, unknown>;
}

/**
 * 从冲突类错误的 `details` 还原容量校验出参（`30001 BOOKING_SLOT_CONFLICT`）
 *
 * 🔴 形状与 `POST /bookings/capacity-check` 出参**同形**（后端刻意复用同一聚合器，
 * `conflicts` / `suggestions` / `window` 逐字对齐）⇒ 页面可以拿同一套 `capacity.*`
 * 文案渲染「确认被容量拒绝」与「创建前预校验失败」两种场景，不写两份展示逻辑。
 *
 * 形状不符（缺 `conflicts` 数组）时返回 `null`：宁可退化成通用错误提示，也不渲染
 * 半截面板。
 */
export function readBookingConflictDetails(payload: unknown): BookingCapacityCheckResult | null {
  const details = readErrorDetails(payload);
  if (!details) return null;
  if (!Array.isArray(details.conflicts)) return null;
  return {
    available: details.available === true,
    conflicts: details.conflicts,
    suggestions: Array.isArray(details.suggestions) ? details.suggestions : [],
    window: (details.window ?? {
      startHour: 0,
      endHour: 0,
      stepMinutes: 30,
    }) as BookingCapacityCheckResult["window"],
  } as BookingCapacityCheckResult;
}

/** 从流转失败错误的 `details` 还原判据字段（`30002` / `30003` 用） */
export function readBookingTransitionDetails(
  payload: unknown
): BookingTransitionErrorDetails | null {
  const details = readErrorDetails(payload);
  if (!details) return null;
  return details as BookingTransitionErrorDetails;
}
