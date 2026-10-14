import { Test } from "@nestjs/testing";
import type { TestingModule } from "@nestjs/testing";
import { ValidationPipe, HttpStatus } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import * as request from "supertest";
import * as bcrypt from "bcrypt";
import { AppModule } from "../src/app.module";
import { ResponseInterceptor } from "../src/common/interceptors/response.interceptor";
import { RedisService } from "../src/common/redis/redis.service";
import { PrismaService } from "../src/common/prisma/prisma.service";
import { enableBigIntJsonSerialization } from "../src/common/prisma/bigint-json";

/**
 * 登录/刷新链路租户状态校验 E2E（P0-03-04 挂账增量 · 安全闭环）
 *
 * 验收链：临时租户启用 → 用户登录成功 → 平台停用租户 → 登录 403 + A0306、
 * 刷新令牌 403 + A0306 → 恢复启用 → 登录再次成功。
 *
 * 前置（真实环境，与 test/app.e2e-spec.ts 同口径）：
 *  1. PG（peluvida_dev）与 Redis 连通；
 *  2. 种子已执行（本套件不依赖种子数据，临时租户/用户直插 + afterAll 清理）。
 *
 * 安全红线：**不触碰 tenant 1（demo）的 status**（影响并行 E2E 的 tenant_admin
 * 登录），全部操作针对本套件直插的临时租户，afterAll 硬删清理。
 *
 * 口径：
 *  - 全局前缀 /api/v1；成功信封 { code: "00000", msg, data }（ResponseInterceptor）；
 *  - 登录需真实验证码：GET /auth/captcha + Redis DB7 后门读明文（受控测试后门）；
 *  - 业务异常（BusinessException）保留 httpStatus（A0306 → 403）；
 *  - it 内 HTTP 请求 ≤ 5（RateLimitMiddleware 每 IP 每秒 10 次 + 错峰/清计数器）。
 */

const PREFIX = "/api/v1";

describe("登录/刷新链路租户状态校验 (e2e)", () => {
  let app: INestApplication;
  let redis: RedisService;
  let prisma: PrismaService;

  /** 临时租户/用户（beforeAll 直插，afterAll 硬删，避免污染种子环境） */
  const suffix = Date.now();
  const tempTenantCode = `authfix_${suffix}`; // ≤32 chars
  const tempUsername = `authfix_u_${suffix}`;
  const tempPassword = "123456";
  let tempTenantId: bigint;

  /** 启用态首登拿到的 refresh token（停用期间用于验证 refresh 链路被拦） */
  let refreshTokenFromEnabledLogin: string;

  /** 走真实 /auth/captcha 流程取得有效 captchaId，并从 Redis 读取其明文（受控后门） */
  async function obtainCaptcha(): Promise<{ captchaId: string; captchaCode: string }> {
    const res = await request(app.getHttpServer()).get(`${PREFIX}/auth/captcha`).expect(200);
    const captchaId: string = res.body.data.captchaId;
    const captchaCode = await redis.get<string>(`captcha:image:${captchaId}`);
    expect(captchaCode).toBeTruthy();
    return { captchaId, captchaCode: captchaCode as string };
  }

  /** 受控测试后门：清空全局限流计数器（rate_limiter:ip:*），隔离并行进程 429 假失败 */
  async function resetRateLimiter(): Promise<void> {
    const client = redis.getClient();
    const limiterKeys = await client.keys("rate_limiter:ip:*");
    if (limiterKeys.length > 0) await client.del(...limiterKeys);
  }

  /** 命中 429 时清一次计数器并重试（仅一次），避免并行测试进程共享限流键造成假失败 */
  async function withRetry429<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (String((error as Error)?.message ?? "").includes("429")) {
        await resetRateLimiter();
        await new Promise((resolve) => setTimeout(resolve, 300));
        return await fn();
      }
      throw error;
    }
  }

  /** 完整登录请求（验证码 → 登录），返回响应体（信封） */
  async function postLogin(): Promise<request.Response> {
    await resetRateLimiter();
    const { captchaId, captchaCode } = await withRetry429(() => obtainCaptcha());
    return await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/auth/login`)
        .send({ username: tempUsername, password: tempPassword, captchaCode, captchaId })
        .expect((res) => {
          // 成功 201 / 业务拒绝 403（A0306 保留 httpStatus），其余状态一律失败
          if (![HttpStatus.CREATED, HttpStatus.FORBIDDEN].includes(res.status)) {
            throw new Error(`意外的 HTTP 状态: ${res.status}`);
          }
        })
    );
  }

  beforeAll(async () => {
    enableBigIntJsonSerialization();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(PREFIX);
    app.useGlobalInterceptors(new ResponseInterceptor(app.get(Reflector), app.get(ConfigService)));
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        transformOptions: { enableImplicitConversion: true },
        whitelist: true,
        forbidNonWhitelisted: false,
      })
    );
    await app.init();

    redis = app.get(RedisService);
    prisma = app.get(PrismaService);

    // 直插临时租户（启用态）+ 归属用户（无角色，登录链路允许角色为空）
    const tenant = await prisma.tenant.create({
      data: {
        name: "authfix 临时租户",
        code: tempTenantCode,
        status: 1,
        plan: "starter",
      },
    });
    tempTenantId = tenant.id;
    await prisma.sysUser.create({
      data: {
        username: tempUsername,
        nickname: "authfix 临时用户",
        password: bcrypt.hashSync(tempPassword, 8),
        tenantId: tempTenantId,
        status: 1,
        isDeleted: 0,
      },
    });
  });

  beforeEach(async () => {
    // 错峰限流窗口 + 隔离并行进程
    await resetRateLimiter();
    await new Promise((resolve) => setTimeout(resolve, 250));
  });

  afterAll(async () => {
    // 硬删临时数据（走基础客户端，仅命中本套件直插行）
    if (prisma) {
      await prisma.sysUser.deleteMany({ where: { username: tempUsername } });
      await prisma.tenant.deleteMany({ where: { code: tempTenantCode } });
    }
    // 清理限流与登录失败/锁定键，避免污染同 IP / 同用户名的后续套件
    if (redis) {
      await resetRateLimiter();
      const client = redis.getClient();
      const loginKeys = await client.keys(`auth:login:*${tempUsername}`);
      if (loginKeys.length > 0) await client.del(...loginKeys);
    }
    if (app) await app.close();
  });

  it("启用租户：用户登录成功（00000），并留存 refresh token 供停用期刷新验证", async () => {
    const res = await postLogin();
    expect(res.status).toBe(HttpStatus.CREATED);
    expect(res.body.code).toBe("00000");
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
    refreshTokenFromEnabledLogin = res.body.data.refreshToken as string;
  });

  it("平台停用租户：登录被拒 403 + A0306（即使凭证与验证码全部正确）", async () => {
    await prisma.tenant.update({
      where: { id: tempTenantId },
      data: { status: 0 },
    });

    const res = await postLogin();
    expect(res.status).toBe(HttpStatus.FORBIDDEN);
    expect(res.body).toMatchObject({ code: "A0306", data: null });
  });

  it("停用期间刷新令牌：403 + A0306（启用态签发的 refresh 也不得续签）", async () => {
    await resetRateLimiter();
    const res = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/auth/refresh-token`)
        .query({ refreshToken: refreshTokenFromEnabledLogin })
        .expect(HttpStatus.FORBIDDEN)
    );
    expect(res.body).toMatchObject({ code: "A0306", data: null });
  });

  it("恢复启用：登录再次成功（00000），停用→恢复闭环", async () => {
    await prisma.tenant.update({
      where: { id: tempTenantId },
      data: { status: 1 },
    });

    const res = await postLogin();
    expect(res.status).toBe(HttpStatus.CREATED);
    expect(res.body.code).toBe("00000");
    expect(res.body.data.accessToken).toBeTruthy();
  });
});
