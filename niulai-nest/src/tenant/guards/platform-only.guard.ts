import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { RequestContext } from "../../common/context/request-context";
import { ErrorCode } from "../../common/enums/error-code.enum";
import { BusinessException } from "../../common/exceptions/business.exception";

/**
 * 平台隔离守卫（P0-03-04）
 *
 * 语义：标注 `@UseGuards(PlatformOnlyGuard)` 的路由**只允许平台级账号访问**——
 * 请求携带任何租户上下文（`RequestContext.getTenantId()` 或 JWT payload 里的
 * `user.tenantId` 非空）一律 403 + A0305「仅平台账号可操作」。
 *
 * 存在必要性：平台侧租户管理接口（GET/PATCH /tenants*）若不加此守卫，
 * 租户 ROOT（tenant_admin）会因 ROOT 角色直放 PermissionGuard 而拿到接口——
 * 就能改自己租户的 plan/feature_flags，属于提权破洞。
 *
 * 时序：全局守卫链（AuthGuard → DataScopeGuard → PermissionGuard）先于路由守卫
 * 执行，`RequestContext` 的租户上下文在本守卫运行前已由认证链写入，
 * 取值顺序与 `TenantContextGuard` 保持一致（上下文优先，令牌直读兜底）。
 */
@Injectable()
export class PlatformOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const tenantId = RequestContext.getTenantId() || request?.user?.tenantId || null;

    if (tenantId) {
      throw new BusinessException(ErrorCode.TENANT_PLATFORM_ONLY);
    }
    return true;
  }
}
