/**
 * 业务相关枚举
 *
 * @description
 * 包含菜单、用户、角色等业务实体的枚举定义
 */

/**
 * 菜单类型枚举
 */
export enum MenuTypeEnum {
  CATALOG = "C", // 目录
  MENU = "M", // 菜单
  EXTERNAL = "E", // 外链
  BUTTON = "B", // 按钮
}

/**
 * 菜单范围枚举
 */
export enum MenuScopeEnum {
  PLATFORM = 1, // 平台菜单
  TENANT = 2, // 业务菜单
}

/**
 * 用户性别枚举
 */
export enum UserGender {
  /** 未知 */
  UNKNOWN = 0,
  /** 男 */
  MALE = 1,
  /** 女 */
  FEMALE = 2,
}

/**
 * 门店类型枚举（P0-04-02 · `CreateStoreDto.type`）
 *
 * 门店状态复用 {@link CommonStatus}（1 启用 / 0 停用），不另立口径。
 */
export enum StoreType {
  /** 直营 */
  DIRECT = 1,
  /** 加盟 */
  FRANCHISE = 2,
}

/**
 * 房型枚举（P0-04-03 · `CreateRoomDto.roomType`）
 *
 * 与后端 schema 注释一一对应（`room.room_type` SmallInt）。
 */
export enum RoomType {
  /** 笼位 */
  KENNEL = 1,
  /** 独立房 */
  SUITE = 2,
  /** 猫房 */
  CAT = 3,
  /** 狗房 */
  DOG = 4,
  /** VIP 房 */
  VIP = 5,
  /** 多宠房 */
  MULTI = 6,
}

/**
 * 房态枚举（P0-04-03 · `room.status`）
 *
 * 运行时房态：1/2/3 由 stay 状态机自动流转（后续任务），人工写入口仅有
 * `PATCH /rooms/:id/status` 的维护切换（**仅 1 ↔ 4**，目标 2/3 后端拒绝 A0433）。
 */
export enum RoomStatus {
  /** 空闲 */
  AVAILABLE = 1,
  /** 在住 */
  OCCUPIED = 2,
  /** 清扫中 */
  CLEANING = 3,
  /** 维护中 */
  MAINTENANCE = 4,
}

/**
 * 客户性别枚举（P0-05-02 · `customer.gender`）
 *
 * 与 `@peluvida/shared` 的 `CustomerGender` 同值域（DB 列 `SmallInt`，可空=未登记）。
 */
export enum CustomerGender {
  /** 未知 */
  UNKNOWN = 0,
  /** 男 */
  MALE = 1,
  /** 女 */
  FEMALE = 2,
}

/**
 * 客户生命周期分层（P0-05-06 · `customer.lifecycle`）
 *
 * 与 `@peluvida/shared` 的 `CustomerLifecycle` 同值域（非空，默认 `NEW`）。
 */
export enum CustomerLifecycle {
  /** 新客 */
  NEW = 1,
  /** 活跃 */
  ACTIVE = 2,
  /** 沉睡 */
  DORMANT = 3,
  /** 流失 */
  LOST = 4,
}

/**
 * 触达渠道（P0-05-04 · `reach_log.channel`）
 *
 * 与 `@peluvida/shared` 的 `ReachChannel` 同值域（`SmallInt`，非空）。
 */
export enum ReachChannel {
  /** 站内信 */
  INAPP = 1,
  /** 微信服务号 */
  SERVICE_ACCOUNT = 2,
  /** 小程序订阅消息 */
  SUBSCRIBE_MESSAGE = 3,
  /** 短信 */
  SMS = 4,
}

/**
 * 触达结果（P0-05-04 · `reach_log.result`）
 *
 * `null` = 未回执（与「触达失败」语义不同），前端须区分渲染。
 */
export enum ReachResult {
  /** 成功 */
  SUCCESS = 1,
  /** 失败 */
  FAILED = 2,
}

/**
 * 黑名单状态（P0-05-05 · `blacklist.status`）
 *
 * 解除为 status 1→0（**保留行为记录，不物理删**），故列表需同时呈现两种状态。
 */
export enum BlacklistStatus {
  /** 解除 */
  RELEASED = 0,
  /** 生效 */
  ACTIVE = 1,
}

/**
 * 宠物类型（P0-05-03 · `customer_pet.pet_type` 冗余快照口径）
 *
 * 与 `@peluvida/shared` 的 `PetType` 同值域；宠物实体域（P0-06）落地前，
 * 客户详情的宠物卡片类型标签以此为准。
 */
export enum CustomerPetType {
  /** 犬 */
  DOG = 1,
  /** 猫 */
  CAT = 2,
  /** 其他 */
  OTHER = 9,
}

/**
 * 黑名单范围（P0-05-05 · `blacklist.store_id` 的可空语义）
 *
 * 与 `@peluvida/shared` 的 `BLACKLIST_SCOPE_VALUES` 同值域（字符串枚举，
 * 非 DB 列）：`tenant` → `store_id IS NULL`（对租户所有门店生效）；
 * `store` → `store_id NOT NULL`（仅指定门店生效）。
 */
export enum BlacklistScope {
  /** 门店级 */
  STORE = "store",
  /** 租户级 */
  TENANT = "tenant",
}

/**
 * 宠物转移申请状态（P0-05-03 · `pet_transfer_request.status`）
 *
 * 状态机：1 待审批 → 2 已通过 / 3 已拒绝 / 4 已撤销（终态不可再流转）。
 * 审批通过是**归属变更的唯一合法通道**（PRD《客户管理》FR-2 / BR-4）。
 */
export enum PetTransferStatus {
  /** 待审批 */
  PENDING = 1,
  /** 已通过（归属已变更） */
  APPROVED = 2,
  /** 已拒绝 */
  REJECTED = 3,
  /** 已撤销 */
  CANCELLED = 4,
}

/**
 * 宠物类型（P0-06-02 · `pet.pet_type`）
 *
 * 与 `@peluvida/shared` 的 `PetType` 同值域。注意区别于 {@link CustomerPetType}
 * （后者是 `customer_pet.pet_type` 的冗余快照口径）—— 两者取值相同但归属表不同，
 * 宠物实体域（P0-06）落地后以此为准。
 */
export enum PetType {
  /** 犬 */
  DOG = 1,
  /** 猫 */
  CAT = 2,
  /** 其他 */
  OTHER = 9,
}

/**
 * 宠物性别（P0-06-02 · `pet.gender`）
 *
 * 与客户性别的取值语义不同：宠物 `2` = 母（非「女」），`null` = 未登记。
 */
export enum PetGender {
  /** 公 */
  MALE = 1,
  /** 母 */
  FEMALE = 2,
}

/**
 * 健康记录类型（P0-06-03 · `health_record.record_type`）
 *
 * 值域与后端 `niulai-nest/src/pet/pet-health.constants.ts` 的 `HealthRecordType`
 * 一一对应（该常量尚未上收 `@peluvida/shared`，前端镜像同一口径）。
 */
export enum HealthRecordType {
  /** 疫苗 */
  VACCINE = 1,
  /** 驱虫 */
  DEWORM = 2,
  /** 过敏 */
  ALLERGY = 3,
  /** 用药 */
  MEDICATION = 4,
  /** 绝育 */
  STERILIZATION = 5,
  /** 慢病 */
  CHRONIC = 6,
}

/**
 * 时间线事件类型（P0-06-06 · `timeline_event.event_type`）
 *
 * 与 `@peluvida/shared` 的 `TimelineEventType` 同值域（1~8 与 DB 列注释一致）。
 */
export enum TimelineEventType {
  /** 入驻 */
  CHECK_IN = 1,
  /** 离店 */
  CHECK_OUT = 2,
  /** 喂养 */
  FEEDING = 3,
  /** 洗护 */
  GROOMING = 4,
  /** 医疗 */
  MEDICAL = 5,
  /** 体重 */
  WEIGHT = 6,
  /** 照片 */
  PHOTO = 7,
  /** 系统 */
  SYSTEM = 8,
}

/**
 * 时间线操作者类型（P0-06-06 · `timeline_event.actor_type`）
 *
 * 与 `@peluvida/shared` 的 `TimelineActorType` 同值域。
 */
export enum TimelineActorType {
  /** 员工 */
  STAFF = 1,
  /** 系统（自动任务 / 队列消费） */
  SYSTEM = 2,
  /** 宠主 */
  OWNER = 3,
}

/**
 * 行为标签状态（P0-06-05 · `behavior_tag.status`）
 *
 * 停用后新宠物不可挂载，**存量关联保留**（故宠物标签云仍可能展示停用标签）。
 */
export enum BehaviorTagStatus {
  /** 停用 */
  DISABLED = 0,
  /** 启用 */
  ENABLED = 1,
}
