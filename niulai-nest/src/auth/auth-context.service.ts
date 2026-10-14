import { Injectable } from "@nestjs/common";

import { PrismaService } from "../common/prisma/prisma.service";
import { ErrorCode } from "../common/enums/error-code.enum";
import { BusinessException } from "../common/exceptions/business.exception";
import type { CurrentUserInfo } from "../common/interfaces/current-user.interface";
import { AuthService } from "./auth.service";

/**
 * 认证上下文服务（P0-02-06）
 *
 * 承载「上下文接口」的门店域读取与校验：
 *  - `GET /auth/organizations`：当前租户可切换门店列表（`prisma.scoped.store`
 *    自动注入租户条件，RLS 兜底）；
 *  - `POST /auth/switch-context`：目标门店归属/状态校验，再复用
 *    `AuthService.issueSwitchedAccessToken` 签发内嵌 `activeStoreId` 的新 access token。
 *
 * 独立于 AuthService 的原因：AuthService 是登录/刷新/tokenVersion 高敏感区
 * （既有 spec 按位置逐参实例化其构造函数），门店域读取所需的 PrismaService
 * 依赖全部收敛在本服务，**对 AuthService 只做「新增方法」级增量**。
 */
@Injectable()
export class AuthContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService
  ) {}

  /**
   * 当前租户可切换门店列表（切店 UI 数据源）
   *
   * 仅返回启用（status=1）且未软删的门店；租户过滤由 scoped 扩展按 ALS 上下文
   * 注入（路由已挂 @RequireTenant + TenantContextGuard，tenantId 保证非空），
   * 业务代码不从请求参数读取租户。
   */
  async listSwitchableStores(): Promise<
    Array<{ id: string; name: string; code: string; status: number }>
  > {
    return await this.prisma.scoped.store.findMany({
      where: { deletedAt: null, status: 1 },
      select: { id: true, name: true, code: true, status: true },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * 切换门店上下文（P0-02-06）
   *
   * 校验（fail-closed，统一 403 + A0212，不区分「不存在 / 跨租户 / 停用」以防
   * 门店枚举探测）：scoped 扩展注入 tenantId 条件——跨租户门店与不存在的
   * uuid 一样查不到；status !== 1 的停用门店同样拒绝。
   *
   * 签发复用 `AuthService.issueSwitchedAccessToken`（显式构造 payload，
   * jsonwebtoken 9 红线：verify 出的注册声明不展开重签）。
   */
  async switchStoreContext(
    currentUser: CurrentUserInfo,
    storeId: string
  ): Promise<{ accessToken: string; activeStore: { id: string; name: string } }> {
    const store = await this.prisma.scoped.store.findFirst({
      where: { id: storeId, deletedAt: null },
      select: { id: true, name: true, status: true },
    });
    if (!store || store.status !== 1) {
      throw new BusinessException(ErrorCode.STORE_CONTEXT_UNAVAILABLE);
    }

    const { accessToken } = await this.authService.issueSwitchedAccessToken(currentUser, store.id);
    return { accessToken, activeStore: { id: store.id, name: store.name } };
  }
}
