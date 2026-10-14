/**
 * 门店档案 API（MVP-WEB-02-01）
 *
 * 契约来源：`niulai-nest/src/store/store.controller.ts`（P0-04-02 · FR-1）
 *  - `GET    /api/v1/stores`       门店分页列表（权限 `store:list`）
 *  - `GET    /api/v1/stores/:id`   门店详情（权限 `store:list`）
 *  - `POST   /api/v1/stores`       创建门店（权限 `store:create`，幂等：带 Idempotency-Key 同 key 回放）
 *  - `PUT    /api/v1/stores/:id`   更新门店（权限 `store:update`，`version` 乐观锁必填）
 *  - `DELETE /api/v1/stores/:id`   删除门店（权限 `store:delete`，软删）
 *
 * 请求层（`utils/request.ts`）已自动为写方法注入 `Idempotency-Key`，
 * 故创建重复提交天然幂等，页面无需手工管理幂等键。
 *
 * 门店运营配置子域（MVP-WEB-02-03）复用本对象：
 *  - `GET   /api/v1/stores/:id/business-hours` 每周营业时段（权限 `store:list`）
 *  - `PUT   /api/v1/stores/:id/business-hours` 整存整取每周营业时段（`store:update`）
 *  - `GET   /api/v1/stores/:id/config`         门店结构化配置（`store:list`）
 *  - `PATCH /api/v1/stores/:id/config`         部分更新配置（`store:update`）
 *  两写接口**共用 `store.version` 乐观锁**（保存其一后另一侧的 version 也 +1）。
 *
 * 门店日期级例外日历（MVP-WEB-02-04）复用本对象：
 *  - `POST   /api/v1/stores/:id/calendar`            新建例外日（权限 `store:update`）
 *  - `GET    /api/v1/stores/:id/calendar?month=`     按月列例外日（`store:list`）
 *  - `DELETE /api/v1/stores/:id/calendar/:entryId`   软删例外日（`store:update`）
 *  - `GET    /api/v1/stores/:id/calendar-view?month=` 整月逐日营业视图（`store:list`）
 *  权限点同样复用门店档案的 `store:list` / `store:update`，不新增权限种子。
 */

import request from "@/utils/request";
import type { PageResult } from "@/api/common";
import type {
  BusinessHoursResult,
  CalendarListResult,
  CalendarViewResult,
  CreateCalendarEntryForm,
  SaveBusinessHoursForm,
  StoreCalendarEntry,
  StoreConfigResult,
  StoreForm,
  StoreItem,
  StoreQueryParams,
  UpdateStoreConfigForm,
} from "./types";

const STORE_BASE_URL = "/api/v1/stores";

const StoreAPI = {
  /** 分页查询门店列表 */
  getPage(params: StoreQueryParams) {
    return request<unknown, PageResult<StoreItem>>({
      url: `${STORE_BASE_URL}`,
      method: "get",
      params,
    });
  },

  /** 查询门店详情 */
  getDetail(id: string) {
    return request<unknown, StoreItem>({
      url: `${STORE_BASE_URL}/${id}`,
      method: "get",
    });
  },

  /** 创建门店（幂等） */
  create(data: StoreForm) {
    return request<unknown, StoreItem>({
      url: `${STORE_BASE_URL}`,
      method: "post",
      data,
    });
  },

  /**
   * 更新门店
   *
   * `version` 为乐观锁：与库内不一致时后端返回 `STORE_VERSION_CONFLICT`，
   * 冲突提示由请求层统一渲染（PRD《操作流程》§流程通用规则 3）。
   */
  update(id: string, data: StoreForm) {
    return request<unknown, StoreItem>({
      url: `${STORE_BASE_URL}/${id}`,
      method: "put",
      data,
    });
  },

  /** 删除门店（软删） */
  deleteById(id: string) {
    return request<unknown, { success: boolean }>({
      url: `${STORE_BASE_URL}/${id}`,
      method: "delete",
    });
  },

  // ───────────── 每周营业时段（MVP-WEB-02-03 · P0-04-04 · FR-3） ─────────────

  /** 查询每周营业时段（门店从未配置时后端返回 7 天空模板） */
  getBusinessHours(id: string) {
    return request<unknown, BusinessHoursResult>({
      url: `${STORE_BASE_URL}/${id}/business-hours`,
      method: "get",
    });
  },

  /**
   * 整存整取每周营业时段
   *
   * 结构非法（非 7 天键 / 超 3 段 / 时间格式错 / `close <= open`）后端报 `A0436`；
   * `version` 不一致报 `A0423`。
   */
  saveBusinessHours(id: string, data: SaveBusinessHoursForm) {
    return request<unknown, BusinessHoursResult>({
      url: `${STORE_BASE_URL}/${id}/business-hours`,
      method: "put",
      data,
    });
  },

  // ───────────── 门店结构化配置（MVP-WEB-02-03 · P0-04-05 · FR-4） ─────────────

  /** 查询门店配置（缺键 / 非法值已由后端逐键回落平台默认值） */
  getConfig(id: string) {
    return request<unknown, StoreConfigResult>({
      url: `${STORE_BASE_URL}/${id}/config`,
      method: "get",
    });
  },

  /**
   * 部分更新门店配置（浅 merge）
   *
   * 仅提交发生变更的键；值非法后端报 `A0437`，`version` 不一致报 `A0423`。
   */
  updateConfig(id: string, data: UpdateStoreConfigForm) {
    return request<unknown, StoreConfigResult>({
      url: `${STORE_BASE_URL}/${id}/config`,
      method: "patch",
      data,
    });
  },

  // ───────────── 日期级例外日历（MVP-WEB-02-04 · P0-04-04 · FR-3 日历部分） ─────────────

  /**
   * 新建日历例外日
   *
   * 同店同日唯一：重复日期后端报 `A0438`（HTTP 409）；
   * `type=3` 时 `openTime`/`closeTime` 成对必填且 `close > open`（否则 `A0400`）；
   * `date` 非真实日历日报 `A0400`；门店不存在报 `A0424`。
   */
  createCalendarEntry(id: string, data: CreateCalendarEntryForm) {
    return request<unknown, StoreCalendarEntry>({
      url: `${STORE_BASE_URL}/${id}/calendar`,
      method: "post",
      data,
    });
  },

  /**
   * 按月列出日历例外日（`month=yyyy-MM`，`date` 升序）
   *
   * ⚠️ 返回项的 `date` 为本地时区形态 `yyyy-MM-dd HH:mm:ss`，
   * 取日期请用 `entryDateKey()`（见 `utils/store-calendar.ts`）。
   */
  listCalendarEntries(id: string, month: string) {
    return request<unknown, CalendarListResult>({
      url: `${STORE_BASE_URL}/${id}/calendar`,
      method: "get",
      params: { month },
    });
  },

  /** 删除日历例外日（软删）；记录不属于该门店或已删报 `A0439`（HTTP 404） */
  deleteCalendarEntry(id: string, entryId: string) {
    return request<unknown, { success: boolean }>({
      url: `${STORE_BASE_URL}/${id}/calendar/${entryId}`,
      method: "delete",
    });
  },

  // ───────────── 整月逐日营业视图（MVP-WEB-02-04 · P0-04-07 · FR-6 聚合） ─────────────

  /**
   * 整月逐日营业视图（周时段 + 日历例外聚合，**例外日优先**）
   *
   * `days` 恒为整月逐日齐全（1 号至月末）；`date` 为服务端 UTC 口径的 `yyyy-MM-dd`。
   */
  getCalendarView(id: string, month: string) {
    return request<unknown, CalendarViewResult>({
      url: `${STORE_BASE_URL}/${id}/calendar-view`,
      method: "get",
      params: { month },
    });
  },
};

export default StoreAPI;

export * from "./types";
