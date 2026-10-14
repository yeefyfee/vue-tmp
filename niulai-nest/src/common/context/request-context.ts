import { AsyncLocalStorage } from "async_hooks";
import type { CurrentUserInfo } from "../interfaces/current-user.interface";
import type { RoleDataScope } from "../models/role-data-scope.model";
import type { DataPermissionConfig } from "../decorators/data-permission.decorator";
export type { DataPermissionConfig };

/** 请求上下文，基于 AsyncLocalStorage 实现请求级隔离 */
export class RequestContext {
  private static asyncLocalStorage = new AsyncLocalStorage<{
    user: CurrentUserInfo;
    dataPermissionConfig: DataPermissionConfig | null;
    tenantId: string | null;
    traceId: string | null;
    storeId: string | null;
    client: string | null;
    idempotencyKey: string | null;
  }>();

  /**
   * 当前请求的 trace_id（CROSS-14 结构化日志）
   *
   * 由 `RequestContextMiddleware` 在请求入口生成（`X-Trace-Id` 请求头优先透传，
   * 否则生成 UUID），贯穿 controller / service / repository 全链路日志；
   * winston 的 trace-context format 从这里读取，业务代码无需手动传递。
   */
  static getTraceId(): string | null {
    return RequestContext.asyncLocalStorage.getStore()?.traceId ?? null;
  }

  /** 写入 trace_id（仅限请求入口中间件调用） */
  static setTraceId(traceId: string | null): void {
    const store = RequestContext.asyncLocalStorage.getStore();
    if (store) {
      store.traceId = traceId && String(traceId).trim() !== "" ? String(traceId) : null;
    }
  }

  static setCurrentUser(user: CurrentUserInfo | null): void {
    const store = RequestContext.asyncLocalStorage.getStore();
    if (store) {
      store.user =
        user ||
        ({
          userId: "",
          deptId: "",
          deptTreePath: "",
          dataScopes: [],
          roles: [],
        } as CurrentUserInfo);
    }
  }

  static getCurrentUser(): CurrentUserInfo | null {
    const store = RequestContext.asyncLocalStorage.getStore();
    if (!store?.user || !store.user.userId) {
      return null;
    }
    return store.user;
  }

  static getUserId(): string | null {
    return RequestContext.getCurrentUser()?.userId ?? null;
  }

  static getDeptId(): string | null {
    return RequestContext.getCurrentUser()?.deptId ?? null;
  }

  static getDataScopes(): RoleDataScope[] {
    return RequestContext.getCurrentUser()?.dataScopes ?? [];
  }

  static isRoot(): boolean {
    return RequestContext.getCurrentUser()?.isRoot ?? false;
  }

  /**
   * 当前请求的租户ID（PEL-11 租户隔离基线）
   *
   * 取值来源是 JWT payload（经 `DataScopeGuard` 写入），**不接受请求参数传入**；
   * 平台级账号 / 未登录请求返回 `null`。
   * 租户范围的数据访问（Prisma 扩展注入、Redis 键前缀、RLS 会话变量）都以它为锚点。
   */
  static getTenantId(): string | null {
    return RequestContext.asyncLocalStorage.getStore()?.tenantId ?? null;
  }

  /** 写入当前请求的租户ID（仅限认证/守卫链内部调用，业务代码不应直接写） */
  static setTenantId(tenantId: string | null): void {
    const store = RequestContext.asyncLocalStorage.getStore();
    if (store) {
      store.tenantId = tenantId && String(tenantId).trim() !== "" ? String(tenantId) : null;
    }
  }

  static setDataPermissionConfig(config: DataPermissionConfig | null): void {
    const store = RequestContext.asyncLocalStorage.getStore();
    if (store) {
      store.dataPermissionConfig = config;
    }
  }

  static getDataPermissionConfig(): DataPermissionConfig | null {
    return RequestContext.asyncLocalStorage.getStore()?.dataPermissionConfig ?? null;
  }

  /**
   * 当前请求的门店ID（P0-01-04 统一请求头）
   *
   * 来源是 `X-Store-Id` 请求头（经 `RequestContextMiddleware` 写入）；
   * 平台级接口 / 未携带该头的请求返回 `null`。
   * 业务侧语义：**租户上下文来自令牌（不可传参），门店上下文来自请求头（用户可切换）**；
   * 多门店接口的「缺头报错策略」由各业务 controller/service 按需启用
   * （`requireStoreId`），基座只负责解析与透传。
   */
  static getStoreId(): string | null {
    return RequestContext.asyncLocalStorage.getStore()?.storeId ?? null;
  }

  /**
   * 写入当前请求的门店ID
   *
   * 调用方：请求入口中间件（x-store-id 请求头）；以及认证链内的令牌兜底
   * （P0-02-06，JwtStrategy 将 switch-context 签发的 activeStoreId 写入，
   * 仅当请求头未携带时 —— 请求头显式优先于令牌内嵌值）。
   */
  static setStoreId(storeId: string | null): void {
    const store = RequestContext.asyncLocalStorage.getStore();
    if (store) {
      store.storeId = storeId && String(storeId).trim() !== "" ? String(storeId) : null;
    }
  }

  /**
   * 当前请求的客户端类型（P0-01-04 统一请求头）
   *
   * 来源是 `X-Client` 请求头（约定取值：`web` / `staff` / `owner`，
   * 与三端对应；未携带时为 `null`，仅作透传记录，不做枚举强校验——
   * 严格校验留给有明确业务分叉的场景按需启用）。
   */
  static getClient(): string | null {
    return RequestContext.asyncLocalStorage.getStore()?.client ?? null;
  }

  /** 写入当前请求的客户端类型（仅限请求入口中间件调用） */
  static setClient(client: string | null): void {
    const store = RequestContext.asyncLocalStorage.getStore();
    if (store) {
      store.client = client && String(client).trim() !== "" ? String(client) : null;
    }
  }

  /**
   * 当前请求的幂等键（P0-01-04 统一请求头）
   *
   * 来源是 `Idempotency-Key` 请求头（决策 A4：POST 与支付类接口必须携带）。
   * 基座只解析与透传；**幂等去重判定**（首次写入 / 重复返回同一结果）
   * 由支付 / 下单等具体写接口结合 Redis 实现，不在中间件层统一拦截。
   */
  static getIdempotencyKey(): string | null {
    return RequestContext.asyncLocalStorage.getStore()?.idempotencyKey ?? null;
  }

  /** 写入当前请求的幂等键（仅限请求入口中间件调用） */
  static setIdempotencyKey(idempotencyKey: string | null): void {
    const store = RequestContext.asyncLocalStorage.getStore();
    if (store) {
      store.idempotencyKey =
        idempotencyKey && String(idempotencyKey).trim() !== "" ? String(idempotencyKey) : null;
    }
  }

  /** 断言当前请求必须携带门店上下文（多门店接口的缺头策略钩子） */
  static requireStoreId(): string {
    const storeId = RequestContext.getStoreId();
    if (!storeId) {
      throw new Error("[RequestContext] 缺少 X-Store-Id 请求头（多门店接口要求携带门店上下文）");
    }
    return storeId;
  }

  static run<T>(callback: () => T): T {
    return RequestContext.asyncLocalStorage.run(
      {
        user: {
          userId: "",
          deptId: "",
          deptTreePath: "",
          dataScopes: [],
          roles: [],
        },
        dataPermissionConfig: null,
        tenantId: null,
        traceId: null,
        storeId: null,
        client: null,
        idempotencyKey: null,
      },
      callback
    );
  }

  static initUserContext(user: CurrentUserInfo): void {
    const store = RequestContext.asyncLocalStorage.getStore();
    if (store) {
      store.user = user;
      // 租户上下文与用户上下文同源（JWT payload），一并写入（PEL-11）
      RequestContext.setTenantId(user.tenantId ?? null);
    }
  }
}
