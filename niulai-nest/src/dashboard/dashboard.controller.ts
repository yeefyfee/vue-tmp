import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import { RequireTenant } from "../tenant/decorators/require-tenant.decorator";
import { TenantContextGuard } from "../tenant/guards/tenant-context.guard";
import { DashboardService } from "./dashboard.service";
import { DashboardOverviewQueryDto } from "./dto/dashboard-overview.dto";

/**
 * 经营工作台接口（MVP-WEB-03-01 布局 / MVP-WEB-03-02 增量轮询）
 *
 * 权限口径：**不声明 `@Permissions`** —— 工作台是登录后的落地首页（前端
 * `constantRoutes` 静态页 `/dashboard`，非 RBAC 动态菜单），PRD《页面功能》
 * §5.2「老板打开后 10 秒知道今天店里发生了什么」面向全部登录角色。
 * 租户上下文仍强约束（类级 `@RequireTenant()` + `TenantContextGuard`）：
 * 无租户上下文（平台级 admin）一律 403 + A0302，fail-closed。
 *
 * 只读端点：无 `@Audit`（不产生审计轨）。
 *
 * MVP-WEB-03-02 实时刷新：本端点支持 `since=<revision>` 增量语义（见
 * `DashboardOverviewQueryDto`）；关键状态变化的**即时推送**走既有 SSE 总线
 * （`SseService.sendDashboardChange`，事件名 `dashboard`，租户级定向）。
 */
@ApiTags("00.经营工作台")
@Controller("dashboard")
@UseGuards(TenantContextGuard)
@RequireTenant()
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @ApiOperation({ summary: "经营工作台总览（今日数据 / 今天的工作 / 需要你处理）" })
  @Get("overview")
  async getOverview(@Query() query: DashboardOverviewQueryDto) {
    return await this.dashboardService.getOverview(query.since);
  }
}
