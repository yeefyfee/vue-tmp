import { Inject, Injectable, Logger, Optional } from "@nestjs/common";

import { JwtService } from "@nestjs/jwt";
import { v4 as uuidv4 } from "uuid";
import { UserService } from "../system/user/user.service";
import type { LoginRequestDto } from "./dto/login-request.dto";
import jwtConfig from "../config/jwt.config";
import { ConfigType, ConfigService } from "@nestjs/config";
import { LoginResultDto } from "./dto/login-result.dto";
import { BusinessException } from "../common/exceptions/business.exception";
import { ErrorCode } from "../common/enums/error-code.enum";
import * as bcrypt from "bcrypt";
import { RedisService } from "../common/redis/redis.service";
import { PrismaService } from "../common/prisma/prisma.service";
import { RedisConstants } from "../common/constants/redis.constants";
import { LogService } from "../system/log/log.service";
import { ActionTypeValue } from "../common/enums/action-type.enum";
import { LogModuleValue } from "../common/enums/log-module.enum";

/**
 * 认证服务
 *
 * 负责用户登录认证、令牌签发与刷新、登出等核心功能
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  // ── 防爆破常量（P0-02-03 / P0-02-07）────────────────────────────
  /** 登录失败计数上限：窗口内累计达到该值即锁定账户 */
  private static readonly LOGIN_FAIL_LIMIT = 5;
  /** 登录失败计数窗口与锁定时长（秒）：15 分钟 */
  private static readonly LOGIN_LOCK_SECONDS = 900;
  /** 短信验证码发送冷却（秒）：同一手机号 60 秒内只允许发送一次 */
  private static readonly SMS_SEND_LOCK_SECONDS = 60;
  /** 短信验证码有效期（秒） */
  private static readonly SMS_CODE_TTL = 300;
  /** 短信验证码验证尝试上限：错码累计达到该值即作废当前验证码 */
  private static readonly SMS_TRY_LIMIT = 5;

  constructor(
    @Inject(jwtConfig.KEY)
    private readonly config: ConfigType<typeof jwtConfig>,
    private readonly jwtService: JwtService,
    private readonly userService: UserService,
    private readonly redisCacheService: RedisService,
    private readonly configService: ConfigService,
    private readonly logService: LogService,
    /**
     * 租户状态校验用（P0-03-04 挂账增量 · 登录链路安全闭环）。
     * PrismaModule 为 @Global，可直接注入；标记 @Optional 兼容存量单测
     * 的 6 参手动构造（无租户归属的用例不触达该依赖，行为零回归）。
     */
    @Optional() private readonly prismaService?: PrismaService
  ) {}

  /**
   * 获取用户 JWT 会话缓存键
   */
  private getJwtUserSessionKey(userId: string): string {
    return `${RedisConstants.Auth.USER_JWT_SESSION}:${userId}`;
  }

  /**
   * 登录失败锁定键（P0-02-07）
   *
   * 登录前无租户上下文，RedisService.resolveKey 原样返回，键名不带租户前缀——符合预期。
   */
  private getLoginLockKey(username: string): string {
    return `auth:login:lock:${username}`;
  }

  private getLoginFailKey(username: string): string {
    return `auth:login:fail:${username}`;
  }

  /**
   * 记录一次登录失败（P0-02-07）
   *
   * 固定窗口计数：首次失败起 15 分钟内累计，达到上限则设置锁定键（15 分钟），
   * 并清空计数——锁定过期后从零重新累计，锁定期内的尝试在入口即被拒绝、不再累计。
   */
  private async recordLoginFailure(username: string): Promise<void> {
    const client = this.redisCacheService.getClient();
    const failKey = this.getLoginFailKey(username);
    const fails = await client.incr(failKey);
    if (fails === 1) {
      await client.expire(failKey, AuthService.LOGIN_LOCK_SECONDS);
    }
    if (fails >= AuthService.LOGIN_FAIL_LIMIT) {
      await client.set(this.getLoginLockKey(username), "1", "EX", AuthService.LOGIN_LOCK_SECONDS);
      await client.del(failKey);
    }
  }

  /** 清空登录失败计数（登录成功时调用） */
  private async clearLoginFailure(username: string): Promise<void> {
    await this.redisCacheService.getClient().del(this.getLoginFailKey(username));
  }

  /**
   * 签发令牌
   *
   * 根据会话类型配置采用不同的令牌策略：
   * - jwt: JWT 自包含模式，用户信息存储在 Token 中
   * - redis-token: Redis 索引模式，Token 仅作为索引，用户会话存储在 Redis
   */
  private async issueTokens(user: any): Promise<LoginResultDto> {
    const sessionType = this.configService.get<string>("SESSION_TYPE") || "jwt";

    // JWT 模式：令牌自包含用户信息
    if (sessionType === "jwt") {
      const userId = user.id;

      // Token 版本控制，用于批量失效历史 Token
      const versionKey = `${RedisConstants.Auth.USER_TOKEN_VERSION}:${userId}`;
      const currentVersionRaw = await this.redisCacheService.getGlobal<number>(versionKey);
      const tokenVersion = currentVersionRaw ?? 0;

      // 缓存用户会话（不包含 perms，权限从角色权限缓存动态获取）
      // 全局键：与 invalidateUserSessions 的清理端同口径（键名含全局唯一 userId）
      const refreshTtl = this.config.expiresIn * 10;
      await this.redisCacheService.setGlobal(
        this.getJwtUserSessionKey(userId),
        {
          userId,
          username: user.username,
          deptId: user.deptId,
          dataScopes: user.dataScopes,
          deptTreePath: user.deptTreePath,
          roles: user.roles,
        },
        refreshTtl
      );

      // 构建 JWT payload
      const jti = uuidv4();
      const payload = {
        sub: userId,
        username: user.username,
        deptId: user.deptId,
        dataScopes: user.dataScopes,
        deptTreePath: user.deptTreePath,
        roles: user.roles,
        // 租户归属（PEL-11 + P0-03-01）：只进令牌，不接受请求参数。
        // 源头 = sys_user.tenant_id（P0-03-01 打破冻结加列，user.service 已字符串化）；
        // NULL = 平台级账号，不受租户 RLS。
        tenantId: (user as { tenantId?: string | null }).tenantId ?? null,
        tokenVersion,
        jti,
      };

      const accessToken = await this.jwtService.signAsync(payload, {
        expiresIn: this.config.expiresIn,
      });

      const refreshToken = await this.jwtService.signAsync(
        {
          ...payload,
          refreshToken: true,
        },
        {
          expiresIn: this.config.expiresIn * 10,
        }
      );

      return {
        tokenType: "Bearer",
        accessToken,
        refreshToken,
        expiresIn: this.config.expiresIn,
      };
    }

    // Redis-Token 模式：Token 仅作为索引
    const userId = user.id;
    const accessToken = uuidv4();
    const refreshToken = uuidv4();

    const accessTtl = this.config.expiresIn;
    const refreshTtl = this.config.expiresIn * 10;

    // 用户会话（不包含 perms）
    const userSession = {
      userId: userId,
      username: user.username,
      deptId: user.deptId,
      dataScopes: user.dataScopes,
      roles: user.roles,
    };

    // 存储 access/refresh 双 Token 及 userId 反向索引（全局键：RedisTokenAuthGuard 在
    // ALS 装配前读取这些映射，写入端必须同为无前缀键，否则认证恒失败）
    await this.redisCacheService.setGlobal(
      `auth:token:access:${accessToken}`,
      userSession,
      accessTtl
    );
    await this.redisCacheService.setGlobal(
      `auth:token:refresh:${refreshToken}`,
      userSession,
      refreshTtl
    );
    await this.redisCacheService.setGlobal(`auth:user:access:${userId}`, accessToken, accessTtl);
    await this.redisCacheService.setGlobal(`auth:user:refresh:${userId}`, refreshToken, refreshTtl);

    return {
      tokenType: "Bearer",
      accessToken,
      refreshToken,
      expiresIn: accessTtl,
    };
  }

  /**
   * 验证用户凭证
   */
  async validateUser(username: string, password: string): Promise<any> {
    const user = await this.userService.getAuthCredentialsByUsername(username);
    if (!user) {
      return null;
    }
    if (await bcrypt.compare(password, user.password)) {
      const { password: _password, ...result } = user;
      return result;
    }
    return null;
  }

  /**
   * 租户状态校验（P0-03-04 挂账增量 · 登录/刷新链路安全闭环）
   *
   * tenantId 非空（租户级账号）时校验所属租户 status：停用（≠1）或租户记录
   * 缺失一律 fail-closed 抛 A0306「租户已停用，禁止登录」（403）——与 A0303
   * （current 场景的「租户不存在/停用」）语义分离，登录场景独立成码便于区分。
   * 平台级账号（tenantId NULL）不受租户治理，直接放行。
   *
   * 查询方式：user.service 的登录装载查询未 join tenant（本轮禁区不动），
   * 故按主键单独 findUnique 一次（select 仅 status，BigInt 主键点查，成本可忽略）。
   */
  private async ensureTenantActive(tenantId: string | null | undefined): Promise<void> {
    if (!tenantId) {
      return; // 平台级账号不校验
    }
    const tenant = await this.prismaService?.tenant.findUnique({
      where: { id: BigInt(tenantId) },
      select: { status: true },
    });
    if (!tenant || tenant.status !== 1) {
      throw new BusinessException(ErrorCode.TENANT_DISABLED);
    }
  }

  /**
   * 用户登录认证
   */
  async login(loginDto: LoginRequestDto): Promise<LoginResultDto> {
    const { username, password } = loginDto;

    // 登录失败锁定（P0-02-07）：锁定期内直接拒绝，不触碰用户服务
    if (await this.redisCacheService.hasKey(this.getLoginLockKey(username))) {
      throw new BusinessException(ErrorCode.LOGIN_ATTEMPT_LIMIT_EXCEEDED);
    }

    const user = await this.validateUser(username, password);
    if (!user) {
      await this.recordLoginFailure(username);
      throw new BusinessException(ErrorCode.USER_PASSWORD_ERROR);
    }
    if (user.status === 0) {
      // 冻结不属于凭证错误：不计入失败次数，也不清空既有计数
      throw new BusinessException(ErrorCode.ACCOUNT_FROZEN);
    }
    // 租户状态闭环（P0-03-04 挂账）：平台停用的租户禁止其用户登录
    await this.ensureTenantActive((user as { tenantId?: string | null }).tenantId);

    await this.clearLoginFailure(username);
    const result = await this.issueTokens(user);

    // 手动记录登录日志（Public 接口无法通过拦截器获取 userId）
    this.logService
      .saveManualLog({
        module: LogModuleValue.LOGIN,
        actionType: ActionTypeValue.LOGIN,
        operatorId: user.id,
        operatorName: user.username,
        requestMethod: "POST",
        requestUri: "/api/v1/auth/login",
        status: 1,
      })
      .catch(() => {});

    return result;
  }

  /**
   * 发送短信登录验证码
   *
   * 发送冷却（P0-02-03）：SET NX EX 抢占 60 秒发送锁，抢占失败（锁已存在）
   * 说明冷却窗口内重复发送，拒绝本次请求。验证码写入失败时不回滚发送锁——
   * 宁可让用户等 60 秒重发，也不放松频率限制。
   */
  async sendSmsLoginCode(mobile: string) {
    if (!mobile) {
      throw new BusinessException(ErrorCode.REQUEST_REQUIRED_PARAMETER_IS_EMPTY);
    }

    const client = this.redisCacheService.getClient();
    const acquired = await client.set(
      `auth:sms:send:lock:${mobile}`,
      "1",
      "EX",
      AuthService.SMS_SEND_LOCK_SECONDS,
      "NX"
    );
    if (acquired === null) {
      throw new BusinessException(ErrorCode.USER_VERIFICATION_CODE_ATTEMPT_LIMIT_EXCEEDED);
    }

    const code = "1234";
    await this.redisCacheService.set(`captcha:sms_login:${mobile}`, code, AuthService.SMS_CODE_TTL);
  }

  /**
   * 短信验证码登录
   *
   * 验证尝试限制（P0-02-03）：错码累计计数（窗口与验证码 TTL 同为 5 分钟），
   * 达到 5 次即作废当前验证码并清空计数——之后即使输入正确码也会走过期分支。
   */
  async loginBySms(mobile: string, code: string) {
    if (!mobile || !code) {
      throw new BusinessException(ErrorCode.REQUEST_REQUIRED_PARAMETER_IS_EMPTY);
    }

    const codeKey = `captcha:sms_login:${mobile}`;
    const tryKey = `captcha:sms_login:try:${mobile}`;
    const cacheCode = await this.redisCacheService.get<string>(codeKey);
    if (!cacheCode) {
      throw new BusinessException(ErrorCode.USER_VERIFICATION_CODE_EXPIRED);
    }
    if (String(cacheCode).trim() !== String(code).trim()) {
      const client = this.redisCacheService.getClient();
      const tries = await client.incr(tryKey);
      if (tries === 1) {
        await client.expire(tryKey, AuthService.SMS_CODE_TTL);
      }
      if (tries >= AuthService.SMS_TRY_LIMIT) {
        await this.redisCacheService.del(codeKey);
        await client.del(tryKey);
      }
      throw new BusinessException(ErrorCode.USER_VERIFICATION_CODE_ERROR);
    }

    const user = await this.userService.findByMobile(mobile);
    if (!user) {
      throw new BusinessException(ErrorCode.ACCOUNT_NOT_FOUND);
    }
    if (user.status === 0) {
      throw new BusinessException(ErrorCode.ACCOUNT_FROZEN);
    }
    // 租户状态闭环（P0-03-04 挂账）：平台停用的租户禁止其用户短信登录
    await this.ensureTenantActive((user as { tenantId?: string | null }).tenantId);

    // 验证通过，清空尝试计数
    await this.redisCacheService.getClient().del(tryKey);
    const result = await this.issueTokens(user);

    // 手动记录登录日志（Public 接口无法通过拦截器获取 userId）
    this.logService
      .saveManualLog({
        module: LogModuleValue.LOGIN,
        actionType: ActionTypeValue.LOGIN,
        operatorId: user.id,
        operatorName: user.username,
        requestMethod: "POST",
        requestUri: "/api/v1/auth/login/sms",
        status: 1,
      })
      .catch(() => {});

    return result;
  }

  /**
   * 刷新访问令牌
   */
  async refreshToken(refreshToken: string) {
    if (!refreshToken) {
      throw new BusinessException(ErrorCode.REQUEST_REQUIRED_PARAMETER_IS_EMPTY);
    }

    const sessionType = this.configService.get<string>("SESSION_TYPE") || "jwt";

    // JWT 模式
    if (sessionType === "jwt") {
      try {
        const payload: any = await this.jwtService.verifyAsync(refreshToken, {
          secret: this.config.secretKey,
          ignoreExpiration: false,
        });

        if (!payload || payload.refreshToken !== true) {
          throw new BusinessException(ErrorCode.REFRESH_TOKEN_INVALID);
        }

        const userId = payload.sub;

        // 校验 Token 版本
        const tokenVersion: number = payload.tokenVersion ?? 0;
        const versionKey = `${RedisConstants.Auth.USER_TOKEN_VERSION}:${userId}`;
        const currentVersionRaw = await this.redisCacheService.getGlobal<number>(versionKey);
        const currentVersion = currentVersionRaw ?? 0;
        if (tokenVersion < currentVersion) {
          throw new BusinessException(ErrorCode.REFRESH_TOKEN_INVALID);
        }

        // 校验黑名单（**全局键**：读取发生在 ALS 装配前，见 RedisService.setGlobal 注释）
        const jti: string | undefined = payload.jti;
        if (jti) {
          const blacklistKey = `${RedisConstants.Auth.TOKEN_BLACKLIST}:${jti}`;
          const inBlacklist = await this.redisCacheService.hasGlobalKey(blacklistKey);
          if (inBlacklist) {
            const versionKey = `${RedisConstants.Auth.USER_TOKEN_VERSION}:${userId}`;
            await this.redisCacheService.incrGlobal(versionKey);
            // 版本键随 refresh 生命周期滚动（最后使用起 30 天窗口）
            await this.redisCacheService.expireGlobal(versionKey, this.config.expiresIn * 10);
            throw new BusinessException(ErrorCode.REFRESH_TOKEN_INVALID);
          }
        }

        // 租户状态闭环（P0-03-04 挂账）：平台停用的租户禁止其用户续签令牌
        // （tenantId 取自已验签 payload，不信任请求参数）
        await this.ensureTenantActive(payload.tenantId ?? null);

        // 签发新的访问令牌
        const newJti = uuidv4();
        const newAccessToken = await this.jwtService.signAsync(
          {
            sub: payload.sub,
            username: payload.username,
            deptId: payload.deptId,
            dataScopes: payload.dataScopes,
            deptTreePath: payload.deptTreePath,
            roles: payload.roles,
            // 刷新时透传租户归属（PEL-11）
            tenantId: payload.tenantId ?? null,
            tokenVersion: tokenVersion,
            jti: newJti,
          },
          {
            expiresIn: this.config.expiresIn,
          }
        );

        // 刷新旋转（P0-02-02）：每次刷新签发全新 refresh（新 jti），
        // 旧 refresh 加入黑名单（剩余有效期），重放即触发全会话吊销。
        // ⚠️ 必须显式构造新 payload（与上方 newAccessToken 同构）：verify 出的
        // payload 残留注册声明（exp/iss/aud/iat…），展开进 sign 会被
        // jsonwebtoken 9 逐项拒绝（Bad "options.xxx" option）。
        const newRefreshJti = uuidv4();
        const newRefreshToken = await this.jwtService.signAsync(
          {
            sub: payload.sub,
            username: payload.username,
            deptId: payload.deptId,
            dataScopes: payload.dataScopes,
            deptTreePath: payload.deptTreePath,
            roles: payload.roles,
            // 刷新时透传租户归属（PEL-11）
            tenantId: payload.tenantId ?? null,
            tokenVersion: tokenVersion,
            refreshToken: true,
            jti: newRefreshJti,
          },
          {
            expiresIn: this.config.expiresIn * 10,
          }
        );
        if (jti) {
          const nowSeconds = Math.floor(Date.now() / 1000);
          const remaining = Math.max((payload.exp ?? nowSeconds) - nowSeconds, 60);
          // 全局键：与 JwtStrategy.validate 的读取口径一致（后者在 ALS 装配前执行）
          await this.redisCacheService.setGlobal(
            `${RedisConstants.Auth.TOKEN_BLACKLIST}:${jti}`,
            true,
            remaining
          );
        }

        return {
          tokenType: "Bearer",
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
          expiresIn: this.config.expiresIn,
        };
      } catch (e) {
        // 业务异常（含租户停用 A0306）原样上抛，不吞成 A0231；
        // 其余（验证失败 / 内部错误）统一转 A0231，真实原因落日志（吞错无日志=排障黑洞）
        if (e instanceof BusinessException) {
          throw e;
        }
        this.logger.error(
          `refreshToken 校验失败: ${e instanceof Error ? e.message : String(e)}`,
          e instanceof Error ? e.stack : undefined
        );
        throw new BusinessException(ErrorCode.REFRESH_TOKEN_INVALID);
      }
    }

    // Redis-Token 模式（全局键，口径同 RedisTokenAuthGuard）
    const userSession = await this.redisCacheService.getGlobal<any>(
      `auth:token:refresh:${refreshToken}`
    );
    if (!userSession) {
      throw new BusinessException(ErrorCode.REFRESH_TOKEN_INVALID);
    }

    const accessToken = uuidv4();
    const accessTtl = this.config.expiresIn;

    await this.redisCacheService.setGlobal(
      `auth:token:access:${accessToken}`,
      userSession,
      accessTtl
    );
    await this.redisCacheService.setGlobal(
      `auth:user:access:${userSession.userId}`,
      accessToken,
      accessTtl
    );

    return {
      tokenType: "Bearer",
      accessToken,
      refreshToken,
      expiresIn: accessTtl,
    };
  }

  /**
   * 签发「切换门店上下文」访问令牌（P0-02-06 · POST /auth/switch-context）
   *
   * 载荷来源：JwtStrategy 校验后的 request.user（验签 + 标准化后的对象，
   * **不是** verify 出的原始 payload —— jsonwebtoken 9 红线：注册声明
   * （exp/iat/iss/aud…）不能展开进 sign，故逐字段显式构造新 payload）。
   *
   * 语义边界：
   *  - 只签 access：切换门店不改变身份与会话生命周期，refresh token 沿用原值；
   *  - tokenVersion 语义不变：读当前版本号原样写入，不做吊销（切店非失效场景）；
   *  - payload 新增 activeStoreId：门店上下文随令牌流转（与 x-store-id 请求头
   *    互补，请求头显式优先，见 JwtStrategy 的 ALS 兜底写入）。
   */
  async issueSwitchedAccessToken(
    currentUser: {
      userId: string;
      username?: string;
      deptId?: string | null;
      dataScopes?: unknown;
      deptTreePath?: string | null;
      roles?: string[];
      tenantId?: string | null;
    },
    activeStoreId: string
  ): Promise<{ accessToken: string }> {
    const sessionType = this.configService.get<string>("SESSION_TYPE") || "jwt";

    // JWT 模式：显式构造 payload（与 issueTokens 同构 + activeStoreId）
    if (sessionType === "jwt") {
      const userId = currentUser.userId;

      // Token 版本控制：与 issueTokens / refreshToken 同键，读当前版本原样写入
      const versionKey = `${RedisConstants.Auth.USER_TOKEN_VERSION}:${userId}`;
      const currentVersionRaw = await this.redisCacheService.getGlobal<number>(versionKey);
      const tokenVersion = currentVersionRaw ?? 0;

      const payload = {
        sub: userId,
        username: currentUser.username,
        deptId: currentUser.deptId,
        dataScopes: currentUser.dataScopes,
        deptTreePath: currentUser.deptTreePath,
        roles: currentUser.roles,
        // 租户归属沿用令牌（PEL-11）；平台级账号为 null
        tenantId: currentUser.tenantId ?? null,
        // 门店上下文随令牌流转（P0-02-06）
        activeStoreId,
        tokenVersion,
        jti: uuidv4(),
      };

      const accessToken = await this.jwtService.signAsync(payload, {
        expiresIn: this.config.expiresIn,
      });
      return { accessToken };
    }

    // Redis-Token 模式：会话对象补写 activeStoreId 并轮换 access token
    // （旧 access 自然过期，与 refreshToken 的轮换语义一致，不影响 refresh token）
    // ⚠️ 全局键：本方法由**已认证**的 switch-context 调用（ALS 有租户上下文），
    // 而 RedisTokenAuthGuard 在 ALS 装配前读取 —— 带前缀写会让换发的新令牌立即不可用。
    const userId = currentUser.userId;
    const currentAccessToken = await this.redisCacheService.getGlobal<string>(
      `auth:user:access:${userId}`
    );
    const userSession = currentAccessToken
      ? await this.redisCacheService.getGlobal<Record<string, unknown>>(
          `auth:token:access:${currentAccessToken}`
        )
      : null;
    if (!userSession) {
      // 无会话可继承 = 令牌上下文非法，拒绝盲签
      throw new BusinessException(ErrorCode.ACCESS_TOKEN_INVALID);
    }

    const accessToken = uuidv4();
    const accessTtl = this.config.expiresIn;
    await this.redisCacheService.setGlobal(
      `auth:token:access:${accessToken}`,
      { ...userSession, activeStoreId },
      accessTtl
    );
    await this.redisCacheService.setGlobal(`auth:user:access:${userId}`, accessToken, accessTtl);
    return { accessToken };
  }

  /**
   * 注销登录
   */
  async logout() {
    // 实际黑名单逻辑由 AuthController 传入原始 Bearer Token 后调用本方法完成
    return;
  }

  /**
   * 将 JWT 令牌加入黑名单
   *
   * @param token Bearer Token 或裸 Token
   */
  async blacklistToken(token: string): Promise<void> {
    if (!token) {
      return;
    }

    // 剥离 Bearer 前缀
    if (token.startsWith("Bearer ")) {
      token = token.substring("Bearer ".length);
    }

    const decoded: any = this.jwtService.decode(token);
    if (!decoded) {
      return;
    }

    const jti: string | undefined = decoded["jti"];
    const exp: number | undefined = decoded["exp"];

    if (!jti || !exp) {
      return;
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const remaining = exp - nowSeconds;
    if (remaining <= 0) {
      return;
    }

    const blacklistKey = `${RedisConstants.Auth.TOKEN_BLACKLIST}:${jti}`;
    // 全局键（不做租户前缀）：jti 本身全局唯一；登出请求带租户上下文、校验请求不带，
    // 若走带前缀的 set 会写出 JwtStrategy 永远读不到的键（登出形同虚设）。
    await this.redisCacheService.setGlobal(blacklistKey, true, remaining);
  }
}
