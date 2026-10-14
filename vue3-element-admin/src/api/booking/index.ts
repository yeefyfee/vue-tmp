/**
 * 预约 API（MVP-WEB-06-01 预约列表与状态展示 / 06-02 预约创建表单 /
 * 06-03 预约日历 / 06-04 容量校验 / 06-05 状态流转 · 改期 · 取消）
 *
 * 契约来源：`niulai-nest/src/booking/booking.controller.ts`（P0-08-05）
 *  - `GET  /api/v1/bookings`                          预约分页列表（权限 `booking:list`）
 *  - `GET  /api/v1/bookings/:id`                      预约详情（权限 `booking:list`）
 *  - `GET  /api/v1/bookings/reference/staffs`         创建表单 · 员工下拉（`booking:create`）
 *  - `GET  /api/v1/bookings/reference/service-items`  创建表单 · 服务项下拉（`booking:create`）
 *  - `POST /api/v1/bookings`                          创建预约（`booking:create`）
 *  - `GET  /api/v1/bookings/calendar`                 预约日历（非分页；`booking:list`）
 *  - `POST /api/v1/bookings/calendar/conflict-check`  冲突检测（只读；`booking:list`）
 *  - `POST /api/v1/bookings/capacity-check`           容量预校验（只读；`booking:create`）
 *  - `POST /api/v1/bookings/:id/{confirm,checkin,start,complete,reschedule,cancel,no-show}`
 *                                                    状态流转（各动作**各一码**权限）
 *
 * ⚠️ 静态段端点（`calendar`、`calendar/conflict-check`、`capacity-check`、`reference/*`）
 * 在后端一律声明在 `:id` 之前（踩坑 37），前端调用路径不得拼成 `/bookings/calendar/:x`。
 * 状态流转端点比 `:id` 多一段（`/:id/<action>`）且方法为 POST ⇒ 不受该顺序约束。
 *
 * 未接：无（预约域端点已全部落地）。
 */

import request from "@/utils/request";
import type { PageResult } from "@/api/common";
import type {
  BookingAction,
  BookingCalendarQueryParams,
  BookingCalendarResult,
  BookingCapacityCheckResult,
  BookingConflictCheckResult,
  BookingItem,
  BookingQueryParams,
  BookingReferenceQueryParams,
  BookingServiceItemOption,
  BookingStaffOption,
  BookingTransitionPayload,
  BookingTransitionResult,
  CancelBookingPayload,
  CapacityCheckPayload,
  ConflictCheckPayload,
  CreateBookingPayload,
  RescheduleBookingPayload,
} from "./types";

const BOOKING_BASE_URL = "/api/v1/bookings";

/**
 * 状态流转请求的统一构造（7 个动作共用）
 *
 * URL 只在这里拼一次：动作值**就是**端点路径段（含 `no-show` 的连字符），
 * 故不存在「枚举值与端点不一致」的第二处来源。
 */
function postTransition(
  id: string,
  action: BookingAction,
  payload: BookingTransitionPayload | RescheduleBookingPayload | CancelBookingPayload
): Promise<BookingTransitionResult> {
  return request<unknown, BookingTransitionResult>({
    url: `${BOOKING_BASE_URL}/${id}/${action}`,
    method: "post",
    data: payload,
  });
}

const BookingAPI = {
  /**
   * 分页查询预约列表
   *
   * 筛选维度：storeId / status / petId / customerId / employeeId / bookingNo（前缀）
   *          / 预约日期区间（闭区间）。
   * 排序白名单：`bookingDate` / `startTime` / `createdAt` / `bookingNo` / `status`
   *（白名单外后端静默回落 `bookingDate`；服务端另有 `id` 二级排序键保证分页稳定）。
   */
  getPage(params: BookingQueryParams) {
    return request<unknown, PageResult<BookingItem>>({
      url: BOOKING_BASE_URL,
      method: "get",
      params,
    });
  },

  /** 查询预约详情（含门店 / 宠物 / 客户 / 员工 / 房间的展示字段） */
  getDetail(id: string) {
    return request<unknown, BookingItem>({
      url: `${BOOKING_BASE_URL}/${id}`,
      method: "get",
    });
  },

  /** 创建表单 · 员工下拉（可选按门店收窄；权限同创建） */
  getReferenceStaffs(params: BookingReferenceQueryParams = {}) {
    return request<unknown, BookingStaffOption[]>({
      url: `${BOOKING_BASE_URL}/reference/staffs`,
      method: "get",
      params,
    });
  },

  /** 创建表单 · 服务项下拉（类目树叶子；可选按业务大类收窄；权限同创建） */
  getReferenceServiceItems(params: BookingReferenceQueryParams = {}) {
    return request<unknown, BookingServiceItemOption[]>({
      url: `${BOOKING_BASE_URL}/reference/service-items`,
      method: "get",
      params,
    });
  },

  /**
   * 创建预约（初始状态 `pending`）
   *
   * ⚠️ 创建端点本身**不做容量校验**（PRD《Booking API》：「创建与校验之间不加锁，
   * `confirm` 时二次校验」）⇒ 表单在**提交前**显式调用 `checkCapacity` 预校验
   * （见 `BookingFormDialog`）；真正的落库前二次校验归 06-05 的 confirm。
   */
  create(payload: CreateBookingPayload) {
    return request<unknown, BookingItem>({
      url: BOOKING_BASE_URL,
      method: "post",
      data: payload,
    });
  },

  /**
   * 容量预校验（MVP-WEB-06-04）—— 只读：「这一次创建**能不能成**？」
   *
   * 请求体与创建一致（`serviceId` 必填）；返回 `available` / `conflicts`（按资源聚合，
   * 带 `limit` 与 `occupied`）/ `suggestions`（当日可替代时段）。
   * 仅**只读**：不写库、不占位（真正的防超卖在 06-05 的 confirm）。
   */
  checkCapacity(payload: CapacityCheckPayload) {
    return request<unknown, BookingCapacityCheckResult>({
      url: `${BOOKING_BASE_URL}/capacity-check`,
      method: "post",
      data: payload,
    });
  },

  /**
   * 预约日历（MVP-WEB-06-03）
   *
   * ⚠️ **非分页**（与 `getPage` 不同）：日历一次要「整窗」数据铺卡片，
   * 故出参是普通对象 `{ range, items }`；窗口跨度上限 31 天，超限后端返回 A0808。
   */
  getCalendar(params: BookingCalendarQueryParams) {
    return request<unknown, BookingCalendarResult>({
      url: `${BOOKING_BASE_URL}/calendar`,
      method: "get",
      params,
    });
  },

  /**
   * 冲突检测（MVP-WEB-06-03）—— 只读：「这个候选时段能不能放？」
   *
   * 返回结构化冲突明细（规则 + 命中的预约单号 + 资源），**不写库**；
   * 文案由页面按 `rule` 走 i18n 组合（服务端不下发中文原因，踩坑 126-bis）。
   */
  checkConflict(payload: ConflictCheckPayload) {
    return request<unknown, BookingConflictCheckResult>({
      url: `${BOOKING_BASE_URL}/calendar/conflict-check`,
      method: "post",
      data: payload,
    });
  },

  /* ══════════════ MVP-WEB-06-05 状态流转 / 改期 / 取消 ══════════════ */

  /**
   * 确认预约（`pending → confirmed`）
   *
   * 🔴 **防超卖的权威点**：PRD《Booking API》「创建与校验之间不加锁，`confirm` 时
   * 二次校验」⇒ 本调用会重做容量校验，冲突即 `30001`（`BOOKING_SLOT_CONFLICT`），
   * `details` 与 `capacity-check` 同形（`conflicts` / `suggestions` / `window`）。
   */
  confirmBooking(id: string, payload: BookingTransitionPayload = {}) {
    return postTransition(id, "confirm", payload);
  },

  /** 到店登记（`confirmed → in_service`；寄养业务叙事的「已到店」并入 in_service） */
  checkinBooking(id: string, payload: BookingTransitionPayload = {}) {
    return postTransition(id, "checkin", payload);
  },

  /** 开始服务（`confirmed → in_service`；不经过到店登记的直通路径） */
  startBooking(id: string, payload: BookingTransitionPayload = {}) {
    return postTransition(id, "start", payload);
  },

  /** 完成服务（`in_service → completed`） */
  completeBooking(id: string, payload: BookingTransitionPayload = {}) {
    return postTransition(id, "complete", payload);
  },

  /**
   * 改期（`confirmed → rescheduled` + 生成承担新时段的新单，`prevBookingId` 互链）
   *
   * 出参里 `booking` 是**新单**、`previousBooking` 是原单（后端注释同口径）；
   * 累计改期 ≥ 3 次且调用方非店长 ⇒ `30003`；新时段容量冲突 ⇒ `30001`。
   */
  rescheduleBooking(id: string, payload: RescheduleBookingPayload) {
    return postTransition(id, "reschedule", payload);
  },

  /**
   * 取消预约（`pending / confirmed → cancelled`）
   *
   * 出参 `feeRule` 为服务端判定的计费档位（`free` / `charged` / `review`）；
   * 服务已开始 ⇒ `30005`（BR-3）；宠主端窗口外 ⇒ `30004`。
   */
  cancelBooking(id: string, payload: CancelBookingPayload) {
    return postTransition(id, "cancel", payload);
  },

  /** 标记爽约（`pending / confirmed → no_show`） */
  noShowBooking(id: string, payload: BookingTransitionPayload = {}) {
    return postTransition(id, "no-show", payload);
  },
};

export default BookingAPI;

export * from "./types";
