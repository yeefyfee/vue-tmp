import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { IS_PUBLIC_KEY } from "../decorators/auth.decorator";
import { BusinessException } from "../exceptions/business.exception";

import { OwnershipErrorCode } from "./ownership.error-codes";
import {
  OWNERSHIP_METADATA_KEY,
  type OwnershipGuardMode,
  type RequireOwnershipOptions,
} from "./ownership.decorator";
import { OwnershipService } from "./ownership.service";
import type { OwnershipEntityType } from "./ownership.types";

/**
 * P0-07-03 归属链越权防护基座 —— OwnershipGuard
 *
 * 声明式守卫：读取 `@RequireOwnership(...)` 元数据，在进入 handler 前执行
 * 归属链断言；未声明元数据的接口**不介入**（放行），`@Public()` 接口直接放行
 * （与 PermissionGuard / DataScopeGuard 的 Public 语义一致）。
 *
 * ⚠️ 本轮**不在任何控制器启用**（避免与并行代理冲突）；仅提供实现 + 单测。
 * 逐端点 opt-in 时，须在目标模块的 providers 中注册 `OwnershipGuard`
 * （并确保 `OwnershipService` 可注入），再以 `@UseGuards(OwnershipGuard)` 启用。
 *
 * 说明：`canActivate` 只做「读元数据 → 解析计划 → 委派 service 断言」，
 * 具体解析逻辑抽到纯函数 {@link resolveOwnershipPlan}（可单测、无 DI 依赖）。
 */
@Injectable()
export class OwnershipGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly ownership: OwnershipService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Public 接口不做归属校验（与全局守卫链 Public 语义一致）
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    // 未声明归属要求 → 本守卫不介入
    const options = this.reflector.getAllAndOverride<RequireOwnershipOptions>(
      OWNERSHIP_METADATA_KEY,
      [context.getHandler(), context.getClass()]
    );
    if (!options) {
      return true;
    }

    const request = context.switchToHttp().getRequest<OwnershipRequestLike>();
    const plan = resolveOwnershipPlan(options, request);

    switch (plan.mode) {
      case "owner":
        await this.ownership.assertCustomerOwnsPet(plan.customerId, plan.entityId);
        break;
      case "reachable":
        await this.ownership.assertPetAccessibleByCustomer(plan.customerId, plan.entityId);
        break;
      case "tenant":
      default:
        await this.ownership.assertTenantScoped(plan.entity, plan.entityId);
        break;
    }

    return true;
  }
}

/** 守卫视角下的最小请求对象视图 */
export interface OwnershipRequestLike {
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  user?: { customerId?: unknown } | null;
}

/** 解析后的归属校验计划（交给 OwnershipService 执行） */
export interface OwnershipPlan {
  readonly entity: OwnershipEntityType;
  readonly entityId: string;
  readonly mode: OwnershipGuardMode;
  /** owner / reachable 模式下的目标客户 id；tenant 模式为空串 */
  readonly customerId: string;
}

/**
 * 纯函数：把 `@RequireOwnership` 元数据 + 请求对象解析为可执行的归属校验计划。
 *
 * 解析规则：
 *  - 实体 id 取值来源：`options.paramSource`（默认 params）下、`options.idParam`（默认 "id"）；
 *  - `mode` 默认 `"tenant"`；
 *  - `owner` / `reachable` 模式：客户 id 依次取
 *    `paramSource[customerIdParam ?? "customerId"]` → `request.user.customerId`（兜底）；
 *  - 缺失实体 id → `ENTITY_ID_REQUIRED`；缺客户上下文 → `ACTOR_CUSTOMER_REQUIRED`（fail-closed）。
 *
 * @throws BusinessException `ENTITY_ID_REQUIRED` / `ACTOR_CUSTOMER_REQUIRED`
 */
export function resolveOwnershipPlan(
  options: RequireOwnershipOptions,
  request: OwnershipRequestLike | undefined
): OwnershipPlan {
  const source = options.paramSource ?? "params";
  const bag = (request?.[source] as Record<string, unknown> | undefined) ?? {};

  const idParam = options.idParam ?? "id";
  const entityId = readString(bag[idParam]);
  if (!entityId) {
    throw new BusinessException(OwnershipErrorCode.ENTITY_ID_REQUIRED);
  }

  const mode: OwnershipGuardMode = options.mode ?? "tenant";
  if (mode === "owner" || mode === "reachable") {
    const customerIdParam = options.customerIdParam ?? "customerId";
    const customerId = readString(bag[customerIdParam]) || readString(request?.user?.customerId);
    if (!customerId) {
      throw new BusinessException(OwnershipErrorCode.ACTOR_CUSTOMER_REQUIRED);
    }
    return { entity: options.entity, entityId, mode, customerId };
  }

  return { entity: options.entity, entityId, mode, customerId: "" };
}

/** 把任意值归一化为去空白字符串；缺失 / 空 → 空串 */
function readString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}
