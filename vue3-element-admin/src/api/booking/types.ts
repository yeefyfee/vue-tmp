/**
 * 预约（Booking）类型定义（MVP-WEB-06-01 预约列表与状态展示 / 06-02 创建表单 /
 * 06-03 预约日历 / 06-04 容量校验 / 06-05 状态流转 · 改期 · 取消）
 *
 * 契约来源：`niulai-nest/src/booking/booking.controller.ts`（P0-08-05）
 *  - `GET  /api/v1/bookings`                          预约分页列表（`booking:list`）
 *  - `GET  /api/v1/bookings/:id`                      预约详情（`booking:list`）
 *  - `GET  /api/v1/bookings/reference/staffs`         创建表单 · 员工下拉（`booking:create`）
 *  - `GET  /api/v1/bookings/reference/service-items`  创建表单 · 服务项下拉（`booking:create`）
 *  - `POST /api/v1/bookings`                          创建预约（`booking:create`）
 *  - `GET  /api/v1/bookings/calendar`                 预约日历（非分页；`booking:list`）
 *  - `POST /api/v1/bookings/calendar/conflict-check`  冲突检测（只读；`booking:list`）
 *  - `POST /api/v1/bookings/capacity-check`           容量预校验（只读；`booking:create`）
 *  - `POST /api/v1/bookings/:id/confirm`              确认预约（`booking:confirm`）
 *  - `POST /api/v1/bookings/:id/checkin`              到店登记（`booking:checkin`）
 *  - `POST /api/v1/bookings/:id/start`                开始服务（`booking:start`）
 *  - `POST /api/v1/bookings/:id/complete`             完成服务（`booking:complete`）
 *  - `POST /api/v1/bookings/:id/reschedule`           改期（`booking:reschedule`）
 *  - `POST /api/v1/bookings/:id/cancel`               取消（`booking:cancel`）
 *  - `POST /api/v1/bookings/:id/no-show`              标记爽约（`booking:no-show`）
 *
 * 状态值域**唯一来源**为 `@peluvida/shared` 的 `BookingStatus`
 * （snake_case 字符串，DB 列 `booking.status` VARCHAR(16) 存的就是它）；
 * 文案与语义色统一走共享的 `BOOKING_STATUS_META`，页面**不私写状态映射表**
 * （PRD《状态》硬要求 + 踩坑 126-bis 双源漂移）。
 *
 * 服务端会对每行**回查补齐**展示字段（`storeName` / `petName` / `petPhotoUrl` /
 * `customerName` / `employeeName` / `roomLabel`），关联实体缺失时为 `null`，
 * 前端需有兜底文案。
 */

import type { BookingAction, BookingStatus } from "@peluvida/shared";
import type { BaseQueryParams } from "@/api/common";

/**
 * 状态流转动作（**直接再导出**共享枚举，本文件不另立一份值域）
 *
 * 取值即端点路径段（`no-show` 用连字符），故 `POST /bookings/:id/${action}`
 * 可直接拼路径；动作 ↔ 状态转移的合法性判据也在 shared（`BOOKING_ACTION_META`
 * 带模块加载期守卫），前端只消费不复制。
 */
export type { BookingAction };

/** 预约分页查询参数（后端 `QueryBookingDto`，camelCase 口径） */
export interface BookingQueryParams extends BaseQueryParams {
  /** 归属门店 id（精确匹配） */
  storeId?: string;
  /** 预约状态（值域见 `@peluvida/shared` BookingStatus） */
  status?: BookingStatus;
  /** 宠物 id（精确匹配） */
  petId?: string;
  /** 客户（宠主）id（精确匹配） */
  customerId?: string;
  /** 指定员工 id（精确匹配） */
  employeeId?: string;
  /** 预约单号（前缀匹配） */
  bookingNo?: string;
  /** 预约日期起（含，`yyyy-MM-dd`） */
  bookingDateStart?: string;
  /** 预约日期止（含，`yyyy-MM-dd`） */
  bookingDateEnd?: string;
}

/**
 * 预约列表 / 详情行
 *
 * `storeName` 等 5 个字段为服务端回查值（非表列）；`tenantId` 为 BIGINT，
 * 经响应层序列化后为字符串，前端不消费故不声明。
 */
export interface BookingItem {
  id: string;
  storeId: string;
  customerId: string;
  petId: string;
  /** 服务项 id（🔴 本轮以**服务类目树的叶子节点**承载服务项语义，见后端 `BookingServiceItemOption`） */
  serviceId: string | null;
  /** 服务项名称快照 */
  serviceName: string | null;
  /** 业务单号（租户内唯一） */
  bookingNo: string;
  /** 预约日期（DATE，ISO 串，取日历日部分） */
  bookingDate: string;
  /** 预约时段开始（ISO 8601） */
  startTime: string;
  /** 预约时段结束（ISO 8601） */
  endTime: string;
  /** 指定员工 id（可空） */
  employeeId: string | null;
  /** 指定房间 id（可空） */
  roomId: string | null;
  /** 状态（snake_case） */
  status: BookingStatus;
  /** 改期前的关联预约 id（BR-1 互链，可空） */
  prevBookingId: string | null;
  /** 备注 */
  remark: string | null;
  createdAt: string;
  updatedAt: string;
  /** 乐观锁版本 */
  version: number;

  /* ── 服务端回查补齐的展示字段 ── */
  storeName: string | null;
  petName: string | null;
  /** 宠物头像 URL（预约日历卡片右上角「宠物名 + 头像」用；缺失为 null） */
  petPhotoUrl: string | null;
  customerName: string | null;
  employeeName: string | null;
  roomLabel: string | null;
}

/* ────────────────────────── MVP-WEB-06-02 预约创建表单 ────────────────────────── */

/**
 * 创建预约请求体（后端 `CreateBookingDto`，camelCase 口径）
 *
 * 契约要点（PRD《Booking API》·「创建请求参数」）：
 *  - **无 `customerId`**：客户由 `petId` 在服务端反查（`pet.owner_customer_id`），
 *    前端只做「客户 → 宠物」两级联动，不给调用方传错的机会；
 *  - `serviceId` 对应 PRD 的 `service_item_id`（DB 列即 `booking.service_id`）；
 *  - `roomId` 为**条件必填** —— 服务项 `catType === 3`（寄养）时必填，否则后端抛 `A0805`；
 *  - `startAt` 走**墙钟串** `yyyy-MM-dd HH:mm`（服务端按门店时区解释为瞬时）；
 *  - `durationMinutes` 缺省 60（服务时长字段属《服务管理》模块，尚未建模，见后端注释）。
 */
export interface CreateBookingPayload {
  /** 门店 id（uuid） */
  storeId: string;
  /** 宠物 id（uuid） */
  petId: string;
  /** 服务项 id（uuid；类目树叶子） */
  serviceId: string;
  /** 指定员工 id（可选） */
  employeeId?: string;
  /** 指定房间 id（寄养类必填） */
  roomId?: string;
  /** 开始时间（墙钟串 `yyyy-MM-dd HH:mm`） */
  startAt: string;
  /** 服务时长（分钟，可选，默认 60） */
  durationMinutes?: number;
  /** 备注（可选） */
  remark?: string;
}

/** 员工下拉项（`GET /bookings/reference/staffs`；不含手机号等敏感列） */
export interface BookingStaffOption {
  id: string;
  name: string;
  /** 主岗位：1 店长 / 2 美容师 / 3 洗护师 / 4 寄养员 / 5 前台 / 6 训练师 / 9 其他 */
  jobRole: number;
  storeId: string;
}

/** 服务项下拉项（`GET /bookings/reference/service-items`） */
export interface BookingServiceItemOption {
  id: string;
  name: string;
  /** 业务大类：1 洗护 / 2 美容 / 3 寄养 / 4 日托 / …（展示用） */
  catType: number;
  /**
   * 是否必须指定房间 —— 🔴 **由服务端裁定**（`catType === 3`）。
   *
   * 前端**不要**自行用 `catType === 3` 复算：同一条规则两处来源，任一侧调整即出现
   * 「表单不要求、提交被拒（A0805）」或反之（踩坑 126-bis）。
   */
  requiresRoom: boolean;
  /** 父类目 id（一级叶子为 null） */
  parentId: string | null;
  /** 父类目名（一级叶子为 null） */
  parentName: string | null;
  /** 下拉展示标签（一级叶子为自身名，二级叶子为「父 / 子」） */
  label: string;
}

/** 参考数据查询参数（员工 / 服务项下拉共用，均可选） */
export interface BookingReferenceQueryParams {
  /** 门店 id（收窄员工范围） */
  storeId?: string;
  /** 业务大类（收窄服务项范围） */
  catType?: number;
}

/* ────────────────────────── MVP-WEB-06-03 预约日历 ────────────────────────── */

/**
 * 日历视图模式（PRD《页面功能》预约日历三视图）
 *  - `day`      日视图：纵轴时段（30 分钟粒度）× 横轴资源
 *  - `week`     周视图：纵轴日期 × 横轴时段概览
 *  - `resource` 资源视图：按美容师 / 房间分组展示
 */
export type BookingCalendarView = "day" | "week" | "resource";

/** 日历查询参数（后端 `BookingCalendarQueryDto`；`storeId` 与窗口为必填） */
export interface BookingCalendarQueryParams {
  storeId: string;
  /** 窗口起（含，`yyyy-MM-dd`） */
  dateStart: string;
  /** 窗口止（含，`yyyy-MM-dd`；与起点跨度 ≤ 31 天，后端超限返回 A0808） */
  dateEnd: string;
  /** 指定员工（收窄） */
  employeeId?: string;
  /** 状态（收窄） */
  status?: BookingStatus;
  /** 服务业务大类（收窄） */
  catType?: number;
}

/**
 * 日历出参（**普通对象**，非分页信封 —— 对齐 lifecycle-stats 等聚合读侧端点）
 */
export interface BookingCalendarResult {
  /** 服务端回显的实际生效窗口 */
  range: { start: string; end: string };
  items: BookingItem[];
  /**
   * 「服务类型」筛选项（**服务端派生**自本租户一级服务类目，非前端写死枚举）
   * ⇒ 类目大类型是数据不是常量，抄一份即第二来源（踩坑 126-bis）。
   */
  serviceTypes: Array<{ value: number; label: string }>;
}

/** 冲突规则（与后端 `BOOKING_CONFLICT_RULES` 逐字对齐；文案由前端 i18n 派生） */
export type BookingConflictRule = "pet_overlap" | "resource_overload";

/** 冲突涉及的资源类型（`pet_overlap` 无资源维度 ⇒ 后端给 null） */
export type BookingResourceType = "employee" | "room";

/** 单条冲突明细（后端只回结构化事实，不回中文文案） */
export interface BookingConflictItem {
  rule: BookingConflictRule;
  resourceType: BookingResourceType | null;
  resourceId: string | null;
  /** 与候选时段重叠的既有预约 id / 单号 */
  bookingId: string;
  bookingNo: string;
}

/** 冲突检测出参 */
export interface BookingConflictCheckResult {
  hasConflict: boolean;
  conflicts: BookingConflictItem[];
}

/**
 * 冲突检测请求体（后端 `ConflictCheckDto`）
 *
 * `roomId` **不**因寄养类而必填（检测常在「还没挑房间」时先问宠物 / 员工是否冲突）；
 * `excludeBookingId` 供**改期**场景排除被拖动的单自身。
 */
export interface ConflictCheckPayload {
  storeId: string;
  petId: string;
  /**
   * 服务项 id（**可选**）
   *
   * 冲突几何只取决于「宠物 / 员工 / 房间 / 时间」，不依赖服务项；且既有演示预约
   * （`BK-DEMO-*`）的 `serviceId` 为 NULL ⇒ 传 `undefined` 时后端跳过服务项校验。
   */
  serviceId?: string;
  employeeId?: string;
  roomId?: string;
  /** 候选开始时间（墙钟串 `yyyy-MM-dd HH:mm`） */
  startAt: string;
  durationMinutes?: number;
  excludeBookingId?: string;
}

/* ───────────────────── MVP-WEB-06-04 容量校验 ───────────────────── */

/**
 * 单条容量冲突（后端 `BookingCapacityConflict`）
 *
 * 🔴 与 `BookingConflictItem`（冲突检测，**逐单**一条）**刻意不同形**：容量校验按
 * **资源聚合**一条，给出「差多少」（`limit` / `occupied`）与命中的**日期**
 * （房间逐日校验）。
 */
export interface BookingCapacityConflict {
  rule: BookingConflictRule;
  resourceType: BookingResourceType | null;
  resourceId: string | null;
  /** 资源展示名（员工名 / 房间标签；后端回查，缺失为 null） */
  resourceName: string | null;
  /** 该资源上限（员工并发上限 / 房间容量）；`pet_overlap` 为 null */
  limit: number | null;
  /** 已占用数（**不含**本次候选；`occupied + 1 > limit` 即冲突）；`pet_overlap` 为 null */
  occupied: number | null;
  /** 房间「逐日」校验命中的日期（`yyyy-MM-dd`）；员工与宠物维度为 null */
  date: string | null;
  bookingIds: string[];
  bookingNos: string[];
}

/** 「可替代时段」候选（与请求同时长、落在营业窗口格点上、且无冲突） */
export interface BookingCapacitySuggestion {
  /** 墙钟串 `yyyy-MM-dd HH:mm`（与请求 `startAt` 同口径，可直接回填表单） */
  startAt: string;
  endAt: string;
}

/**
 * 容量校验出参（后端 `BookingCapacityCheckResult`）
 *
 * `window` 由服务端**回显**（前端不私存这份营业窗口配置 ⇒ 一处判据一处来源）。
 */
export interface BookingCapacityCheckResult {
  available: boolean;
  conflicts: BookingCapacityConflict[];
  suggestions: BookingCapacitySuggestion[];
  window: {
    startHour: number;
    endHour: number;
    stepMinutes: number;
  };
}

/**
 * 容量校验请求体（后端 `CapacityCheckDto`）
 *
 * PRD《Booking API》：「容量预校验端点**请求体与创建一致**」⇒ 字段与
 * `CreateBookingPayload` 逐字对齐（`serviceId` **必填**、寄养类房间必填），
 * 仅多一个 `excludeBookingId`（改期 06-05 复跑同一校验时排除自身）。
 */
export interface CapacityCheckPayload {
  storeId: string;
  petId: string;
  serviceId: string;
  employeeId?: string;
  roomId?: string;
  /** 候选开始时间（墙钟串 `yyyy-MM-dd HH:mm`） */
  startAt: string;
  durationMinutes?: number;
  excludeBookingId?: string;
  remark?: string;
}

/* ───────────────── MVP-WEB-06-05 状态流转 / 改期 / 取消 ───────────────── */

/**
 * 状态流转通用请求体（后端 `BookingTransitionDto`）
 *
 * ⚠️ **不带 `status` 字段**：目标状态由端点路径唯一决定 —— 让调用方传目标状态
 * 等于给出「状态 + 端点」双源判据，两处不一致时以谁为准会变成扯皮
 * （后端注释同一口径）。
 */
export interface BookingTransitionPayload {
  /** 备注（可选，追加进 `booking.remark`） */
  remark?: string;
  /** 乐观锁版本（可选；传了即参与 CAS，过期则 30002 且 `details.reason = concurrent_modification`） */
  version?: number;
}

/**
 * 改期请求体（后端 `RescheduleBookingDto`）
 *
 * 🔴 门店 / 宠物 / 客户 / 服务项 / 员工**一律沿用原单**（不在请求体里给改错的机会）：
 * 只允许换「时间」与「房间」。
 */
export interface RescheduleBookingPayload {
  /** 新的开始时间（墙钟串 `yyyy-MM-dd HH:mm`，服务端按门店时区解释） */
  startAt: string;
  /**
   * 新房间（可选）
   *
   * 省略即**沿用原单房间**（服务端 `dto.roomId ?? row.roomId`）；寄养类
   * （`catType = 3`）服务端仍强制要求有房间（`requireFosterRoom`）。
   */
  roomId?: string;
  /** 改期原因（必填，≤255；会追加进原单备注并作为新单备注） */
  reason: string;
  /** 新时长（分钟，可选；省略则沿用原单实际时长 —— 寄养跨天不会被压扁） */
  durationMinutes?: number;
  /** 乐观锁版本（可选） */
  version?: number;
}

/**
 * 取消请求体（后端 `CancelBookingDto`）
 *
 * ⚠️ **宠主端窗口判据由请求头承载，不放请求体**：`X-Actor-Scope: owner` 由调用方
 * 在请求入口声明，放 body 等于让商家端可以自证「我是宠主」（后端注释同口径）。
 * 本轮 Web 端恒走员工口径，故本类型不含任何「身份」字段。
 */
export interface CancelBookingPayload {
  /** 取消原因（必填，≤255；追加进 `booking.remark`） */
  reason: string;
  /** 乐观锁版本（可选） */
  version?: number;
}

/** 取消计费档位（后端 `BOOKING_CANCEL_FEE_POLICIES`；文案由前端 i18n 派生） */
export type BookingCancelFeePolicy = "free" | "charged" | "review";

/**
 * 取消计费规则（后端 `BookingCancelFeeRule`）
 *
 * 🔴 档位**只由服务端裁定**（按门店 `cancelCutoffHours` + 平台紧窗口 2h + 剩余时间），
 * 前端不本地复算 —— 否则「页面提示免费、服务端按计费办」这类双源漂移必然出现
 * （踩坑 126-bis）。前端只按 `policy` 取文案。
 */
export interface BookingCancelFeeRule {
  policy: BookingCancelFeePolicy;
  /**
   * 距开始的小时数（一位小数）
   *
   * ⚠️ 类型必须放宽为 `number | string`：响应层把**非安全整数**的 number 序列化成
   * 字符串（踩坑 126），`952.9` 在 wire 上是 `"952.9"`（`952` 这类整数仍是 number）。
   */
  hoursBeforeStart: number | string;
  /** 门店取消截止（小时；平台默认 24） */
  cutoffHours: number;
  /** 平台紧窗口（小时，= 2） */
  tightWindowHours: number;
  /** 是否计费（`policy !== "free"`） */
  chargeable: boolean;
  /** 计费金额（分）；定价域未建模 ⇒ 恒 `null` */
  amountCents: number | null;
  /** 服务端自述文案（**仅作兜底**：常规渲染走 `policy` → i18n，见组件注释） */
  description: string;
}

/** 流转结果里的关联单指针（改期互链；仅 id 与单号） */
export interface BookingLinkRef {
  id: string;
  bookingNo: string;
}

/**
 * 状态流转统一出参（后端 `BookingTransitionResult`，7 个动作同形）
 *
 * 🔴 **刻意不做多态**：前端拿到结果即可**就地刷新抽屉**（`booking`）并据 `action` /
 * `nextBooking` 决定后续提示，无需再补一次 `GET /bookings/:id`（多一次请求既撞
 * IP 限流，也会读到流转后的新状态而与本动作的 `fromStatus` 对不上）。
 */
export interface BookingTransitionResult {
  /** 流转后的预约（**改期时为承担新时段的新单**，其余动作为本单） */
  booking: BookingItem;
  /** 本次动作 */
  action: BookingAction;
  /** 动作**前**的状态 */
  fromStatus: BookingStatus;
  /** 动作**后**的状态（= `booking.status`） */
  toStatus: BookingStatus;
  /** 本次生成的关联新单（**仅改期**有值） */
  nextBooking: BookingLinkRef | null;
  /** 被本次动作置为终态的旧单（**仅改期**有值 = 原单） */
  previousBooking: BookingLinkRef | null;
  /** 取消计费规则（**仅取消**有值） */
  feeRule: BookingCancelFeeRule | null;
}

/**
 * 状态流转失败的 `details` 形状（`ApiError.payload.details`）
 *
 * 只声明前端会消费的两个字段：`current_status`（30002 时用于就地纠正按钮）
 * 与 `reason`（`concurrent_modification` ⇒ 提示刷新）。冲突明细的 details 形状
 * 与 `BookingCapacityCheckResult` 同形（30001），复用该类型。
 */
export interface BookingTransitionErrorDetails {
  current_status?: BookingStatus;
  action?: BookingAction;
  reason?: string;
  required_role?: string;
  reschedule_count?: number;
  limit?: number;
}
