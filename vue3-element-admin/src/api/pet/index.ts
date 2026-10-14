/**
 * 宠物域 API（MVP-WEB-05-01 宠物列表与档案页）
 *
 * 契约来源：`niulai-nest/src/pet/**`
 *  - `GET    /api/v1/pets`                          宠物分页列表（`pet:list`）
 *  - `GET    /api/v1/pets/:id`                      宠物详情（含行为标签，`pet:list`）
 *  - `POST   /api/v1/pets`                          建档（`pet:create`）
 *  - `PUT    /api/v1/pets/:id`                      更新（`pet:update`，`version` 乐观锁必填）
 *  - `DELETE /api/v1/pets/:id`                      软删（`pet:delete`）
 *  - `PUT    /api/v1/pets/:id/tags`                 行为标签全量替换（`pet:tag:assign`）
 *  - `GET    /api/v1/pets/:petId/health`            健康档案分页（`pet:health:list`）
 *  - `POST   /api/v1/pets/:petId/health`            健康记录建档（`pet:health:create`）
 *  - `PUT    /api/v1/pets/:petId/health/:recordId`  健康记录更正（`pet:health:update`，`version` 必填）
 *  - `DELETE /api/v1/pets/:petId/health/:recordId`  健康记录软删（`pet:health:delete`）
 *  - `GET    /api/v1/pets/:petId/health/validity`   疫苗/驱虫有效性判定（`pet:health:list`）
 *  - `GET    /api/v1/pets/health-expiry-reminders`  跨宠物到期提醒（`pet:health:list`，租户级）
 *  - `GET    /api/v1/pets/:petId/weight-curve`      体重曲线（`pet:weight:list`）
 *  - `POST   /api/v1/pets/:petId/weights`           记录体重（`pet:weight:create`，回带 BR-4 环比）
 *  - `DELETE /api/v1/pets/:petId/weights/:recordId` 软删体重记录（`pet:weight:delete`）
 *  - `GET    /api/v1/pets/:petId/timeline`          时间线分页（`pet:timeline:list`）
 *  - `GET    /api/v1/pets/:petId/timeline/:eventId` 事件详情（`pet:timeline:list`）
 *  - `POST   /api/v1/pets/:petId/timeline`          手工补录事件（`pet:timeline:create`）
 *  - `POST   /api/v1/pets/:petId/timeline/:eventId/revise` 冲正事件（`pet:timeline:revise`）
 *  - `GET    /api/v1/behavior-tags`                 行为标签库分页（`pet:tag:list`）
 *  - `POST   /api/v1/behavior-tags`                 行为标签创建（`pet:tag:create`）
 *  - `PATCH  /api/v1/behavior-tags/:id`             行为标签更新（`pet:tag:update`，`version` 必填）
 *  - `DELETE /api/v1/behavior-tags/:id`             行为标签软删（`pet:tag:delete`）
 *
 * ⚠️ 路由纪律：`pet.controller.ts` 的 `:id` 与 `health` / `weight-curve` / `timeline`
 * 三段路径由**不同控制器**承载且路径段数不同（`:id` 单段不会吞掉两段路径，踩坑 37）；
 * 但 `health-expiry-reminders` 与 `:id` **同为 2 段** ⇒ 后端刻意把静态段注册在
 * `@Get(":id")` **之前**（Nest 按方法声明顺序匹配，否则会被 `ParseUUIDPipe` 吞成 400）。
 *
 * 健康档案读写（05-02）、体重曲线读写（05-03）、时间线补录/冲正（05-04）与
 * 行为标签库 CRUD（05-05）均已落地。
 */

import request from "@/utils/request";
import type { PageResult } from "@/api/common";
import type {
  BehaviorTagItem,
  BehaviorTagQueryParams,
  CreateBehaviorTagPayload,
  CreateHealthRecordPayload,
  CreatePetPayload,
  CreateTimelineEventPayload,
  CreateWeightPayload,
  HealthExpiryReminderQueryParams,
  HealthExpiryReminderResult,
  HealthRecordItem,
  HealthRecordQueryParams,
  HealthValidityResult,
  PetDetail,
  PetItem,
  PetQueryParams,
  ReplacePetTagsPayload,
  ReviseTimelineEventPayload,
  TimelineEventItem,
  TimelineQueryParams,
  UpdateBehaviorTagPayload,
  UpdateHealthRecordPayload,
  UpdatePetPayload,
  WeightCreateResult,
  WeightCurveQueryParams,
  WeightCurveResult,
} from "./types";

const PET_BASE_URL = "/api/v1/pets";
const BEHAVIOR_TAG_BASE_URL = "/api/v1/behavior-tags";

const PetAPI = {
  /**
   * 分页查询宠物列表
   *
   * 筛选维度：`petType` / `ownerCustomerId` / `storeId` / `chipNo` / `behaviorTagId`
   * 精确 + `name` 模糊 + `createdAt` 闭区间；排序白名单 `createdAt` / `name`
   * （白名单外后端**静默回落** `createdAt`）。
   *
   * 出参行已含 `ownerName` / `ownerMobile` / `storeName`（服务端批量回查补齐，
   * 非 N+1；关联缺失为 `null`）。
   */
  getPage(params: PetQueryParams) {
    return request<unknown, PageResult<PetItem>>({
      url: `${PET_BASE_URL}`,
      method: "get",
      params,
    });
  },

  /** 查询宠物详情（含行为标签摘要与主人/门店展示名） */
  getDetail(id: string) {
    return request<unknown, PetDetail>({
      url: `${PET_BASE_URL}/${id}`,
      method: "get",
    });
  },

  /**
   * 新建宠物档案
   *
   * 服务端校验：主人客户归属 `A0603` / 门店归属 `A0604` / 行为标签归属 `A0605`；
   * 创建成功按填充字段重算 `profileCompleteness`。
   */
  create(payload: CreatePetPayload) {
    return request<unknown, PetDetail>({
      url: `${PET_BASE_URL}`,
      method: "post",
      data: payload,
    });
  },

  /**
   * 更新宠物档案（部分更新）
   *
   * `version` **必填**：不一致抛 `A0602`（数据已被他人修改），记录不存在抛 `A0601`。
   */
  update(id: string, payload: UpdatePetPayload) {
    return request<unknown, PetDetail>({
      url: `${PET_BASE_URL}/${id}`,
      method: "put",
      data: payload,
    });
  },

  /** 软删宠物档案（同步清除行为标签关联；健康/体重/时间线历史保留） */
  deleteById(id: string) {
    return request<unknown, { success: boolean }>({
      url: `${PET_BASE_URL}/${id}`,
      method: "delete",
    });
  },

  // ── 行为标签（宠物维度）────────────────────────────────────────────────

  /**
   * 行为标签全量替换（空数组 = 清空）
   *
   * 与 `PUT /pets/:id` 携带 `behaviorTagIds` 同范式；本入口**不参与 pet 乐观锁**
   * （改标签无须回传 `version`）。
   */
  replaceTags(id: string, payload: ReplacePetTagsPayload) {
    return request<unknown, PetDetail>({
      url: `${PET_BASE_URL}/${id}/tags`,
      method: "put",
      data: payload,
    });
  },

  // ── 健康档案（读写；MVP-WEB-05-02）──────────────────────────────────────

  /**
   * 健康档案分页
   *
   * 排序固定为 `recordDate`（默认倒序，`order=asc` 反转）+ `createdAt` 兜底，
   * 不接受任意字段透传。
   */
  getHealthRecords(petId: string, params: HealthRecordQueryParams) {
    return request<unknown, PageResult<HealthRecordItem>>({
      url: `${PET_BASE_URL}/${petId}/health`,
      method: "get",
      params,
    });
  },

  /**
   * 疫苗/驱虫有效性判定（PRD BR-1「入住前校验疫苗在有效期内」的读侧口径）
   *
   * 返回每种受跟踪类型（疫苗 / 驱虫）的最近一条记录与其到期判定
   * （`valid` / `daysLeft`；`daysLeft < 0` = 已过期）。
   */
  getHealthValidity(petId: string) {
    return request<unknown, HealthValidityResult>({
      url: `${PET_BASE_URL}/${petId}/health/validity`,
      method: "get",
    });
  },

  /**
   * 健康记录建档
   *
   * 服务端校验：宠物归属 `A0601`、记录日格式、**到期日不得早于记录日** `A0608`。
   * 成功后会写一条 `health.record.created` 时间线（append-only）并推送工作台变更。
   */
  createHealthRecord(petId: string, payload: CreateHealthRecordPayload) {
    return request<unknown, HealthRecordItem>({
      url: `${PET_BASE_URL}/${petId}/health`,
      method: "post",
      data: payload,
    });
  },

  /**
   * 健康记录更正（`version` 必填）
   *
   * 不一致抛 `A0609`（版本冲突），记录不存在抛 `A0606`。
   * 业务口径：健康档案在临床语义上**append-only**，本接口仅用于「录入错误更正」。
   */
  updateHealthRecord(petId: string, recordId: string, payload: UpdateHealthRecordPayload) {
    return request<unknown, HealthRecordItem>({
      url: `${PET_BASE_URL}/${petId}/health/${recordId}`,
      method: "put",
      data: payload,
    });
  },

  /** 软删健康记录（保留行可追溯；记录不存在抛 `A0606`） */
  deleteHealthRecord(petId: string, recordId: string) {
    return request<unknown, { success: boolean }>({
      url: `${PET_BASE_URL}/${petId}/health/${recordId}`,
      method: "delete",
    });
  },

  /**
   * 跨宠物健康到期提醒清单（**租户级**，MVP-WEB-05-02）
   *
   * 列出「疫苗/驱虫 且 `expireDate ≤ 今日 + windowDays`」的未软删记录，**含已过期**
   * ——后台扫描器（`HealthExpiryReminderService`）只覆盖未来窗口，本端点是前台
   * 「谁该补打了」的唯一读侧入口（PRD 验收「疫苗到期低于 14 天红色预警」/ BR-1）。
   *
   * 出参为**普通对象**（含三档 `summary`），非分页信封。
   */
  getHealthExpiryReminders(params?: HealthExpiryReminderQueryParams) {
    return request<unknown, HealthExpiryReminderResult>({
      url: `${PET_BASE_URL}/health-expiry-reminders`,
      method: "get",
      params,
    });
  },

  // ── 体重曲线（FR-3 体重趋势图 + BR-4 环比预警）─────────────────────────

  /**
   * 体重曲线（含 pet 当前体重快照、排序方向与 BR-4 环比）
   *
   * 每点携带 `deltaPercent`（相对时间升序上一条的变化百分比，带符号）与
   * `deltaAlert`（`|环比| > 15%`，PRD《宠物管理》BR-4）；顶层 `alertCount` 为
   * 预警点数。默认 `asc`，最多 500 点。
   */
  getWeightCurve(petId: string, params?: WeightCurveQueryParams) {
    return request<unknown, WeightCurveResult>({
      url: `${PET_BASE_URL}/${petId}/weight-curve`,
      method: "get",
      params,
    });
  },

  /**
   * 记录体重（`pet:weight:create`）
   *
   * 服务端同步刷新 `pet.weightKg` 快照（恒取「最新称重」而非最后插入）并追加
   * 一条体重时间线（最佳努力）；响应回带 BR-4 环比（`previousWeightKg` /
   * `deltaPercent` / `deltaAlert`），供前端在录入后即时提示前台确认健康状态。
   */
  createWeight(petId: string, payload: CreateWeightPayload) {
    return request<unknown, WeightCreateResult>({
      url: `${PET_BASE_URL}/${petId}/weights`,
      method: "post",
      data: payload,
    });
  },

  /**
   * 软删体重记录（`pet:weight:delete`）
   *
   * 服务端重算 `pet.weightKg` 快照（删掉最新一条则回退到次新，全删空则置 `null`）；
   * 记录不存在抛 `A0607`。体重为 append-only 语义，删除仅用于「误录回收」。
   */
  deleteWeight(petId: string, recordId: string) {
    return request<unknown, { success: boolean }>({
      url: `${PET_BASE_URL}/${petId}/weights/${recordId}`,
      method: "delete",
    });
  },

  // ── 时间线（MVP-WEB-05-04：读 + 补录 + 冲正）───────────────────────────

  /**
   * 时间线分页（默认 `eventTime desc` + `id desc`）
   *
   * PRD 性能约定：Timeline 采用**增量分页，每次 30 条**。
   */
  getTimeline(petId: string, params: TimelineQueryParams) {
    return request<unknown, PageResult<TimelineEventItem>>({
      url: `${PET_BASE_URL}/${petId}/timeline`,
      method: "get",
      params,
    });
  },

  /**
   * 事件详情（`GET /pets/:petId/timeline/:eventId`）
   *
   * 事件不存在 / 跨租户 / 非法 id 形态统一 `A0613`（防枚举）。
   */
  getTimelineEventDetail(petId: string, eventId: string) {
    return request<unknown, TimelineEventItem>({
      url: `${PET_BASE_URL}/${petId}/timeline/${eventId}`,
      method: "get",
    });
  },

  /**
   * 手工补录事件（`POST /pets/:petId/timeline`，`pet:timeline:create`）
   *
   * 未登记事件名且未显式给 `eventType` ⇒ `A0614`（事件名枚举纪律）。
   */
  createTimelineEvent(petId: string, data: CreateTimelineEventPayload) {
    return request<unknown, TimelineEventItem>({
      url: `${PET_BASE_URL}/${petId}/timeline`,
      method: "post",
      data,
    });
  },

  /**
   * 冲正事件（`POST /pets/:petId/timeline/:eventId/revise`，`pet:timeline:revise`）
   *
   * TR-4：不修改原事件，追加 `timeline.event.revised` 冲正事件（返回新追加事件）。
   */
  reviseTimelineEvent(petId: string, eventId: string, data: ReviseTimelineEventPayload) {
    return request<unknown, TimelineEventItem>({
      url: `${PET_BASE_URL}/${petId}/timeline/${eventId}/revise`,
      method: "post",
      data,
    });
  },

  // ── 行为标签库（MVP-WEB-05-01 只读 · MVP-WEB-05-05 补写路径）──────────

  /** 行为标签库分页（`name` 模糊 + `status` 精确；排序白名单 createdAt/name/sort/status） */
  getBehaviorTags(params: BehaviorTagQueryParams) {
    return request<unknown, PageResult<BehaviorTagItem>>({
      url: `${BEHAVIOR_TAG_BASE_URL}`,
      method: "get",
      params,
    });
  },

  /**
   * 创建行为标签（`POST /behavior-tags`，`pet:tag:create`）
   *
   * 存活同名 ⇒ `A0610`；**同名已软删 ⇒ 复用其 id 复活**（后端语义）。
   */
  createBehaviorTag(data: CreateBehaviorTagPayload) {
    return request<unknown, BehaviorTagItem>({
      url: `${BEHAVIOR_TAG_BASE_URL}`,
      method: "post",
      data,
    });
  },

  /**
   * 更新行为标签（`PATCH /behavior-tags/:id`，`pet:tag:update`）
   *
   * ⚠️ `data.version` 必填（乐观锁）：版本不符 ⇒ `A0612`；
   * 目标不存在 / 已软删 / 跨租户 ⇒ `A0611`；改名撞存活同名 ⇒ `A0610`。
   */
  updateBehaviorTag(id: string, data: UpdateBehaviorTagPayload) {
    return request<unknown, BehaviorTagItem>({
      url: `${BEHAVIOR_TAG_BASE_URL}/${id}`,
      method: "patch",
      data,
    });
  },

  /**
   * 删除行为标签（`DELETE /behavior-tags/:id`，`pet:tag:delete`）
   *
   * 软删并同步清除宠物关联（重算档案完整度）；出参 `{ success: true }`。
   */
  deleteBehaviorTag(id: string) {
    return request<unknown, { success: boolean }>({
      url: `${BEHAVIOR_TAG_BASE_URL}/${id}`,
      method: "delete",
    });
  },
};

export default PetAPI;
export * from "./types";
