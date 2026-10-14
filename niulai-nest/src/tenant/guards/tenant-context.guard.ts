import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RequestContext } from "../../common/context/request-context";
import { ErrorCode } from "../../common/enums/error-code.enum";
import { BusinessException } from "../../common/exceptions/business.exception";
import { TENANT_REQUIRED_KEY } from "../decorators/require-tenant.decorator";

/**
 * 租户上下文守卫（PEL-11 租户隔离基线）
 *
 * 仅对 `@RequireTenant()` 标注的路由生效：
 *  - 上下文里没有租户ID ⇒ 403 + 业务码 `A0302`（fail-closed，验收标准「无租户上下文的查询被拒绝」）；
 *  - 有租户ID ⇒ 放行（租户是否真实存在/停用，归 P0-03-01 的租户管理服务校验）。
 *
 * 取值顺序：`RequestContext.getTenantId()`（DataScopeGuard 已随认证写入）
 * → 回退 `request.user.tenantId`（令牌直读，与全局守卫顺序解耦）。
 * 全局守卫顺序：AuthGuard → DataScopeGuard → PermissionGuard，本守卫按路由挂载，天然在其后。
 */
@Injectable()
export class TenantContextGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean>(TENANT_REQUIRED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // 未标注路由：不拦截（平台级接口不受租户约束）
    if (!required) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const tenantId = RequestContext.getTenantId() || request?.user?.tenantId || null;

    if (!tenantId) {
      throw new BusinessException(ErrorCode.TENANT_CONTEXT_MISSING);
    }

    // 归一化写入上下文，后续 Prisma 扩展 / Redis 前缀统一从这里取
    RequestContext.setTenantId(String(tenantId));
    return true;
  }
}
