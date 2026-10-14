import { AuthService } from "./auth.service";
import { BusinessException } from "../common/exceptions/business.exception";

/**
 * 切换门店上下文令牌签发 单元测试（P0-02-06）
 *
 * 全依赖 mock，不触碰真实 Redis：
 *  - JWT 模式：payload 显式构造（含 activeStoreId / tokenVersion / 租户归属），
 *    无 verify 残留注册声明（jsonwebtoken 9 红线）；
 *  - Redis-Token 模式：会话补写 activeStoreId 并轮换 access token。
 */
describe("AuthService - 切换门店上下文令牌签发（P0-02-06）", () => {
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

  const userService = { getAuthCredentialsByUsername: jest.fn(), findByMobile: jest.fn() };
  const jwtService = {
    signAsync: jest.fn(),
    verifyAsync: jest.fn(),
    decode: jest.fn(),
  };
  const configService = { get: jest.fn().mockReturnValue("jwt") };
  const logService = { saveManualLog: jest.fn().mockResolvedValue(undefined) };
  const jwtConfig = { secretKey: "test-secret", expiresIn: 7200 };

  /** 模拟 JwtStrategy.validate 标准化后的 request.user */
  const currentUser = {
    userId: "91",
    username: "tenant_admin",
    deptId: "61",
    dataScopes: [],
    deptTreePath: "0",
    roles: ["ROOT"],
    tenantId: "1",
  };

  beforeEach(() => {
    jest.clearAllMocks();

    redisCacheService.get.mockResolvedValue(null); // tokenVersion 未建立 → 0
    redisCacheService.set.mockResolvedValue(true);
    redisCacheService.getGlobal.mockResolvedValue(null);
    redisCacheService.setGlobal.mockResolvedValue(true);
    redisCacheService.hasGlobalKey.mockResolvedValue(false);
    redisCacheService.delGlobal.mockResolvedValue(true);
    jwtService.signAsync.mockResolvedValue("signed-token");
    configService.get.mockReturnValue("jwt");

    service = new AuthService(
      jwtConfig as any,
      jwtService as any,
      userService as any,
      redisCacheService as any,
      configService as any,
      logService as any
    );
  });

  it("JWT 模式：payload 显式构造（含 activeStoreId / tokenVersion / 租户归属），无注册声明残留", async () => {
    redisCacheService.getGlobal.mockResolvedValue(3); // 当前 tokenVersion = 3（全局键）

    const { accessToken } = await service.issueSwitchedAccessToken(
      currentUser as any,
      "store-uuid-1"
    );

    expect(accessToken).toBe("signed-token");
    expect(jwtService.signAsync).toHaveBeenCalledTimes(1); // 只签 access，不签 refresh

    const [payload, options] = jwtService.signAsync.mock.calls[0];
    expect(payload).toMatchObject({
      sub: "91",
      username: "tenant_admin",
      roles: ["ROOT"],
      tenantId: "1",
      activeStoreId: "store-uuid-1",
      tokenVersion: 3,
    });
    expect(typeof payload.jti).toBe("string");
    expect(payload.jti.length).toBeGreaterThan(0);
    // jsonwebtoken 9 红线：verify 出的注册声明不得展开进 sign payload
    expect(payload.exp).toBeUndefined();
    expect(payload.iat).toBeUndefined();
    expect(payload.iss).toBeUndefined();
    expect(options).toEqual({ expiresIn: 7200 });
  });

  it("JWT 模式：tokenVersion 未建立时按 0 写入（语义与登录签发一致）", async () => {
    await service.issueSwitchedAccessToken(currentUser as any, "store-uuid-1");

    const payload = jwtService.signAsync.mock.calls[0][0];
    expect(payload.tokenVersion).toBe(0);
  });

  it("Redis-Token 模式：会话补写 activeStoreId 并轮换 access token（refresh 不动）", async () => {
    configService.get.mockReturnValue("redis-token");
    redisCacheService.getGlobal.mockImplementation(async (key: string) => {
      if (key === "auth:user:access:91") return "old-access";
      if (key === "auth:token:access:old-access") {
        return { userId: "91", username: "tenant_admin" };
      }
      return null;
    });

    const { accessToken } = await service.issueSwitchedAccessToken(
      currentUser as any,
      "store-uuid-1"
    );

    // 新 access 为 uuid（轮换），且未触碰 jwtService（redis-token 模式不签 JWT）
    expect(accessToken).not.toBe("old-access");
    expect(accessToken).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(jwtService.signAsync).not.toHaveBeenCalled();

    // 新 access 的会话对象 = 原会话 + activeStoreId（全局键：RedisTokenAuthGuard 前置读取）
    const sessionCall = redisCacheService.setGlobal.mock.calls.find(([key]) =>
      String(key).startsWith("auth:token:access:")
    );
    expect(sessionCall[0]).toBe(`auth:token:access:${accessToken}`);
    expect(sessionCall[1]).toMatchObject({ userId: "91", activeStoreId: "store-uuid-1" });

    // userId 反向索引指向新 access
    const userCall = redisCacheService.setGlobal.mock.calls.find(
      ([key]) => key === "auth:user:access:91"
    );
    expect(userCall[1]).toBe(accessToken);
  });

  it("Redis-Token 模式：原会话不存在（无有效令牌上下文）→ 拒绝盲签（A0230）", async () => {
    configService.get.mockReturnValue("redis-token");
    redisCacheService.getGlobal.mockResolvedValue(null);

    await expect(
      service.issueSwitchedAccessToken(currentUser as any, "store-uuid-1")
    ).rejects.toMatchObject({ response: { code: "A0230" } } as any);
    expect(jwtService.signAsync).not.toHaveBeenCalled();
    expect(redisCacheService.setGlobal).not.toHaveBeenCalled();
  });

  /** 防呆：确保断言对象确为 BusinessException 形态（信封 code 可读） */
  it("错误形态：拒绝值为 BusinessException（getResponse 含信封 code）", async () => {
    configService.get.mockReturnValue("redis-token");
    redisCacheService.getGlobal.mockResolvedValue(null);

    const err = await service
      .issueSwitchedAccessToken(currentUser as any, "store-uuid-1")
      .catch((e) => e);
    expect(err).toBeInstanceOf(BusinessException);
    expect((err as BusinessException).getResponse()).toMatchObject({ code: "A0230" });
  });
});
