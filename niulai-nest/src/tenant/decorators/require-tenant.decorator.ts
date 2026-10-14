import { SetMetadata } from "@nestjs/common";

/** 路由元数据键：该路由要求租户上下文 */
export const TENANT_REQUIRED_KEY = "tenant:required";

/**
 * 标记路由需要租户上下文（PEL-11）
 *
 * 用法（与 `@RequireTenant` + `TenantContextGuard` 成对使用）：
 * ```ts
 * @UseGuards(TenantContextGuard)
 * @RequireTenant()
 * @Get("customers")
 * listCustomers() { ... }
 * ```
 *
 * 设计为**显式 opt-in**：全局守卫链里已有的平台级接口（14 张 sys_* 与 gen_* 表）
 * 不受影响；业务模块（P0-03 之后）逐路由标注。租户ID 只来自 JWT payload，
 * **不接受请求参数 / 请求头传入**。
 */
export const RequireTenant = () => SetMetadata(TENANT_REQUIRED_KEY, true);
