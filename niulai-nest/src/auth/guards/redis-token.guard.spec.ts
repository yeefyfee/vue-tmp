import type { ExecutionContext } from "@nestjs/common";

import { RedisTokenAuthGuard } from "./redis-token.guard";
import { BusinessException } from "../../common/exceptions/business.exception";
import { ErrorCode } from "../../common/enums/error-code.enum";
import type { RedisService } from "../../common/redis/redis.service";

/**
 * RedisTokenAuthGuard 单元测试（P0-02-09）
 *
 * Redis 会话模式认证守卫此前 **0 覆盖**。覆盖：
 *  - 无 authorization / 非 `Bearer ` 前缀 → A0230；
 *  - Redis `auth:token:access:{token}` 未命中 → A0230；
 *  - 命中 → 挂载 request.user 并放行。
 */
describe("RedisTokenAuthGuard（P0-02-09 Redis 会话认证守卫）", () => {
  const redisMock = { getGlobal: jest.fn() };

  function makeContext(headers: Record<string, unknown>): {
    context: ExecutionContext;
    request: { headers: Record<string, unknown>; user?: unknown };
  } {
    const request = { headers } as { headers: Record<string, unknown>; user?: unknown };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { context, request };
  }

  let guard: RedisTokenAuthGuard;

  beforeEach(() => {
    jest.resetAllMocks();
    guard = new RedisTokenAuthGuard(redisMock as unknown as RedisService);
  });

  it("无 authorization 头 → A0230", async () => {
    const { context } = makeContext({});
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      constructor: BusinessException,
    });
    try {
      await guard.canActivate(context);
    } catch (e) {
      expect((e as BusinessException).getResponse()).toMatchObject({
        code: ErrorCode.ACCESS_TOKEN_INVALID.code,
      });
    }
    expect(redisMock.getGlobal).not.toHaveBeenCalled();
  });

  it("非 Bearer 前缀（如 Token xxx）→ A0230", async () => {
    const { context } = makeContext({ authorization: "Token abc" });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(BusinessException);
    expect(redisMock.getGlobal).not.toHaveBeenCalled();
  });

  it("Bearer 但 Redis 未命中 → A0230", async () => {
    redisMock.getGlobal.mockResolvedValue(null);
    const { context } = makeContext({ authorization: "Bearer abc" });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(BusinessException);
    expect(redisMock.getGlobal).toHaveBeenCalledWith("auth:token:access:abc");
  });

  it("Bearer 命中 → 挂载 request.user 并返回 true", async () => {
    const session = { userId: "92", username: "tenant_admin", roles: ["ROOT"] };
    redisMock.getGlobal.mockResolvedValue(session);
    const { context, request } = makeContext({ authorization: "Bearer abc" });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual(session);
    expect(redisMock.getGlobal).toHaveBeenCalledWith("auth:token:access:abc");
  });
});
