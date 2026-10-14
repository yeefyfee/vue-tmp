import { Injectable, Logger } from "@nestjs/common";
import { Prisma, type Booking } from "@prisma/client";

import { AuditAction, AuditEntityType, resolveStoreConfig } from "@peluvida/shared";
import type { TimelinePayloadBookingChanged } from "@peluvida/shared";
import {
  getBookingNotificationTrigger,
  SSE_TOPIC_BOOKING_NOTIFICATION,
  type BookingNotificationPayload,
} from "@peluvida/shared";
import { AuditLogService } from "../common/audit/audit-log.service";
import { PrismaService } from "../common/prisma/prisma.service";
import { toBigInt } from "../common/prisma/prisma-ids";
import { RequestContext } from "../common/context/request-context";
import { DomainErrorCode } from "../common/enums/domain-error-code.enum";
import { ErrorCode } from "../common/enums/error-code.enum";
import { BusinessException } from "../common/exceptions/business.exception";
import {
  addDays,
  formatDateTimeInZone,
  parseWallClock,
  startOfDay,
  toDayString,
} from "../common/utils/date.util";
import { SseService } from "../message/sse.service";
import { TimelineWriteService } from "../pet/timeline-write.service";
import {
  BOOKING_ACTOR_SCOPE_OWNER,
  BOOKING_CALENDAR_MAX_RANGE_DAYS,
  BOOKING_CANCEL_FEE_POLICIES,
  BOOKING_CANCEL_TIGHT_WINDOW_HOURS,
  BOOKING_CONFLICT_RULES,
  BOOKING_DEFAULT_DURATION_MINUTES,
  BOOKING_DEFAULT_SORT_BY,
  BOOKING_EMPLOYEE_CONCURRENCY_LIMIT,
  BOOKING_FOSTER_CAT_TYPE,
  BOOKING_MANAGER_ROLE_CODE,
  BOOKING_NO_MAX_RETRY,
  BOOKING_NO_PREFIX,
  BOOKING_NO_SUFFIX_DIGITS,
  BOOKING_OCCUPANCY_TAKE_LIMIT,
  BOOKING_OCCUPYING_STATUSES,
  BOOKING_RESCHEDULE_CHAIN_LIMIT,
  BOOKING_RESCHEDULE_CHAIN_MAX_HOPS,
  BOOKING_RESOURCE_TYPES,
  BOOKING_SORTABLE_FIELDS,
  BOOKING_SUGGESTION_DAY_END_HOUR,
  BOOKING_SUGGESTION_DAY_START_HOUR,
  BOOKING_SUGGESTION_LIMIT,
  BOOKING_SUGGESTION_STEP_MINUTES,
  BOOKING_ACTION_META,
  BOOKING_TIMELINE_EVENT_NAMES,
  BookingAction,
  BookingStatus,
  isBookingActionAllowed,
  type BookingCancelFeePolicy,
  type BookingConflictRule,
  type BookingResourceType,
  type BookingSortableField,
  type BookingStatusValue,
} from "./booking.constants";
import { BookingCalendarQueryDto } from "./dto/booking-calendar-query.dto";
import { BookingTransitionDto } from "./dto/booking-transition.dto";
import { CancelBookingDto } from "./dto/cancel-booking.dto";
import { CapacityCheckDto } from "./dto/capacity-check.dto";
import { ConflictCheckDto } from "./dto/conflict-check.dto";
import { CreateBookingDto } from "./dto/create-booking.dto";
import { QueryBookingDto } from "./dto/query-booking.dto";
import { RescheduleBookingDto } from "./dto/reschedule-booking.dto";

/**
 * 预约列表行（`Booking` + 服务端补齐的展示字段）
 *
 * 为什么不改表：`booking` 只存关联 id 快照（无冗余名称列，`service_name` 除外），
 * 而列表页要让前台一眼看清「谁家宠物、哪个门店、哪位员工、哪间房」——故在服务端
 * **批量**回查（5 次 `in` 查询，非 N+1），保持既有 `{ data, page }` 出参形态不变。
 *
 * 关联实体缺失（历史脏数据 / 已物理清理）时补 `null`，前端须有兜底文案。
 */
export interface BookingListItem extends Booking {
  /** 门店名（回查；缺失为 null） */
  readonly storeName: string | null;
  /** 宠物名（回查；缺失为 null） */
  readonly petName: string | null;
  /**
   * 宠物头像 URL（回查；缺失为 null）
   *
   * 仅供预约日历卡片右上角显示「宠物名 + 头像」（PRD《页面功能》预约日历）；
   * 列表页不需要则不消费，无额外请求成本（与 `petName` 同一次 `in` 回查取回）。
   */
  readonly petPhotoUrl: string | null;
  /** 客户（宠主）名（回查；缺失为 null） */
  readonly customerName: string | null;
  /** 指定员工名（回查；未指定或缺失为 null） */
  readonly employeeName: string | null;
  /** 房间展示标签（roomNo / name 二选一，回查；未指定或缺失为 null） */
  readonly roomLabel: string | null;
}

/**
 * 员工下拉项（MVP-WEB-06-02 预约创建表单 · 参考数据）
 *
 * 只回传排期需要的四列，**不回传**手机号 / 身份证等敏感字段（最小暴露）。
 */
export interface BookingStaffOption {
  readonly id: string;
  readonly name: string;
  /** 主岗位：1 店长 / 2 美容师 / 3 洗护师 / 4 寄养员 / 5 前台 / 6 训练师 / 9 其他 */
  readonly jobRole: number;
  readonly storeId: string;
}

/**
 * 服务项下拉项（MVP-WEB-06-02 预约创建表单 · 参考数据）
 *
 * 🔴 语义裁决：`service_item` 表属《服务管理》模块尚未建模，本轮以
 * `service_category` **类目树的叶子节点**承载「服务项」（schema 注释原文：
 * 「两级树，叶子挂服务项」）⇒ `booking.service_id` 指向叶子类目 id，
 * `service_name` 存叶子名快照。服务项表落地后此处改为查该表，出参形状不变。
 */
export interface BookingServiceItemOption {
  readonly id: string;
  readonly name: string;
  /** 业务大类（1 洗护 / 2 美容 / 3 寄养 / …），前端据此判定「寄养类须选房间」 */
  readonly catType: number;
  /**
   * 是否必须指定房间（= `catType === BOOKING_FOSTER_CAT_TYPE`）。
   *
   * 🔴 **由服务端裁定**：「寄养 ⇒ 房间必填」这条规则在创建端（`createBooking`
   * 抛 `A0805`）与表单端（房间字段必填星号）都要用；若前端自行用 `catType === 3`
   * 复算，就形成同一判据的两个来源 —— 任一侧调整即出现「表单不要求、提交被拒」
   * 或反之（踩坑 126-bis）。故由服务端一次性给出布尔结论，前端只消费。
   */
  readonly requiresRoom: boolean;
  readonly parentId: string | null;
  /** 父类目名（一级叶子为 null） */
  readonly parentName: string | null;
  /** 下拉展示标签：一级叶子为自身名，二级叶子为「父 / 子」 */
  readonly label: string;
}

/**
 * 日历出参（MVP-WEB-06-03 预约日历）
 *
 * 非分页端点 ⇒ 出参是**普通对象**（对齐 `GET /customers/lifecycle-stats` /
 * `GET /pets/health-expiry-reminders` 的聚合读侧口径），不走分页信封。
 * `range` 回显实际生效窗口（便于前端确认「地址栏要求」与「服务端认可」一致）。
 */
export interface BookingCalendarResult {
  readonly range: { readonly start: string; readonly end: string };
  readonly items: BookingListItem[];
  /**
   * 「服务类型」筛选项（**服务端派生**，非前端写死枚举）
   *
   * 由本租户**一级服务类目**（`parentId = null`）派生：`value = catType`、`label = 类目名`
   * （种子里即「洗护美容」→ 1、「寄养」→ 3）。放在日历出参里而不是让前端抄一份
   * `catType` 枚举：类目大类型是**数据**不是常量，抄一份即「第二来源」（踩坑 126-bis）。
   * 也刻意**不**复用 `reference/service-items`（那是创建表单的端点、由 `booking:create`
   * 门控，而日历只需 `booking:list`）⇒ 避免「能看日历却取不到筛选项」的权限错配。
   */
  readonly serviceTypes: Array<{ readonly value: number; readonly label: string }>;
}

/**
 * 单条冲突明细（MVP-WEB-06-03 冲突检测）
 *
 * 只回**结构化事实**（规则 / 资源 / 命中的预约单号），**不回中文原因文案** ——
 * 文案由前端按 `rule` 走 i18n（同一判据不留给第二处来源，踩坑 126-bis）。
 */
export interface BookingConflictItem {
  readonly rule: BookingConflictRule;
  /** 冲突资源类型；`pet_overlap` 无资源维度，为 null */
  readonly resourceType: BookingResourceType | null;
  /** 冲突资源 id（员工 / 房间）；`pet_overlap` 为 null */
  readonly resourceId: string | null;
  /** 与候选时段重叠的既有预约 id / 单号（供前端展示「与 BK… 冲突」） */
  readonly bookingId: string;
  readonly bookingNo: string;
}

/** 冲突检测出参（MVP-WEB-06-03） */
export interface BookingConflictCheckResult {
  readonly hasConflict: boolean;
  readonly conflicts: BookingConflictItem[];
}

/**
 * 单条容量冲突（MVP-WEB-06-04 容量校验）
 *
 * 🔴 与 `BookingConflictItem`（06-03）**刻意不同形**：冲突检测回答「与哪些单重叠」，
 * 故**逐单**一条明细（前端要显示「与 BK… 冲突」）；容量校验回答「差多少」，
 * 故**按资源聚合**一条明细（给出 `limit` / `occupied` / 命中的日期）。
 * 两者共享同一份占用判定（`findOccupiedSlots`），只是**呈现粒度**不同。
 *
 * 仍只回结构化事实，不回中文文案 —— 文案由前端按 `rule` / `resourceType` 走 i18n
 * （同一判据不留给第二处来源，踩坑 126-bis）。
 */
export interface BookingCapacityConflict {
  readonly rule: BookingConflictRule;
  /** 冲突资源类型；`pet_overlap` 无资源维度，为 null */
  readonly resourceType: BookingResourceType | null;
  readonly resourceId: string | null;
  /** 资源展示名（员工名 / 房间标签；回查，缺失为 null），便于前端直接展示 */
  readonly resourceName: string | null;
  /** 该资源的上限（员工并发上限 / 房间容量）；`pet_overlap` 为 null */
  readonly limit: number | null;
  /** 已占用数（**不含**本次候选；`occupied + 1 > limit` 即冲突）；`pet_overlap` 为 null */
  readonly occupied: number | null;
  /** 房间「逐日」校验命中的日期（`yyyy-MM-dd`）；员工维度与宠物维度为 null */
  readonly date: string | null;
  /** 命中的既有预约（供前端展示「与哪些单冲突」） */
  readonly bookingIds: string[];
  readonly bookingNos: string[];
}

/** 「可替代时段」候选（与请求同时长、落在营业窗口格点上、且无冲突） */
export interface BookingCapacitySuggestion {
  /** 墙钟串 `yyyy-MM-dd HH:mm`（与请求 `startAt` 同口径） */
  readonly startAt: string;
  readonly endAt: string;
}

/**
 * 容量校验出参（MVP-WEB-06-04）
 *
 * 非分页端点 ⇒ **普通对象**出参（对齐 lifecycle-stats / calendar / health-expiry-reminders）。
 * `window` 原样回显建议窗口，前端据此渲染「建议时段」而不私存这份配置
 * （一处判据一处来源，踩坑 126-bis）。
 */
export interface BookingCapacityCheckResult {
  readonly available: boolean;
  readonly conflicts: BookingCapacityConflict[];
  readonly suggestions: BookingCapacitySuggestion[];
  /** 建议时段所依据的营业窗口（半开区间 `[startHour, endHour)`，步长分钟） */
  readonly window: {
    readonly startHour: number;
    readonly endHour: number;
    readonly stepMinutes: number;
  };
}

/** 占用行（`booking_time_slot` 读出的最小形状） */
interface OccupiedSlotRow {
  readonly bookingId: string;
  readonly startTime: Date;
  readonly endTime: Date;
}

/**
 * 预约引用解析结果（内部）
 *
 * 创建（`createBooking`）与冲突检测（`checkConflict`）共享**同一条引用校验链**：
 * 门店存在 → 宠物存在 → 服务项存在且启用 → （寄养按需）房间必填 → 房间存在且同店
 * → 员工存在且未离职 → 开始时间合法（含日历有效性回读）。
 * 抽成一个私有方法，避免「创建会拒、检测不拒」这类两处判据漂移（踩坑 126-bis）。
 */
interface ResolvedBookingRefs {
  readonly storeId: string;
  readonly petId: string;
  readonly ownerCustomerId: string;
  /** 服务项 id（冲突检测可不带服务项 ⇒ 可空；创建端必非空） */
  readonly serviceId: string | null;
  readonly serviceName: string | null;
  readonly roomId: string | null;
  /** 房间容量（冲突检测按容量判超载；未指定房间为 0） */
  readonly roomCapacity: number;
  readonly employeeId: string | null;
  readonly durationMinutes: number;
  readonly startTime: Date;
  readonly endTime: Date;
}

/** 引用校验输入（创建 DTO 与冲突检测 DTO 的交集） */
interface BookingRefsInput {
  readonly storeId: string;
  readonly petId: string;
  readonly serviceId?: string;
  readonly startAt: string;
  readonly durationMinutes?: number;
  readonly employeeId?: string;
  readonly roomId?: string;
}

/** 引用校验开关：创建端要求服务项必填 + 寄养必带房间；冲突检测两者都不要求 */
interface BookingRefsOptions {
  readonly requireService: boolean;
  readonly requireFosterRoom: boolean;
}

/**
 * Prisma 唯一约束冲突（P2002）判定。
 *
 * 用鸭子类型读 `code` 而非 `instanceof PrismaClientKnownRequestError`：
 * Prisma 各版本对错误类的导出路径有过调整，`instanceof` 会静默失效变成
 * 「永远不重试」的隐性缺陷。
 */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "P2002";
}

/**
 * 占用行 → 去重后的「占用者预约 id」序列。
 *
 * 占用行是 (预约 × 资源) 粒度，而容量判定要的是「同一时段有几个**预约**在占用」
 * ⇒ 必须先按 bookingId 去重（同一预约的 employee / room 两行只算一个占用者）。
 */
function uniqueBookingIds(rows: OccupiedSlotRow[]): string[] {
  return [...new Set(rows.map((row) => row.bookingId))];
}

/**
 * 「状态 CAS 未命中」的内部哨兵（**不外泄**）。
 *
 * 触发场景：读到的状态与写入时的状态不一致（两个请求同时流转同一单）；
 * 事务内抛它 → 事务回滚 → `runInTransitionTx` 捕获后**重新读取**当前状态、
 * 包装成业务码 30002 返回（`details.current_status` 是库里的真实值，
 * 而不是调用方手里那份过期快照）。
 *
 * 用独立类而不是 Error 字符串：既要能被 `instanceof` 精确识别（不受其它异常
 * 文案变化影响），又必须与业务异常区分开（业务异常要原样上抛）。
 */
class BookingTransitionCasError extends Error {
  constructor() {
    super("booking transition CAS missed");
    this.name = "BookingTransitionCasError";
  }
}

/** remark 列宽（VARCHAR(255)）；追加动作备注时按此截断 */
const BOOKING_REMARK_MAX_LENGTH = 255;

/**
 * 把动作备注**追加**到原 remark 之后（保留原文，`|` 连接）。
 *
 * 为什么写进 remark：取消 / 改期 / 爽约原因需要能被详情抽屉直接看到（现有
 * `GET /bookings/:id` 已出 remark），而不必为「读一条原因」新增读端点或让前端去拼
 * 审计日志。语义同 `customer-merge.service` 的 `buildMergedRemark`（追加而非覆盖）。
 *
 * 超长时**保留尾部**（最新动作优先），并按**码点**截断（`.slice` 会劈开代理对）。
 */
function appendBookingRemark(old: string | null, note: string): string {
  const merged = old && old.trim() !== "" ? `${old} | ${note}` : note;
  const points = Array.from(merged);
  return points.length > BOOKING_REMARK_MAX_LENGTH
    ? points.slice(points.length - BOOKING_REMARK_MAX_LENGTH).join("")
    : merged;
}

/** 简单流转的入参（`BookingTransitionDto` / `CancelBookingDto` 的结构交集） */
interface BookingTransitionInput {
  readonly remark?: string;
  readonly version?: number;
}

/* ─────────────────── MVP-WEB-06-05 状态流转出参 ─────────────────── */

/**
 * 取消计费规则（PRD《Booking API》取消段「响应返回 `fee_rule` 字段说明适用规则与金额」）。
 *
 * 🔴 **规则由服务端裁定**，前端只按 `policy` 取文案，**不自行用剩余小时数复算档位**
 * （踩坑 126-bis：同一判据不留两个来源）；`cutoffHours` 与 `tightWindowHours` 一并回显，
 * 使前端能把「为什么是这一档」如实讲清楚。
 *
 * ⚠️ **边界**：`amountCents` 恒为 `null` —— 计费金额依赖《服务管理》的服务定价
 * （`service_item` 未建模），本轮只回**规则档位**；金额落地后由服务端填这一格，
 * 出参形状不变。
 */
export interface BookingCancelFeeRule {
  /** 档位：free（免费取消）/ charged（按门店规则计费）/ review（转店长审核） */
  readonly policy: BookingCancelFeePolicy;
  /** 距服务开始的剩余小时（可为负；保留 1 位小数） */
  readonly hoursBeforeStart: number;
  /** 门店取消截止（小时）：免费 / 计费的分界（来自 `store.config.cancelCutoffHours`） */
  readonly cutoffHours: number;
  /** 紧窗口（小时）：计费 / 审核的分界，同时是宠主端自助取消的截止 */
  readonly tightWindowHours: number;
  /** 是否按门店规则计费（`policy !== free`） */
  readonly chargeable: boolean;
  /** 计费金额（**分**）。定价域未建模 ⇒ 恒 null */
  readonly amountCents: number | null;
  /** 人类可读说明（服务端裁定，前端直接展示） */
  readonly description: string;
}

/**
 * 状态流转统一出参（7 个动作同形）。
 *
 * 刻意不做成「有时返回详情、有时返回空」的多态：前端拿到结果即可**就地刷新抽屉**
 * （`booking`）并据 `action` / `nextBooking` 决定后续提示与跳转，无需再补一次
 * `GET /bookings/:id`（多一次请求 = 多一条限流风险，且会读到流转后的新状态而
 * 与本次动作的 fromStatus 对不上）。
 */
export interface BookingTransitionResult {
  /** 流转后的预约（**改期时为承担新时段的新单**，其余动作为本单） */
  readonly booking: BookingListItem;
  /** 本次动作（`@peluvida/shared` BookingAction；`no-show` 用连字符） */
  readonly action: string;
  /** 动作**前**的状态（前端据此提示「已确认 → 服务中」，也便于审计对账） */
  readonly fromStatus: string;
  /** 动作**后**的状态（= `booking.status`） */
  readonly toStatus: string;
  /** 本次生成的关联新单（**仅改期**有值） */
  readonly nextBooking: { id: string; bookingNo: string } | null;
  /** 被本次动作置为终态的旧单（**仅改期**有值 = 原单） */
  readonly previousBooking: { id: string; bookingNo: string } | null;
  /** 取消计费规则（**仅取消**有值） */
  readonly feeRule: BookingCancelFeeRule | null;
}

/** 改期链回溯结果 */
interface RescheduleChain {
  /** 已发生的改期次数（沿 prev_booking_id 向上回溯的步数） */
  readonly count: number;
}

/**
 * 预约服务（P0-08-05；MVP-WEB-06-01 预约列表与状态展示）
 *
 * 数据访问统一走 `prisma.scoped.booking`（租户隔离扩展自动注入 tenantId 条件，
 * RLS 兜底）；**业务代码绝不从请求参数读取 tenantId**。
 *
 * 契约口径（与 store / room / customer 域同构）：
 *  - 分页返回 `{ data, page: { pageNum, pageSize, total } }`，
 *    由全局 ResponseInterceptor 改写成 `list/total/page/page_size` 顶层扁平信封；
 *  - 所有入口一律过滤 `deletedAt: null`；
 *  - 排序走白名单（`booking.constants.ts`），非法 `sortBy` 静默回落默认值。
 *
 * 状态口径：`status` 存 snake_case 字符串（`@peluvida/shared` BookingStatus），
 * 出参即字符串，前端直接查共享的 `BOOKING_STATUS_META` 取文案与语义色
 * —— 服务端**不**额外产出「状态文案 / 颜色」字段，避免同一判据两处来源（踩坑 126-bis）。
 */
@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly timelineWrite: TimelineWriteService,
    private readonly sseService: SseService
  ) {}

  /**
   * 预约分页列表（MVP-WEB-06-01）
   *
   * 筛选：storeId / status / petId / customerId / employeeId / bookingNo（前缀）
   *      / 预约日期区间（闭区间，DATE 列走 UTC 午夜口径，对齐 store_calendar 先例）。
   * 排序：白名单字段 + ASC/DESC，默认 `bookingDate desc`。
   */
  async getBookingPage(query: QueryBookingDto) {
    const pageNum = Number(query.pageNum) > 0 ? Number(query.pageNum) : 1;
    const pageSize = Number(query.pageSize) > 0 ? Number(query.pageSize) : 20;

    const where: Prisma.BookingWhereInput = { deletedAt: null };
    if (query.storeId) where.storeId = query.storeId;
    if (query.status) where.status = query.status;
    if (query.petId) where.petId = query.petId;
    if (query.customerId) where.customerId = query.customerId;
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.bookingNo) where.bookingNo = { startsWith: query.bookingNo };

    const dateRange = this.buildBookingDateRange(query.bookingDateStart, query.bookingDateEnd);
    if (dateRange) where.bookingDate = dateRange;

    const sortBy = this.resolveSortField(query.sortBy);
    const order: Prisma.SortOrder = query.order?.toUpperCase() === "ASC" ? "asc" : "desc";
    // 二级排序键固定为 id，保证分页边界稳定（排序键可能有并列，如同日多单）
    const orderBy: Prisma.BookingOrderByWithRelationInput[] = [{ [sortBy]: order }, { id: "asc" }];

    const [list, total] = await Promise.all([
      this.prisma.scoped.booking.findMany({
        where,
        orderBy,
        skip: (pageNum - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.scoped.booking.count({ where }),
    ]);

    return {
      data: await this.attachDisplayFields(list),
      page: {
        pageNum,
        pageSize,
        total,
      },
    };
  }

  /**
   * 预约详情（MVP-WEB-06-01）；已软删记录视为不存在（A0801）
   */
  async getBookingDetail(id: string) {
    const booking = await this.prisma.scoped.booking.findFirst({
      where: { id, deletedAt: null },
    });
    if (!booking) {
      throw new BusinessException(ErrorCode.BOOKING_NOT_FOUND);
    }
    const [enriched] = await this.attachDisplayFields([booking]);
    return enriched;
  }

  /**
   * 创建预约（MVP-WEB-06-02 预约创建表单）
   *
   * 落库即 `pending`（PRD《Booking API》：「校验通过后创建预约初始为 pending」）。
   *
   * 引用校验链（任一失败即 400，全部走业务错误码而非裸 500）：
   *   门店存在 → 宠物存在（并反查宠主）→ 服务项存在且启用
   *   → 寄养类必须给房间 → 房间存在且属所选门店 → 员工存在且未离职
   *   → 开始时间合法（含日历有效性回读）→ 单号生成落库。
   *
   * 🔴 刻意**不做**容量校验：PRD 明确「容量预校验」是独立端点（`capacity-check`），
   *    归 MVP-WEB-06-04；本端点也不写 `booking_time_slot` 占用表（同属 06-04）。
   *    故 06-02 创建的预约**不占用时段**，`confirm` 的二次校验由 06-05 承接。
   *
   * 🔴 也不写宠物时间线：`@peluvida/shared` 的 `TimelineEventType` 只有
   *    CHECK_IN/CHECK_OUT/FEEDING/GROOMING/MEDICAL/WEIGHT/PHOTO/SYSTEM 八类，
   *    无预约事件类型 —— 造第二个映射即双源漂移（踩坑 126-bis），记为边界。
   */
  async createBooking(dto: CreateBookingDto): Promise<BookingListItem> {
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw new BusinessException(ErrorCode.TENANT_CONTEXT_MISSING);
    }
    const userId = RequestContext.getUserId();

    // 引用校验链与冲突检测共用（创建端：服务项必填 + 寄养必带房间）
    const refs = await this.resolveBookingRefs(dto, {
      requireService: true,
      requireFosterRoom: true,
    });

    // booking_date 是 DATE 列（UTC 午夜口径，对齐 store_calendar）：取墙钟日期分量
    const day = toDayString(refs.startTime);
    if (!day) {
      throw new BusinessException(ErrorCode.BOOKING_TIME_INVALID);
    }
    const bookingDate = new Date(`${day}T00:00:00.000Z`);

    const base: Omit<Prisma.BookingCreateInput, "bookingNo"> = {
      tenantId: BigInt(tenantId),
      storeId: refs.storeId,
      customerId: refs.ownerCustomerId,
      petId: refs.petId,
      serviceId: refs.serviceId,
      serviceName: refs.serviceName,
      bookingDate,
      startTime: refs.startTime,
      endTime: refs.endTime,
      employeeId: refs.employeeId,
      roomId: refs.roomId,
      status: BookingStatus.PENDING,
      remark: dto.remark ?? null,
      createdBy: toBigInt(userId),
      updatedBy: toBigInt(userId),
    };

    const created = await this.createWithUniqueBookingNo(refs.startTime, base);
    const [enriched] = await this.attachDisplayFields([created]);
    return enriched;
  }

  /* ─────────────── MVP-WEB-06-05 改期 / 取消 / 爽约与状态流转 ─────────────── */

  /**
   * 状态流转（7 个动作，统一出参 {@link BookingTransitionResult}）。
   *
   * 落地要点（逐条对 PRD《Booking API》「状态流转端点」+《预约管理》BR-1~BR-4）：
   *  1. **状态机守卫唯一来源** = shared 的 `BOOKING_ACTION_META` + `isBookingActionAllowed`
   *     （与 `BOOKING_STATUS_TRANSITIONS` 由模块加载期守卫绑定）⇒ 非法流转抛 30002，
   *     `details.current_status` 给出当前状态供前端刷新（PRD 明文）；
   *  2. **并发护栏** = 「读到的状态」作为 CAS 条件（`updateMany` where 带 status
   *     [+ 可选 version]）⇒ 两个请求同时流转只可能成功一个，失败方同样收到 30002
   *     并附带**重新读到**的当前状态（不是自己手里的过期值）；
   *  3. **审计**（`audit_log`，与状态写入**同事务**显式轨）= 「每次流转写操作人与时间戳」，
   *     审计失败即业务失败（防抵赖优先，对齐 `AuditLogService` 的双轨口径）；
   *  4. **时间线**（`timeline_event`，事务提交后最佳努力）= PRD 验收要点「预约关键动作
   *     全部写入宠物时间线」；失败只告警不回滚（权威留痕已在 ③）。
   *
   * ⚠️ 两处**边界**（判据不可得，不阻塞流程，待对应模块落地后补前置校验）：
   *  · `checkin` 的「寄养须先完成入住登记」依赖《寄养》`stay`（未建模）；
   *  · `complete` 的「已生成关联订单」依赖《订单》`order`（未建模）。
   */

  /** 确认预约（pending → confirmed；**容量二次校验**，冲突 30001） */
  async confirmBooking(id: string, dto: BookingTransitionDto): Promise<BookingTransitionResult> {
    const row = await this.loadTransitionTarget(id);
    // 先判状态机（非法状态不必浪费一次容量查询），再判容量（PRD：confirm 时二次校验）
    this.assertTransition(row, BookingAction.CONFIRM);

    // 排除自身：本单（pending 态仍占用资源）已在占用表里，不排除则必然「与自己冲突」
    const refs = await this.refsFromBooking(row);
    const conflicts = await this.collectCapacityConflicts(refs, row.id);
    if (conflicts.length > 0) {
      const suggestions = await this.suggestAlternatives(refs, row.id);
      // details 形状与 06-04 `capacity-check` 出参逐字一致 ⇒ 前端复用同一块冲突面板
      throw new BusinessException(DomainErrorCode.BOOKING_SLOT_CONFLICT, {
        available: false,
        conflicts,
        suggestions,
        window: this.capacityWindow(),
      });
    }

    return await this.applyTransition(row, BookingAction.CONFIRM, dto);
  }

  /** 到店登记（confirmed → in_service） */
  async checkInBooking(id: string, dto: BookingTransitionDto): Promise<BookingTransitionResult> {
    const row = await this.loadTransitionTarget(id);
    return await this.applyTransition(row, BookingAction.CHECKIN, dto);
  }

  /** 开始服务（confirmed → in_service；无需到店登记的直通路径） */
  async startBooking(id: string, dto: BookingTransitionDto): Promise<BookingTransitionResult> {
    const row = await this.loadTransitionTarget(id);
    return await this.applyTransition(row, BookingAction.START, dto);
  }

  /** 完成服务（in_service → completed） */
  async completeBooking(id: string, dto: BookingTransitionDto): Promise<BookingTransitionResult> {
    const row = await this.loadTransitionTarget(id);
    return await this.applyTransition(row, BookingAction.COMPLETE, dto);
  }

  /** 标记爽约（pending / confirmed → no_show） */
  async noShowBooking(id: string, dto: BookingTransitionDto): Promise<BookingTransitionResult> {
    const row = await this.loadTransitionTarget(id);
    return await this.applyTransition(row, BookingAction.NO_SHOW, dto, {
      auditAfter: { remark: dto.remark ?? null },
      remarkNote: dto.remark ? `[爽约] ${dto.remark}` : undefined,
    });
  }

  /**
   * 取消预约（pending / confirmed → cancelled；服务未开始）。
   *
   * 三条规则（PRD《Booking API》取消段 +《预约管理》BR-3）：
   *  · **已开始不可取消** → 30005（可改走爽约 / 异常流程）；
   *  · **响应回 `feeRule`** —— 档位按门店 `cancelCutoffHours`（免费/计费分界）与平台
   *    紧窗口分档；金额依赖服务定价（未建模）⇒ `amountCents` 恒 null；
   *  · **宠主端**（`X-Actor-Scope: owner`）仅允许 `confirmed` 且不晚于开始前紧窗口，
   *    否则 30004（PRD「超出窗口返回 30004」）。
   *
   * 「已关联未支付订单联动关闭」属订单域（未建模）⇒ 记边界。
   */
  async cancelBooking(
    id: string,
    dto: CancelBookingDto,
    actorScope?: string | null
  ): Promise<BookingTransitionResult> {
    const row = await this.loadTransitionTarget(id);
    this.assertTransition(row, BookingAction.CANCEL);

    const now = new Date();
    const store = await this.prisma.scoped.store.findFirst({
      where: { id: row.storeId },
      select: { config: true },
    });
    // 门店级取消截止（免费 / 计费分界）；脏数据由 resolveStoreConfig fail-safe 回落默认
    const { cancelCutoffHours } = resolveStoreConfig(store?.config);
    const feeRule = this.computeCancelFeeRule(row, cancelCutoffHours, now);

    // 服务已开始 ⇒ 不可取消（BR-3）
    if (row.startTime.getTime() <= now.getTime()) {
      throw new BusinessException(DomainErrorCode.BOOKING_CANCEL_AFTER_START, {
        current_status: row.status,
        start_at: row.startTime.toISOString(),
        hours_before_start: feeRule.hoursBeforeStart,
      });
    }

    // 宠主端：仅 confirmed 且不晚于开始前紧窗口（超出即 30004）
    if (actorScope === BOOKING_ACTOR_SCOPE_OWNER) {
      const withinOwnerWindow =
        row.status === BookingStatus.CONFIRMED &&
        feeRule.hoursBeforeStart > BOOKING_CANCEL_TIGHT_WINDOW_HOURS;
      if (!withinOwnerWindow) {
        throw new BusinessException(DomainErrorCode.BOOKING_CANCEL_WINDOW_EXCEEDED, {
          current_status: row.status,
          hours_before_start: feeRule.hoursBeforeStart,
          tight_window_hours: BOOKING_CANCEL_TIGHT_WINDOW_HOURS,
        });
      }
    }

    return await this.applyTransition(row, BookingAction.CANCEL, dto, {
      feeRule,
      remarkNote: `[取消] ${dto.reason}`,
      auditAfter: {
        reason: dto.reason,
        fee_policy: feeRule.policy,
        hours_before_start: feeRule.hoursBeforeStart,
        actor_scope: actorScope === BOOKING_ACTOR_SCOPE_OWNER ? "owner" : "staff",
      },
    });
  }

  /**
   * 改期（confirmed → rescheduled，同时**生成新单**承担新时段）。
   *
   * PRD 四步流程逐条落地：
   *  ① 新时段容量校验，失败 30001 + `suggestions`（details 形状同 `capacity-check`）；
   *  ② 原单置 `rescheduled` + 新单 `prev_booking_id` 互链（PRD 的 `rescheduled_from_id`
   *     在本仓即 `booking.prev_booking_id`，迁移 20261012120000 已落，不另加列）；
   *  ③ 累计改期超过 3 次需**店长角色**二次确认，否则 30003；
   *  ④ 写审计（旧单状态迁移 + 新单产生两条）+ 时间线（一个 `booking.rescheduled` 事件）。
   *
   * 🔴 **新单状态 = `confirmed`**（继承被改期的确认态）：改期只能从 `confirmed` 发起，
   * 把客户已确认的排期打回 `pending` 等于凭空多一轮审批（PRD 未要求），故在服务端裁定；
   * 该判据只此一处，前端不复制。
   *
   * ⚠️ 边界：PRD「寄养改房时 room_id 必填」在本仓按「寄养类（catType=3）必须有房间」
   * 统一校验（`requireFosterRoom`）；非寄养单带 `roomId` 亦允许（日托/训练可用房）。
   */
  async rescheduleBooking(id: string, dto: RescheduleBookingDto): Promise<BookingTransitionResult> {
    const row = await this.loadTransitionTarget(id);
    this.assertTransition(row, BookingAction.RESCHEDULE);

    // ③ 累计改期次数（沿 prev_booking_id 回溯；脏数据成环有步数上限保护）
    const { count: rescheduleCount } = await this.countRescheduleChain(row);
    if (rescheduleCount >= BOOKING_RESCHEDULE_CHAIN_LIMIT && !this.isManagerOrRoot()) {
      throw new BusinessException(DomainErrorCode.BOOKING_RESCHEDULE_LIMIT_EXCEEDED, {
        reschedule_count: rescheduleCount,
        limit: BOOKING_RESCHEDULE_CHAIN_LIMIT,
        required_role: BOOKING_MANAGER_ROLE_CODE,
      });
    }

    // 新时段引用校验（门店/宠物/服务项/员工沿用本单；时间与房间可换）
    const refs = await this.resolveBookingRefs(
      {
        storeId: row.storeId,
        petId: row.petId,
        serviceId: row.serviceId ?? undefined,
        startAt: dto.startAt,
        durationMinutes: dto.durationMinutes ?? this.durationOf(row),
        employeeId: row.employeeId ?? undefined,
        roomId: dto.roomId ?? row.roomId ?? undefined,
      },
      // 服务项沿用本单（演示数据无 serviceId）⇒ 不强制；寄养必带房间同创建端口径
      { requireService: false, requireFosterRoom: true }
    );

    // ① 新时段容量校验（排除自身：原单占用的是**旧**时段，不该算进新时段的冲突）
    const conflicts = await this.collectCapacityConflicts(refs, row.id);
    if (conflicts.length > 0) {
      const suggestions = await this.suggestAlternatives(refs, row.id);
      throw new BusinessException(DomainErrorCode.BOOKING_SLOT_CONFLICT, {
        available: false,
        conflicts,
        suggestions,
        window: this.capacityWindow(),
      });
    }

    const tenantId = this.requireTenant();
    const userId = RequestContext.getUserId();
    const day = toDayString(refs.startTime);
    if (!day) {
      throw new BusinessException(ErrorCode.BOOKING_TIME_INVALID);
    }
    const bookingDate = new Date(`${day}T00:00:00.000Z`);

    const created = await this.runInTransitionTx(tenantId, BookingAction.RESCHEDULE, async (tx) => {
      // ②-1 原单 → rescheduled（CAS：状态 + 租户 + 未软删 [+ version]）
      const cas = await tx.booking.updateMany({
        where: {
          id: row.id,
          tenantId: BigInt(tenantId),
          deletedAt: null,
          status: row.status,
          ...(dto.version !== undefined ? { version: dto.version } : {}),
        },
        data: {
          status: BookingStatus.RESCHEDULED,
          remark: appendBookingRemark(row.remark, `[改期] ${dto.reason}`),
          updatedBy: toBigInt(userId),
          version: { increment: 1 },
        },
      });
      if (cas.count === 0) throw new BookingTransitionCasError();

      // ②-2 新单（沿用门店/客户/宠物/服务项与员工；新时段 + 新房间；prev 互链）
      const base: Omit<Prisma.BookingCreateInput, "bookingNo"> = {
        tenantId: BigInt(tenantId),
        storeId: refs.storeId,
        customerId: refs.ownerCustomerId,
        petId: refs.petId,
        serviceId: refs.serviceId,
        serviceName: refs.serviceName,
        bookingDate,
        startTime: refs.startTime,
        endTime: refs.endTime,
        employeeId: refs.employeeId,
        roomId: refs.roomId,
        status: BookingStatus.CONFIRMED,
        prevBookingId: row.id,
        remark: dto.reason,
        createdBy: toBigInt(userId),
        updatedBy: toBigInt(userId),
      };
      const newBooking = await this.createWithUniqueBookingNo(refs.startTime, base, (data) =>
        tx.booking.create({ data })
      );

      // ②-3 审计两条：旧单状态迁移 + 新单产生（否则审计里查不到新单从哪来）
      await this.auditLogService.record(
        {
          entityType: AuditEntityType.BOOKING,
          entityId: row.id,
          action: AuditAction.UPDATE,
          before: { status: row.status },
          after: {
            status: BookingStatus.RESCHEDULED,
            action: BookingAction.RESCHEDULE,
            reason: dto.reason,
            newBookingId: newBooking.id,
            newBookingNo: newBooking.bookingNo,
            startAt: dto.startAt,
            rescheduleCount,
          },
        },
        tx
      );
      await this.auditLogService.record(
        {
          entityType: AuditEntityType.BOOKING,
          entityId: newBooking.id,
          action: AuditAction.CREATE,
          before: null,
          after: {
            bookingNo: newBooking.bookingNo,
            status: newBooking.status,
            prevBookingId: row.id,
            startTime: newBooking.startTime.toISOString(),
            endTime: newBooking.endTime.toISOString(),
            roomId: newBooking.roomId,
          },
        },
        tx
      );

      return newBooking;
    });

    // ④ 时间线（一个动作一条事件；改期事件额外带新单指针）
    await this.writeBookingTimeline(row, BookingAction.RESCHEDULE, created.status, {
      reason: dto.reason,
      newBookingId: created.id,
      newBookingNo: created.bookingNo,
    });

    // ⑤ SSE 通知派发（MVP-WEB-06-06）
    await this.dispatchBookingNotification(row, BookingAction.RESCHEDULE);

    const [enriched] = await this.attachDisplayFields([created]);
    return {
      booking: enriched,
      action: BookingAction.RESCHEDULE,
      fromStatus: row.status,
      toStatus: created.status,
      nextBooking: { id: created.id, bookingNo: created.bookingNo },
      previousBooking: { id: row.id, bookingNo: row.bookingNo },
      feeRule: null,
    };
  }

  /* ── 状态流转内部工具 ── */

  /** 载入待流转的预约（软删视为不存在 → A0801，对齐详情端口径） */
  private async loadTransitionTarget(id: string): Promise<Booking> {
    const row = await this.prisma.scoped.booking.findFirst({ where: { id, deletedAt: null } });
    if (!row) {
      throw new BusinessException(ErrorCode.BOOKING_NOT_FOUND);
    }
    return row;
  }

  /** 状态机守卫：来源状态不允许该动作 ⇒ 30002（`details.current_status` 供前端刷新） */
  private assertTransition(row: Booking, action: BookingAction): void {
    if (!isBookingActionAllowed(row.status as BookingStatusValue, action)) {
      throw new BusinessException(DomainErrorCode.BOOKING_INVALID_TRANSITION, {
        current_status: row.status,
        action,
        allowed_from: BOOKING_ACTION_META[action].from,
      });
    }
  }

  /** 取当前租户（缺失 fail-closed，与全模块口径一致） */
  private requireTenant(): string {
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw new BusinessException(ErrorCode.TENANT_CONTEXT_MISSING);
    }
    return tenantId;
  }

  /** 调用方是否具备「改期超限二次确认」资格（PRD：店长；超管直放） */
  private isManagerOrRoot(): boolean {
    const user = RequestContext.getCurrentUser();
    if (!user) return false;
    if (user.isRoot) return true;
    return (user.roles ?? []).includes(BOOKING_MANAGER_ROLE_CODE);
  }

  /** 容量建议的营业窗口（与 `checkCapacity` 出参同源，前端不私存） */
  private capacityWindow() {
    return {
      startHour: BOOKING_SUGGESTION_DAY_START_HOUR,
      endHour: BOOKING_SUGGESTION_DAY_END_HOUR,
      stepMinutes: BOOKING_SUGGESTION_STEP_MINUTES,
    };
  }

  /** 预约时长（分钟；用于改期时沿用原时长） */
  private durationOf(row: Booking): number {
    return Math.max(1, Math.round((row.endTime.getTime() - row.startTime.getTime()) / 60_000));
  }

  /**
   * 由**已存在的预约**还原容量校验所需的引用集合。
   *
   * 与 `resolveBookingRefs` 的分工：后者面向「请求体里的候选排期」（要解析墙钟串、
   * 校验引用链），前者面向「库里已有的排期」（时间与时长取**实际值**，不按
   * `durationMinutes` 重算 —— 寄养单跨天，重算会把 3 天压成 1 小时）。
   */
  private async refsFromBooking(row: Booking): Promise<ResolvedBookingRefs> {
    let roomCapacity = 0;
    if (row.roomId) {
      const room = await this.prisma.scoped.room.findFirst({
        where: { id: row.roomId, deletedAt: null },
        select: { capacity: true },
      });
      roomCapacity = room?.capacity ?? 0;
    }
    return {
      storeId: row.storeId,
      petId: row.petId,
      ownerCustomerId: row.customerId,
      serviceId: row.serviceId,
      serviceName: row.serviceName,
      roomId: row.roomId,
      roomCapacity,
      employeeId: row.employeeId,
      durationMinutes: this.durationOf(row),
      startTime: row.startTime,
      endTime: row.endTime,
    };
  }

  /**
   * 取消计费规则（服务端**唯一**裁定点：档位由这里算，前端只按 `policy` 取文案）。
   *
   * 分档（`tight = 2h` 紧窗口，`cutoff = 门店取消截止`，平台默认 24h）：
   *  · `剩余 > max(cutoff, tight)` → `free`   免费取消
   *  · `剩余 > tight`              → `charged` 按门店规则计费
   *  · 其余（含已开始）             → `review`  转店长审核
   */
  private computeCancelFeeRule(row: Booking, cutoffHours: number, now: Date): BookingCancelFeeRule {
    const hoursBeforeStart =
      Math.round(((row.startTime.getTime() - now.getTime()) / 3_600_000) * 10) / 10;
    const tight = BOOKING_CANCEL_TIGHT_WINDOW_HOURS;

    let policy: BookingCancelFeePolicy;
    if (hoursBeforeStart > Math.max(cutoffHours, tight)) {
      policy = BOOKING_CANCEL_FEE_POLICIES.FREE;
    } else if (hoursBeforeStart > tight) {
      policy = BOOKING_CANCEL_FEE_POLICIES.CHARGED;
    } else {
      policy = BOOKING_CANCEL_FEE_POLICIES.REVIEW;
    }

    const description =
      policy === BOOKING_CANCEL_FEE_POLICIES.FREE
        ? `距开始 ${hoursBeforeStart} 小时（> ${Math.max(cutoffHours, tight)} 小时），可免费取消`
        : policy === BOOKING_CANCEL_FEE_POLICIES.CHARGED
          ? `距开始 ${hoursBeforeStart} 小时（≤ 门店取消截止 ${cutoffHours} 小时），按门店规则计费`
          : `距开始 ${hoursBeforeStart} 小时（≤ ${tight} 小时），需店长审核`;

    return {
      policy,
      hoursBeforeStart,
      cutoffHours,
      tightWindowHours: tight,
      chargeable: policy !== BOOKING_CANCEL_FEE_POLICIES.FREE,
      amountCents: null,
      description,
    };
  }

  /**
   * 回溯改期链，返回链上**已发生**的改期次数。
   *
   * 语义：`booking.prev_booking_id` 指向上一次改期的单 ⇒ 从当前单出发向上走，
   * 走过的步数就是「这张单是被改期过几次之后产生的」。步数上限
   * （`BOOKING_RESCHEDULE_CHAIN_MAX_HOPS`）+ 已访问集合双重防环（脏数据不至于把请求拖死）。
   */
  private async countRescheduleChain(row: Booking): Promise<RescheduleChain> {
    let cursor = row.prevBookingId;
    let count = 0;
    const seen = new Set<string>([row.id]);
    while (cursor && count < BOOKING_RESCHEDULE_CHAIN_MAX_HOPS) {
      if (seen.has(cursor)) break;
      seen.add(cursor);
      count += 1;
      const prev: { prevBookingId: string | null } | null =
        await this.prisma.scoped.booking.findFirst({
          where: { id: cursor },
          select: { prevBookingId: true },
        });
      cursor = prev?.prevBookingId ?? null;
    }
    return { count };
  }

  /**
   * 事务内执行一次状态流转写入（CAS + 审计），并统一把「CAS 未命中」转成 30002。
   *
   * 为什么用 `withTenantContext` 而不是 scoped 客户端：审计要与状态写入**同事务**
   * （显式轨），而 `AuditLogService.record(entry, tx)` 要求调用方提供事务客户端；
   * 事务内的租户隔离由 `set_config('app.tenant_id')`（GUC）+ RLS 承担，
   * 且本方法的每条语句都**显式**带 `tenantId` 条件，不依赖隐身注入。
   */
  private async runInTransitionTx<T>(
    tenantId: string,
    action: BookingAction,
    work: (tx: Prisma.TransactionClient) => Promise<T>
  ): Promise<T> {
    try {
      return await this.prisma.withTenantContext(tenantId, work);
    } catch (error) {
      if (error instanceof BookingTransitionCasError) {
        throw new BusinessException(DomainErrorCode.BOOKING_INVALID_TRANSITION, {
          action,
          reason: "concurrent_modification",
          hint: "该预约已被其它操作修改，请刷新后重试",
        });
      }
      throw error;
    }
  }

  /**
   * 简单流转（无派生单据的 6 个动作）：CAS 改状态 + 同事务审计 + 事后写时间线。
   */
  private async applyTransition(
    row: Booking,
    action: BookingAction,
    dto: BookingTransitionInput,
    extra?: {
      /** 追加到 remark 的动作备注（保留原文，`|` 连接） */
      remarkNote?: string;
      /** 审计 after 的附加字段（原因 / 规则档位等） */
      auditAfter?: Record<string, unknown>;
      /** 取消计费规则（仅取消出参） */
      feeRule?: BookingCancelFeeRule;
    }
  ): Promise<BookingTransitionResult> {
    const actionMeta = BOOKING_ACTION_META[action];
    this.assertTransition(row, action);

    const tenantId = this.requireTenant();
    const userId = RequestContext.getUserId();

    const updated = await this.runInTransitionTx(tenantId, action, async (tx) => {
      const cas = await tx.booking.updateMany({
        where: {
          id: row.id,
          tenantId: BigInt(tenantId),
          deletedAt: null,
          status: row.status,
          ...(dto.version !== undefined ? { version: dto.version } : {}),
        },
        data: {
          status: actionMeta.target,
          updatedBy: toBigInt(userId),
          version: { increment: 1 },
          ...(extra?.remarkNote
            ? { remark: appendBookingRemark(row.remark, extra.remarkNote) }
            : {}),
        },
      });
      if (cas.count === 0) throw new BookingTransitionCasError();

      await this.auditLogService.record(
        {
          entityType: AuditEntityType.BOOKING,
          entityId: row.id,
          action: AuditAction.UPDATE,
          before: { status: row.status },
          after: {
            status: actionMeta.target,
            action,
            ...(extra?.auditAfter ?? {}),
          },
        },
        tx
      );

      const fresh = await tx.booking.findFirst({
        where: { id: row.id, tenantId: BigInt(tenantId) },
      });
      if (!fresh) throw new BookingTransitionCasError();
      return fresh;
    });

    await this.writeBookingTimeline(row, action, updated.status, {
      reason: typeof extra?.auditAfter?.reason === "string" ? extra.auditAfter.reason : null,
    });

    await this.dispatchBookingNotification(row, action);

    const [enriched] = await this.attachDisplayFields([updated]);
    return {
      booking: enriched,
      action,
      fromStatus: row.status,
      toStatus: updated.status,
      nextBooking: null,
      previousBooking: null,
      feeRule: extra?.feeRule ?? null,
    };
  }

  /**
   * 写宠物时间线（**最佳努力**：失败只告警不回滚已提交的流转）。
   *
   * 为什么敢不阻断：权威留痕是与业务**同事务**的 `audit_log`（失败即业务失败），
   * 时间线是按宠物聚合的展示侧副本，平台对它的既定口径就是「最终一致、不阻断主流程」
   * （见 `TimelineWriteService.recordAsync` 的注释）。
   */
  private async writeBookingTimeline(
    row: Booking,
    action: BookingAction,
    toStatus: string,
    extra?: { reason?: string | null; newBookingId?: string; newBookingNo?: string }
  ): Promise<void> {
    const eventName = BOOKING_TIMELINE_EVENT_NAMES[action];
    const payload: TimelinePayloadBookingChanged = {
      bookingId: row.id,
      bookingNo: row.bookingNo,
      action,
      fromStatus: row.status,
      toStatus,
      reason: extra?.reason ?? null,
      ...(extra?.newBookingId ? { newBookingId: extra.newBookingId } : {}),
      ...(extra?.newBookingNo ? { newBookingNo: extra.newBookingNo } : {}),
    };
    try {
      await this.timelineWrite.recordSync({
        petId: row.petId,
        eventName,
        content: `${BOOKING_ACTION_META[action].label}：${row.bookingNo}`,
        payload: payload as unknown as Record<string, unknown>,
        refType: "booking",
        refId: row.id,
      });
    } catch (error) {
      this.logger.warn(
        `预约流转写时间线失败（已提交的状态变更不受影响）：booking=${row.bookingNo} action=${action} err=${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * 预约通知 SSE 派发（MVP-WEB-06-06）
   *
   * 状态流转成功后调用：
   * 1. 推送 dashboard 刷新信号（工作台列表需重取）
   * 2. 推送 booking-notification 事件（含场景码 + 预约号 + 宠物名）
   *
   * 推送失败不影响业务（best-effort，与时间线写入同原则）。
   */
  private async dispatchBookingNotification(row: Booking, action: BookingAction): Promise<void> {
    const tenantId = RequestContext.getTenantId();
    const trigger = getBookingNotificationTrigger(action);

    // dashboard 刷新信号（所有流转都推）
    this.sseService.sendDashboardChange(tenantId, `booking.${action}`, row.storeId);

    // 通知事件（有触发规则才推）
    if (trigger) {
      const pet = await this.prisma.scoped.pet.findFirst({
        where: { id: row.petId },
        select: { name: true },
      });
      const payload: BookingNotificationPayload = {
        scenario: trigger.scenario,
        bookingNo: row.bookingNo,
        petName: pet?.name ?? "",
        priority: trigger.priority,
        timestamp: Date.now(),
      };
      const username = RequestContext.getCurrentUser()?.username ?? "";
      if (username) {
        this.sseService.sendToUser(username, SSE_TOPIC_BOOKING_NOTIFICATION, payload);
      }
    }
  }

  /**
   * 日历读端点（MVP-WEB-06-03 预约日历）
   *
   * 与列表端点的分工：列表**分页**（每页 20，配白名单排序与地址栏还原）；日历要
   * **整窗**（日 / 周 / 资源三视图一次渲染，跨资源分组）⇒ 非分页，改用
   * `dateStart`~`dateEnd` 闭区间 + **窗口上限 31 天**（`BOOKING_CALENDAR_MAX_RANGE_DAYS`）
   * 兜底，避免无界扫描。
   *
   * 排序固定 `bookingDate asc, startTime asc, id asc`（日历按时间轴铺卡片，
   * 不提供排序参数；`id` 兜底保证同刻并列时顺序确定）。
   *
   * `catType` 筛选：`booking.service_id` 指向**服务类目树叶子**（`service_item`
   * 未建模，见 `BookingServiceItemOption` 的语义裁决）⇒ 先把该 `catType` 下的类目
   * id 全量取出，再 `serviceId in (...)`（单次 `in`，非 N+1）。
   */
  async getCalendar(query: BookingCalendarQueryDto): Promise<BookingCalendarResult> {
    const gte = this.parseUtcDate(query.dateStart);
    const lte = this.parseUtcDate(query.dateEnd);
    // 日历的窗口端点是**必填**参数 ⇒ 非法 / 溢出日期直接拒绝（不同于列表端点「静默忽略」）
    if (!gte || !lte) {
      throw new BusinessException(ErrorCode.BOOKING_TIME_INVALID);
    }
    const days = Math.floor((lte.getTime() - gte.getTime()) / 86_400_000) + 1;
    if (days < 1 || days > BOOKING_CALENDAR_MAX_RANGE_DAYS) {
      throw new BusinessException(ErrorCode.BOOKING_TIME_INVALID);
    }

    const where: Prisma.BookingWhereInput = {
      deletedAt: null,
      storeId: query.storeId,
      bookingDate: { gte, lte },
    };
    if (query.status) where.status = query.status;
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.catType) {
      const ids = await this.serviceIdsByCatType(query.catType);
      // 该大类下无任何服务项 ⇒ 用「不可能命中的 uuid」表达空集（`in: []` 语义在各版本
      // Prisma 间不一致，显式空集更稳）
      where.serviceId = { in: ids.length ? ids : ["00000000-0000-0000-0000-000000000000"] };
    }

    const rows = await this.prisma.scoped.booking.findMany({
      where,
      orderBy: [{ bookingDate: "asc" }, { startTime: "asc" }, { id: "asc" }],
    });

    return {
      range: { start: query.dateStart, end: query.dateEnd },
      items: await this.attachDisplayFields(rows),
      serviceTypes: await this.listServiceTypes(),
    };
  }

  /** 「服务类型」筛选项：本租户一级服务类目（`parentId = null`）→ `{ value: catType, label: name }` */
  private async listServiceTypes(): Promise<Array<{ value: number; label: string }>> {
    const roots = await this.prisma.scoped.serviceCategory.findMany({
      where: { deletedAt: null, parentId: null, status: 1 },
      select: { name: true, catType: true, sort: true },
      orderBy: [{ catType: "asc" }, { sort: "asc" }, { name: "asc" }],
    });
    const seen = new Set<number>();
    const options: Array<{ value: number; label: string }> = [];
    for (const row of roots) {
      if (seen.has(row.catType)) continue;
      seen.add(row.catType);
      options.push({ value: row.catType, label: row.name });
    }
    return options;
  }

  /**
   * 冲突检测（MVP-WEB-06-03 预约日历 · 拖拽改期的「落库前」把关）
   *
   * PRD《页面功能》预约日历：「冲突检测覆盖同一宠物时段重复、同一资源超载、员工排班
   * 空档三类规则，冲突时阻止保存并给出原因」。本轮实现前两类（见
   * `BOOKING_CONFLICT_RULES` 的边界说明：排班表未建模 ⇒ 第三类不可判）：
   *
   *  1. `pet_overlap`           同一宠物在重叠时段已有占用态预约；
   *  2. `resource_overload`     同员工（并发上限 `BOOKING_EMPLOYEE_CONCURRENCY_LIMIT`）
   *                             或同房间（占用数 ≥ `room.capacity`）超载。
   *
   * 重叠判定用**半开区间** `[start, end)`：`aStart < bEnd && bStart < aEnd`
   * —— 相邻排期（9:00–10:00 与 10:00–11:00）**不算**冲突，否则排期会被切不出连续档。
   *
   * 🔴 **两条规则的读取源刻意不同**（各自只有一个来源，踩坑 126-bis）：
   *  - `pet_overlap` 按 `booking` 预约事实读（宠物**不是占用表里的资源**，PRD 把
   *    `resource_type` 限定为 employee / room）；
   *  - `resource_overload` **按占用表 `booking_time_slot` 读**（MVP-WEB-06-04 起）——
   *    与 `capacity-check` 共享同一份占用判定（`findOccupiedSlots`）。占用表由
   *    `booking` 触发器维护「占用态才有行」，故「哪些状态占用资源」这条判据
   *    只存在于触发器一处，检测端不再重复现算。
   *
   * 🔴 **只读**：不写库、不加锁（PRD 明确「创建与校验之间不加锁」）；真正的落库前二次
   * 校验仍由写路径（06-05 改期 / confirm）在同一事务内复跑本逻辑。
   */
  async checkConflict(dto: ConflictCheckDto): Promise<BookingConflictCheckResult> {
    // 与创建端同一条引用校验链（两者都不要求：服务项可缺、寄养可先不挑房间）
    const refs = await this.resolveBookingRefs(dto, {
      requireService: false,
      requireFosterRoom: false,
    });
    const excludeId = dto.excludeBookingId ?? null;
    const conflicts: BookingConflictItem[] = [];

    // 规则 1：同一宠物时段重复（按预约事实）
    const petOverlaps = await this.findOverlapping(
      { petId: refs.petId },
      refs.startTime,
      refs.endTime,
      excludeId
    );
    for (const row of petOverlaps) {
      conflicts.push({
        rule: BOOKING_CONFLICT_RULES.PET_OVERLAP,
        resourceType: null,
        resourceId: null,
        bookingId: row.id,
        bookingNo: row.bookingNo,
      });
    }

    // 规则 2a：员工超载（按占用表）
    if (refs.employeeId) {
      const ids = uniqueBookingIds(
        await this.findOccupiedSlots(
          BOOKING_RESOURCE_TYPES.EMPLOYEE,
          refs.employeeId,
          refs.startTime,
          refs.endTime,
          excludeId
        )
      );
      if (ids.length >= BOOKING_EMPLOYEE_CONCURRENCY_LIMIT) {
        const noMap = await this.resolveBookingNos(ids);
        for (const id of ids) {
          conflicts.push({
            rule: BOOKING_CONFLICT_RULES.RESOURCE_OVERLOAD,
            resourceType: BOOKING_RESOURCE_TYPES.EMPLOYEE,
            resourceId: refs.employeeId,
            bookingId: id,
            bookingNo: noMap.get(id) ?? "",
          });
        }
      }
    }

    // 规则 2b：房间超载（按占用表；占用数 ≥ 房间容量）
    if (refs.roomId) {
      const ids = uniqueBookingIds(
        await this.findOccupiedSlots(
          BOOKING_RESOURCE_TYPES.ROOM,
          refs.roomId,
          refs.startTime,
          refs.endTime,
          excludeId
        )
      );
      if (ids.length >= Math.max(1, refs.roomCapacity)) {
        const noMap = await this.resolveBookingNos(ids);
        for (const id of ids) {
          conflicts.push({
            rule: BOOKING_CONFLICT_RULES.RESOURCE_OVERLOAD,
            resourceType: BOOKING_RESOURCE_TYPES.ROOM,
            resourceId: refs.roomId,
            bookingId: id,
            bookingNo: noMap.get(id) ?? "",
          });
        }
      }
    }

    return { hasConflict: conflicts.length > 0, conflicts };
  }

  /**
   * 容量预校验（MVP-WEB-06-04 容量校验 API）
   *
   * PRD《Booking API》：「容量预校验端点请求体与创建一致，响应返回 `available`、
   * `conflicts`（房间、员工、时段容量）与 `suggestions`（可替代时段列表）」。
   *
   * 校验规则落地（对齐 PRD《预约管理》FR-2 / BR-2 与《Booking API》「校验规则」）：
   *  1. **同一宠物时段重复** —— 宠物维度按预约事实判（见 `checkConflict` 的源说明）；
   *  2. **员工并发上限** —— 按占用表统计重叠占用的**不同预约数**，`occupied + 1 > 上限` 即冲突；
   *  3. **房间容量（逐日）** —— 寄养 / 日托跨天占用时，**逐日**统计该房当天并发占用数
   *     （`occupied + 1 > capacity` 即冲突），命中日期回填 `conflict.date`
   *     —— PRD「寄养按房间**逐日**校验占用」。
   *
   * ⚠️ **边界**：PRD 校验规则另提「日托与洗护按**服务项单时段容量上限**校验」，
   * 而该上限字段属《服务管理》的服务项（`service_item` 未建模，本轮以类目树叶子承载）
   * ⇒ 无判据可用，记为边界；落地后在 `collectCapacityConflicts` 内补一条规则即可
   * （出参形状不变）。「员工档期按**排班表**校验」同理（无 `shift` 表）。
   *
   * 🔴 **只读**：不写库、不加锁。PRD 明确「创建与校验之间不加锁，`confirm` 时二次校验」
   * ⇒ 真正的防超卖权威点在 06-05 的 confirm（同事务 + 行锁）。
   */
  async checkCapacity(dto: CapacityCheckDto): Promise<BookingCapacityCheckResult> {
    // 与创建端**逐字对齐**的引用校验链（服务项必填 + 寄养必带房间）
    const refs = await this.resolveBookingRefs(dto, {
      requireService: true,
      requireFosterRoom: true,
    });
    const excludeId = dto.excludeBookingId ?? null;

    const conflicts = await this.collectCapacityConflicts(refs, excludeId);
    // 冲突才给建议（无冲突时建议无意义，也省掉一轮查询）
    const suggestions = conflicts.length > 0 ? await this.suggestAlternatives(refs, excludeId) : [];

    return {
      available: conflicts.length === 0,
      conflicts,
      suggestions,
      window: {
        startHour: BOOKING_SUGGESTION_DAY_START_HOUR,
        endHour: BOOKING_SUGGESTION_DAY_END_HOUR,
        stepMinutes: BOOKING_SUGGESTION_STEP_MINUTES,
      },
    };
  }

  /** 汇总容量冲突（宠物 / 员工 / 房间三条规则，按资源聚合出参） */
  private async collectCapacityConflicts(
    refs: ResolvedBookingRefs,
    excludeId: string | null
  ): Promise<BookingCapacityConflict[]> {
    const conflicts: BookingCapacityConflict[] = [];

    // 规则 1：同一宠物时段重复（宠物维度不是占用表里的「资源」）
    const petOverlaps = await this.findOverlapping(
      { petId: refs.petId },
      refs.startTime,
      refs.endTime,
      excludeId
    );
    if (petOverlaps.length > 0) {
      conflicts.push({
        rule: BOOKING_CONFLICT_RULES.PET_OVERLAP,
        resourceType: null,
        resourceId: null,
        resourceName: null,
        limit: null,
        occupied: null,
        date: null,
        bookingIds: petOverlaps.map((row) => row.id),
        bookingNos: petOverlaps.map((row) => row.bookingNo),
      });
    }

    // 规则 2：员工并发上限（按占用表）
    if (refs.employeeId) {
      const ids = uniqueBookingIds(
        await this.findOccupiedSlots(
          BOOKING_RESOURCE_TYPES.EMPLOYEE,
          refs.employeeId,
          refs.startTime,
          refs.endTime,
          excludeId
        )
      );
      if (ids.length + 1 > BOOKING_EMPLOYEE_CONCURRENCY_LIMIT) {
        const [noMap, name] = await Promise.all([
          this.resolveBookingNos(ids),
          this.resolveStaffName(refs.employeeId),
        ]);
        conflicts.push({
          rule: BOOKING_CONFLICT_RULES.RESOURCE_OVERLOAD,
          resourceType: BOOKING_RESOURCE_TYPES.EMPLOYEE,
          resourceId: refs.employeeId,
          resourceName: name,
          limit: BOOKING_EMPLOYEE_CONCURRENCY_LIMIT,
          occupied: ids.length,
          date: null,
          bookingIds: ids,
          bookingNos: ids.map((id) => noMap.get(id) ?? ""),
        });
      }
    }

    // 规则 3：房间容量（逐日）
    if (refs.roomId) {
      const slots = await this.findOccupiedSlots(
        BOOKING_RESOURCE_TYPES.ROOM,
        refs.roomId,
        refs.startTime,
        refs.endTime,
        excludeId
      );
      const capacity = Math.max(1, refs.roomCapacity);
      for (const day of this.stayDays(refs.startTime, refs.endTime)) {
        const dayStart = startOfDay(day);
        if (!dayStart) continue;
        const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
        // 该日并发占用数（**逐日**口径：占用行与本日有交集即计入当天）
        const ids = uniqueBookingIds(
          slots.filter((row) => row.startTime < dayEnd && row.endTime > dayStart)
        );
        if (ids.length + 1 > capacity) {
          const [noMap, label] = await Promise.all([
            this.resolveBookingNos(ids),
            this.resolveRoomLabel(refs.roomId),
          ]);
          conflicts.push({
            rule: BOOKING_CONFLICT_RULES.RESOURCE_OVERLOAD,
            resourceType: BOOKING_RESOURCE_TYPES.ROOM,
            resourceId: refs.roomId,
            resourceName: label,
            limit: capacity,
            occupied: ids.length,
            date: day,
            bookingIds: ids,
            bookingNos: ids.map((id) => noMap.get(id) ?? ""),
          });
        }
      }
    }

    return conflicts;
  }

  /**
   * 「可替代时段」建议
   *
   * 口径：候选起点 = **请求当日**营业窗口内的 30 分钟格点（`[startHour, endHour)` 内
   * 且「起点 + 本次时长」不越窗），逐个用**已在内存里的当日占用集合**判定
   * （一次查询 + 内存扫描，不按候选点循环打库）；按与请求时刻的**距离升序**取前
   * `BOOKING_SUGGESTION_LIMIT` 条。
   *
   * ⚠️ **边界**：只给**当日**建议（PRD 未规定跨天搜索范围；跨天建议需要「逐日容量 + 营业
   * 例外」的完整营业时段模型）。当日无解时返回空数组，前端据此提示「当日无可用时段」。
   */
  private async suggestAlternatives(
    refs: ResolvedBookingRefs,
    excludeId: string | null
  ): Promise<BookingCapacitySuggestion[]> {
    const day = toDayString(refs.startTime);
    const winStart = startOfDay(refs.startTime);
    if (!day || !winStart) return [];
    const winEnd = new Date(winStart.getTime() + 24 * 60 * 60 * 1000);
    const durationMs = refs.endTime.getTime() - refs.startTime.getTime();

    const resourceIds = [refs.employeeId, refs.roomId].filter((v): v is string => !!v);
    const [daySlots, petRows] = await Promise.all([
      resourceIds.length
        ? this.prisma.scoped.bookingTimeSlot.findMany({
            where: {
              deletedAt: null,
              resourceId: { in: resourceIds },
              startTime: { lt: winEnd },
              endTime: { gt: winStart },
              ...(excludeId ? { bookingId: { not: excludeId } } : {}),
            },
            select: {
              resourceType: true,
              resourceId: true,
              bookingId: true,
              startTime: true,
              endTime: true,
            },
            orderBy: [{ startTime: "asc" }, { bookingId: "asc" }],
            take: BOOKING_OCCUPANCY_TAKE_LIMIT * 4,
          })
        : Promise.resolve(
            [] as Array<{
              resourceType: string;
              resourceId: string;
              bookingId: string;
              startTime: Date;
              endTime: Date;
            }>
          ),
      // 宠物维度的当日占用（建议同样不得与自己的另一单重叠）
      this.findOverlapping({ petId: refs.petId }, winStart, winEnd, excludeId),
    ]);

    const employeeSlots = refs.employeeId
      ? daySlots.filter((row) => row.resourceId === refs.employeeId)
      : [];
    const roomSlots = refs.roomId ? daySlots.filter((row) => row.resourceId === refs.roomId) : [];
    const roomCapacity = Math.max(1, refs.roomCapacity);

    const requested = refs.startTime.getTime();
    const candidates: Date[] = [];
    const openMinute = BOOKING_SUGGESTION_DAY_START_HOUR * 60;
    const closeMinute = BOOKING_SUGGESTION_DAY_END_HOUR * 60;
    const durationMinutes = Math.round(durationMs / 60_000);
    for (
      let minute = openMinute;
      minute + durationMinutes <= closeMinute;
      minute += BOOKING_SUGGESTION_STEP_MINUTES
    ) {
      candidates.push(new Date(winStart.getTime() + minute * 60_000));
    }

    const free = candidates.filter((start) => {
      const end = new Date(start.getTime() + durationMs);
      if (petRows.some((row) => row.startTime < end && row.endTime > start)) return false;
      if (
        employeeSlots.filter((row) => row.startTime < end && row.endTime > start).length + 1 >
        BOOKING_EMPLOYEE_CONCURRENCY_LIMIT
      ) {
        return false;
      }
      if (
        roomSlots.filter((row) => row.startTime < end && row.endTime > start).length + 1 >
        roomCapacity
      ) {
        return false;
      }
      return true;
    });

    return free
      .sort((a, b) => Math.abs(a.getTime() - requested) - Math.abs(b.getTime() - requested))
      .slice(0, BOOKING_SUGGESTION_LIMIT)
      .map((start) => ({
        startAt: this.toWallClockMinute(start),
        endAt: this.toWallClockMinute(new Date(start.getTime() + durationMs)),
      }));
  }

  /** 本次占用跨越的「自然日」序列（应用时区口径；结束时刻落在午夜整点时不占末日） */
  private stayDays(start: Date, end: Date): string[] {
    const first = toDayString(start);
    const last = toDayString(new Date(end.getTime() - 1));
    if (!first || !last) return [];
    const days: string[] = [];
    let cursor = first;
    while (cursor <= last && days.length < 400) {
      days.push(cursor);
      cursor = addDays(cursor, 1);
    }
    return days;
  }

  /** 瞬时 → 墙钟串 `yyyy-MM-dd HH:mm`（与请求 `startAt` 同口径，前端可直接回填表单） */
  private toWallClockMinute(value: Date): string {
    return (formatDateTimeInZone(value) ?? "").slice(0, 16);
  }

  /**
   * 读占用行（`booking_time_slot`）—— **容量判定的唯一读取入口**
   * （`conflict-check` 与 `capacity-check` 共用，避免两处判定漂移）。
   *
   * 半开区间重叠 `startTime < end && endTime > start`；`excludeId` 用于改期场景排除自身。
   * 占用表本身只含**占用态**行（释放态由 `booking` 触发器剔出）⇒ 此处不再按状态过滤。
   */
  private async findOccupiedSlots(
    resourceType: BookingResourceType,
    resourceId: string,
    start: Date,
    end: Date,
    excludeId: string | null
  ): Promise<OccupiedSlotRow[]> {
    return await this.prisma.scoped.bookingTimeSlot.findMany({
      where: {
        deletedAt: null,
        resourceType,
        resourceId,
        startTime: { lt: end },
        endTime: { gt: start },
        ...(excludeId ? { bookingId: { not: excludeId } } : {}),
      },
      select: { bookingId: true, startTime: true, endTime: true },
      orderBy: [{ startTime: "asc" }, { bookingId: "asc" }],
      take: BOOKING_OCCUPANCY_TAKE_LIMIT,
    });
  }

  /** 批量回查预约单号（占用行只存 booking_id；不含单号会让前端无从提示「与谁冲突」） */
  private async resolveBookingNos(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.scoped.booking.findMany({
      where: { id: { in: ids } },
      select: { id: true, bookingNo: true },
    });
    return new Map(rows.map((row) => [row.id, row.bookingNo] as const));
  }

  /** 员工名（容量冲突出参的展示名；缺失为 null） */
  private async resolveStaffName(id: string): Promise<string | null> {
    const row = await this.prisma.scoped.staff.findFirst({
      where: { id },
      select: { name: true },
    });
    return row?.name ?? null;
  }

  /** 房间展示标签（name 优先、回退 roomNo；缺失为 null） */
  private async resolveRoomLabel(id: string): Promise<string | null> {
    const row = await this.prisma.scoped.room.findFirst({
      where: { id },
      select: { roomNo: true, name: true },
    });
    return row ? (row.name ?? row.roomNo) : null;
  }

  /**
   * 共享引用校验链（创建 / 冲突检测）
   *
   * 顺序与语义对齐 `createBooking` 原实现（错误码不变）：
   *   门店 `A0802` → 宠物 `A0803` → 服务项 `A0804`（**带 `serviceId` 时**校验，
   *   且须 `status = 1`）→ （`requireFosterRoom` 时）寄养类必须给房间 `A0805`
   *   → 房间 `A0806`（须存在且属所选门店）→ 员工 `A0807`（须存在且非离职）
   *   → 时间 `A0808`（`parseBookingStart`，含日历有效性回读）。
   *
   * `opts.requireService`：创建端 `true`（无服务项即 `A0804`）；冲突检测端 `false`
   * （只算宠物 / 员工 / 房间 / 时间的交叠，不依赖服务项 —— 且 06-01 的演示预约
   * `service_id` 为 NULL，强求会让日历对既有数据不可用）。
   */
  private async resolveBookingRefs(
    input: BookingRefsInput,
    opts: BookingRefsOptions
  ): Promise<ResolvedBookingRefs> {
    const store = await this.prisma.scoped.store.findFirst({
      where: { id: input.storeId, deletedAt: null },
      select: { id: true },
    });
    if (!store) {
      throw new BusinessException(ErrorCode.BOOKING_STORE_INVALID);
    }

    // PRD 创建请求体**无** customer_id ⇒ 由宠物反查宠主（前端只做「客户 → 宠物」两级联动）
    const pet = await this.prisma.scoped.pet.findFirst({
      where: { id: input.petId, deletedAt: null },
      select: { id: true, ownerCustomerId: true },
    });
    if (!pet) {
      throw new BusinessException(ErrorCode.BOOKING_PET_INVALID);
    }

    let serviceId: string | null = null;
    let serviceName: string | null = null;
    let serviceCatType: number | null = null;
    if (input.serviceId) {
      const service = await this.prisma.scoped.serviceCategory.findFirst({
        where: { id: input.serviceId, deletedAt: null },
        select: { id: true, name: true, catType: true, status: true },
      });
      if (!service || service.status !== 1) {
        throw new BusinessException(ErrorCode.BOOKING_SERVICE_INVALID);
      }
      serviceId = service.id;
      serviceName = service.name;
      serviceCatType = service.catType;
    } else if (opts.requireService) {
      throw new BusinessException(ErrorCode.BOOKING_SERVICE_INVALID);
    }

    // 寄养类（catType=3）必须指定房间（PRD room_id 标为「条件」必填）—— 仅创建端要求
    if (opts.requireFosterRoom && serviceCatType === BOOKING_FOSTER_CAT_TYPE && !input.roomId) {
      throw new BusinessException(ErrorCode.BOOKING_ROOM_REQUIRED);
    }

    let roomId: string | null = null;
    let roomCapacity = 0;
    if (input.roomId) {
      const room = await this.prisma.scoped.room.findFirst({
        where: { id: input.roomId, deletedAt: null },
        select: { id: true, storeId: true, capacity: true },
      });
      // 房间必须存在且归属所选门店（跨店派房是排期错误，直接拒绝而非静默忽略）
      if (!room || room.storeId !== input.storeId) {
        throw new BusinessException(ErrorCode.BOOKING_ROOM_INVALID);
      }
      roomId = room.id;
      roomCapacity = room.capacity;
    }

    let employeeId: string | null = null;
    if (input.employeeId) {
      const staff = await this.prisma.scoped.staff.findFirst({
        where: { id: input.employeeId, deletedAt: null },
        select: { id: true, status: true },
      });
      // 离职（status=0）员工不可派单；请假（2）保留（可临时派单）
      if (!staff || staff.status === 0) {
        throw new BusinessException(ErrorCode.BOOKING_EMPLOYEE_INVALID);
      }
      employeeId = staff.id;
    }

    const startTime = this.parseBookingStart(input.startAt);
    if (!startTime) {
      throw new BusinessException(ErrorCode.BOOKING_TIME_INVALID);
    }
    const durationMinutes = input.durationMinutes ?? BOOKING_DEFAULT_DURATION_MINUTES;
    const endTime = new Date(startTime.getTime() + durationMinutes * 60_000);

    return {
      storeId: store.id,
      petId: pet.id,
      ownerCustomerId: pet.ownerCustomerId,
      serviceId,
      serviceName,
      roomId,
      roomCapacity,
      employeeId,
      durationMinutes,
      startTime,
      endTime,
    };
  }

  /**
   * 与候选时段重叠的**占用态**预约（冲突检测用）
   *
   * 半开区间重叠：`startTime < end && endTime > start`；`excludeId` 用于改期场景
   * 排除被拖动的单自身。`take` 兜底防极端脏数据（同资源同时段几十单）把响应撑爆。
   */
  private async findOverlapping(
    extra: Prisma.BookingWhereInput,
    start: Date,
    end: Date,
    excludeId: string | null
  ): Promise<Array<{ id: string; bookingNo: string; startTime: Date; endTime: Date }>> {
    return await this.prisma.scoped.booking.findMany({
      where: {
        ...extra,
        deletedAt: null,
        status: { in: [...BOOKING_OCCUPYING_STATUSES] },
        startTime: { lt: end },
        endTime: { gt: start },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      // 带上区间：容量校验的「建议时段」需要在内存里逐个候选点判重叠（不再打库）
      select: { id: true, bookingNo: true, startTime: true, endTime: true },
      orderBy: [{ startTime: "asc" }, { id: "asc" }],
      take: 50,
    });
  }

  /** 某业务大类（`service_category.cat_type`）下的全部类目 id（含父类目，叶子命中即可） */
  private async serviceIdsByCatType(catType: number): Promise<string[]> {
    const rows = await this.prisma.scoped.serviceCategory.findMany({
      where: { deletedAt: null, catType },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /**
   * 员工下拉（MVP-WEB-06-02 参考数据）
   *
   * 默认全租户在职员工，可按门店收窄。只回传排期必需字段（**不回传**手机号 /
   * 身份证等敏感列）；离职（status=0）排除，请假（2）保留。
   */
  async listReferenceStaffs(storeId?: string): Promise<BookingStaffOption[]> {
    return await this.prisma.scoped.staff.findMany({
      where: {
        deletedAt: null,
        status: { not: 0 },
        ...(storeId ? { storeId } : {}),
      },
      select: { id: true, name: true, jobRole: true, storeId: true },
      orderBy: [{ jobRole: "asc" }, { name: "asc" }],
    });
  }

  /**
   * 服务项下拉（MVP-WEB-06-02 参考数据）
   *
   * 取类目树的**叶子节点**且仅启用。叶子判定基于**全量未删行**的父子关系
   * （而非仅启用行）—— 否则某叶子停用后其父类目会被误判成叶子并出现在下拉里。
   */
  async listReferenceServiceItems(catType?: number): Promise<BookingServiceItemOption[]> {
    const all = await this.prisma.scoped.serviceCategory.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, catType: true, parentId: true, sort: true, status: true },
      orderBy: [{ catType: "asc" }, { sort: "asc" }, { name: "asc" }],
    });
    const parentIds = new Set(all.map((row) => row.parentId).filter((v): v is string => !!v));
    const rootNameMap = new Map(
      all.filter((row) => !row.parentId).map((row) => [row.id, row.name] as const)
    );
    return all
      .filter(
        (row) => row.status === 1 && !parentIds.has(row.id) && (!catType || row.catType === catType)
      )
      .map((row) => {
        const parentName = row.parentId ? (rootNameMap.get(row.parentId) ?? null) : null;
        return {
          id: row.id,
          name: row.name,
          catType: row.catType,
          // 「寄养 ⇒ 房间必填」的判据由服务端裁定，前端不自行复算（踩坑 126-bis）
          requiresRoom: row.catType === BOOKING_FOSTER_CAT_TYPE,
          parentId: row.parentId,
          parentName,
          label: parentName ? `${parentName} / ${row.name}` : row.name,
        };
      });
  }

  /**
   * 解析预约开始时间（墙钟串 → 真实瞬时）
   *
   * `parseWallClock` 对 `2026-02-31 09:30` 这类溢出日期会静默进位（`Date.UTC`
   * 允许溢出）⇒ 先用 `Date.UTC` 回读分量比对，拒绝日历上不存在的日期
   * （对齐列表侧 `parseUtcDate` 的回读校验口径）。
   */
  private parseBookingStart(value: string): Date | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6] ?? "0");
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    if (hour > 23 || minute > 59 || second > 59) return null;
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (
      probe.getUTCFullYear() !== year ||
      probe.getUTCMonth() !== month - 1 ||
      probe.getUTCDate() !== day
    ) {
      return null;
    }
    return parseWallClock(value);
  }

  /**
   * 生成业务单号：`BK` + 应用时区 `yyyyMMddHHmmss` + N 位随机数。
   *
   * 刻意**不使用**「当日计数 + 1」：计数会被软删打乱、且需要额外事务与重入保护；
   * 时间戳法无跨请求状态，唯一性由 `uk_booking_tenant_no` 兜底 + 有限重试保证。
   */
  private buildBookingNo(startTime: Date): string {
    const stamp = (formatDateTimeInZone(startTime) ?? "").replace(/[-: ]/g, "").slice(0, 14);
    const max = 10 ** BOOKING_NO_SUFFIX_DIGITS;
    const suffix = String(Math.floor(Math.random() * max)).padStart(BOOKING_NO_SUFFIX_DIGITS, "0");
    return `${BOOKING_NO_PREFIX}${stamp}${suffix}`;
  }

  /**
   * 落库；唯一约束冲突（P2002）时更换随机后缀重试，非唯一错误立即抛出。
   *
   * MVP-WEB-06-05 抽出 `create` 回调，使**改期**路径能在同一事务内（`tx.booking.create`）
   * 复用同一套单号重试策略 —— 否则改期要么绕开重试（可能撞 `uk_booking_tenant_no`），
   * 要么自己复制一份（两处单号策略 = 双源，踩坑 126-bis）。
   */
  private async createWithUniqueBookingNo(
    startTime: Date,
    base: Omit<Prisma.BookingCreateInput, "bookingNo">,
    create: (data: Prisma.BookingCreateInput) => Promise<Booking> = (data) =>
      this.prisma.scoped.booking.create({ data })
  ): Promise<Booking> {
    let lastError: unknown;
    for (let attempt = 0; attempt < BOOKING_NO_MAX_RETRY; attempt++) {
      try {
        return await create({ ...base, bookingNo: this.buildBookingNo(startTime) });
      } catch (error) {
        lastError = error;
        if (!isUniqueViolation(error)) throw error;
      }
    }
    throw lastError;
  }

  /**
   * 补齐列表展示字段（门店名 / 宠物名 / 客户名 / 员工名 / 房间标签）。
   *
   * 批量回查（5 次 `in` 查询，非 N+1）。名称回查**不过滤** `deletedAt`：关联对象可能
   * 在预约之后被软删（如房间停用、宠物档案归档），按未删过滤会让历史预约变成一串 UUID
   * （对齐 `pet-transfer.service.ts` 的既有口径）。
   */
  private async attachDisplayFields(rows: Booking[]): Promise<BookingListItem[]> {
    if (rows.length === 0) return [];

    const storeIds = [...new Set(rows.map((row) => row.storeId))];
    const petIds = [...new Set(rows.map((row) => row.petId))];
    const customerIds = [...new Set(rows.map((row) => row.customerId))];
    const employeeIds = [
      ...new Set(rows.map((row) => row.employeeId).filter((v): v is string => !!v)),
    ];
    const roomIds = [...new Set(rows.map((row) => row.roomId).filter((v): v is string => !!v))];

    const [stores, pets, customers, staff, rooms] = await Promise.all([
      this.prisma.scoped.store.findMany({
        where: { id: { in: storeIds } },
        select: { id: true, name: true },
      }),
      this.prisma.scoped.pet.findMany({
        where: { id: { in: petIds } },
        select: { id: true, name: true, photoUrl: true },
      }),
      this.prisma.scoped.customer.findMany({
        where: { id: { in: customerIds } },
        select: { id: true, name: true },
      }),
      employeeIds.length
        ? this.prisma.scoped.staff.findMany({
            where: { id: { in: employeeIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as Array<{ id: string; name: string }>),
      roomIds.length
        ? this.prisma.scoped.room.findMany({
            where: { id: { in: roomIds } },
            select: { id: true, roomNo: true, name: true },
          })
        : Promise.resolve([] as Array<{ id: string; roomNo: string; name: string | null }>),
    ]);

    const storeMap = new Map(stores.map((row) => [row.id, row.name]));
    const petMap = new Map(pets.map((row) => [row.id, row]));
    const customerMap = new Map(customers.map((row) => [row.id, row.name]));
    const staffMap = new Map(staff.map((row) => [row.id, row.name]));
    const roomMap = new Map(rooms.map((row) => [row.id, row]));

    return rows.map((row) => {
      const room = row.roomId ? roomMap.get(row.roomId) : undefined;
      const pet = petMap.get(row.petId);
      return {
        ...row,
        storeName: storeMap.get(row.storeId) ?? null,
        petName: pet?.name ?? null,
        petPhotoUrl: pet?.photoUrl ?? null,
        customerName: customerMap.get(row.customerId) ?? null,
        employeeName: row.employeeId ? (staffMap.get(row.employeeId) ?? null) : null,
        roomLabel: room ? (room.name ?? room.roomNo) : null,
      };
    });
  }

  /**
   * 预约日期区间（闭区间，DATE 列走 UTC 午夜口径）
   *
   * `booking_date` 是 DATE 列（无时间语义），应用层统一以 **UTC 午夜瞬时**承载
   * （对齐 `store_calendar` 的 `parseCalendarMonthRange` 先例），故区间端点用
   * `Date.UTC` 而非 `parseWallClock`（后者按应用时区解析，会把 00:00 变成前一日 16:00Z）。
   */
  private buildBookingDateRange(start?: string, end?: string): Prisma.DateTimeFilter | undefined {
    const gte = this.parseUtcDate(start);
    const lte = this.parseUtcDate(end);
    if (!gte && !lte) return undefined;
    return {
      ...(gte ? { gte } : {}),
      ...(lte ? { lte } : {}),
    } as Prisma.DateTimeFilter;
  }

  /** `yyyy-MM-dd` → UTC 午夜瞬时；非法输入返回 null（静默忽略该端点，不抛 400） */
  private parseUtcDate(value?: string): Date | null {
    if (!value) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const instant = new Date(Date.UTC(year, month - 1, day));
    // 回读校验，拒绝 2026-02-31 这类溢出日期
    if (
      instant.getUTCFullYear() !== year ||
      instant.getUTCMonth() !== month - 1 ||
      instant.getUTCDate() !== day
    ) {
      return null;
    }
    return instant;
  }

  /** 排序字段白名单解析，非法值回落默认值 */
  private resolveSortField(sortBy?: string): BookingSortableField {
    if (sortBy && (BOOKING_SORTABLE_FIELDS as readonly string[]).includes(sortBy)) {
      return sortBy as BookingSortableField;
    }
    return BOOKING_DEFAULT_SORT_BY;
  }
}
