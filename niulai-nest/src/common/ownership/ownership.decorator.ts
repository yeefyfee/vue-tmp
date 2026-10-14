import { SetMetadata } from "@nestjs/common";

import type { OwnershipEntityType } from "./ownership.types";

/**
 * P0-07-03 归属链越权防护基座 —— @RequireOwnership 元数据装饰器
 *
 * 用法：在控制器类或方法上声明「进入本 handler 前须通过归属链校验」，
 * 由 {@link OwnershipGuard} 读取本元数据并执行对应断言。
 *
 * ⚠️ 本轮**不接入任何既有业务端点**（避免与并行代理的文件冲突）；本装饰器
 * 与守卫仅提供实现 + 单测，逐端点 opt-in 见 OwnershipService 头部接入清单。
 *
 * 用法示例：
 * ```ts
 * // 1) 宠物资源：仅要求「实体在本租户可达」
 * @Get(":id")
 * @RequireOwnership({ entity: "pet", idParam: "id" })
 * detail(@Param("id") id: string) { ... }
 *
 * // 2) 宠主端：要求「该客户拥有此宠物」（customerId 走路由参数）
 * @Get(":customerId/pets/:id")
 * @RequireOwnership({ entity: "pet", idParam: "id", mode: "owner", customerIdParam: "customerId" })
 * ownerDetail(@Param("customerId") c: string, @Param("id") id: string) { ... }
 * ```
 */

/** 归属校验元数据键（Reflector 读取用） */
export const OWNERSHIP_METADATA_KEY = "peluvida:ownership";

/**
 * 归属校验模式：
 *  - `"tenant"`：仅要求实体在当前租户可达（默认，对应 `assertTenantScoped`）；
 *  - `"owner"`：要求某客户是该宠物主人（对应 `assertCustomerOwnsPet`）；
 *  - `"reachable"`：要求某客户对宠物归属链可达（对应 `assertPetAccessibleByCustomer`）。
 */
export type OwnershipGuardMode = "tenant" | "owner" | "reachable";

/** 实体 id 的取值来源（默认路由参数） */
export type OwnershipParamSource = "params" | "query" | "body";

/** @RequireOwnership 选项 */
export interface RequireOwnershipOptions {
  /** 被校验的归属实体类型（须已在 OWNERSHIP_ENTITY_MODEL 声明映射；tenant 模式用） */
  readonly entity: OwnershipEntityType;
  /** 携带实体 id 的参数名，默认 `"id"` */
  readonly idParam?: string;
  /** 校验模式，默认 `"tenant"` */
  readonly mode?: OwnershipGuardMode;
  /** owner / reachable 模式下，携带 customerId 的参数名，默认 `"customerId"` */
  readonly customerIdParam?: string;
  /** id 取值来源，默认 `"params"`（路由参数） */
  readonly paramSource?: OwnershipParamSource;
}

/**
 * 声明式归属链校验装饰器（opt-in）。
 *
 * 只负责写入元数据；实际校验由 {@link OwnershipGuard} 完成。
 * 可标注在类（作用于全部 handler）或方法（覆盖类级声明 —— getAllAndOverride 语义）上。
 */
export const RequireOwnership = (
  options: RequireOwnershipOptions
): MethodDecorator & ClassDecorator => SetMetadata(OWNERSHIP_METADATA_KEY, { ...options });
