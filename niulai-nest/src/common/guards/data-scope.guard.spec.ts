import type { Reflector } from "@nestjs/core";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { DataScopeGuard } from "./data-scope.guard";
import { RequestContext } from "../context/request-context";

/**
 * DataScopeGuard 单测（P0-03-02 验收断言）
 *
 * 验收标准：「请求携带参数 tenant_id 时被忽略 / 拒绝」——
 * 租户上下文**只能**从 JWT payload（request.user.tenantId）解析写入 ALS；
 * query / body / header 里的任何 tenant_id 伪造值一律被忽略
 * （guard 源码根本不读取 request.query / request.body，本 spec 以行为断言固化）。
 */
describe("DataScopeGuard（P0-03-02 租户上下文解析）", () => {
  let guard: CanActivate;

  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(false),
  } as unknown as Reflector;

  function makeContext(user: unknown, extraReq: Record<string, unknown> = {}): ExecutionContext {
    const request = {
      user,
      // 攻击面锚点：实现层 guard 不应读取这些字段， spec 显式放置伪造值
      query: { tenant_id: "999" },
      body: { tenant_id: "999" },
      headers: { "x-tenant-id": "999" },
      ...extraReq,
    };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => () => undefined,
      getClass: () => Object,
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    guard = new DataScopeGuard(reflector);
  });

  it("JWT 带 tenantId：写入 ALS 的是令牌值，query/body/header 伪造的 tenant_id=999 被忽略", async () => {
    await RequestContext.run(async () => {
      const user = {
        userId: 92,
        deptId: 61,
        deptTreePath: "0/61",
        dataScopes: [],
        roles: ["ROOT"],
        tenantId: "1",
      };
      await expect(guard.canActivate(makeContext(user))).resolves.toBe(true);
      expect(RequestContext.getTenantId()).toBe("1");
      expect(RequestContext.getUserId()).toBe("92");
    });
  });

  it("平台级账号（JWT 无 tenantId）：ALS 租户为 null（即便参数伪造 tenant_id=999）", async () => {
    await RequestContext.run(async () => {
      const user = {
        userId: 91,
        deptId: 61,
        deptTreePath: "0/61",
        dataScopes: [],
        roles: ["ROOT"],
      };
      await expect(guard.canActivate(makeContext(user))).resolves.toBe(true);
      expect(RequestContext.getTenantId()).toBeNull();
    });
  });

  it("JWT tenantId 为 bigint 形态数字：统一字符串化写入", async () => {
    await RequestContext.run(async () => {
      const user = { userId: 92, deptId: 61, dataScopes: [], roles: [], tenantId: 123n };
      await guard.canActivate(makeContext(user));
      expect(RequestContext.getTenantId()).toBe("123");
    });
  });

  it("@Public 接口：不设置用户/租户上下文", async () => {
    const publicReflector = {
      getAllAndOverride: jest.fn().mockReturnValue(true),
    } as unknown as Reflector;
    const publicGuard = new DataScopeGuard(publicReflector);
    await RequestContext.run(async () => {
      await expect(
        publicGuard.canActivate(makeContext({ userId: 92, tenantId: "1" }))
      ).resolves.toBe(true);
      expect(RequestContext.getCurrentUser()).toBeNull();
      expect(RequestContext.getTenantId()).toBeNull();
    });
  });

  it("未登录请求（无 request.user）：不抛错，上下文保持空", async () => {
    await RequestContext.run(async () => {
      await expect(guard.canActivate(makeContext(undefined))).resolves.toBe(true);
      expect(RequestContext.getCurrentUser()).toBeNull();
      expect(RequestContext.getTenantId()).toBeNull();
    });
  });
});
