import { BusinessException } from "../common/exceptions/business.exception";

import { AuthService } from "./auth.service";
import { RedisConstants } from "../common/constants/redis.constants";

/**
 * 刷新令牌旋转与重放防护 单元测试（P0-02-02 验收口径）
 *
 *  - 旋转：每次刷新签发全新 refresh（新 jti），旧 refresh 入黑名单（剩余有效期）；
 *  - 重放：已旋转的旧 refresh 重放 → tokenVersion +1 吊销全会话 → REFRESH_TOKEN_INVALID。
 */
describe("AuthService - 刷新令牌旋转与重放防护", () => {
  let service: AuthService;

  const redisCacheService = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    hasKey: jest.fn(),
    getClient: jest.fn(),
    // 认证域全局键（无租户前缀，见 RedisService `*Global`）
    getGlobal: jest.fn(),
    setGlobal: jest.fn(),
    hasGlobalKey: jest.fn(),
    delGlobal: jest.fn(),
    incrGlobal: jest.fn(),
    expireGlobal: jest.fn(),
  };

  const redisClient = {
    incr: jest.fn(),
    expire: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };

  const userService = { getAuthCredentialsByUsername: jest.fn(), findByMobile: jest.fn() };
  const jwtService = {
    signAsync: jest.fn(),
    verifyAsync: jest.fn(),
    decode: jest.fn(),
  };
  const configService = { get: jest.fn().mockReturnValue("jwt") };
  const logService = { saveManualLog: jest.fn().mockResolvedValue(undefined) };
  const jwtConfig = { secretKey: "test-secret", expiresIn: 7200 };

  beforeEach(() => {
    jest.clearAllMocks();

    redisClient.incr.mockResolvedValue(1);
    redisClient.expire.mockResolvedValue(1);
    redisClient.set.mockResolvedValue("OK");
    redisClient.del.mockResolvedValue(1);

    redisCacheService.get.mockResolvedValue(null); // tokenVersion 未建立 → 0
    redisCacheService.set.mockResolvedValue(true);
    redisCacheService.hasKey.mockResolvedValue(false); // 默认不在黑名单
    redisCacheService.getClient.mockReturnValue(redisClient);
    redisCacheService.getGlobal.mockResolvedValue(null); // tokenVersion 未建立 → 0
    redisCacheService.setGlobal.mockResolvedValue(true);
    redisCacheService.hasGlobalKey.mockResolvedValue(false); // 默认不在黑名单
    redisCacheService.delGlobal.mockResolvedValue(true);
    redisCacheService.incrGlobal.mockResolvedValue(1);
    redisCacheService.expireGlobal.mockResolvedValue(true);

    jwtService.signAsync.mockImplementation(
      async (_payload: unknown, opts: { expiresIn?: number }) =>
        `token-${(opts as { expiresIn?: number })?.expiresIn}`
    );

    service = new AuthService(
      jwtConfig as any,
      jwtService as any,
      userService as any,
      redisCacheService as any,
      configService as any,
      logService as any
    );
  });

  it("刷新旋转：签发全新 refresh（新 jti），旧 jti 加入黑名单（剩余有效期）", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600; // 1 小时后过期
    jwtService.verifyAsync.mockResolvedValue({
      sub: "91",
      username: "admin",
      refreshToken: true,
      tokenVersion: 0,
      jti: "old-jti",
      exp,
    });

    const result = await service.refreshToken("old-refresh-token");

    // 新 access（7200）与新 refresh（72000）分别签发
    expect(jwtService.signAsync).toHaveBeenCalledTimes(2);
    const [accessCall, refreshCall] = (jwtService.signAsync as jest.Mock).mock.calls;
    expect((accessCall[0] as { jti: string }).jti).not.toBe("old-jti");
    expect((refreshCall[0] as { jti: string }).jti).not.toBe("old-jti");
    expect((refreshCall[0] as { jti: string }).jti).not.toBe(
      (accessCall[0] as { jti: string }).jti
    );
    expect((refreshCall[0] as { refreshToken: boolean }).refreshToken).toBe(true);

    // 返回值：refreshToken 为全新签发，不再是入参原值
    expect(result.refreshToken).toBe("token-72000");
    expect(result.refreshToken).not.toBe("old-refresh-token");
    expect(result.accessToken).toBe("token-7200");

    // 旧 jti 入黑名单（全局键，无租户前缀），TTL = 剩余有效期
    expect(redisCacheService.setGlobal).toHaveBeenCalledWith(
      `${RedisConstants.Auth.TOKEN_BLACKLIST}:old-jti`,
      true,
      expect.any(Number)
    );
    const ttl = (redisCacheService.setGlobal as jest.Mock).mock.calls.find(
      (c) => String(c[0]).includes("token:blacklist") || String(c[0]).includes("old-jti")
    )?.[2];
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(3600);
  });

  it("重放防护：已旋转的旧 refresh 重放 → tokenVersion 升级吊销全会话 → 拒绝", async () => {
    redisCacheService.hasGlobalKey.mockResolvedValue(true); // 旧 jti 已在黑名单
    jwtService.verifyAsync.mockResolvedValue({
      sub: "91",
      username: "admin",
      refreshToken: true,
      tokenVersion: 0,
      jti: "old-jti",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    try {
      await service.refreshToken("replayed-token");
      throw new Error("期望抛出 REFRESH_TOKEN_INVALID");
    } catch (e) {
      expect(e).toBeInstanceOf(BusinessException);
      expect((e as BusinessException).getResponse()).toMatchObject({ code: "A0231" });
    }

    // 全会话吊销：tokenVersion +1 并滚动 30 天窗口（全局键，读侧 JwtStrategy 无租户上下文）
    expect(redisCacheService.incrGlobal).toHaveBeenCalledWith(
      `${RedisConstants.Auth.USER_TOKEN_VERSION}:91`
    );
    expect(redisCacheService.expireGlobal).toHaveBeenCalledWith(
      `${RedisConstants.Auth.USER_TOKEN_VERSION}:91`,
      72000
    );
  });

  it("payload 缺 refreshToken 标记 → 拒绝（防 access 冒充 refresh）", async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: "91",
      username: "admin",
      refreshToken: false,
      tokenVersion: 0,
      jti: "access-jti",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    try {
      await service.refreshToken("access-token-masquerade");
      throw new Error("期望抛出 REFRESH_TOKEN_INVALID");
    } catch (e) {
      expect((e as BusinessException).getResponse()).toMatchObject({ code: "A0231" });
    }
  });
});
