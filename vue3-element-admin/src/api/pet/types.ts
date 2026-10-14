/**
 * 宠物域类型定义（MVP-WEB-05-01 宠物列表与档案页）
 *
 * 契约来源：`niulai-nest/src/pet/**`（P0-06-02~06-10）
 *  - `pet.controller.ts`           宠物档案 CRUD
 *  - `health-record.controller.ts` 健康档案（含疫苗/驱虫有效性判定）
 *  - `weight.controller.ts`        体重曲线
 *  - `timeline.controller.ts`      宠物时间线（含冲正）
 *  - `behavior-tag.controller.ts`  行为标签库
 *  - `pet-tag.controller.ts`       宠物-行为标签全量替换
 * + PRD《宠物管理》（字段全表 / FR-1~FR-6 / BR-1~BR-4 / TR-1~TR-6）。
 *
 * 字段名保持后端原始命名（PRD《组件》§数据表格：列定义与后端字段一一对应）。
 */

import type { BaseQueryParams } from "@/api/common";

// ─────────────────────────────────────────────────────────────
// 宠物档案
// ─────────────────────────────────────────────────────────────

/**
 * 宠物列表查询参数（`GetPetPage`）
 *
 * ⚠️ 分页口径为**存量 camelCase** `pageNum` / `pageSize` + `sortBy` / `order`
 * （`QueryPetDto extends BaseQueryDto`）—— 传 snake_case 会被后端 whitelist
 * 静默剥离并回落默认值（踩坑 53）。
 *
 * 排序白名单：`createdAt` / `name`（白名单外**静默回落** `createdAt`，不报错）。
 */
export interface PetQueryParams extends BaseQueryParams {
  /** 宠物类型：1 犬 / 2 猫 / 9 其他 */
  petType?: number;
  /** 主人客户档案 id（精确匹配） */
  ownerCustomerId?: string;
  /** 归属门店 id（精确匹配） */
  storeId?: string;
  /** 宠物名（模糊匹配；注意是 `name` 而非客户域的 `keyword`） */
  name?: string;
  /** 芯片号（精确匹配） */
  chipNo?: string;
  /** 按行为标签筛选（精确；命中挂有该标签的宠物） */
  behaviorTagId?: string;
  /** 创建时间起（含，`yyyy-MM-dd` 或 ISO 8601） */
  createdAtStart?: string;
  /** 创建时间止（含当天末尾） */
  createdAtEnd?: string;
}

/**
 * 宠物档案行（列表 / 详情）
 *
 * 服务端统一序列化：BigInt 主键 → 字符串、`Decimal(5,2)` 体重 → 字符串、
 * 时间列 → `yyyy-MM-dd HH:mm:ss`（本地时区）、`nullable` 列 → `null`。
 */
export interface PetItem {
  /** 宠物 ID（uuid） */
  id: string;
  /** 租户 ID（BigInt → 字符串） */
  tenantId: string;
  /** 归属门店 id（`null` = 租户级档案） */
  storeId: string | null;
  /** 主人（客户）档案 id */
  ownerCustomerId: string;
  /** 宠物名 */
  name: string;
  /** 宠物类型：1 犬 / 2 猫 / 9 其他 */
  petType: number;
  /** 品种（可空） */
  breed: string | null;
  /** 性别：1 公 / 2 母（`null` = 未登记） */
  gender: number | null;
  /** 生日（`yyyy-MM-dd`，可空 = 未登记） */
  birthday: string | null;
  /** 当前体重快照 kg（两位小数字符串，可空） */
  weightKg: string | null;
  /** 毛色 */
  coatColor: string | null;
  /** 是否绝育（`null` = 未登记） */
  sterilized: boolean | null;
  /** 芯片号 */
  chipNo: string | null;
  /** 主图 URL */
  photoUrl: string | null;
  /** 多图 URL 数组 */
  photos: string[] | null;
  /** 档案完整度评分 0~100 */
  profileCompleteness: number;
  /** 备注 */
  remark: string | null;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
  /** 乐观锁版本号 */
  version: number;
  /** 逻辑删除时间（列表/详情恒为 null） */
  deletedAt: string | null;

  // ── 跨域展示字段（MVP-WEB-05-01 后端补齐，非 N+1 批量回查）──
  /** 主人客户姓名（关联缺失为 `null`） */
  ownerName: string | null;
  /** 主人客户手机号（供「跳客户列表」定位） */
  ownerMobile: string | null;
  /** 归属门店名（`storeId` 为空时恒 `null`） */
  storeName: string | null;
}

/** 宠物详情行 = 档案行 + 挂载的行为标签摘要 */
export interface PetDetail extends PetItem {
  /** 已挂载的行为标签（按 sort 升序） */
  behaviorTags: Array<{ id: string; name: string }>;
}

/** 新建宠物档案载荷（`POST /pets`） */
export interface CreatePetPayload {
  name: string;
  ownerCustomerId: string;
  /** 1 犬 / 2 猫 / 9 其他 */
  petType: number;
  storeId?: string;
  breed?: string;
  /** 1 公 / 2 母 */
  gender?: number;
  /** `yyyy-MM-dd` */
  birthday?: string;
  /** 体重视为字符串（后端正则校验最多两位小数） */
  weightKg?: string;
  coatColor?: string;
  sterilized?: boolean;
  chipNo?: string;
  photoUrl?: string;
  /** 多图，≤9 张 */
  photos?: string[];
  /** 行为标签 id 数组（≤20） */
  behaviorTagIds?: string[];
  remark?: string;
}

/**
 * 更新宠物档案载荷（`PUT /pets/:id`，部分更新）
 *
 * `version` **必填**（乐观锁）；不一致抛 `A0602`，记录不存在抛 `A0601`。
 *
 * ⚠️ 可空列（`storeId` / `breed` / `gender` / `birthday` / `weightKg` / `coatColor` /
 * `sterilized` / `chipNo` / `photoUrl` / `photos` / `remark`）**允许显式传 `null`**
 * 表示「清空该列」—— 与后端 `UpdatePetDto` 的 `@IsOptional()` + `| null` 声明一一对应
 * （后端按 `null` 落库清空，`undefined` 则整列不参与 SET）。
 * `behaviorTagIds` 为**全量替换**语义（空数组 = 清空全部关联）。
 */
export interface UpdatePetPayload {
  /** 乐观锁版本号（必填） */
  version: number;
  name?: string;
  /** 变更主人（服务端校验归属 A0603） */
  ownerCustomerId?: string;
  /** 1 犬 / 2 猫 / 9 其他 */
  petType?: number;
  storeId?: string | null;
  breed?: string | null;
  /** 1 公 / 2 母（`null` = 清空登记） */
  gender?: number | null;
  /** `yyyy-MM-dd` */
  birthday?: string | null;
  /** 体重视为字符串（后端正则校验最多两位小数） */
  weightKg?: string | null;
  coatColor?: string | null;
  sterilized?: boolean | null;
  chipNo?: string | null;
  photoUrl?: string | null;
  /** 多图，≤9 张（空数组 = 清空） */
  photos?: string[] | null;
  /** 行为标签 id 数组（≤20；空数组 = 清空） */
  behaviorTagIds?: string[];
  remark?: string | null;
}

/** 宠物-行为标签全量替换载荷（`PUT /pets/:id/tags`，空数组 = 清空） */
export interface ReplacePetTagsPayload {
  behaviorTagIds: string[];
}

// ─────────────────────────────────────────────────────────────
// 健康档案
// ─────────────────────────────────────────────────────────────

/**
 * 健康记录类型（`health_record.record_type`）
 *
 * ⚠️ 后端常量目前落在 `niulai-nest/src/pet/pet-health.constants.ts`（尚未上收
 * `@peluvida/shared`），值域与 DB 列注释 1~6 一一对应；前端 `@/enums` 的
 * `HealthRecordType` 与之镜像。
 */
export const HEALTH_RECORD_TYPES = [1, 2, 3, 4, 5, 6] as const;

/** 健康档案列表查询参数（`GET /pets/:petId/health`） */
export interface HealthRecordQueryParams extends BaseQueryParams {
  /** 记录类型：1 疫苗 / 2 驱虫 / 3 过敏 / 4 用药 / 5 绝育 / 6 慢病 */
  recordType?: number;
  /** 记录日起（含，`yyyy-MM-dd`） */
  from?: string;
  /** 记录日止（含，`yyyy-MM-dd`） */
  to?: string;
  /** 到期日起（含，`yyyy-MM-dd`） */
  expireFrom?: string;
  /** 到期日止（含，`yyyy-MM-dd`） */
  expireTo?: string;
}

/** 健康档案记录行 */
export interface HealthRecordItem {
  id: string;
  tenantId: string;
  petId: string;
  /** 1 疫苗 / 2 驱虫 / 3 过敏 / 4 用药 / 5 绝育 / 6 慢病 */
  recordType: number;
  /** 记录日（`yyyy-MM-dd`） */
  recordDate: string;
  /** 到期日（疫苗/驱虫复种到期；可空） */
  expireDate: string | null;
  /** 内容摘要 */
  content: string | null;
  /** 操作人（sys_user id 字符串，可空） */
  operatorId: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  deletedAt: string | null;
}

/** 新建健康记录载荷（`POST /pets/:petId/health`） */
export interface CreateHealthRecordPayload {
  recordType: number;
  /** `yyyy-MM-dd` */
  recordDate: string;
  /** `yyyy-MM-dd` */
  expireDate?: string;
  content?: string;
  /** 数字字符串；缺省 = 当前登录用户 */
  operatorId?: string;
}

/** 更正健康记录载荷（`PUT /pets/:petId/health/:recordId`，`version` 必填） */
export interface UpdateHealthRecordPayload {
  version: number;
  recordType?: number;
  recordDate?: string;
  expireDate?: string | null;
  content?: string | null;
  operatorId?: string | null;
}

/** 单条疫苗/驱虫有效性判定结果（`GET /pets/:petId/health/validity`） */
export interface HealthValidityItem {
  /** 1 疫苗 / 2 驱虫 */
  recordType: number;
  /** 类型中文名（服务端下发） */
  recordName: string;
  /** 是否存在该类记录 */
  hasRecord: boolean;
  /** 是否在有效期内（`expireDate >= 今日`） */
  valid: boolean;
  /** 最近一条记录 id（无记录为 null） */
  latestRecordId: string | null;
  recordDate: string | null;
  expireDate: string | null;
  /** 剩余天数（可为负 = 已过期；无到期日为 null） */
  daysLeft: number | null;
}

/** 疫苗/驱虫有效性判定汇总 */
export interface HealthValidityResult {
  petId: string;
  /** 判定基准日（`yyyy-MM-dd`） */
  asOf: string | null;
  /** 全部在有效期内 */
  allValid: boolean;
  items: HealthValidityItem[];
}

// ── 跨宠物到期提醒（MVP-WEB-05-02）───────────────────────────────────────

/**
 * 到期紧急度分级（**派生值**，由服务端按 `expireDate - 今日` 计算）
 *
 *  - `expired`：`daysLeft < 0` —— 已过期（PRD BR-1「疫苗过期阻断寄养/日托入住」的输入）
 *  - `urgent`：`0 ≤ daysLeft ≤ urgentDays(14)` —— **红色预警**（PRD《Web端 · 页面功能》
 *    「到期低于 14 天自动红色预警」）
 *  - `soon`：`14 < daysLeft ≤ windowDays` —— 窗口内提醒
 */
export const HEALTH_EXPIRY_LEVELS = ["expired", "urgent", "soon"] as const;

export type HealthExpiryLevel = (typeof HEALTH_EXPIRY_LEVELS)[number];

/**
 * 跨宠物到期提醒查询参数（`GET /pets/health-expiry-reminders`）
 *
 * ⚠️ 该端点是**租户级聚合**（非单宠）；按数据权限三级自动收敛到「本门店 / 仅本人」。
 * 静态段 `health-expiry-reminders` 在后端刻意注册于 `:id` **之前**（踩坑 37）。
 */
export interface HealthExpiryReminderQueryParams extends BaseQueryParams {
  /** 提醒窗口（天）：到期日 ≤ 今日+N（含已过期）；默认 30，1~365 */
  windowDays?: number;
  /** 紧急度筛选（**只收敛 items/total，不改变 summary**） */
  level?: HealthExpiryLevel;
  /** 1 疫苗 / 2 驱虫（缺省 = 两者） */
  recordType?: number;
  /** 限定宠物 id（缺省 = 全租户） */
  petId?: string;
}

/** 到期提醒条目（展示字段由服务端两次 `in` 批量回查补齐，非 N+1） */
export interface HealthExpiryReminderItem {
  recordId: string;
  petId: string;
  /** 宠物名（关联缺失为 `null`） */
  petName: string | null;
  /** 1 犬 / 2 猫 / 9 其他（关联缺失为 `null`） */
  petType: number | null;
  ownerCustomerId: string | null;
  ownerName: string | null;
  ownerMobile: string | null;
  storeId: string | null;
  storeName: string | null;
  /** 1 疫苗 / 2 驱虫 */
  recordType: number;
  /** 类型中文名（服务端下发） */
  recordName: string;
  recordDate: string | null;
  expireDate: string | null;
  /** 到期剩余天数（<0 = 已过期） */
  daysLeft: number;
  level: HealthExpiryLevel;
}

/** 三档计数（基于窗口内**全部命中**，不受 `level` 筛选影响） */
export interface HealthExpiryReminderSummary {
  expired: number;
  urgent: number;
  soon: number;
}

/**
 * 到期提醒查询结果
 *
 * ⚠️ 为**普通对象出参**（非分页信封）—— 对齐 `GET /customers/lifecycle-stats` 先例：
 * 响应拦截器只把 `{ data, page }` 形状改写成 `list/total/page/page_size`，
 * 本端点返回 `{ asOf, windowDays, urgentDays, total, summary, pageNum, pageSize, items }`。
 */
export interface HealthExpiryReminderResult {
  /** 判定基准日（`yyyy-MM-dd`） */
  asOf: string | null;
  /** 本次查询的提醒窗口（天） */
  windowDays: number;
  /** 红色预警阈值（天），当前 14 */
  urgentDays: number;
  /** `items` 总数（受 `level` 筛选影响） */
  total: number;
  /** 三档计数（窗口内全貌） */
  summary: HealthExpiryReminderSummary;
  pageNum: number;
  pageSize: number;
  items: HealthExpiryReminderItem[];
}

// ─────────────────────────────────────────────────────────────
// 体重曲线
// ─────────────────────────────────────────────────────────────

/** 体重曲线查询参数（`GET /pets/:petId/weight-curve`） */
export interface WeightCurveQueryParams {
  /** 称重日起（含，`yyyy-MM-dd`） */
  from?: string;
  /** 称重日止（含，`yyyy-MM-dd`） */
  to?: string;
  /** `asc`（默认，时间序列口径）/ `desc` */
  order?: "asc" | "desc";
  /** 返回条数上限（默认 100，最大 500） */
  limit?: number;
}

/** 体重记录点（`GET /pets/:petId/weight-curve` 的 `points[]`） */
export interface WeightPoint {
  id: string;
  tenantId: string;
  petId: string;
  /** 称重日（服务端 `@db.Date` 序列化为 `yyyy-MM-dd HH:mm:ss`，展示前取前 10 位） */
  weighedAt: string;
  /** 体重 kg（Decimal 序列化，尾零可能被省略，如 `"12.5"` / `"10"`） */
  weightKg: string;
  /**
   * 相对**上一条**（时间升序紧邻）的变化百分比，带正负号；序列首点 = `null`。
   *
   * 🔴 类型刻意放宽为 `number | string`：后端全局响应拦截器把「非安全整数」的 number
   * 序列化为字符串（正数/整数原样、小数转串），故 wire 上 `8` 与 `"20.4"` 并存。
   * 消费侧**必须**经 `toDeltaPercent()` 归一（见 `utils/pet.ts`）。
   */
  deltaPercent: number | string | null;
  /**
   * 是否触发 BR-4 预警（`|环比| > 15%`）—— **服务端权威裁决**，图表打点标红与
   * 明细表 tag 着色**都**以它为准。
   *
   * 类型刻意放宽为可选：wire 上字段缺失时消费侧回退到 `isWeightDeltaAlert(deltaPercent)`
   * 本地重算（防序列化裁剪/老版本后端导致双源判据分裂）。
   */
  deltaAlert?: boolean;
  createdAt: string;
  version: number;
}

/** 体重曲线响应（含 pet 当前体重快照与排序方向） */
export interface WeightCurveResult {
  petId: string;
  /** pet 当前体重快照（kg 字符串；`null` = 未登记） */
  weightKg: string | null;
  order: "asc" | "desc";
  from: string | null;
  to: string | null;
  total: number;
  /** 触发 BR-4 预警（`|环比| > 15%`）的点数 */
  alertCount: number;
  points: WeightPoint[];
}

/** 记录体重载荷（`POST /pets/:petId/weights`） */
export interface CreateWeightPayload {
  /** `yyyy-MM-dd` */
  weighedAt: string;
  /** 0.01~999.99，最多两位小数 */
  weightKg: string;
}

/** 记录体重的响应（体重行 + pet 快照 + BR-4 环比） */
export interface WeightCreateResult extends WeightPoint {
  /** pet 更新后的体重新快照（kg 字符串；`null` = 全部记录已删空） */
  petWeightKg: string | null;
  /** 「上次体重」= 按称重日早于本次的最新一条（无 = `null`） */
  previousWeightKg: string | null;
  /** 相对上次体重的变化百分比（无上一条 = `null`；类型同 `WeightPoint.deltaPercent`） */
  deltaPercent: number | string | null;
  /** 是否触发 BR-4 预警 */
  deltaAlert: boolean;
}

// ─────────────────────────────────────────────────────────────
// 时间线
// ─────────────────────────────────────────────────────────────

/** 时间线查询参数（`GET /pets/:petId/timeline`） */
export interface TimelineQueryParams extends BaseQueryParams {
  /** 1 入驻 / 2 离店 / 3 喂养 / 4 洗护 / 5 医疗 / 6 体重 / 7 照片 / 8 系统 */
  eventType?: number;
  /** 事件名（`模块.动作`，精确匹配） */
  eventName?: string;
  /** 多态关联对象类型（精确匹配） */
  refType?: string;
  /** 多态关联对象 id（精确匹配） */
  refId?: string;
  /**
   * 宠主端可见（`"true"` / `"false"`）
   *
   * ⚠️ 声明为**字符串**：后端 DTO 亦为 string（`enableImplicitConversion`
   * 会把 `"false"` 错转成 `true`，踩坑 101），故不得改写为 boolean。
   */
  visibleToOwner?: "true" | "false";
  /** 事件时间起（含） */
  eventTimeStart?: string;
  /** 事件时间止（含当天末尾） */
  eventTimeEnd?: string;
}

/** 时间线事件（出参已把 BigInt 事件 id / 操作人 id 字符串化） */
export interface TimelineEventItem {
  /** 事件 id（BigInt 字符串化） */
  id: string;
  tenantId: string;
  petId: string;
  /** 1 入驻 / 2 离店 / 3 喂养 / 4 洗护 / 5 医疗 / 6 体重 / 7 照片 / 8 系统 */
  eventType: number;
  /** 事件名（`模块.动作`；历史行可能为 null） */
  eventName: string | null;
  /** 事件内容摘要 */
  content: string | null;
  /** 结构化负载快照 */
  payload: Record<string, unknown> | null;
  refType: string | null;
  refId: string | null;
  /** 操作者类型：1 员工 / 2 系统 / 3 宠主 */
  actorType: number;
  /** 操作人 id（BigInt 字符串化；null = 系统事件） */
  operatorId: string | null;
  /** 事件时间 */
  eventTime: string;
  /** 宠主端可见 */
  visibleToOwner: boolean;
}

/**
 * 手工补录时间线事件入参（`POST /pets/:petId/timeline`）
 *
 * ⚠️ 不传 `tenantId`（租户归属只来自 JWT；DTO 白名单会剥离伪造值）。
 * `eventType` / `actorType` / `visibleToOwner` 缺省时由服务端按事件名（`模块.动作`）
 * 回落默认值；未登记事件名且未显式给 `eventType` 会抛 `A0614`。
 */
export interface CreateTimelineEventPayload {
  /** 事件名（`模块.动作`，如 `health.record.created`） */
  eventName: string;
  /** 事件类型：1 入驻 / 2 离店 / 3 喂养 / 4 洗护 / 5 医疗 / 6 体重 / 7 照片 / 8 系统 */
  eventType?: number;
  /** 事件内容摘要（≤500） */
  content?: string;
  /** 结构化负载快照 */
  payload?: Record<string, unknown>;
  /** 多态关联对象类型（如 order / stay / health_record） */
  refType?: string;
  /** 多态关联对象 id（字符串，兼容 uuid 与 bigint） */
  refId?: string;
  /** 操作者类型：1 员工 / 2 系统 / 3 宠主 */
  actorType?: number;
  /** 操作人（BigInt 字符串；缺省=当前登录用户） */
  operatorId?: string;
  /** 宠主端可见（缺省按事件名回落） */
  visibleToOwner?: boolean;
  /** 事件时间（ISO 8601 或 `yyyy-MM-dd`；缺省=落库时刻） */
  eventTime?: string;
}

/**
 * 冲正时间线事件入参（`POST /pets/:petId/timeline/:eventId/revise`）
 *
 * 语义（TR-4）：**不修改原事件**，追加一条 `timeline.event.revised` 冲正事件
 * （refType=`timeline_event`、refId=原事件 id），原事件行保持字节级不变。
 */
export interface ReviseTimelineEventPayload {
  /** 冲正原因（≤500） */
  reason?: string;
  /** 修正内容（字段级差分对象） */
  changes?: Record<string, unknown>;
  /** 冲正事件的宠主端可见性（缺省继承原事件） */
  visibleToOwner?: boolean;
}

// ─────────────────────────────────────────────────────────────
// 行为标签库
// ─────────────────────────────────────────────────────────────

/** 行为标签查询参数（`GET /behavior-tags`） */
export interface BehaviorTagQueryParams extends BaseQueryParams {
  /** 标签名（模糊匹配） */
  name?: string;
  /** 状态：1 启用 / 0 停用 */
  status?: number;
}

/** 行为标签行 */
export interface BehaviorTagItem {
  id: string;
  tenantId: string;
  /** 标签名（租户内唯一，≤32） */
  name: string;
  /** 展示排序（小在前） */
  sort: number;
  /** 1 启用 / 0 停用 */
  status: number;
  createdAt: string;
  updatedAt: string;
  version: number;
  deletedAt: string | null;
}

/**
 * 行为标签创建参数（`POST /behavior-tags`，`pet:tag:create`）
 *
 * `name` 租户内唯一：存活同名 ⇒ `A0610`；**同名已软删则复用其 id 复活**
 * （后端语义，见 `behavior-tag.service.createBehaviorTag`）。
 * 不声明 `tenantId`（租户恒由 JWT 上下文注入，DTO 白名单剥离伪造值）。
 */
export interface CreateBehaviorTagPayload {
  /** 标签名（1~32 字符，自动 trim） */
  name: string;
  /** 展示排序（小在前，缺省 0，非负整数） */
  sort?: number;
  /** 1 启用 / 0 停用（缺省 1） */
  status?: number;
}

/**
 * 行为标签更新参数（`PATCH /behavior-tags/:id`，`pet:tag:update`）
 *
 * ⚠️ `version` **必填**（乐观锁）：与库内 `version` 不一致 ⇒ `A0612`；
 * 目标 id 不存在 / 已软删 / 跨租户 ⇒ `A0611`；改名撞存活同名 ⇒ `A0610`。
 */
export interface UpdateBehaviorTagPayload {
  /** 乐观锁版本号（创建为 0，每次更新 +1） */
  version: number;
  /** 标签名（1~32 字符，自动 trim） */
  name?: string;
  /** 展示排序（小在前，非负整数） */
  sort?: number;
  /** 1 启用 / 0 停用 */
  status?: number;
}
