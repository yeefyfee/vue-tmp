/**
 * 经营工作台 API（MVP-WEB-03-01 布局 / MVP-WEB-03-02 增量轮询）
 *
 * 契约来源：`niulai-nest/src/dashboard/dashboard.controller.ts`
 *  - `GET /api/v1/dashboard/overview?since=<revision>`  工作台总览
 *    （登录即可访问，需租户上下文；`since` 命中指纹时返回 `changed:false` 轻量响应）
 *
 * ⚠️ 该端点**不声明权限码**（工作台为登录后落地首页，面向全部登录角色），
 * 前端也不做 `v-hasPerm` 门控 —— 与路由表 `constantRoutes` 的静态首页一致。
 *
 * 租户隔离由后端 `prisma.scoped.*` + RLS 兜底；门店维度由请求头
 * `x-store-id`（切店上下文）决定，前端无需传参。
 *
 * 实时刷新（03-02）：60s 轮询本端点（增量 `since`）+ 订阅 SSE `dashboard` 事件即时刷新。
 */

import request from "@/utils/request";
import type { DashboardOverviewResponse } from "./types";

const DASHBOARD_BASE_URL = "/api/v1/dashboard";

const DashboardAPI = {
  /**
   * 工作台总览（今日数据 / 今天的工作 / 需要你处理）
   *
   * @param since 上次的 `revision` 指纹；传入且命中时服务端返回 `changed:false`
   *              的轻量响应（省去全量聚合），实现增量轮询。
   */
  getOverview(params?: { since?: string }) {
    return request<unknown, DashboardOverviewResponse>({
      url: `${DASHBOARD_BASE_URL}/overview`,
      method: "get",
      params,
    });
  },
};

export default DashboardAPI;
