/**
 * 客户（萌主）档案类型定义（MVP-WEB-04-01）
 *
 * 契约来源：`niulai-nest/src/customer/customer.controller.ts` 与
 * `customer.service.ts`（P0-05-02 · FR-1）+ PRD《Customer API》。
 * 字段名保持后端原始命名（PRD《组件》§数据表格：列定义与后端字段一一对应）。
 */

import type { BaseQueryParams } from "@/api/common";

/**
 * 客户列表查询参数
 *
 * ⚠️ 客户端点是**存量分页口径**：`QueryCustomerDto extends BaseQueryDto`，
 * 分页字段为 camelCase `pageNum` / `pageSize`，排序为 `sortBy` / `order`
 * （ASC|DESC）。传 snake_case 会被后端 whitelist 静默剥离并回落默认值
 * 而不报错（踩坑 53），故此处不得改写为新契约。
 *
 * 筛选维度：keyword（姓名 **或** 手机号模糊）/ mobile（精确）/ name（模糊）/
 * storeId（精确）/ lifecycle / createdAt 闭区间。
 */
export interface CustomerQueryParams extends BaseQueryParams {
  /**
   * 通用关键字（同时模糊匹配姓名与手机号，OR 语义）
   *
   * PRD《Customer API》验收要点：「列表 `keyword` 同时命中姓名与手机号」。
   */
  keyword?: string;
  /** 手机号（精确匹配） */
  mobile?: string;
  /** 客户姓名（模糊匹配） */
  name?: string;
  /** 归属门店 id（精确匹配） */
  storeId?: string;
  /** 生命周期分层：1 新客 / 2 活跃 / 3 沉睡 / 4 流失 */
  lifecycle?: number;
  /** 创建时间起（含，`yyyy-MM-dd` 或 ISO 8601） */
  createdAtStart?: string;
  /** 创建时间止（含当天末尾） */
  createdAtEnd?: string;
}

/**
 * 客户档案（列表 / 详情行）
 *
 * 服务端已统一处理：BigInt 主键（`tenantId` 等）序列化为字符串、
 * 时间列序列化为 `yyyy-MM-dd HH:mm:ss`（本地时区）。
 */
export interface CustomerItem {
  /** 客户 ID（uuid） */
  id: string;
  /** 租户 ID（BigInt → 字符串） */
  tenantId: string;
  /** 归属门店 id（`null` = 租户级客户，非任何单一门店） */
  storeId: string | null;
  /** 客户（宠主）姓名 */
  name: string;
  /** 手机号（租户内唯一，软删释放） */
  mobile: string;
  /** 性别：1 男 / 2 女 / 0 未知（`null` = 未登记） */
  gender: number | null;
  /** 生日（`yyyy-MM-dd`；`null` = 未登记） */
  birthday: string | null;
  /** 客户来源：1 自然进店 / 2 老客转介绍 / 3 线上团购 / 4 小程序 / 9 其他（`null` = 未登记） */
  source: number | null;
  /** 备注 */
  remark: string | null;
  /**
   * 生命周期分层：1 新客 / 2 活跃 / 3 沉睡 / 4 流失
   *
   * 分层标签与筛选的展示规格归 MVP-WEB-04-04「客户分层 lifecycle 展示」，
   * 本页仅透传该字段。
   */
  lifecycle: number;
  /** 触达偏好（JSONB；展示与编辑归 MVP-WEB-04-02 客户详情） */
  reachPreferences: Record<string, unknown>;
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

/** 客户来源选项（`GET /customers/source-options` 元素，值域唯一来源为 `@peluvida/shared`） */
export interface CustomerSourceOption {
  /** 来源值：1 / 2 / 3 / 4 / 9 */
  value: number;
  /** 来源中文名（如「自然进店」） */
  label: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// MVP-WEB-04-02 客户详情（宠物 / 触达 / 黑名单）
// 契约来源：`customer-pet.controller.ts`（P0-05-03 · FR-2）、
// `customer-reach.controller.ts`（P0-05-04 · FR-3）、`blacklist.controller.ts`（P0-05-05 · FR-4）
// ─────────────────────────────────────────────────────────────────────────────

/** 宠物类型码（`customer_pet.pet_type`；与 `@peluvida/shared` PetType 同值域） */
export const CUSTOMER_PET_TYPE_VALUES = [1, 2, 9] as const;

/**
 * 客户-宠物归属列表项（`GET /customers/:id/pets` 元素）
 *
 * ⚠️ 与后端 `CustomerPetService.listCustomerPets` 返回的**扁平结构**逐字对齐：
 * 关联行（`customer_pet`）+ join 宠物摘要（`pet`，宠物缺失/软删时为 `null`）。
 * 排序：`isPrimary desc` → `createdAt asc`（主宠在前）。
 */
export interface CustomerPetItem {
  /** 归属关联 id（`customer_pet.id`） */
  id: string;
  customerId: string;
  petId: string;
  /** 是否主宠（`null` = 未标记） */
  isPrimary: boolean | null;
  /** 关联行冗余的宠物名快照 */
  petName: string | null;
  /** join 宠物摘要（宠物软删 / 缺失时为 `null`，此时应回退展示 `petName`） */
  pet: {
    id: string;
    name: string;
    /** 宠物类型：1 犬 / 2 猫 / 9 其他 */
    petType: number;
    /** 档案完整度 0~100 */
    profileCompleteness: number;
  } | null;
}

/**
 * 触达记录分页查询参数（`GET /customers/:id/reach-logs`）
 *
 * 分页/排序沿用存量 `BaseQueryDto` 口径（camelCase `pageNum`/`pageSize`，
 * 见踩坑 53）；排序字段白名单在服务端收敛为 `reachedAt` / `createdAt`，
 * 默认 `reachedAt desc`。
 */
export interface ReachLogQueryParams extends BaseQueryParams {
  /** 触达渠道：1 站内信 / 2 服务号 / 3 订阅消息 / 4 短信 */
  channel?: number;
  /** 触达结果：1 成功 / 2 失败 */
  result?: number;
  /** 触达时间起（含，`yyyy-MM-dd` 或 ISO 8601） */
  reachedAtStart?: string;
  /** 触达时间止（含当天末尾） */
  reachedAtEnd?: string;
}

/** 触达记录（`GET /customers/:id/reach-logs` 行；append-only 表，无业务改删） */
export interface ReachLogItem {
  id: string;
  tenantId: string;
  customerId: string;
  /** 触达渠道：1 站内信 / 2 服务号 / 3 订阅消息 / 4 短信 */
  channel: number;
  /** 模板标识 / 名称（`null` = 非模板触达） */
  template: string | null;
  /** 内容摘要（`null` = 纯事件型触达） */
  content: string | null;
  /** 触达结果：1 成功 / 2 失败（`null` = 未回执） */
  result: number | null;
  /** 实际触达时间 */
  reachedAt: string;
  /** 操作人（sys_user.id，`null` = 系统自动触达） */
  operatorId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  version: number;
}

/**
 * 记录触达入参（`POST /customers/:id/reach-logs`）
 *
 * 服务端管道：① 黑名单**硬拦截**（命中 → `A0522`）→ ② 触达偏好**软拦截**
 * （渠道被拒 / 不在白名单 → `A0527`）→ ③ 落库。故 400/业务码不是「参数错」，
 * 需按错误文案原样透出给操作人。
 */
export interface CreateReachLogPayload {
  channel: number;
  /** 模板标识 / 名称（1~64） */
  template?: string;
  /** 内容摘要（1~500） */
  content?: string;
  /** 触达结果：1 成功 / 2 失败（不传 = 未回执） */
  result?: number;
  /** 实际触达时间（`yyyy-MM-dd` 或 `yyyy-MM-dd HH:mm:ss`；不传 = 写入时刻） */
  reachedAt?: string;
}

/** 免打扰时段（跨夜由 `start > end` 表达） */
export interface ReachDoNotDisturb {
  enabled: boolean;
  /** 起始 `HH:mm`（含） */
  start: string;
  /** 结束 `HH:mm`（不含） */
  end: string;
}

/**
 * 客户触达偏好（`customer.reach_preferences` JSONB）
 *
 * `allowedChannels = null`（或空数组归一为 `null`）= 不设白名单 ⇒ 默认允许全部；
 * `blockedChannels` 优先级高于白名单（命中即拒）。
 */
export interface ReachPreference {
  allowedChannels: number[] | null;
  blockedChannels: number[];
  doNotDisturb: ReachDoNotDisturb;
}

/**
 * 设置触达偏好入参（`PUT /customers/:id/reach-preferences`，**整存整取**）
 *
 * 请求即目标全量；服务端归一后整体覆写，响应回读归一结果。
 */
export type UpdateReachPreferencePayload = ReachPreference;

/** 黑名单范围（`blacklist.store_id` 为 NULL 时租户级） */
export type BlacklistScope = "store" | "tenant";

/** 黑名单分页查询参数（`GET /customers/:id/blacklist`） */
export interface BlacklistQueryParams extends BaseQueryParams {
  scope?: BlacklistScope;
  /** 门店 id（精确匹配；与 scope 同时给出时以 storeId 为准） */
  storeId?: string;
  /** 状态：1 生效 / 0 解除 */
  status?: number;
}

/** 黑名单记录（`GET /customers/:id/blacklist` 行） */
export interface BlacklistItem {
  id: string;
  tenantId: string;
  customerId: string;
  /** `null` = 租户级黑名单（对所有门店生效）；非空 = 门店级 */
  storeId: string | null;
  /** 拉黑原因 */
  reason: string;
  /** 解除原因（`null` = 未解除；status=0 时非空） */
  releaseReason: string | null;
  /** 状态：1 生效 / 0 解除（保留行为记录，不物理删） */
  status: number;
  /** 操作人（sys_user.id，`null` = 系统动作） */
  operatorId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  version: number;
}

/**
 * 拉黑客户入参（`POST /customers/:id/blacklist`）
 *
 * `scope=store` 时 `storeId` 必填且须为租户内有效门店（否则 `A0524`）；
 * `scope=tenant` 时 `storeId` 被服务端忽略（落 NULL）。同范围已有生效记录 → `A0525`。
 */
export interface AddBlacklistPayload {
  scope: BlacklistScope;
  storeId?: string;
  /** 拉黑原因（1~255） */
  reason: string;
}

/**
 * 解除黑名单入参（`POST /customers/:id/blacklist/:blacklistId/release`）
 *
 * PRD《客户管理》BR-2「移出黑名单必须填写原因」⇒ `reason` 为服务端**必填**
 * （1~255，落 `blacklist.release_reason`）。
 */
export interface ReleaseBlacklistPayload {
  reason: string;
}

/* -------------------------------------------------------------------------- */
/* MVP-WEB-04-03 客户合并（P0-05-07 · FR-7）与宠物转移审批（P0-05-03 · FR-2）   */
/* -------------------------------------------------------------------------- */

/**
 * 客户合并入参（`POST /customers/merge`）
 *
 * 语义：把 `sourceId`（被并入方）并入 `targetId`（保留方）。
 * 合并后 source 归档（软删 + 备注追加），宠物归属 / 关联 / 触达记录迁往 target。
 *
 * ⚠️ 不声明 `tenantId` —— 合并只在当前租户内进行（服务端 scoped 隔离，伪造字段被白名单剥离）。
 * 错误码：`A0529` 自合并 / `A0530` 源客户无效 / `A0531` 目标客户无效 /
 * `A0528` 源客户存在在途转移申请 / `A0511` 版本冲突（携带 `version` 时）。
 */
export interface MergeCustomerPayload {
  /** 源客户（被并入方）id */
  sourceId: string;
  /** 目标客户（保留方）id */
  targetId: string;
  /** 源客户期望版本号（可选，乐观锁；不符则拒绝合并） */
  version?: number;
}

/** 客户合并结果（`POST /customers/merge` 出参） */
export interface MergeCustomerResult {
  /** 保留方客户 id */
  targetId: string;
  /** 归属改判到 target 的宠物数（`pet.owner_customer_id` 权威口径） */
  movedPets: number;
  /** 迁移到 target 的触达记录数 */
  movedReachLogs: number;
  /** 被归档的源客户 id */
  mergedSourceId: string;
}

/**
 * 宠物转移申请（`GET /pet-transfers` 行；`pet_transfer_request`）
 *
 * `petName` / `petType` / `fromCustomerName` / `toCustomerName` 为服务端**回查**的
 * 展示字段（表内只存 id 快照），关联实体缺失时为 `null` ⇒ 前端须有兜底文案。
 */
export interface PetTransferItem {
  id: string;
  tenantId: string;
  /** 宠物 id */
  petId: string;
  /** 转出方客户 id（发起时快照） */
  fromCustomerId: string;
  /** 转入方客户 id */
  toCustomerId: string;
  /** 状态：1 待审批 / 2 已通过 / 3 已拒绝 / 4 已撤销 */
  status: number;
  /** 申请理由（`null` = 未填） */
  reason: string | null;
  /** 申请人（`sys_user.id`） */
  appliedBy: string | null;
  /** 审批人（`null` = 未审批） */
  approvedBy: string | null;
  /** 审批时间（`null` = 未审批） */
  approvedAt: string | null;
  /** 拒绝理由（状态 3 时填写） */
  rejectReason: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  version: number;

  /** 宠物名称（回查；`null` = 关联实体缺失） */
  petName: string | null;
  /** 宠物类型（回查；`null` = 缺失） */
  petType: number | null;
  /** 转出方客户名（回查） */
  fromCustomerName: string | null;
  /** 转入方客户名（回查） */
  toCustomerName: string | null;
}

/**
 * 转移申请分页查询参数（`GET /pet-transfers`）
 *
 * ⚠️ 沿用**存量分页口径** camelCase `pageNum` / `pageSize`（`QueryTransferDto extends BaseQueryDto`），
 * 排序白名单仅 `createdAt`（白名单外服务端回落 `createdAt`，踩坑 53）。
 */
export interface PetTransferQueryParams extends BaseQueryParams {
  /** 状态：1 待审批 / 2 已通过 / 3 已拒绝 / 4 已撤销 */
  status?: number;
  /** 宠物 id（精确匹配） */
  petId?: string;
  /** 创建时间起（含） */
  createdAtStart?: string;
  /** 创建时间止（含当天末尾） */
  createdAtEnd?: string;
}

/**
 * 发起宠物转移申请入参（`POST /pets/:id/transfer`）
 *
 * ⚠️ 不声明 `fromCustomerId` —— 转出方由宠物当前归属**服务端快照**推导。
 * 未审批**不变更归属**；错误码：`A0601` 宠物不存在 / `A0518` 转给当前主人 /
 * `A0517` 目标客户无效 / `A0515` 该宠物已有在途申请。
 */
export interface CreateTransferPayload {
  /** 目标客户（新主人）id */
  toCustomerId: string;
  /** 申请理由（1~255，可选） */
  reason?: string;
}

/** 拒绝转移申请入参（`POST /pet-transfers/:id/reject`） */
export interface RejectTransferPayload {
  /** 拒绝理由（1~255，必填） */
  rejectReason: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// MVP-WEB-04-04 客户分层 lifecycle 展示（分布统计）
// 契约来源：`customer.controller.ts` → `GET /customers/lifecycle-stats`（权限 `customer:list`）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 分层分布统计项（`GET /customers/lifecycle-stats` 的 `items` 元素）
 *
 * 服务端按 `CUSTOMER_LIFECYCLE_VALUES` **补零**后返回 ⇒ 4 层恒定齐全、顺序稳定。
 */
export interface CustomerLifecycleStatItem {
  /** 分层：1 新客 / 2 活跃 / 3 沉睡 / 4 流失 */
  lifecycle: number;
  /** 该层客户数（未软删口径） */
  count: number;
}

/**
 * 分层分布统计结果（`GET /customers/lifecycle-stats`）
 *
 * **口径**：全量租户分布（未软删），**不叠加列表筛选** —— 分布条是「钻取入口」：
 * 点击某层写 `params.lifecycle` 触发列表筛选，而分布自身固定为全量基准，
 * 故占比（`count / total`）不会因筛选而自相矛盾（选中一层后其余层不会归零）。
 */
export interface CustomerLifecycleStats {
  /** 分布总数（= 各层 count 之和 = 租户内未软删客户数） */
  total: number;
  /** 各层计数（4 层恒定齐全，值域同 `CustomerLifecycle`） */
  items: CustomerLifecycleStatItem[];
}
