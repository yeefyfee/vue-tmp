/**
 * 房间资源 API（MVP-WEB-02-02）
 *
 * 契约来源：`niulai-nest/src/room/room.controller.ts`（P0-04-03 · FR-2）
 *  - `GET    /api/v1/rooms`              房间分页列表（权限 `room:list`）
 *  - `GET    /api/v1/rooms/:id`          房间详情（权限 `room:list`）
 *  - `POST   /api/v1/rooms`              创建房间（权限 `room:create`，幂等）
 *  - `PUT    /api/v1/rooms/:id`          更新房间（权限 `room:update`，`version` 乐观锁必填）
 *  - `DELETE /api/v1/rooms/:id`          删除房间（权限 `room:delete`，软删）
 *  - `PATCH  /api/v1/rooms/:id/status`   房态维护切换（权限 `room:update`，仅 1 ↔ 4）
 *
 * 路由顺序注意：后端 `GET /rooms/availability` 是静态段（房态看板数据源，
 * 归 MVP-WEB-09-01），声明在 `/rooms/:id` 之前；前端不消费该端点，无需处理。
 *
 * 请求层（`utils/request.ts`）已自动为写方法注入 `Idempotency-Key`，
 * 故创建重复提交天然幂等，页面无需手工管理幂等键。
 */

import request from "@/utils/request";
import type { PageResult } from "@/api/common";
import type { RoomForm, RoomItem, RoomQueryParams, RoomStatusForm, RoomUpdateForm } from "./types";

const ROOM_BASE_URL = "/api/v1/rooms";

const RoomAPI = {
  /** 分页查询房间列表 */
  getPage(params: RoomQueryParams) {
    return request<unknown, PageResult<RoomItem>>({
      url: `${ROOM_BASE_URL}`,
      method: "get",
      params,
    });
  },

  /** 查询房间详情 */
  getDetail(id: string) {
    return request<unknown, RoomItem>({
      url: `${ROOM_BASE_URL}/${id}`,
      method: "get",
    });
  },

  /** 创建房间（幂等） */
  create(data: RoomForm) {
    return request<unknown, RoomItem>({
      url: `${ROOM_BASE_URL}`,
      method: "post",
      data,
    });
  },

  /**
   * 更新房间
   *
   * `version` 为乐观锁：与库内不一致时后端返回 `ROOM_VERSION_CONFLICT`，
   * 冲突提示由请求层统一渲染（PRD《操作流程》§流程通用规则 3）。
   *
   * 入参用 {@link RoomUpdateForm}：**不含 `storeId`**（后端刻意收敛，房间不支持跨店迁移）。
   */
  update(id: string, data: RoomUpdateForm) {
    return request<unknown, RoomItem>({
      url: `${ROOM_BASE_URL}/${id}`,
      method: "put",
      data,
    });
  },

  /** 删除房间（软删） */
  deleteById(id: string) {
    return request<unknown, { success: boolean }>({
      url: `${ROOM_BASE_URL}/${id}`,
      method: "delete",
    });
  },

  /**
   * 房态维护切换（仅 1 空闲 ↔ 4 维护中）
   *
   * 目标值 2 / 3 由 stay 状态机流转，人工提交会被后端拒绝（A0433）。
   */
  switchStatus(id: string, data: RoomStatusForm) {
    return request<unknown, { success: boolean }>({
      url: `${ROOM_BASE_URL}/${id}/status`,
      method: "patch",
      data,
    });
  },
};

export default RoomAPI;

export * from "./types";
