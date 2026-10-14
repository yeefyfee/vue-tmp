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
 * P0-05-04/05/06 客户域三连 E2E
 *   P0-05-04 触达渠道与偏好 FR-3（reach_log 读写 + reach-preferences）
 *   P0-05-05 黑名单 FR-4（门店/租户两级 + 硬拦截 A0522）
 *   P0-05-06 来源枚举 FR-5 + 分层 lifecycle FR-6
 *
 * 独立 spec（禁动 test/app.e2e-spec.ts 及任何既有 spec）。覆盖：
 *  1. 触达读写：POST 记录（渠道/模板/内容/结果/触达时间）→ GET 分页（渠道 + 时间闭区间）；
 *  2. 触达偏好：GET 兜底默认 → PUT 整存整取（拒收渠道）→ 拒收渠道触达 A0527、放行渠道 200；
 *  3. 黑名单（租户级）：拉黑 → 查询 → 触达被硬拦 A0522 → 解除 → 触达放行；
 *  4. 黑名单（门店级）：scope=store 缺 storeId A0524；拉黑门店级 → 带 x-store-id 触达被拦、
 *     不带（仅租户级判定）放行；
 *  5. 来源枚举：GET /customers/source-options；lifecycle 默认 1 → PATCH 更新 3 → ?lifecycle=3 命中。
 *
 * 口径对齐 p0-05 / p0-05-03 e2e：
 *  - 全局前缀 /api/v1；成功信封 { code: "00000", msg, data }；创建类断言一律 200；
 *  - 每 it 内 HTTP 请求 ≤ 5（RateLimitMiddleware 每 IP 每秒 10 次）；
 *  - 限流错峰 + 清键（rate_limiter:ip:*）；afterAll 兜底物理清理（库内无脏状态）。
 *
 * 前置：PG / Redis 连通 + 系统域种子已执行（tenant_admin / 123456，tenant_id=1）。
 * 运行：node node_modules/jest/bin/jest.js --config ./test/jest-e2e.json p0-05-04-06 --runInBand
 */

const PREFIX = "/api/v1";

describe("P0-05-04/05/06 客户触达·黑名单·来源生命周期 (e2e)", () => {
  let app: INestApplication;
  let redis: RedisService;
  let prisma: PrismaService;
  let tenantToken: string; // 租户管理员（tenant_admin，tenant_id=1）
  let platformToken: string; // 平台级账号（admin，无租户归属）
  let customerId: string; // 主链客户（触达/偏好/黑名单）
  let storeId: string; // 门店（门店级黑名单用）
  let lifecycleCustomerId: string; // 来源 / lifecycle 用客户

  const mobileMain = `135${Date.now()}`;
  const mobileLifecycle = `134${Date.now()}`;
  const storeCode = `e2e504${Date.now()}`;

  const createdCustomerIds: string[] = [];
  const createdStoreIds: string[] = [];

  /** 受控测试后门：清空全局限流计数器（rate_limiter:ip:*） */
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
    await new Promise((resolve) => setTimeout(resolve, 400));
    platformToken = await loginAndGetToken("admin", "123456");
    await new Promise((resolve) => setTimeout(resolve, 400));
  });

  beforeEach(async () => {
    await resetRateLimiter();
  });

  it("前置：建档客户 C + 创建门店 S", async () => {
    const c = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/customers`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ name: "E2E 触达宠主", mobile: mobileMain, source: 1 })
        .expect(HttpStatus.OK)
    );
    expect(c.body.code).toBe("00000");
    customerId = c.body.data.id;
    expect(c.body.data.lifecycle).toBe(1); // FR-6 默认生命周期 = 1 新客
    createdCustomerIds.push(customerId);

    const s = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/stores`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({
          code: storeCode,
          name: "E2E 触达门店",
          province: "广东省",
          city: "深圳市",
          district: "南山区",
          address: "科技园 1 号",
          phone: "075512345678",
        })
        .expect(HttpStatus.OK)
    );
    expect(s.body.code).toBe("00000");
    storeId = s.body.data.id;
    createdStoreIds.push(storeId);
  });

  it("触达读写：记录触达 → 分页（渠道筛选命中 / 时间闭区间命中）", async () => {
    const createRes = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/customers/${customerId}/reach-logs`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({
          channel: 1,
          template: "WELCOME",
          content: "欢迎到店，赠送洗护券",
          result: 1,
          reachedAt: "2026-10-05 10:00:00",
        })
        .expect(HttpStatus.OK)
    );
    expect(createRes.body.code).toBe("00000");
    const reachId = createRes.body.data.id;
    expect(createRes.body.data.channel).toBe(1);
    expect(createRes.body.data.result).toBe(1);
    expect(createRes.body.data.template).toBe("WELCOME");

    // 渠道筛选：channel=1 命中
    const byChannel = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/customers/${customerId}/reach-logs?channel=1`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(byChannel.body.code).toBe("00000");
    const chList = byChannel.body.data.list as Array<{ id: string; channel: number }>;
    expect(chList.some((r) => r.id === reachId)).toBe(true);
    for (const row of chList) expect(row.channel).toBe(1);

    // 渠道筛选：channel=4 不命中
    const byChannelMiss = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/customers/${customerId}/reach-logs?channel=4`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(
      (byChannelMiss.body.data.list as Array<{ id: string }>).some((r) => r.id === reachId)
    ).toBe(false);

    // 时间闭区间：2026-10-05 当天命中
    const byRange = await withRetry429(() =>
      request(app.getHttpServer())
        .get(
          `${PREFIX}/customers/${customerId}/reach-logs?reachedAtStart=2026-10-05&reachedAtEnd=2026-10-05`
        )
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(byRange.body.code).toBe("00000");
    expect((byRange.body.data.list as Array<{ id: string }>).some((r) => r.id === reachId)).toBe(
      true
    );

    // 越权：无租户上下文的平台 admin → @RequireTenant 拒绝（403 A0302）
    const forbidden = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/customers/${customerId}/reach-logs`)
        .set("Authorization", `Bearer ${platformToken}`)
        .expect(HttpStatus.FORBIDDEN)
    );
    expect(forbidden.body).toMatchObject({ code: "A0302", data: null });
  });

  it("触达偏好：GET 兜底默认 → PUT 拒收渠道 4 → 渠道 4 触达 A0527、渠道 2 放行", async () => {
    const getDefault = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/customers/${customerId}/reach-preferences`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(getDefault.body.code).toBe("00000");
    expect(getDefault.body.data.allowedChannels).toBeNull();
    expect(getDefault.body.data.blockedChannels).toEqual([]);

    const putRes = await withRetry429(() =>
      request(app.getHttpServer())
        .put(`${PREFIX}/customers/${customerId}/reach-preferences`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({
          allowedChannels: null,
          blockedChannels: [4],
          doNotDisturb: { enabled: true, start: "22:00", end: "08:00" },
        })
        .expect(HttpStatus.OK)
    );
    expect(putRes.body.code).toBe("00000");
    expect(putRes.body.data.blockedChannels).toEqual([4]);
    expect(putRes.body.data.doNotDisturb).toMatchObject({
      enabled: true,
      start: "22:00",
      end: "08:00",
    });

    // 拒收渠道 4 → A0527
    const rejected = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/customers/${customerId}/reach-logs`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ channel: 4, content: "短信不应送达" })
        .expect(HttpStatus.CONFLICT)
    );
    expect(rejected.body).toMatchObject({ code: "A0527", data: null });

    // 允许渠道 2 → 200
    const allowed = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/customers/${customerId}/reach-logs`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ channel: 2, content: "服务号触达" })
        .expect(HttpStatus.OK)
    );
    expect(allowed.body.code).toBe("00000");
    expect(allowed.body.data.channel).toBe(2);
  });

  it("黑名单（租户级）硬拦截：拉黑 → 查询命中 → 触达 A0522 → 解除 → 触达放行", async () => {
    const createBl = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/customers/${customerId}/blacklist`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ scope: "tenant", reason: "多次恶意骚扰" })
        .expect(HttpStatus.OK)
    );
    expect(createBl.body.code).toBe("00000");
    expect(createBl.body.data.status).toBe(1);
    expect(createBl.body.data.storeId).toBeNull();
    const blacklistId = createBl.body.data.id;

    const page = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/customers/${customerId}/blacklist?scope=tenant&status=1`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(page.body.code).toBe("00000");
    expect((page.body.data.list as Array<{ id: string }>).some((r) => r.id === blacklistId)).toBe(
      true
    );

    // 硬拦截：触达被拒 A0522
    const blocked = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/customers/${customerId}/reach-logs`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ channel: 1, content: "应被黑名单拦截" })
        .expect(HttpStatus.CONFLICT)
    );
    expect(blocked.body).toMatchObject({ code: "A0522", data: null });

    // 解除（1→0）
    const release = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/customers/${customerId}/blacklist/${blacklistId}/release`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(release.body.code).toBe("00000");
    expect(release.body.data.status).toBe(0);

    // 解除后触达放行（渠道 1 未被偏好拒收）
    const allowed = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/customers/${customerId}/reach-logs`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ channel: 1, content: "解除后可触达" })
        .expect(HttpStatus.OK)
    );
    expect(allowed.body.code).toBe("00000");
  });

  it("黑名单（门店级）：scope=store 缺 storeId A0524；拉黑门店级 → 带 x-store-id 触达被拦、不带放行", async () => {
    // scope=store 缺 storeId → 400 A0524
    const invalid = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/customers/${customerId}/blacklist`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ scope: "store", reason: "缺门店" })
        .expect(HttpStatus.BAD_REQUEST)
    );
    expect(invalid.body).toMatchObject({ code: "A0524", data: null });

    // 门店级拉黑
    const createBl = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/customers/${customerId}/blacklist`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ scope: "store", storeId, reason: "仅本店拒收" })
        .expect(HttpStatus.OK)
    );
    expect(createBl.body.code).toBe("00000");
    expect(createBl.body.data.storeId).toBe(storeId);

    // 带 x-store-id=S → 门店级命中，硬拦截 A0522
    const blocked = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/customers/${customerId}/reach-logs`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .set("x-store-id", storeId)
        .send({ channel: 1, content: "本店应被拦" })
        .expect(HttpStatus.CONFLICT)
    );
    expect(blocked.body).toMatchObject({ code: "A0522", data: null });

    // 不带门店上下文 → 仅租户级判定（租户级已解除）→ 放行
    const allowed = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/customers/${customerId}/reach-logs`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ channel: 1, content: "无门店上下文放行" })
        .expect(HttpStatus.OK)
    );
    expect(allowed.body.code).toBe("00000");
  });

  it("来源枚举 + lifecycle：source-options → PATCH 更新为 3 → ?lifecycle=3 命中", async () => {
    const options = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/customers/source-options`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(options.body.code).toBe("00000");
    const opts = options.body.data as Array<{ value: number; label: string }>;
    expect(Array.isArray(opts)).toBe(true);
    expect(opts.map((o) => o.value).sort()).toEqual([1, 2, 3, 4, 9]);
    expect(opts.every((o) => typeof o.label === "string" && o.label.length > 0)).toBe(true);

    // 新建客户（lifecycle 默认 1）
    const created = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/customers`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ name: "E2E 生命周期宠主", mobile: mobileLifecycle })
        .expect(HttpStatus.OK)
    );
    expect(created.body.data.lifecycle).toBe(1);
    lifecycleCustomerId = created.body.data.id;
    createdCustomerIds.push(lifecycleCustomerId);

    // PATCH 更新 lifecycle=3（version=0）
    const patched = await withRetry429(() =>
      request(app.getHttpServer())
        .patch(`${PREFIX}/customers/${lifecycleCustomerId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ version: 0, lifecycle: 3 })
        .expect(HttpStatus.OK)
    );
    expect(patched.body.code).toBe("00000");
    expect(patched.body.data.lifecycle).toBe(3);
    expect(patched.body.data.version).toBe(1);

    // 列表按 lifecycle=3 筛选命中
    const list = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/customers?lifecycle=3`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(list.body.code).toBe("00000");
    const rows = list.body.data.list as Array<{ id: string; lifecycle: number }>;
    expect(rows.some((r) => r.id === lifecycleCustomerId)).toBe(true);
    for (const row of rows) expect(row.lifecycle).toBe(3);
  });

  afterAll(async () => {
    if (app) {
      // 兜底清理：物理清理本套件创建的触达 / 黑名单 / 客户 / 门店行
      // （admin 为超级用户，直连基础客户端绕过 RLS；库内无脏状态）
      if (createdCustomerIds.length > 0) {
        await prisma.reachLog.deleteMany({ where: { customerId: { in: createdCustomerIds } } });
        await prisma.blacklist.deleteMany({ where: { customerId: { in: createdCustomerIds } } });
      }
      if (createdStoreIds.length > 0) {
        await prisma.blacklist.deleteMany({ where: { storeId: { in: createdStoreIds } } });
      }
      if (createdCustomerIds.length > 0) {
        await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
      }
      if (createdStoreIds.length > 0) {
        await prisma.store.deleteMany({ where: { id: { in: createdStoreIds } } });
      }
      await app.close();
    }
  });
});
