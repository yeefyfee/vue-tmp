/**
 * 房间资源类型定义（MVP-WEB-02-02）
 *
 * 与后端 `niulai-nest/src/room` 的 RoomController / RoomService 契约一一对应。
 * 字段名保持后端原始命名（PRD《组件》§数据表格：列定义与后端字段一一对应）。
 */

import type { BaseQueryParams } from "@/api/common";

/**
 * 房间查询参数
 *
 * ⚠️ 房间端点是**存量分页口径**：`QueryRoomDto extends BaseQueryDto`，
 * 分页字段为 camelCase `pageNum` / `pageSize`，排序为 `sortBy` / `order`
 * （ASC|DESC）。传 snake_case 会被后端 whitelist 静默剥离并回落默认值
 * 而不报错（踩坑 53），故此处不得改写为新契约。
 *
 * 筛选维度：storeId / roomType / status / roomNo（前缀）。
 * 排序白名单（后端 service 收敛）：createdAt / roomNo / roomType / status。
 */
export interface RoomQueryParams extends BaseQueryParams {
  /** 所属门店 ID（uuid） */
  storeId?: string;
  /** 房型：1 笼位 / 2 独立房 / 3 猫房 / 4 狗房 / 5 VIP房 / 6 多宠房 */
  roomType?: number;
  /** 房态：1 空闲 / 2 在住 / 3 清扫中 / 4 维护中 */
  status?: number;
  /** 房间编号（前缀匹配） */
  roomNo?: string;
}

/**
 * 房间资源
 *
 * 服务端已统一处理：BigInt 主键序列化为字符串、时间列序列化为
 * `yyyy-MM-dd HH:mm:ss`（本地时区）。
 */
export interface RoomItem {
  /** 房间 ID（uuid） */
  id: string;
  /** 租户 ID（BigInt → 字符串） */
  tenantId: string;
  /** 所属门店 ID（uuid；不支持跨店迁移） */
  storeId: string;
  /** 房间名称（展示用，可空；看板优先显示名称，缺省回退编号） */
  name: string | null;
  /** 房间编号（同门店内唯一） */
  roomNo: string;
  /** 房型：1 笼位 / 2 独立房 / 3 猫房 / 4 狗房 / 5 VIP房 / 6 多宠房 */
  roomType: number;
  /** 容量（可同时容纳宠物数） */
  capacity: number;
  /** 适用宠物体重段（PRD allow_pet_size），如 `[{"min_kg":0,"max_kg":10}]` */
  allowPetSize: unknown;
  /** 房态：1 空闲 / 2 在住 / 3 清扫中 / 4 维护中 */
  status: number;
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
  /** 乐观锁版本号（创建为 0，每次更新 +1） */
  version: number;
}

/**
 * 房间创建 / 更新表单
 *
 * 与 `CreateRoomDto` / `UpdateRoomDto` 对齐。**不含 tenantId 与 status** ——
 *  · 租户归属恒由 JWT 上下文注入，请求体伪造会被后端白名单剥离；
 *  · `status` 是运行时房态，创建即空闲（schema 默认 1），人工写入口仅维护切换端点。
 *
 * `storeId` 仅创建时提交：更新时后端刻意收敛（房间不支持跨店迁移，换店 = 删旧建新）。
 * `version` 仅更新时必填（乐观锁）。
 */
export interface RoomForm {
  /** 所属门店 ID（uuid，创建必填） */
  storeId: string;
  /** 房间编号（1~16 字符，同门店内唯一） */
  roomNo: string;
  /** 房间名称（1~64 字符，可空） */
  name?: string;
  /** 房型：1~6 */
  roomType: number;
  /** 容量（1~32767） */
  capacity: number;
  /** 适用宠物体重段（可选） */
  allowPetSize?: Array<Record<string, unknown>>;
  /** 乐观锁版本号（更新必填） */
  version?: number;
}

/** 房态维护切换请求体（`PATCH /rooms/:id/status`，仅 1 / 4） */
export interface RoomStatusForm {
  /** 目标房态：仅允许 1（空闲）/ 4（维护中） */
  status: number;
}

/**
 * 房间更新表单（`UpdateRoomDto`）
 *
 * 相比 {@link RoomForm}：**去除 `storeId`**（后端刻意收敛，房间不支持跨店迁移）
 * 且 `version` 改为必填（乐观锁）。
 */
export type RoomUpdateForm = Omit<RoomForm, "storeId" | "version"> & { version: number };
