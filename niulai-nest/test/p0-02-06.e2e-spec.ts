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
 * P0-02-06 上下文接口 E2E（/auth/me · /auth/organizations · /auth/switch-context）
 *
 * 覆盖：
 *  1. `GET /auth/me`：等价 `/users/me`（同一用户身份，契约偏差消除）；
 *  2. `GET /auth/organizations`：仅返回当前租户**启用**门店（停用店不出现）；
 *  3. `POST /auth/switch-context` 主链：新 token 内嵌 activeStoreId + 上下文随动
 *     （新 token 访问门店数据接口，数据范围正常）；
 *  4. 越权：跨租户/不存在 storeId 与停用门店 → 403 + A0212；
 *  5. 平台级账号（admin，无租户）：organizations / switch-context → 403 + A0302；
 *     `/auth/me` 不受租户约束仍可用。
 *
 * 口径对齐 test/app.e2e-spec.ts：
 *  - 全局前缀 /api/v1；成功信封 { code: "00000", msg, data }；
 *  - enableBigIntJsonSerialization 在任何响应序列化前调用；
 *  - 登录走真实 captcha（Redis DB7 受控后门读明文）；
 *  - RateLimitMiddleware 每 IP 每秒 10 次：用例间错峰 + 清 rate_limiter:ip:* 键；
 *  - afterAll 清理登录防爆破键与用例创建的门店（软删，走基础客户端）。
 */

const PREFIX = "/api/v1";
/** 合法格式但不存在的门店 uuid（跨租户越权用例） */
const FOREIGN_STORE_ID = "00000000-0000-4000-8000-000000000000";

/** 解析 JWT payload（仅测试断言用，不做验签） */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split(".")[1];
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

describe("P0-02-06 上下文接口 (e2e)", () => {
  let app: INestApplication;
  let redis: RedisService;
  let prisma: PrismaService;

  let tenantToken: string; // 租户管理员（tenant_admin，tenant_id=1）
  let platformToken: string; // 平台级账号（admin，无租户归属）

  let storeAId: string; // 启用门店（切换目标）
  let storeBId: string; // 停用门店（A0212 用例）
  const storeACode = `e2e-ctx-a-${Date.now()}`;
  const storeBCode = `e2e-ctx-b-${Date.now()}`;
  const storeAName = "E2E 上下文门店A";
  /** 兜底清理集合：本套件创建的门店 id，afterAll 统一软删 */
  const createdStoreIds: string[] = [];

  /** 走真实 /auth/captcha 流程取得有效 captchaId，并从 Redis 读取其明文（受控后门） */
  async function obtainCaptcha(): Promise<{ captchaId: string; captchaCode: string }> {
    const res = await request(app.getHttpServer()).get(`${PREFIX}/auth/captcha`).expect(200);
    const captchaId: string = res.body.data.captchaId;
    const captchaCode = await redis.get<string>(`captcha:image:${captchaId}`);
    expect(captchaCode).toBeTruthy();
    return { captchaId, captchaCode: captchaCode as string };
  }

  /** 受控测试后门：清空全局限流计数器（rate_limiter:ip:*，每 IP 10 次/s） */
  async function resetRateLimiter(): Promise<void> {
    const client = redis.getClient();
    const limiterKeys = await client.keys("rate_limiter:ip:*");
    if (limiterKeys.length > 0) await client.del(...limiterKeys);
  }

  async function loginAndGetToken(username: string, password: string): Promise<string> {
    const { captchaId, captchaCode } = await obtainCaptcha();
    const res = await request(app.getHttpServer())
      .post(`${PREFIX}/auth/login`)
      .send({ username, password, captchaCode, captchaId })
      .expect(HttpStatus.CREATED);
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

    // 登录两账号（错峰：RateLimitMiddleware 每 IP 每秒 10 次）
    tenantToken = await loginAndGetToken("tenant_admin", "123456");
    await new Promise((resolve) => setTimeout(resolve, 400));
    platformToken = await loginAndGetToken("admin", "123456");
    await new Promise((resolve) => setTimeout(resolve, 400));

    // 自建门店 A（启用，切换目标）与门店 B（停用，A0212 用例；afterAll 一并清理）
    const createARes = await request(app.getHttpServer())
      .post(`${PREFIX}/stores`)
      .set("Authorization", `Bearer ${tenantToken}`)
      .send({
        code: storeACode,
        name: storeAName,
        type: 1,
        province: "广东省",
        city: "深圳市",
        district: "南山区",
        address: "科技园路 6 号",
        phone: "0755-1234571",
        status: 1,
      })
      .expect(HttpStatus.OK);
    expect(createARes.body.code).toBe("00000");
    storeAId = createARes.body.data.id as string;
    createdStoreIds.push(storeAId);
    expect(storeAId).toBeTruthy();

    await new Promise((resolve) => setTimeout(resolve, 400));

    const createBRes = await request(app.getHttpServer())
      .post(`${PREFIX}/stores`)
      .set("Authorization", `Bearer ${tenantToken}`)
      .send({
        code: storeBCode,
        name: "E2E 上下文门店B（停用）",
        type: 1,
        province: "广东省",
        city: "深圳市",
        district: "南山区",
        address: "科技园路 7 号",
        phone: "0755-1234572",
        status: 0, // 停用门店：organizations 不出现 / switch-context 拒绝
      })
      .expect(HttpStatus.OK);
    expect(createBRes.body.code).toBe("00000");
    storeBId = createBRes.body.data.id as string;
    createdStoreIds.push(storeBId);
  });

  beforeEach(async () => {
    // 限流错峰：清计数器 + 固定窗口让位（与 app.e2e-spec 同口径）
    await resetRateLimiter();
    await new Promise((resolve) => setTimeout(resolve, 250));
  });

  afterAll(async () => {
    if (redis) {
      // 清理登录防爆破副作用（P0-02-07 惯例）：fail/lock 键清零，避免影响后续轮次
      await redis.delMultiple([
        "auth:login:fail:tenant_admin",
        "auth:login:lock:tenant_admin",
        "auth:login:fail:admin",
        "auth:login:lock:admin",
      ]);
      await resetRateLimiter();
    }
    // 兜底清理：统一软删本套件创建的门店（走基础客户端绕过租户扩展——清理脚本语义）
    if (app && createdStoreIds.length > 0) {
      await prisma.store.updateMany({
        where: { id: { in: createdStoreIds }, deletedAt: null },
        data: { deletedAt: new Date() },
      });
    }
    if (app) await app.close();
  });

  it("me：GET /auth/me 与 /users/me 等价（同一用户身份，契约偏差消除）", async () => {
    const authMeRes = await request(app.getHttpServer())
      .get(`${PREFIX}/auth/me`)
      .set("Authorization", `Bearer ${tenantToken}`)
      .expect(HttpStatus.OK);
    expect(authMeRes.body).toMatchObject({ code: "00000" });
    expect(authMeRes.body.data.username).toBe("tenant_admin");

    // 与 /users/me 逐字段一致（等价复用 UserService.findMe）
    const usersMeRes = await request(app.getHttpServer())
      .get(`${PREFIX}/users/me`)
      .set("Authorization", `Bearer ${tenantToken}`)
      .expect(HttpStatus.OK);
    expect(usersMeRes.body.data).toEqual(authMeRes.body.data);
  });

  it("organizations：仅返回当前租户启用门店（停用店 B 不出现）", async () => {
    const res = await request(app.getHttpServer())
      .get(`${PREFIX}/auth/organizations`)
      .set("Authorization", `Bearer ${tenantToken}`)
      .expect(HttpStatus.OK);
    expect(res.body.code).toBe("00000");

    const stores = res.body.data as Array<{
      id: string;
      name: string;
      code: string;
      status: number;
    }>;
    expect(Array.isArray(stores)).toBe(true);

    // 启用门店 A 在列，字段齐全
    const hitA = stores.find((row) => row.id === storeAId);
    expect(hitA).toBeTruthy();
    expect(hitA).toMatchObject({ code: storeACode, name: storeAName, status: 1 });

    // 停用门店 B 不出现（切店 UI 只展示可切换门店）
    expect(stores.some((row) => row.id === storeBId)).toBe(false);
  });

  it("switch-context 主链：新 token 内嵌 activeStoreId + 上下文随动（门店数据范围正常）", async () => {
    // 1) 切换到门店 A
    const switchRes = await request(app.getHttpServer())
      .post(`${PREFIX}/auth/switch-context`)
      .set("Authorization", `Bearer ${tenantToken}`)
      .send({ storeId: storeAId })
      .expect(HttpStatus.OK); // POST 经全局拦截器统一 200 信封
    expect(switchRes.body.code).toBe("00000");

    const { accessToken, activeStore } = switchRes.body.data;
    expect(typeof accessToken).toBe("string");
    expect(accessToken.length).toBeGreaterThan(0);
    expect(activeStore).toMatchObject({ id: storeAId, name: storeAName });

    // 2) 新 token payload：activeStoreId 内嵌 + 租户归属保留 + 注册声明由签发方写入
    const payload = decodeJwtPayload(accessToken);
    expect(payload.activeStoreId).toBe(storeAId);
    expect(payload.tenantId).toBe("1");
    expect(payload.sub).toBeTruthy();
    expect(payload.tokenVersion).toBeGreaterThanOrEqual(0);
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));

    // 3) 上下文随动：新 token 访问门店数据接口，数据范围正常（本租户门店可见）
    const detailRes = await request(app.getHttpServer())
      .get(`${PREFIX}/stores/${storeAId}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(HttpStatus.OK);
    expect(detailRes.body.code).toBe("00000");
    expect(detailRes.body.data.id).toBe(storeAId);
    expect(detailRes.body.data.tenantId).toBe("1");
    expect(detailRes.body.data.code).toBe(storeACode);
  });

  it("越权：跨租户/不存在 storeId 与停用门店 → 403 + A0212（同口径，防枚举探测）", async () => {
    // 1) 跨租户/不存在的门店 uuid：scoped 扩展注入租户条件 → 查不到 → A0212
    const foreignRes = await request(app.getHttpServer())
      .post(`${PREFIX}/auth/switch-context`)
      .set("Authorization", `Bearer ${tenantToken}`)
      .send({ storeId: FOREIGN_STORE_ID })
      .expect(HttpStatus.FORBIDDEN);
    expect(foreignRes.body).toMatchObject({ code: "A0212", data: null });

    // 2) 本租户但已停用的门店 B：状态校验拒绝 → A0212
    const disabledRes = await request(app.getHttpServer())
      .post(`${PREFIX}/auth/switch-context`)
      .set("Authorization", `Bearer ${tenantToken}`)
      .send({ storeId: storeBId })
      .expect(HttpStatus.FORBIDDEN);
    expect(disabledRes.body).toMatchObject({ code: "A0212", data: null });
  });

  it("平台级账号：organizations / switch-context → 403 A0302；/auth/me 不受租户约束", async () => {
    // 1) organizations：无租户上下文 → TenantContextGuard fail-closed
    const orgRes = await request(app.getHttpServer())
      .get(`${PREFIX}/auth/organizations`)
      .set("Authorization", `Bearer ${platformToken}`)
      .expect(HttpStatus.FORBIDDEN);
    expect(orgRes.body).toMatchObject({ code: "A0302", data: null });

    // 2) switch-context：同样拒绝
    const switchRes = await request(app.getHttpServer())
      .post(`${PREFIX}/auth/switch-context`)
      .set("Authorization", `Bearer ${platformToken}`)
      .send({ storeId: storeAId })
      .expect(HttpStatus.FORBIDDEN);
    expect(switchRes.body).toMatchObject({ code: "A0302", data: null });

    // 3) /auth/me：无需租户上下文，平台 admin 正常返回
    const meRes = await request(app.getHttpServer())
      .get(`${PREFIX}/auth/me`)
      .set("Authorization", `Bearer ${platformToken}`)
      .expect(HttpStatus.OK);
    expect(meRes.body.code).toBe("00000");
    expect(meRes.body.data.username).toBe("admin");
  });
});
