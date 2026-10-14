import { BusinessException } from "../common/exceptions/business.exception";

import { AuthService } from "./auth.service";
import * as bcrypt from "bcrypt";

/**
 * 登录失败锁定 & 短信验证码限制 单元测试（P0-02-03 / P0-02-07）
 *
 * 全依赖 mock，不触碰真实 Redis：
 *  - 登录锁定：auth:login:lock:{username} / auth:login:fail:{username}
 *  - 短信发送冷却：auth:sms:send:lock:{mobile}（SET NX EX 60）
 *  - 短信验证尝试：captcha:sms_login:try:{mobile}（错码 5 次作废）
 */
describe("AuthService - 登录失败锁定与短信验证码限制", () => {
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

  // getClient() 原生客户端（incr/expire/set/del）
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

  /** 有效用户凭证（真实 bcrypt hash，走通 validateUser） */
  let validUser: Record<string, any>;

  beforeAll(() => {
    validUser = {
      id: "91",
      username: "admin",
      password: bcrypt.hashSync("123456", 8),
      status: 1,
      deptId: 61,
      dataScopes: [1],
      deptTreePath: "0",
      roles: [{ id: 157, name: "ROOT" }],
    };
  });

  beforeEach(() => {
    jest.clearAllMocks();

    redisClient.incr.mockResolvedValue(1);
    redisClient.expire.mockResolvedValue(1);
    redisClient.set.mockResolvedValue("OK"); // SET NX EX 抢占成功
    redisClient.del.mockResolvedValue(1);

    redisCacheService.get.mockResolvedValue(null);
    redisCacheService.set.mockResolvedValue(true);
    redisCacheService.del.mockResolvedValue(true);
    redisCacheService.hasKey.mockResolvedValue(false); // 默认未锁定
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

    service = new AuthService(
      jwtConfig as any,
      jwtService as any,
      userService as any,
      redisCacheService as any,
      configService as any,
      logService as any
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

  describe("P0-02-07 登录失败锁定", () => {
    it("锁定期内登录：直接拒绝 A0211，不触碰用户服务", async () => {
      redisCacheService.hasKey.mockResolvedValue(true);

      await expectBusinessError(
        service.login({ username: "admin", password: "123456" } as any),
        "A0211"
      );

      expect(redisCacheService.hasKey).toHaveBeenCalledWith("auth:login:lock:admin");
      expect(userService.getAuthCredentialsByUsername).not.toHaveBeenCalled();
      expect(redisClient.incr).not.toHaveBeenCalled();
    });

    it("密码错误 1~4 次：累计计数、首次失败设 15 分钟窗口，但不锁定", async () => {
      userService.getAuthCredentialsByUsername.mockResolvedValue(null);

      for (let i = 1; i <= 4; i++) {
        redisClient.incr.mockResolvedValue(i);
        await expectBusinessError(
          service.login({ username: "admin", password: "wrong" } as any),
          "A0210"
        );
      }

      expect(redisClient.incr).toHaveBeenCalledTimes(4);
      expect(redisClient.incr).toHaveBeenCalledWith("auth:login:fail:admin");
      // 仅首次失败设置窗口 TTL
      expect(redisClient.expire).toHaveBeenCalledTimes(1);
      expect(redisClient.expire).toHaveBeenCalledWith("auth:login:fail:admin", 900);
      // 未达上限：不设锁
      expect(redisClient.set).not.toHaveBeenCalledWith("auth:login:lock:admin", "1", "EX", 900);
    });

    it("第 5 次密码错误：设置 15 分钟锁定键并清空计数", async () => {
      userService.getAuthCredentialsByUsername.mockResolvedValue(null);
      redisClient.incr.mockResolvedValue(5);

      await expectBusinessError(
        service.login({ username: "admin", password: "wrong" } as any),
        "A0210"
      );

      expect(redisClient.set).toHaveBeenCalledWith("auth:login:lock:admin", "1", "EX", 900);
      expect(redisClient.del).toHaveBeenCalledWith("auth:login:fail:admin");
    });

    it("登录成功：清空既有失败计数", async () => {
      userService.getAuthCredentialsByUsername.mockResolvedValue(validUser);
      redisClient.incr.mockResolvedValue(3); // 此前失败过 3 次（模拟残留计数）

      const result = await service.login({ username: "admin", password: "123456" } as any);

      expect(result.tokenType).toBe("Bearer");
      expect(result.accessToken).toBe("mocked-token");
      expect(redisClient.del).toHaveBeenCalledWith("auth:login:fail:admin");
    });

    it("账户冻结：不计入失败次数、也不清空既有计数", async () => {
      userService.getAuthCredentialsByUsername.mockResolvedValue({
        ...validUser,
        status: 0,
      });

      await expectBusinessError(
        service.login({ username: "admin", password: "123456" } as any),
        "A0202"
      );

      expect(redisClient.incr).not.toHaveBeenCalled();
      expect(redisClient.del).not.toHaveBeenCalled();
    });
  });

  describe("P0-02-03 短信验证码限制", () => {
    it("60 秒冷却窗口内重发：拒绝 A0241，验证码不写入", async () => {
      redisClient.set.mockResolvedValue(null); // SET NX 未命中：锁已存在

      await expectBusinessError(service.sendSmsLoginCode("13800138000"), "A0241");

      expect(redisClient.set).toHaveBeenCalledWith(
        "auth:sms:send:lock:13800138000",
        "1",
        "EX",
        60,
        "NX"
      );
      expect(redisCacheService.set).not.toHaveBeenCalled();
    });

    it("错码累计 5 次：作废当前验证码并清空尝试计数", async () => {
      redisCacheService.get.mockResolvedValue("1234");
      redisClient.incr.mockResolvedValue(5);

      await expectBusinessError(service.loginBySms("13800138000", "0000"), "A0240");

      expect(redisClient.incr).toHaveBeenCalledWith("captcha:sms_login:try:13800138000");
      expect(redisCacheService.del).toHaveBeenCalledWith("captcha:sms_login:13800138000");
      expect(redisClient.del).toHaveBeenCalledWith("captcha:sms_login:try:13800138000");
    });

    it("验证通过：清空尝试计数后正常签发令牌", async () => {
      redisCacheService.get.mockResolvedValue("1234");
      userService.findByMobile.mockResolvedValue({
        ...validUser,
        mobile: "13800138000",
      });

      const result = await service.loginBySms("13800138000", "1234");

      expect(result.tokenType).toBe("Bearer");
      expect(redisClient.del).toHaveBeenCalledWith("captcha:sms_login:try:13800138000");
      expect(jwtService.signAsync).toHaveBeenCalledTimes(2);
    });
  });
});
