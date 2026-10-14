import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";

import { Permissions } from "../decorators/auth.decorator";
import { RequireTenant } from "../../tenant/decorators/require-tenant.decorator";
import { TenantContextGuard } from "../../tenant/guards/tenant-context.guard";
import { AuditLogQueryService } from "./audit-log-query.service";
import { QueryAuditLogDto } from "./dto/query-audit-log.dto";

/**
 * 审计日志查询接口（P0-02-08 子任务 4 · 租户内）
 *
 * 权限点：`audit:list`（PermissionGuard 校验；ROOT 角色直放——tenant_admin/admin
 * 均为 ROOT，无需权限种子即可访问，非 ROOT 角色的授权走角色-权限配置）。
 *
 * 租户上下文：类级 `@RequireTenant()` + `TenantContextGuard`（成对使用）——
 * 无租户上下文（平台 admin 等）一律 403 + A0302，fail-closed；
 * service 内查询 where 再显式注入 `tenantId = 上下文租户`（双保险，见
 * audit-log-query.service.ts 隔离契约注释）。
 *
 * TODO（开放问题 6，用户尚未拍板）：平台侧（tenant_id = 0 哨兵行）的审计查询
 * 通道不在本任务实现——平台 admin 对租户数据的操作归属口径拍板后另行开任务
 * 落地独立的平台侧查询端点（不走本租户内接口，也不复用本 DTO 的租户锚点语义）。
 *
 * 仅提供 GET /audit-logs 列表接口：审计复合主键 (id, created_at)，单条回看
 * 可用 entityId + entityType + 时间区间筛到唯一行，不为单查单开路由。
 */
@ApiTags("14.审计查询")
@Controller("audit-logs")
@UseGuards(TenantContextGuard)
@RequireTenant()
export class AuditLogQueryController {
  constructor(private readonly auditLogQueryService: AuditLogQueryService) {}

  @ApiOperation({ summary: "审计日志分页列表（对象/操作人/动作/时间区间筛选）" })
  @ApiOkResponse({ description: "统一信封 data = { list, total, page, page_size }（A4）" })
  @Get()
  @Permissions("audit:list")
  async getAuditLogPage(@Query() query: QueryAuditLogDto) {
    return await this.auditLogQueryService.findPage(query);
  }
}
