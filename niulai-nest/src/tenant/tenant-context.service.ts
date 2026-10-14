import { Injectable } from "@nestjs/common";
import { RequestContext } from "../common/context/request-context";
import { BusinessException } from "../common/exceptions/business.exception";
import { ErrorCode } from "../common/enums/error-code.enum";
import { TENANT_GUC_KEY } from "./tenant.constants";

/**
 * 租户上下文服务（PEL-11 租户隔离基线）
 *
 * 职责边界：
 *  - **只读地**暴露当前请求的租户ID（真源是 JWT payload → `RequestContext`）；
 *  - 提供 `requireTenantId()` 的 fail-closed 入口：没有上下文就抛业务异常，
 *    绝不返回兜底值 —— 「无租户上下文的查询被拒绝」这条验收标准的代码侧实现。
 *
 * 不做的事：解析/校验租户是否存在（P0-03-01 出租户模型后由 tenant 管理服务承接）、
 * Prisma 扩展挂链（CROSS-09）、Redis 键规范（CROSS-10）。
 */
@Injectable()
export class TenantContextService {
  /** 当前请求的租户ID；平台级账号 / 未登录请求为 null */
  getTenantId(): string | null {
    return RequestContext.getTenantId();
  }

  /**
   * 取当前租户ID，**没有就拒绝**（fail-closed）。
   *
   * 供租户范围的业务方法入口处调用；配合 `@RequireTenant()` 守卫可提前到路由层拦截。
   */
  requireTenantId(): string {
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw new BusinessException(ErrorCode.TENANT_CONTEXT_MISSING);
    }
    return tenantId;
  }

  /** RLS 会话变量（GUC）的键名，CROSS-09 落地 `SET LOCAL` 时使用 */
  get gucKey(): string {
    return TENANT_GUC_KEY;
  }
}
