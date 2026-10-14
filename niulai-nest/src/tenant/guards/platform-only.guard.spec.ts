import type { ExecutionContext } from "@nestjs/common";
import { RequestContext } from "../../common/context/request-context";
import { PlatformOnlyGuard } from "./platform-only.guard";

/**
 * 平台隔离守卫 单元测试（P0-03-04）
 *
 * 验证：带租户上下文（ALS 或 request.user）→ 403 + A0305；
 * 平台级账号（无租户上下文）→ 放行。
 */
describe("PlatformOnlyGuard", () => {
  let guard: PlatformOnlyGuard;

  /** 构造最小 ExecutionContext mock：只用到 switchToHttp().getRequest() */
  function makeContext(user: { tenantId?: string | null } | undefined): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new PlatformOnlyGuard();
  });

  it("ALS 上下文带租户（DataScopeGuard 写入）→ 抛 A0305", () => {
    expect(() =>
      RequestContext.run(() => {
        RequestContext.setTenantId("1");
        return guard.canActivate(makeContext(undefined));
      })
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: "A0305" }),
      })
    );
  });

  it("令牌兜底路径：request.user.tenantId 非空且 ALS 为空 → 抛 A0305", () => {
    expect(() => guard.canActivate(makeContext({ tenantId: "1" }))).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: "A0305" }),
      })
    );
  });

  it("平台级账号（ALS 无租户 + 令牌 tenantId null）→ 放行 true", () => {
    const result = RequestContext.run(() => guard.canActivate(makeContext({ tenantId: null })));
    expect(result).toBe(true);
  });

  it("未登录请求（user 缺失）→ 放行 true（认证链由 AuthGuard 前置负责）", () => {
    const result = RequestContext.run(() => guard.canActivate(makeContext(undefined)));
    expect(result).toBe(true);
  });
});
