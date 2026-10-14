/**
 * 门店档案类型定义（MVP-WEB-02-01）
 *
 * 与后端 `niulai-nest/src/store` 的 StoreController / StoreService 契约一一对应。
 * 字段名保持后端原始命名（PRD《组件》§数据表格：列定义与后端字段一一对应）。
 */

import type { StoreConfig } from "@peluvida/shared";
import type { BaseQueryParams } from "@/api/common";

/**
 * 门店查询参数
 *
 * ⚠️ 门店端点是**存量分页口径**：`QueryStoreDto extends BaseQueryDto`，
 * 分页字段为 camelCase `pageNum` / `pageSize`，排序为 `sortBy` / `order`
 * （ASC|DESC）。传 snake_case 会被后端 whitelist 静默剥离并回落默认值
 * 而不报错（踩坑 53），故此处不得改写为新契约。
 *
 * 筛选维度：code（前缀）/ name（模糊）/ status / createdAt 闭区间。
 */
export interface StoreQueryParams extends BaseQueryParams {
  /** 门店编码（前缀匹配） */
  code?: string;
  /** 门店名称（模糊匹配） */
  name?: string;
  /** 状态：1 启用 / 0 停用 */
  status?: number;
  /** 创建时间起（含，`yyyy-MM-dd` 或 ISO 8601） */
  createdAtStart?: string;
  /** 创建时间止（含当天末尾） */
  createdAtEnd?: string;
}

/**
 * 门店档案
 *
 * 服务端已统一处理：BigInt 主键（`tenantId` 等）序列化为字符串、
 * 时间列序列化为 `yyyy-MM-dd HH:mm:ss`（本地时区）。
 */
export interface StoreItem {
  /** 门店 ID（uuid） */
  id: string;
  /** 租户 ID（BigInt → 字符串） */
  tenantId: string;
  /** 门店编码（租户内唯一） */
  code: string;
  /** 门店名称 */
  name: string;
  /** 门店类型：1 直营 / 2 加盟 */
  type: number;
  /** 省份 */
  province: string;
  /** 城市 */
  city: string;
  /** 区县 */
  district: string;
  /** 详细地址（不含省市区） */
  address: string;
  /** 经度 */
  longitude: string | null;
  /** 纬度 */
  latitude: string | null;
  /** 联系电话 */
  phone: string;
  /** 每周营业时段（FR-3，编辑入口归 MVP-WEB-02-03 营业时间与门店配置页） */
  businessHours: Record<string, unknown> | null;
  /** 门店级配置覆盖（FR-4，同归属 MVP-WEB-02-03） */
  config: Record<string, unknown> | null;
  /** 状态：1 启用 / 0 停用 */
  status: number;
  /** 乐观锁版本号（创建为 0，每次更新 +1） */
  version: number;
  /** 创建人（sys_user.id，BigInt → 字符串） */
  createdBy: string | null;
  /** 更新人 */
  updatedBy: string | null;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
  /** 软删时间（列表/详情/更新均不可见已删记录） */
  deletedAt: string | null;
}

/**
 * 门店创建 / 更新表单
 *
 * 与 `CreateStoreDto` / `UpdateStoreDto` 对齐。**不含 tenantId** —— 租户归属
 * 恒由 JWT 上下文注入，请求体伪造会被后端白名单剥离。
 * `version` 仅更新时必填（乐观锁）。
 */
export interface StoreForm {
  /** 门店编码（`^[a-zA-Z0-9][a-zA-Z0-9_-]*$`，1~32 字符） */
  code: string;
  /** 门店名称（1~64 字符） */
  name: string;
  /** 门店类型：1 直营 / 2 加盟 */
  type: number;
  /** 省份（1~32 字符） */
  province: string;
  /** 城市（1~32 字符） */
  city: string;
  /** 区县（1~32 字符） */
  district: string;
  /** 详细地址（1~255 字符） */
  address: string;
  /** 经度（-180~180，可选） */
  longitude?: number;
  /** 纬度（-90~90，可选） */
  latitude?: number;
  /** 联系电话（1~20 字符） */
  phone: string;
  /** 状态：1 启用 / 0 停用 */
  status: number;
  /** 乐观锁版本号（更新必填） */
  version?: number;
}

// ─────────────────────────────────────────────────────────────
// 每周营业时段（MVP-WEB-02-03 · 后端 P0-04-04 · FR-3）
// 契约来源：`niulai-nest/src/store/business-hours.service.ts`（WEEKDAY_KEYS /
// MAX_SEGMENTS_PER_DAY / assertValidWeekly）。
// ─────────────────────────────────────────────────────────────

/** 每周营业时段键位（周一~周日；与后端 `WEEKDAY_KEYS` 两字母小写 slug 同口径） */
export type WeekdayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

/** 单个营业时段：`[开始, 结束]`，均为 `HH:mm`（24 小时制） */
export type BusinessHoursSegment = [string, string];

/**
 * 每周营业时段（**恰好 7 个天键**）
 *
 * 后端 `assertValidWeekly` 为白名单收敛口径：除 7 天键外的任何键（含大小写变体）
 * 一律拒绝（`A0436`）；每天最多 3 段且 `close > open`（不允许跨天或相等）；
 * **空天必须显式给 `[]`**，不能省略键。
 */
export type WeeklyBusinessHours = Record<WeekdayKey, BusinessHoursSegment[]>;

/** 每周营业时段查询结果 / 保存结果（`version` 为门店共用乐观锁） */
export interface BusinessHoursResult {
  storeId: string;
  businessHours: WeeklyBusinessHours;
  version: number;
}

/** 每周营业时段保存入参（整存整取；携带 `GET` 返回的 `version`） */
export interface SaveBusinessHoursForm {
  version: number;
  businessHours: WeeklyBusinessHours;
}

// ─────────────────────────────────────────────────────────────
// 门店结构化配置（MVP-WEB-02-03 · 后端 P0-04-05 · FR-4）
// 契约来源：`@peluvida/shared` 的 `store-config.ts`（三端唯一常量来源）——
// 键位 / 取值范围 / 平台默认值均从该包导入，前端不再本地复制一份。
// ─────────────────────────────────────────────────────────────

/** 门店配置查询结果（`config` 恒为完整六键：缺失/非法键后端已回落平台默认值） */
export interface StoreConfigResult {
  storeId: string;
  config: StoreConfig;
  version: number;
}

/**
 * 门店配置部分更新入参（浅 merge 语义）
 *
 * 只需提交**发生变更的键**，未出现的键保持库内现值；`version` 恒必填。
 * 非法值后端报 `A0437`（写侧从严）。
 */
export type UpdateStoreConfigForm = Partial<StoreConfig> & { version: number };

// ─────────────────────────────────────────────────────────────
// 门店日期级例外日历 + 整月逐日营业视图
// （MVP-WEB-02-04 · 后端 P0-04-04 FR-3 日历部分 / P0-04-07 FR-6 聚合）
// 契约来源：`niulai-nest/src/store/store-calendar.service.ts` 与
// `store-calendar-view.service.ts`。
// ─────────────────────────────────────────────────────────────

/**
 * 日历例外类型
 *
 * - `1` 节假日闭店：全天闭店（`openTime` / `closeTime` 后端刻意置 NULL）
 * - `2` 临时闭店：全天闭店（同上）
 * - `3` 特殊营业：`openTime` / `closeTime` 成对必填且 `close > open`
 *
 * 同租户同门店同日期唯一（`uk_store_calendar_tenant_store_date`），
 * 重复创建报 `A0438`（HTTP 409）。
 */
export type CalendarEntryType = 1 | 2 | 3;

/** 日历例外日（`GET /stores/:id/calendar` 的列表项） */
export interface StoreCalendarEntry {
  /** 例外日 ID（uuid，删除时使用） */
  id: string;
  /** 租户 ID（BigInt → 字符串） */
  tenantId: string;
  /** 门店 ID */
  storeId: string;
  /**
   * 例外日期
   *
   * ⚠️ **列表与视图两个接口的序列化口径不一致**（后端既有行为）：
   *  - 本接口（列表）返回 Prisma `DATE` 列原值经全局序列化后的**本地时区**形态
   *    `"yyyy-MM-dd HH:mm:ss"`（实测 `"2026-10-20 08:00:00"`，UTC 午夜在 UTC+8 下的渲染）；
   *  - `GET /calendar-view` 的 `days[].date` 由服务端 `formatUtcDate()` 显式格式化为 `"yyyy-MM-dd"`。
   * 前端**一律用 `date.slice(0, 10)` 取日期部分**（见 `utils/store-calendar.ts`
   * 的 `entryDateKey`），切勿整体当日期字符串比较。
   */
  date: string;
  /** 例外类型 */
  type: CalendarEntryType;
  /** 特殊营业开始时间（仅 type=3 有值，`HH:mm`） */
  openTime: string | null;
  /** 特殊营业结束时间（仅 type=3 有值，`HH:mm`） */
  closeTime: string | null;
  /** 备注（如「春节假期」「设备检修」） */
  remark: string | null;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
  /** 创建人（sys_user.id，BigInt → 字符串） */
  createdBy: string | null;
  /** 更新人 */
  updatedBy: string | null;
  /** 软删时间 */
  deletedAt: string | null;
  /** 乐观锁版本号（本域无更新接口，仅作回显） */
  version: number;
}

/** 按月查询结果（`items` 按 `date` 升序） */
export interface CalendarListResult {
  storeId: string;
  /** 查询月份（`yyyy-MM`） */
  month: string;
  items: StoreCalendarEntry[];
}

/**
 * 新建例外日入参（`CreateCalendarEntryDto`）
 *
 * - `type` 仅允许 1 / 2 / 3；
 * - `openTime` / `closeTime` 仅在 `type=3` 时提交（其余类型提交会被后端忽略/校验拒绝）；
 * - `date` 必须为 `yyyy-MM-dd` 且是**真实日历日**（如 `2026-02-30` 后端报 `A0400`）。
 */
export interface CreateCalendarEntryForm {
  date: string;
  type: CalendarEntryType;
  openTime?: string;
  closeTime?: string;
  remark?: string;
}

/** 整月逐日视图的营业状态来源：`weekly` 周时段推断 / `calendar` 日历例外日 */
export type CalendarViewSource = "weekly" | "calendar";

/**
 * 整月逐日视图的单个日期条目（`GET /stores/:id/calendar-view`）
 *
 * ⚠️ 例外日**优先于**周时段：`source === "calendar"` 时 `periods` 完全由例外决定
 * （`type` 1/2 → 空数组 + `open:false`；`type` 3 → 单个特殊时段）。
 */
export interface CalendarViewDay {
  /** 日期（`yyyy-MM-dd`，服务端 UTC 纯日期算术口径） */
  date: string;
  /** 当日是否营业 */
  open: boolean;
  /** 营业状态来源 */
  source: CalendarViewSource;
  /** 营业时段（闭店为空数组） */
  periods: [string, string][];
  /** 日历例外类型（仅 `source === "calendar"` 时出现） */
  calendarType?: CalendarEntryType;
}

/** 整月逐日视图结果（`days` 恒为整月逐日齐全） */
export interface CalendarViewResult {
  storeId: string;
  /** 查询月份（`yyyy-MM`） */
  month: string;
  days: CalendarViewDay[];
}
