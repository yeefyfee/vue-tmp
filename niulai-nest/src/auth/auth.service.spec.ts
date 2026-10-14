import { BusinessException } from "../common/exceptions/business.exception";

import { AuthService } from "./auth.service";
import * as bcrypt from "bcrypt";

/**
 * AuthService 核心 login 链路单元测试（P0-02-09）
 *
 * 定位：补齐 `auth.service.{lock,refresh,switch,tenant}.spec.ts` 之外的**核心路径** ——
 * `validateUser()`（凭证校验）与 `login()`（登录主流程）当前无单测覆盖。
 * lock 变体已覆盖「失败锁定 A0211」机制，本文件**不重复**锁定逻辑，仅补：
 *  - validateUser：用户不存在 / 软删（查询层过滤）/ 密码不匹配 / 命中返回去敏用户；
 *  - login：密码错误 A0210 + 失败计数递增、冻结 A0202、租户停用 A0306、
 *          成功签发 access+refresh + 清失败计数、成功 payload 携带 tenantId/tokenVersion/jti；
 *  - logout / blacklistToken 各分支；
 *  - 私有键名口径（getJwtUserSessionKey / getLoginLockKey / getLoginFailKey）。
 *
 * 全依赖 mock，不触碰真实 Redis / DB（与 auth.service.lock.spec.ts 风格一致）。
 * ⚠️ 说明：图形验证码校验位于 **AuthController.login**（非本 service），故不在本文件覆盖。
 */
describe("AuthService - 核心 login 链路（P0-02-09）", () => {
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
  const prismaService = { tenant: { findUnique: jest.fn() } };
  const jwtConfig = { secretKey: "test-secret", expiresIn: 7200 };

  /** 有效用户凭证（真实 bcrypt hash，走通 validateUser） */
  let validUser: Record<string, any>;

  beforeAll(() => {
    validUser = {
      id: "92",
      username: "tenant_admin",
      password: bcrypt.hashSync("123456", 8),
      status: 1,
      deptId: "61",
      dataScopes: [1],
      deptTreePath: "0",
      roles: ["ROOT"],
      tenantId: "1",
    };
  });

  beforeEach(() => {
    jest.clearAllMocks();

    redisClient.incr.mockResolvedValue(1);
    redisClient.expire.mockResolvedValue(1);
    redisClient.set.mockResolvedValue("OK");
    redisClient.del.mockResolvedValue(1);

    redisCacheService.get.mockResolvedValue(null);
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

  describe("validateUser（凭证校验）", () => {
    it("用户不存在（查询返回 null）→ 返回 null", async () => {
      userService.getAuthCredentialsByUsername.mockResolvedValue(null);
      await expect(service.validateUser("ghost", "123456")).resolves.toBeNull();
      expect(userService.getAuthCredentialsByUsername).toHaveBeenCalledWith("ghost");
    });

    it("用户已软删（查询层已过滤 isDeleted）→ 返回 null（软删不可登录）", async () => {
      // user.service.getAuthCredentialsByUsername 的 where 恒带 isDeleted: 0，
      // 软删用户对登录链路不可见（查询直接返回 null）——本用例固化该契约。
      userService.getAuthCredentialsByUsername.mockResolvedValue(null);
      await expect(service.validateUser("deleted_user", "123456")).resolves.toBeNull();
    });

    it("密码不匹配（bcrypt.compare=false）→ 返回 null", async () => {
      userService.getAuthCredentialsByUsername.mockResolvedValue(validUser);
      await expect(service.validateUser("tenant_admin", "wrong-password")).resolves.toBeNull();
    });

    it("凭证匹配 → 返回去敏用户（剥离 password 字段）", async () => {
      userService.getAuthCredentialsByUsername.mockResolvedValue(validUser);
      const result = await service.validateUser("tenant_admin", "123456");
      expect(result).not.toBeNull();
      expect(result.id).toBe("92");
      expect(result.username).toBe("tenant_admin");
      expect(result).not.toHaveProperty("password");
    });

    it("status=0（冻结）用户仍能通过凭证校验（冻结判定在 login 主流程）", async () => {
      userService.getAuthCredentialsByUsername.mockResolvedValue({ ...validUser, status: 0 });
      const result = await service.validateUser("tenant_admin", "123456");
      expect(result).not.toBeNull();
      expect(result.status).toBe(0);
    });
  });

  describe("login（登录主流程）", () => {
    it("凭证错误 → A0210，且失败计数递增（incr 登录失败键）", async () => {
      userService.getAuthCredentialsByUsername.mockResolvedValue(null);
      redisClient.incr.mockResolvedValue(1);

      await expectBusinessError(
        service.login({ username: "tenant_admin", password: "bad" } as any),
        "A0210"
      );

      expect(redisClient.incr).toHaveBeenCalledWith("auth:login:fail:tenant_admin");
      // 首次失败设置 15 分钟窗口
      expect(redisClient.expire).toHaveBeenCalledWith("auth:login:fail:tenant_admin", 900);
    });

    it("账户冻结（status=0）→ A0202，不计失败、不清计数", async () => {
      userService.getAuthCredentialsByUsername.mockResolvedValue({ ...validUser, status: 0 });

      await expectBusinessError(
        service.login({ username: "tenant_admin", password: "123456" } as any),
        "A0202"
      );

      expect(redisClient.incr).not.toHaveBeenCalled();
      expect(redisClient.del).not.toHaveBeenCalled();
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it("租户已停用（status≠1）→ A0306（fail-closed）", async () => {
      userService.getAuthCredentialsByUsername.mockResolvedValue(validUser);
      prismaService.tenant.findUnique.mockResolvedValue({ status: 0 });

      await expectBusinessError(
        service.login({ username: "tenant_admin", password: "123456" } as any),
        "A0306"
      );

      expect(prismaService.tenant.findUnique).toHaveBeenCalledWith({
        where: { id: BigInt("1") },
        select: { status: true },
      });
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it("租户记录缺失 → A0306（同样 fail-closed）", async () => {
      userService.getAuthCredentialsByUsername.mockResolvedValue(validUser);
      prismaService.tenant.findUnique.mockResolvedValue(null);

      await expectBusinessError(
        service.login({ username: "tenant_admin", password: "123456" } as any),
        "A0306"
      );
    });

    it("平台级账号（tenantId=null）→ 跳过租户状态校验，正常签发", async () => {
      userService.getAuthCredentialsByUsername.mockResolvedValue({
        ...validUser,
        tenantId: null,
      });

      const result = await service.login({ username: "admin", password: "123456" } as any);
      expect(result.accessToken).toBe("mocked-token");
      expect(prismaService.tenant.findUnique).not.toHaveBeenCalled();
    });

    it("登录成功 → 签发 access+refresh、清空失败计数、记录登录日志", async () => {
      userService.getAuthCredentialsByUsername.mockResolvedValue(validUser);

      const result = await service.login({ username: "tenant_admin", password: "123456" } as any);

      expect(result.tokenType).toBe("Bearer");
      expect(result.accessToken).toBe("mocked-token");
      expect(result.refreshToken).toBe("mocked-token");
      expect(result.expiresIn).toBe(7200);
      // 清空失败计数
      expect(redisClient.del).toHaveBeenCalledWith("auth:login:fail:tenant_admin");
      // access + refresh 两次签名
      expect(jwtService.signAsync).toHaveBeenCalledTimes(2);
      // 登录日志（Public 接口手动打点）
      expect(logService.saveManualLog).toHaveBeenCalledWith(
        expect.objectContaining({ requestUri: "/api/v1/auth/login", status: 1 })
      );
    });

    it("成功签发的 payload 含 tenantId / tokenVersion / jti（租户归属只进令牌）", async () => {
      userService.getAuthCredentialsByUsername.mockResolvedValue(validUser);
      redisCacheService.getGlobal.mockResolvedValue(5); // 当前版本号 5（全局键）

      await service.login({ username: "tenant_admin", password: "123456" } as any);

      const accessPayload = jwtService.signAsync.mock.calls[0][0];
      expect(accessPayload).toMatchObject({
        sub: "92",
        username: "tenant_admin",
        roles: ["ROOT"],
        tenantId: "1",
        tokenVersion: 5,
      });
      expect(typeof accessPayload.jti).toBe("string");
      expect(accessPayload.jti.length).toBeGreaterThan(0);
      // refresh payload 有 refreshToken 标记
      const refreshPayload = jwtService.signAsync.mock.calls[1][0];
      expect(refreshPayload.refreshToken).toBe(true);
    });
  });

  describe("logout / blacklistToken", () => {
    it("logout()：无副作用（黑名单由 controller 调 blacklistToken 完成）", async () => {
      await expect(service.logout()).resolves.toBeUndefined();
    });

    it("blacklistToken('')：空 token 直接返回，不写 Redis", async () => {
      await service.blacklistToken("");
      expect(jwtService.decode).not.toHaveBeenCalled();
      expect(redisCacheService.setGlobal).not.toHaveBeenCalled();
    });

    it("blacklistToken：剥离 Bearer 前缀后按 jti 写入黑名单（全局键 + 剩余有效期）", async () => {
      const futureExp = Math.floor(Date.now() / 1000) + 3600;
      jwtService.decode.mockReturnValue({ jti: "jti-1", exp: futureExp });

      await service.blacklistToken("Bearer raw-token");

      expect(jwtService.decode).toHaveBeenCalledWith("raw-token");
      // ⚠️ 必须走 setGlobal：JwtStrategy.validate 在 ALS 装配前读取该键，
      // 带租户前缀的写会让黑名单恒 miss（登出失效，缺陷根因）
      expect(redisCacheService.setGlobal).toHaveBeenCalledWith(
        "auth:token:blacklist:jti-1",
        true,
        expect.any(Number)
      );
      expect(redisCacheService.set).not.toHaveBeenCalled();
      // 剩余有效期应接近 3600
      const ttl = redisCacheService.setGlobal.mock.calls[0][2];
      expect(ttl).toBeGreaterThan(3500);
      expect(ttl).toBeLessThanOrEqual(3600);
    });

    it("blacklistToken：decode 失败 / 缺 jti / 缺 exp / 已过期 → 均不写黑名单", async () => {
      jwtService.decode.mockReturnValue(null);
      await service.blacklistToken("garbage");

      jwtService.decode.mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 100 });
      await service.blacklistToken("no-jti");

      jwtService.decode.mockReturnValue({ jti: "j" });
      await service.blacklistToken("no-exp");

      jwtService.decode.mockReturnValue({ jti: "j", exp: Math.floor(Date.now() / 1000) - 10 });
      await service.blacklistToken("expired");

      expect(redisCacheService.setGlobal).not.toHaveBeenCalled();
    });
  });

  describe("私有键名口径", () => {
    it("getJwtUserSessionKey / getLoginLockKey / getLoginFailKey 命名稳定", () => {
      expect((service as any).getJwtUserSessionKey("92")).toBe("auth:user:jwt_session:92");
      expect((service as any).getLoginLockKey("tenant_admin")).toBe("auth:login:lock:tenant_admin");
      expect((service as any).getLoginFailKey("tenant_admin")).toBe("auth:login:fail:tenant_admin");
    });
  });
});
