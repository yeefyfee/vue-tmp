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
 * P0-07-01 统一请求适配器约定与幂等（Idempotency-Key）E2E
 * （独立 spec，禁动 test/app.e2e-spec.ts——三代理并行）
 *
 * 覆盖：
 *  1. 同 key 两次 `POST /stores` → 第二次回放首次结果、响应头
 *     `Idempotency-Replayed: true`、body 与首次一致，且**不新增门店**（列表数量不变）；
 *  2. **不带 key 的普通请求行为不变**（正常创建、无回放头）；
 *  3. 同 key 但请求体不同 → 409（A0409 幂等键已用于不同的请求）。
 *
 * 口径对齐 p0-06.e2e-spec.ts：全局前缀 /api/v1；成功信封 { code:"00000", msg, data }；
 * POST 经全局 XRequestInterceptor 归一为 200；限流错峰 + afterAll 硬删清理（库内无脏状态）。
 *
 * 前置：PG / Redis 连通 + 系统域种子已执行（tenant_admin / 123456，tenant_id=1）。
 * 运行：node node_modules/.bin/jest --config ./test/jest-e2e.json p0-07-01
 */

const PREFIX = "/api/v1";

describe("P0-07-01 幂等（Idempotency-Key）API (e2e)", () => {
  let app: INestApplication;
  let redis: RedisService;
  let prisma: PrismaService;
  let tenantToken: string; // 租户管理员（tenant_admin，tenant_id=1）

  /** 本套件创建的门店 id（afterAll 硬删兜底） */
  const createdStoreIds: string[] = [];

  /** 受控测试后门：清空全局限流计数器（rate_limiter:ip:*，RedisService 同库） */
  async function resetRateLimiter(): Promise<void> {
    const client = redis.getClient();
    const limiterKeys = await client.keys("rate_limiter:ip:*");
    if (limiterKeys.length > 0) await client.del(...limiterKeys);
  }

  /** 带 429 重试的请求包装 */
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

  async function obtainCaptcha(): Promise<{ captchaId: string; captchaCode: string }> {
    const res = await withRetry429(() =>
      request(app.getHttpServer()).get(`${PREFIX}/auth/captcha`).expect(200)
    );
    const captchaId: string = res.body.data.captchaId;
    const captchaCode = await redis.get<string>(`captcha:image:${captchaId}`);
    expect(captchaCode).toBeTruthy();
    return { captchaId, captchaCode: captchaCode as string };
  }

  async function loginAndGetToken(username: string, password: string): Promise<string> {
    await resetRateLimiter();
    const { captchaId, captchaCode } = await obtainCaptcha();
    const res = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/auth/login`)
        .send({ username, password, captchaCode, captchaId })
        .expect(HttpStatus.CREATED)
    );
    expect(res.body.code).toBe("00000");
    return res.body.data.accessToken as string;
  }

  /** 合法 CreateStoreDto（code 唯一，其余取最小必填集） */
  function storeBody(code: string, name = "E2E 幂等门店") {
    return {
      code,
      name,
      type: 1,
      province: "广东省",
      city: "深圳市",
      district: "南山区",
      address: "幂等路 1 号",
      phone: "0755-0000000",
    };
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

    tenantToken = await loginAndGetToken("tenant_admin", "123456");
  });

  beforeEach(async () => {
    await resetRateLimiter();
  });

  it("同 key 两次 POST /stores → 第二次回放（Idempotency-Replayed: true）且不新增门店；无 key 请求行为不变", async () => {
    const suffix = `${Date.now()}`;
    const code = `IDEM${suffix}`;
    const idemKey = `e2e-idem-${suffix}`;

    // ① 首次：带 Idempotency-Key 创建门店
    const firstRes = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/stores`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .set("Idempotency-Key", idemKey)
        .send(storeBody(code))
        .expect(HttpStatus.OK)
    );
    expect(firstRes.body.code).toBe("00000");
    expect(firstRes.headers["idempotency-replayed"]).toBeUndefined();
    const storeId = firstRes.body.data.id as string;
    createdStoreIds.push(storeId);

    // ② 重复：同 key 同 body → 回放首次结果 + 回放头
    const replayRes = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/stores`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .set("Idempotency-Key", idemKey)
        .send(storeBody(code))
        .expect(HttpStatus.OK)
    );
    expect(replayRes.headers["idempotency-replayed"]).toBe("true");
    expect(replayRes.body.code).toBe("00000");
    expect(replayRes.body.data.id).toBe(storeId); // 同一门店，未二次创建
    expect(replayRes.body).toEqual(firstRes.body); // body 完全一致

    // ③ 不新增门店：按 code 精确筛选，数量仍为 1
    const listRes = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/stores?code=${code}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(listRes.body.code).toBe("00000");
    expect(listRes.body.data.total).toBe(1);
    expect(listRes.body.data.list).toHaveLength(1);

    // ④ 不带 key 的普通请求行为不变：正常创建、无回放头
    const plainCode = `PLAIN${suffix}`;
    const plainRes = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/stores`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send(storeBody(plainCode, "E2E 普通门店"))
        .expect(HttpStatus.OK)
    );
    expect(plainRes.body.code).toBe("00000");
    expect(plainRes.headers["idempotency-replayed"]).toBeUndefined();
    createdStoreIds.push(plainRes.body.data.id as string);
  });

  it("同 key 但请求体不同 → 409（A0409 幂等键已用于不同的请求）", async () => {
    const suffix = `${Date.now()}`;
    const code = `IDEMX${suffix}`;
    const idemKey = `e2e-idem-x-${suffix}`;

    const firstRes = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/stores`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .set("Idempotency-Key", idemKey)
        .send(storeBody(code))
        .expect(HttpStatus.OK)
    );
    expect(firstRes.body.code).toBe("00000");
    createdStoreIds.push(firstRes.body.data.id as string);

    // 同 key 不同 body（name 不同 → 指纹不同）→ 409
    const conflictRes = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/stores`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .set("Idempotency-Key", idemKey)
        .send(storeBody(code, "E2E 幂等门店（不同 body）"))
        .expect(HttpStatus.CONFLICT)
    );
    expect(conflictRes.body).toMatchObject({ code: "A0409", data: null });
  });

  afterAll(async () => {
    if (app) {
      if (createdStoreIds.length > 0) {
        // 硬删本套件创建的门店（走基础客户端绕过租户扩展——清理脚本语义）
        await prisma.store.deleteMany({ where: { id: { in: createdStoreIds } } });
      }
      await app.close();
    }
  });
});
