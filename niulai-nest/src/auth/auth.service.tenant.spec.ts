import { BusinessException } from "../common/exceptions/business.exception";

import { AuthService } from "./auth.service";
import * as bcrypt from "bcrypt";

/**
 * 登录/刷新链路租户状态校验 单元测试（P0-03-04 挂账增量）
 *
 * 全依赖 mock，不触碰真实 Redis / PG：
 *  - 停用租户（status=0）的用户登录 / 短信登录 / 刷新令牌 → A0306（403）；
 *  - 租户记录缺失 → fail-closed 同样拒绝；
 *  - 启用恢复（status=1）→ 放行；
 *  - 平台级账号（tenantId NULL）→ 不校验租户，照常登录。
 */
describe("AuthService - 租户状态校验（登录/刷新链路 A0306）", () => {
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

  const userService = {
    getAuthCredentialsByUsername: jest.fn(),
    findByMobile: jest.fn(),
  };

  const jwtService = {
    signAsync: jest.fn(),
    verifyAsync: jest.fn(),
    decode: jest.fn(),
  };

  const configService = { get: jest.fn() };
  const logService = { saveManualLog: jest.fn() };
  const jwtConfig = { secretKey: "test-secret", expiresIn: 7200 };

  // prisma 最小 mock：只用到 tenant.findUnique
  const prismaService = {
    tenant: {
      findUnique: jest.fn(),
    },
  };

  /** 有效租户级用户凭证（真实 bcrypt hash，走通 validateUser） */
  let tenantUser: Record<string, any>;

  beforeAll(() => {
    tenantUser = {
      id: "9527",
      username: "authfix_user",
      password: bcrypt.hashSync("123456", 8),
      status: 1,
      deptId: 61,
      dataScopes: [1],
      deptTreePath: "0",
      roles: ["tenant_admin"],
      tenantId: "1",
    };
  });

  beforeEach(() => {
    jest.clearAllMocks();

    redisClient.incr.mockResolvedValue(1);
    redisClient.expire.mockResolvedValue(1);
    redisClient.set.mockResolvedValue("OK");
    redisClient.del.mockResolvedValue(1);

    redisCacheService.get.mockResolvedValue(null); // tokenVersion 未建立 → 0
    redisCacheService.set.mockResolvedValue(true);
    redisCacheService.del.mockResolvedValue(true);
    redisCacheService.hasKey.mockResolvedValue(false);
    redisCacheService.getClient.mockReturnValue(redisClient);

    redisCacheService.getGlobal.mockResolvedValue(null);
    redisCacheService.setGlobal.mockResolvedValue(true);
    redisCacheService.hasGlobalKey.mockResolvedValue(false);
    redisCacheService.delGlobal.mockResolvedValue(true);
    redisCacheService.incrGlobal.mockResolvedValue(1);
    redisCacheService.expireGlobal.mockResolvedValue(true);

    configService.get.mockReturnValue("jwt"); // SESSION_TYPE
    jwtService.signAsync.mockResolvedValue("mocked-token");
    logService.saveManualLog.mockResolvedValue(undefined);

    // 默认租户启用（status=1）
    prismaService.tenant.findUnique.mockResolvedValue({ status: 1 });

    service = new AuthService(
      jwtConfig as any,
      jwtService as any,
      userService as any,
      redisCacheService as any,
      configService as any,
      logService as any,
      prismaService as any
    );
  });

  /** 断言 Promise 以指定信封 code 拒绝 */
  async function expectBusinessError(promise: Promise<unknown>, code: string): Promise<void> {
    try {
      await promise;
      throw new Error(`期望抛出 code=${code} 的 BusinessException，但正常返回了`);
    } catch (e) {
      expect(e).toBeInstanceOf(BusinessException);
      expect((e as BusinessException).getResponse()).toMatchObject({ code });
    }
  }

  describe("密码登录（login）", () => {
    it("停用租户（status=0）用户登录 → A0306，不签发令牌、不计失败次数", async () => {
      userService.getAuthCredentialsByUsername.mockResolvedValue(tenantUser);
      prismaService.tenant.findUnique.mockResolvedValue({ status: 0 });

      await expectBusinessError(
        service.login({ username: "authfix_user", password: "123456" } as any),
        "A0306"
      );

      expect(prismaService.tenant.findUnique).toHaveBeenCalledWith({
        where: { id: BigInt(1) },
        select: { status: true },
      });
      expect(jwtService.signAsync).not.toHaveBeenCalled();
      // 停用不属于凭证错误：不触碰失败计数
      expect(redisClient.incr).not.toHaveBeenCalled();
      expect(redisClient.del).not.toHaveBeenCalled();
    });

    it("租户记录缺失（findUnique=null）→ fail-closed 拒绝 A0306", async () => {
      userService.getAuthCredentialsByUsername.mockResolvedValue(tenantUser);
      prismaService.tenant.findUnique.mockResolvedValue(null);

      await expectBusinessError(
        service.login({ username: "authfix_user", password: "123456" } as any),
        "A0306"
      );
    });

    it("启用租户（status=1）用户登录 → 正常签发令牌", async () => {
      userService.getAuthCredentialsByUsername.mockResolvedValue(tenantUser);
      prismaService.tenant.findUnique.mockResolvedValue({ status: 1 });

      const result = await service.login({
        username: "authfix_user",
        password: "123456",
      } as any);

      expect(result.tokenType).toBe("Bearer");
      expect(result.accessToken).toBe("mocked-token");
    });

    it("平台级账号（tenantId NULL）→ 不校验租户，照常登录", async () => {
      userService.getAuthCredentialsByUsername.mockResolvedValue({
        ...tenantUser,
        tenantId: null,
      });

      const result = await service.login({
        username: "authfix_user",
        password: "123456",
      } as any);

      expect(result.tokenType).toBe("Bearer");
      expect(prismaService.tenant.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("短信登录（loginBySms）", () => {
    it("停用租户用户短信登录 → A0306，不签发令牌", async () => {
      redisCacheService.get.mockResolvedValue("1234"); // 验证码命中
      userService.findByMobile.mockResolvedValue({ ...tenantUser, mobile: "13800138000" });
      prismaService.tenant.findUnique.mockResolvedValue({ status: 0 });

      await expectBusinessError(service.loginBySms("13800138000", "1234"), "A0306");

      expect(prismaService.tenant.findUnique).toHaveBeenCalledWith({
        where: { id: BigInt(1) },
        select: { status: true },
      });
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it("启用租户用户短信登录 → 正常签发令牌并清空尝试计数", async () => {
      redisCacheService.get.mockResolvedValue("1234");
      userService.findByMobile.mockResolvedValue({ ...tenantUser, mobile: "13800138000" });
      prismaService.tenant.findUnique.mockResolvedValue({ status: 1 });

      const result = await service.loginBySms("13800138000", "1234");

      expect(result.tokenType).toBe("Bearer");
      expect(redisClient.del).toHaveBeenCalledWith("captcha:sms_login:try:13800138000");
    });
  });

  describe("刷新令牌（refreshToken · JWT 模式）", () => {
    /** 构造合法 refresh payload（带租户归属） */
    function mockVerifyPayload(tenantId: string | null): void {
      jwtService.verifyAsync.mockResolvedValue({
        sub: "9527",
        username: "authfix_user",
        refreshToken: true,
        tokenVersion: 0,
        jti: "old-jti",
        tenantId,
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
    }

    it("停用租户用户刷新令牌 → A0306（业务异常穿透 catch，不吞成 A0231）", async () => {
      mockVerifyPayload("1");
      prismaService.tenant.findUnique.mockResolvedValue({ status: 0 });

      await expectBusinessError(service.refreshToken("old-refresh-token"), "A0306");

      // 不签发新令牌、旧 jti 不入黑名单（拒绝发生在签发之前；黑名单为全局键）
      expect(jwtService.signAsync).not.toHaveBeenCalled();
      expect(redisCacheService.setGlobal).not.toHaveBeenCalled();
    });

    it("租户恢复启用后刷新 → 正常旋转（新 jti + 旧 jti 入黑名单）", async () => {
      mockVerifyPayload("1");
      prismaService.tenant.findUnique.mockResolvedValue({ status: 1 });

      const result = await service.refreshToken("old-refresh-token");

      expect(jwtService.signAsync).toHaveBeenCalledTimes(2);
      expect(redisCacheService.setGlobal).toHaveBeenCalledWith(
        expect.stringContaining("token:blacklist"),
        true,
        expect.any(Number)
      );
      expect(result.accessToken).toBeTruthy();
    });

    it("平台级账号（payload.tenantId null）刷新 → 不校验租户，照常旋转", async () => {
      mockVerifyPayload(null);

      const result = await service.refreshToken("old-refresh-token");

      expect(result.accessToken).toBeTruthy();
      expect(prismaService.tenant.findUnique).not.toHaveBeenCalled();
    });
  });
});
