/**
 * 客户（萌主）档案 API（MVP-WEB-04-01）
 *
 * 契约来源：`niulai-nest/src/customer/customer.controller.ts`（P0-05-02 · FR-1）
 *  - `GET    /api/v1/customers`                客户分页列表（权限 `customer:list`）
 *  - `GET    /api/v1/customers/source-options` 客户来源选项（权限 `customer:list`）
 *  - `GET    /api/v1/customers/lifecycle-stats` 分层分布统计（04-04，权限复用 `customer:list`）
 *  - `GET    /api/v1/customers/:id`            客户详情（权限 `customer:list`）
 *  - `POST   /api/v1/customers`                建档（权限 `customer:create`，幂等）
 *  - `PUT    /api/v1/customers/:id`            整体更新（权限 `customer:update`，`version` 乐观锁必填）
 *  - `PATCH  /api/v1/customers/:id`            局部更新（同上，含 lifecycle）
 *  - `DELETE /api/v1/customers/:id`            软删（权限 `customer:delete`，手机号随之释放）
 *
 * ⚠️ 静态段路由 `source-options` 在后端刻意注册于 `:id` 之前（踩坑 37），
 * 前端调用顺序无约束但不得把 source-options 拼成 `/customers/source-options/:x`。
 *
 * 客户域其余能力（触达记录 / 黑名单 / 客户-宠物归属 / 合并 / 转移审批）由
 * 各自的控制器承载，待对应页面任务（MVP-WEB-04-02/04-03）接入时在本对象扩展。
 *
 * ── MVP-WEB-04-02 客户详情（已接入）────────────────────────────────────────
 *  - `GET  /api/v1/customers/:id/pets`                        宠物归属（权限 `customer:pet:list`）
 *  - `GET  /api/v1/customers/:id/reach-logs`                  触达历史分页（`customer:reach:list`）
 *  - `POST /api/v1/customers/:id/reach-logs`                  记录触达（`customer:reach:create`）
 *  - `GET  /api/v1/customers/:id/reach-preferences`           读触达偏好（`…preference:read`）
 *  - `PUT  /api/v1/customers/:id/reach-preferences`           写触达偏好（`…preference:update`）
 *  - `GET  /api/v1/customers/:id/blacklist`                   黑名单分页（`customer:blacklist:list`）
 *  - `POST /api/v1/customers/:id/blacklist`                   拉黑（`customer:blacklist:create`）
 *  - `POST /api/v1/customers/:id/blacklist/:blacklistId/release` 解除（`…:release`，**reason 必填**）
 *
 * ⚠️ 三个子控制器的路由都挂在 `/customers` 前缀下（`@Controller("customers")`），
 * 但静态段固定、参数段仅 `:id` 与 `:blacklistId`，故不存在踩坑 37 的
 * 「静态段被参数路由吞掉」问题；无需关注调用顺序。
 */

import request from "@/utils/request";
import type { PageResult } from "@/api/common";
import type {
  AddBlacklistPayload,
  BlacklistItem,
  BlacklistQueryParams,
  CreateReachLogPayload,
  CreateTransferPayload,
  CustomerItem,
  CustomerLifecycleStats,
  CustomerPetItem,
  CustomerQueryParams,
  CustomerSourceOption,
  MergeCustomerPayload,
  MergeCustomerResult,
  PetTransferItem,
  PetTransferQueryParams,
  ReachLogItem,
  ReachLogQueryParams,
  ReachPreference,
  RejectTransferPayload,
  ReleaseBlacklistPayload,
  UpdateReachPreferencePayload,
} from "./types";

const CUSTOMER_BASE_URL = "/api/v1/customers";
/** 宠物域前缀（转移发起挂在 `/pets/:id/transfer`，见 PetTransferController） */
const PET_BASE_URL = "/api/v1/pets";
/** 转移申请前缀（列表与审批动作；控制器无类级前缀，全路径落 `/pet-transfers`） */
const TRANSFER_BASE_URL = "/api/v1/pet-transfers";

const CustomerAPI = {
  /**
   * 分页查询客户列表
   *
   * `keyword` 为姓名/手机号 OR 模糊；其余筛选项之间为 AND。
   * 排序白名单：`createdAt` / `name` / `mobile`（白名单外后端回落 `createdAt`）。
   */
  getPage(params: CustomerQueryParams) {
    return request<unknown, PageResult<CustomerItem>>({
      url: `${CUSTOMER_BASE_URL}`,
      method: "get",
      params,
    });
  },

  /** 查询客户详情 */
  getDetail(id: string) {
    return request<unknown, CustomerItem>({
      url: `${CUSTOMER_BASE_URL}/${id}`,
      method: "get",
    });
  },

  /** 客户来源选项（建档 / 筛选下拉复用，值域与后端同源） */
  getSourceOptions() {
    return request<unknown, CustomerSourceOption[]>({
      url: `${CUSTOMER_BASE_URL}/source-options`,
      method: "get",
    });
  },

  /**
   * 分层分布统计（MVP-WEB-04-04 · FR-6 展示侧）
   *
   * 后端 `GET /customers/lifecycle-stats`（静态段路由，权限复用 `customer:list`）。
   * 口径为**全量租户分布（未软删）**，不叠加列表筛选 —— 供列表页「分层分布」条
   * 做钻取入口：点击某层写 `params.lifecycle` 触发筛选。
   */
  getLifecycleStats() {
    return request<unknown, CustomerLifecycleStats>({
      url: `${CUSTOMER_BASE_URL}/lifecycle-stats`,
      method: "get",
    });
  },

  /**
   * 删除客户（软删）
   *
   * 软删后该客户从列表/详情/更新入口消失，手机号被部分唯一索引释放
   * （同租户可重新建档）。
   */
  deleteById(id: string) {
    return request<unknown, { success: boolean }>({
      url: `${CUSTOMER_BASE_URL}/${id}`,
      method: "delete",
    });
  },

  // ── MVP-WEB-04-02 客户详情 ──────────────────────────────────────────────

  /**
   * 客户宠物归属列表（FR-2）
   *
   * 返回该客户全部 active 归属关联 + 宠物摘要；服务端已按
   * `isPrimary desc, createdAt asc` 排序，前端不再二次排序。
   */
  listPets(customerId: string) {
    return request<unknown, CustomerPetItem[]>({
      url: `${CUSTOMER_BASE_URL}/${customerId}/pets`,
      method: "get",
    });
  },

  /**
   * 触达历史分页（FR-3）
   *
   * 排序白名单：`reachedAt` / `createdAt`（白名单外服务端回落 `reachedAt`）。
   */
  getReachLogs(customerId: string, params: ReachLogQueryParams) {
    return request<unknown, PageResult<ReachLogItem>>({
      url: `${CUSTOMER_BASE_URL}/${customerId}/reach-logs`,
      method: "get",
      params,
    });
  },

  /**
   * 记录一次实测触达（FR-3）
   *
   * ⚠️ 失败语义不是「参数错」：黑名单命中 → `A0522`、渠道触达偏好拒收 → `A0527`，
   * 两者都在落库前拒绝且不写记录。调用方须把错误文案原样透出。
   */
  createReachLog(customerId: string, payload: CreateReachLogPayload) {
    return request<unknown, ReachLogItem>({
      url: `${CUSTOMER_BASE_URL}/${customerId}/reach-logs`,
      method: "post",
      data: payload,
    });
  },

  /** 读取触达偏好（未配置时服务端返回默认值，前端无需兜底） */
  getReachPreference(customerId: string) {
    return request<unknown, ReachPreference>({
      url: `${CUSTOMER_BASE_URL}/${customerId}/reach-preferences`,
      method: "get",
    });
  },

  /** 设置触达偏好（整存整取：请求即目标全量，响应为归一后的回读结果） */
  updateReachPreference(customerId: string, payload: UpdateReachPreferencePayload) {
    return request<unknown, ReachPreference>({
      url: `${CUSTOMER_BASE_URL}/${customerId}/reach-preferences`,
      method: "put",
      data: payload,
    });
  },

  /** 客户黑名单分页（scope / storeId / status 筛选） */
  getBlacklist(customerId: string, params: BlacklistQueryParams) {
    return request<unknown, PageResult<BlacklistItem>>({
      url: `${CUSTOMER_BASE_URL}/${customerId}/blacklist`,
      method: "get",
      params,
    });
  },

  /**
   * 拉黑客户（scope=store 门店级 / scope=tenant 租户级）
   *
   * 同范围已有生效记录 → `A0525`；scope=store 而门店无效 → `A0524`。
   */
  addBlacklist(customerId: string, payload: AddBlacklistPayload) {
    return request<unknown, BlacklistItem>({
      url: `${CUSTOMER_BASE_URL}/${customerId}/blacklist`,
      method: "post",
      data: payload,
    });
  },

  /**
   * 解除黑名单（status 1→0，保留行为记录）
   *
   * PRD BR-2「移出黑名单必须填写原因」⇒ `reason` 必填，落 `blacklist.release_reason`。
   */
  releaseBlacklist(customerId: string, blacklistId: string, payload: ReleaseBlacklistPayload) {
    return request<unknown, BlacklistItem>({
      url: `${CUSTOMER_BASE_URL}/${customerId}/blacklist/${blacklistId}/release`,
      method: "post",
      data: payload,
    });
  },

  /* ── MVP-WEB-04-03 客户合并（FR-7）────────────────────────────────────── */

  /**
   * 合并客户（source 并入 target，源客户归档）
   *
   * 权限 `customer:merge`；幂等（携带 `Idempotency-Key` 时同 key 回放首次结果，
   * 由请求层对写方法自动注入）。
   *
   * ⚠️ 失败语义须原样透出：`A0529` 自合并 / `A0530`·`A0531` 档案无效 /
   * `A0528` 源客户存在**在途转移申请**（须先处理）/ `A0511` 版本冲突。
   */
  mergeCustomers(payload: MergeCustomerPayload) {
    return request<unknown, MergeCustomerResult>({
      url: `${CUSTOMER_BASE_URL}/merge`,
      method: "post",
      data: payload,
    });
  },

  /* ── MVP-WEB-04-03 宠物转移审批（FR-2）────────────────────────────────── */

  /** 转移申请分页列表（status / petId / 创建时间区间筛选，权限 `customer:transfer:list`） */
  getTransfers(params: PetTransferQueryParams) {
    return request<unknown, PageResult<PetTransferItem>>({
      url: TRANSFER_BASE_URL,
      method: "get",
      params,
    });
  },

  /**
   * 发起宠物转移申请（权限 `customer:transfer:create`）
   *
   * 只落一行 `status=1`（待审批），**不改归属**；归属变更须审批通过。
   * 失败语义：`A0601` 宠物不存在 / `A0518` 转给当前主人 / `A0517` 目标客户无效 /
   * `A0515` 该宠物已有在途申请。
   */
  createTransfer(petId: string, payload: CreateTransferPayload) {
    return request<unknown, PetTransferItem>({
      url: `${PET_BASE_URL}/${petId}/transfer`,
      method: "post",
      data: payload,
    });
  },

  /** 审批通过转移申请（权限 `customer:transfer:approve`）；事务内改归属 + 更新关联 */
  approveTransfer(id: string) {
    return request<unknown, PetTransferItem>({
      url: `${TRANSFER_BASE_URL}/${id}/approve`,
      method: "post",
    });
  },

  /** 拒绝转移申请（权限 `customer:transfer:reject`）；`rejectReason` 必填，不改归属 */
  rejectTransfer(id: string, payload: RejectTransferPayload) {
    return request<unknown, PetTransferItem>({
      url: `${TRANSFER_BASE_URL}/${id}/reject`,
      method: "post",
      data: payload,
    });
  },

  /**
   * 撤销转移申请（权限 `customer:transfer:cancel`）；不改变归属。
   *
   * 语义为「申请人自助」：非申请人本人且非 ROOT → `A0300`。
   */
  cancelTransfer(id: string) {
    return request<unknown, PetTransferItem>({
      url: `${TRANSFER_BASE_URL}/${id}/cancel`,
      method: "post",
    });
  },
};

export default CustomerAPI;

export * from "./types";
