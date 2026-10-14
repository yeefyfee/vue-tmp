import { Test } from "@nestjs/testing";
import type { TestingModule } from "@nestjs/testing";
import { ValidationPipe, HttpStatus } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import * as request from "supertest";
import { AppModule } from "../src/app.module";
import { ResponseInterceptor } from "../src/common/interceptors/response.interceptor";
import { RedisService } from "../src/common/redis/redis.service";
import { PrismaService } from "../src/common/prisma/prisma.service";
import { enableBigIntJsonSerialization } from "../src/common/prisma/bigint-json";

/**
 * P0-03-04 租户管理 API 与能力开关 E2E
 *
 * 验收链：PATCH /tenants/:id 换 plan → feature_flags 同步为套餐预设 →
 * GET /tenants/current 逐键能力开关随之变化（门控渲染数据源）；
 * 平台隔离：租户 ROOT（tenant_admin）调平台侧接口 → 403 + A0305。
 *
 * 前置（真实环境，与 test/app.e2e-spec.ts 同口径）：
 *  1. PG（peluvida_dev）与 Redis 连通；
 *  2. 种子已执行：demo 租户（tenant_id=1，plan=professional）+ tenant_admin/123456
 *     （租户 ROOT）+ admin/123456（平台 ROOT）。
 *
 * 安全红线：**不触碰 tenant 1 的 status**（停用会影响并行 E2E 的 tenant_admin 登录），
 * 只切 plan，并在 afterAll 从快照回滚 plan/feature_flags。
 *
 * 口径：
 *  - 全局前缀 /api/v1；成功信封 { code: "00000", msg, data }（ResponseInterceptor）；
 *  - 登录需真实验证码：GET /auth/captcha + Redis DB7 后门读明文（受控测试后门）；
 *  - 业务异常（BusinessException）保留 httpStatus（A0305 → 403）；
 *  - 参数校验错误经 filter 统一转 200 + A0400（存量前端口径）；
 *  - it 内 HTTP 请求 ≤ 5（RateLimitMiddleware 每 IP 每秒 10 次 + 错峰/清计数器）。
 */

const PREFIX = "/api/v1";
const DEMO_TENANT_ID = 1;

describe("P0-03-04 租户管理 API 与能力开关 (e2e)", () => {
  let app: INestApplication;
  let redis: RedisService;
  let prisma: PrismaService;
  let tenantToken: string; // 租户管理员（tenant_admin，tenant_id=1，ROOT）
  let platformToken: string; // 平台级账号（admin，无租户归属）
  /** tenant 1 的 plan/feature_flags 快照（beforeAll 捕获，afterAll 回滚） */
  let tenantSnapshot: { plan: string; featureFlags: unknown };

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

  async function loginAndGetToken(username: string, password: string): Promise<string> {
    await resetRateLimiter();
    const { captchaId, captchaCode } = await withRetry429(() => obtainCaptcha());
    const res = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/auth/login`)
        .send({ username, password, captchaCode, captchaId })
        .expect(HttpStatus.CREATED)
    );
    expect(res.body.code).toBe("00000");
    return res.body.data.accessToken as string;
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

    // 快照 tenant 1（afterAll 回滚，保证并行 E2E / 重跑环境不被本套件污染）
    const tenant = await prisma.tenant.findFirstOrThrow({
      where: { id: BigInt(DEMO_TENANT_ID) },
      select: { plan: true, featureFlags: true },
    });
    tenantSnapshot = { plan: tenant.plan, featureFlags: tenant.featureFlags };

    tenantToken = await loginAndGetToken("tenant_admin", "123456");
    await new Promise((resolve) => setTimeout(resolve, 300));
    platformToken = await loginAndGetToken("admin", "123456");
  });

  beforeEach(async () => {
    // 错峰限流窗口 + 隔离并行进程
    await resetRateLimiter();
    await new Promise((resolve) => setTimeout(resolve, 250));
  });

  afterAll(async () => {
    // 回滚 tenant 1 的 plan/feature_flags（走基础客户端，仅命中种子租户）
    if (app && tenantSnapshot) {
      await prisma.tenant.update({
        where: { id: BigInt(DEMO_TENANT_ID) },
        data: {
          plan: tenantSnapshot.plan,
          featureFlags: tenantSnapshot.featureFlags as object,
        },
      });
    }
    // 清理限流键，避免污染同 IP 的后续套件
    if (redis) await resetRateLimiter();
    if (app) await app.close();
  });

  it("租户侧：tenant_admin 读 current → 档案 + professional 预设能力开关（foster/member/marketing 开）", async () => {
    const res = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/tenants/current`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(res.body.code).toBe("00000");

    const data = res.body.data as {
      id: string;
      name: string;
      code: string;
      status: number;
      plan: string;
      featureFlags: Record<string, boolean>;
      capabilities: Record<string, boolean>;
    };
    expect(data.id).toBe("1");
    expect(data.code).toBe("demo");
    expect(data.status).toBe(1);
    expect(typeof data.name).toBe("string");
    expect(data.capabilities).toBeTruthy();

    // 6 能力键齐全、逐键布尔（前端门控渲染直接取值）
    expect(Object.keys(data.capabilities).sort()).toEqual(
      ["foster", "headquarters", "marketing", "member", "multi_store", "open_api"].sort()
    );
    for (const value of Object.values(data.capabilities)) {
      expect(typeof value).toBe("boolean");
    }
    // professional 预设口径：寄养/会员/营销开，多店/总部/OpenAPI 关
    expect(data.capabilities.foster).toBe(true);
    expect(data.capabilities.member).toBe(true);
    expect(data.capabilities.marketing).toBe(true);
    expect(data.capabilities.multi_store).toBe(false);
    expect(data.capabilities.headquarters).toBe(false);
    expect(data.capabilities.open_api).toBe(false);
  });

  it("平台侧：admin 分页列表（code 筛选 + A4 信封）与详情可读", async () => {
    // 分页列表：code 前缀筛种子租户，A4 信封 list/total/page/page_size
    const listRes = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/tenants?code=demo&pageNum=1&pageSize=10`)
        .set("Authorization", `Bearer ${platformToken}`)
        .expect(HttpStatus.OK)
    );
    expect(listRes.body.code).toBe("00000");
    const page = listRes.body.data as {
      list: Array<{ id: string; code: string; plan: string }>;
      total: number;
      page: number;
      page_size: number;
    };
    expect(["list", "total", "page", "page_size"].sort()).toEqual(Object.keys(page).sort());
    expect(page.total).toBeGreaterThanOrEqual(1);
    for (const row of page.list) {
      expect(row.code.startsWith("demo")).toBe(true);
    }

    // 详情
    const detailRes = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/tenants/${DEMO_TENANT_ID}`)
        .set("Authorization", `Bearer ${platformToken}`)
        .expect(HttpStatus.OK)
    );
    expect(detailRes.body.code).toBe("00000");
    expect(detailRes.body.data.id).toBe("1");
    expect(detailRes.body.data.code).toBe("demo");
  });

  it("门控验收链：admin PATCH 换 plan=starter → feature_flags 同步预设 → tenant current 能力全关（伪造参数剥离）", async () => {
    // 1) PATCH：换 starter + 夹带伪造参数（tenant_id 越权改归属 / code 改编码 / 未知键）
    //    DTO 白名单剥离：plan 生效，code/tenant_id/未知键全部忽略
    const patchRes = await withRetry429(() =>
      request(app.getHttpServer())
        .patch(`${PREFIX}/tenants/${DEMO_TENANT_ID}`)
        .set("Authorization", `Bearer ${platformToken}`)
        .send({
          plan: "starter",
          code: "hacked-code",
          tenant_id: "999",
          feature_flags: { open_api: true },
          evilKey: true,
        })
        .expect(HttpStatus.OK)
    );
    expect(patchRes.body.code).toBe("00000");
    expect(patchRes.body.data.plan).toBe("starter");
    // feature_flags 同步为 starter 预设（空对象）——能力判断唯一真源被整包覆写
    expect(patchRes.body.data.featureFlags).toEqual({});
    // 伪造参数剥离：code 未被改、响应不含未知键
    expect(patchRes.body.data.code).toBe("demo");
    expect(patchRes.body.data.evilKey).toBeUndefined();

    // 2) 门控联动：租户侧 current 能力开关随之变化（professional → starter 全关）
    const currentRes = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/tenants/current`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(currentRes.body.data.plan).toBe("starter");
    for (const [key, value] of Object.entries(currentRes.body.data.capabilities)) {
      expect(value).toBe(false as unknown as boolean); // starter 预设无任何能力
      expect(typeof value).toBe("boolean");
      expect(Object.keys(currentRes.body.data.capabilities)).toContain(key);
    }

    // 3) 消费方联动兜底：能力判断 fail-closed（foster 已不在 flags，A0304 语义成立）
    //    （TenantCapabilityService.findActiveById 直读同一 feature_flags，此处不断言具体业务模块）
    expect(currentRes.body.data.capabilities.foster).toBe(false);
  });

  it("门控回滚链：admin PATCH 换回 professional → tenant current 能力恢复（foster/member/marketing 开）", async () => {
    const patchRes = await withRetry429(() =>
      request(app.getHttpServer())
        .patch(`${PREFIX}/tenants/${DEMO_TENANT_ID}`)
        .set("Authorization", `Bearer ${platformToken}`)
        .send({ plan: "professional" })
        .expect(HttpStatus.OK)
    );
    expect(patchRes.body.code).toBe("00000");
    expect(patchRes.body.data.plan).toBe("professional");
    expect(patchRes.body.data.featureFlags).toEqual(
      expect.objectContaining({ foster: true, member: true, marketing: true })
    );

    const currentRes = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/tenants/current`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(currentRes.body.data.plan).toBe("professional");
    expect(currentRes.body.data.capabilities.foster).toBe(true);
    expect(currentRes.body.data.capabilities.member).toBe(true);
    expect(currentRes.body.data.capabilities.marketing).toBe(true);
    expect(currentRes.body.data.capabilities.open_api).toBe(false);
  });

  it("平台隔离：tenant_admin 调平台侧接口 → 403 + A0305（防租户 ROOT 自改套餐提权）", async () => {
    // 列表接口
    const listRes = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/tenants`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.FORBIDDEN)
    );
    expect(listRes.body).toMatchObject({ code: "A0305", data: null });

    // 更新接口（提权尝试：自改 plan/featureFlags 必须被拦）
    const patchRes = await withRetry429(() =>
      request(app.getHttpServer())
        .patch(`${PREFIX}/tenants/${DEMO_TENANT_ID}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ plan: "business" })
        .expect(HttpStatus.FORBIDDEN)
    );
    expect(patchRes.body).toMatchObject({ code: "A0305", data: null });
  });

  it("参数校验：非法 plan / 非法能力键 → A0400（DTO 拦截）或 A0402（service 白名单），不落库", async () => {
    // 1) 非法 plan（不在枚举）→ ValidationPipe 校验失败，经 filter 统一转 200 + A0400
    const invalidPlanRes = await withRetry429(() =>
      request(app.getHttpServer())
        .patch(`${PREFIX}/tenants/${DEMO_TENANT_ID}`)
        .set("Authorization", `Bearer ${platformToken}`)
        .send({ plan: "universe" })
        .expect(HttpStatus.OK)
    );
    expect(invalidPlanRes.body).toMatchObject({ code: "A0400", data: null });

    // 2) 非法能力键（绕过 IsObject 级别校验进入 service）→ 400 + A0402
    //    （INVALID_USER_INPUT 的 BusinessException 保留 httpStatus=BAD_REQUEST）
    const invalidFlagRes = await withRetry429(() =>
      request(app.getHttpServer())
        .patch(`${PREFIX}/tenants/${DEMO_TENANT_ID}`)
        .set("Authorization", `Bearer ${platformToken}`)
        .send({ featureFlags: { evil_key: true } })
        .expect(HttpStatus.BAD_REQUEST)
    );
    expect(invalidFlagRes.body).toMatchObject({ code: "A0402", data: null });
  });
});
