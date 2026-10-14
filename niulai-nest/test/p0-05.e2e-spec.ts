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
 * P0-05-02 萌主档案 API E2E（customer CRUD · 独立 spec，禁动 test/app.e2e-spec.ts）
 *
 * 覆盖：
 *  1. CRUD 主链：创建（伪造 tenant_id 被忽略）→ 详情归属租户 1 → 重复手机号 409（A0501
 *     —— 租户内唯一验收）→ 列表筛选（mobile 精确 / name 模糊）→ 更新（version 乐观锁
 *     0→1）→ 旧版本重放 409（A0511）→ 软删 → 详情 404（A0510）→ 软删后同手机号
 *     重新建档成功（部分唯一索引「软删释放手机号」验收）；
 *  2. 越权：带 ?tenant_id=999 的列表查询返回的行全部属于租户 1；平台 admin（无租户
 *     上下文）调客户接口 → @RequireTenant 拒绝（403 + A0302）。
 *
 * 口径对齐 app.e2e-spec.ts：
 *  - 全局前缀 /api/v1；成功信封 { code: "00000", msg, data }；
 *  - 断言一律 200 信封（BusinessException 保留 httpStatus）；
 *  - 每 it 内 HTTP 请求 ≤ 5（RateLimitMiddleware 每 IP 每秒 10 次）；
 *  - 限流错峰 + 清键（rate_limiter:ip:* 每 IP 10 次/s，429 重试一次）；
 *  - afterAll 兜底清理（物理删客户行，避免部分唯一索引残留阻塞重跑）。
 *
 * 前置：PG / Redis 连通 + 系统域种子已执行（tenant_admin / 123456，tenant_id=1）。
 * 运行：node node_modules/.bin/jest --config ./test/jest-e2e.json p0-05
 */

const PREFIX = "/api/v1";

describe("P0-05-02 萌主档案 API (e2e)", () => {
  let app: INestApplication;
  let redis: RedisService;
  let tenantToken: string; // 租户管理员（tenant_admin，tenant_id=1）
  let platformToken: string; // 平台级账号（admin，无租户归属）
  let customerId: string; // 主链路客户（软删）
  let customerIdB: string; // 第二客户（name 筛选用）
  let recreatedId: string; // 软删后同手机号重新建档的客户
  const mobileA = `138${Date.now()}`; // 16 位数字，DTO @Matches(1~20 位数字) 内
  const mobileB = `139${Date.now()}`;
  /** 兜底清理集合：本套件创建的客户 id，afterAll 统一物理清理 */
  const createdCustomerIds: string[] = [];

  /** 受控测试后门：清空全局限流计数器（rate_limiter:ip:*，RedisService 同库） */
  async function resetRateLimiter(): Promise<void> {
    const client = redis.getClient();
    const limiterKeys = await client.keys("rate_limiter:ip:*");
    if (limiterKeys.length > 0) await client.del(...limiterKeys);
  }

  /** 带 429 重试的请求包装：并行测试进程共享 Redis 限流键时清一次计数器重试 */
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

  /** 走真实 /auth/captcha 流程取得有效 captchaId，并从 Redis 读取其明文（受控后门） */
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

    tenantToken = await loginAndGetToken("tenant_admin", "123456");
    await new Promise((resolve) => setTimeout(resolve, 400));
    platformToken = await loginAndGetToken("admin", "123456");
    await new Promise((resolve) => setTimeout(resolve, 400));
  });

  beforeEach(async () => {
    // 受控测试后门（同 app.e2e-spec 审计 describe 惯例）：用例间清空全局限流计数器，
    // 隔离固定窗口（每 IP 每秒 10 次）跨用例累积造成的 429 假失败
    await resetRateLimiter();
  });

  it("主链路A：创建（query/body 伪造 tenant_id=999 被忽略）→ 详情归属租户 1、version=0", async () => {
    const createRes = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/customers?tenant_id=999`) // 越权：query 伪造
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({
          name: "E2E 张小萌",
          mobile: mobileA,
          gender: 2,
          birthday: "1995-06-15",
          source: 1,
          remark: "P0-05 E2E 客户",
          tenant_id: "999", // 越权：body 伪造（DTO 白名单应剥离）
        })
        .expect(HttpStatus.OK)
    ); // 全局 ResponseInterceptor 统一 200 信封
    expect(createRes.body.code).toBe("00000");
    customerId = createRes.body.data.id;
    createdCustomerIds.push(customerId);
    expect(createRes.body.data.mobile).toBe(mobileA);
    expect(createRes.body.data.version).toBe(0);

    // 回读：租户归属恒为令牌租户 1（BigInt 垫片序列化为字符串），伪造的 999 不生效
    const detailRes = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/customers/${customerId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(detailRes.body.code).toBe("00000");
    expect(detailRes.body.data.tenantId).toBe("1");
    expect(detailRes.body.data.name).toBe("E2E 张小萌");
    expect(detailRes.body.data.birthday).toContain("1995-06-15");
  });

  it("主链路B：同租户重复手机号 409 A0501（唯一约束验收）→ 第二客户建档 → 列表筛选命中", async () => {
    // 重复手机号 → 409 + A0501（部分唯一索引 + 应用层查重）
    const dupRes = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/customers`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ name: "E2E 重复手机号", mobile: mobileA })
        .expect(HttpStatus.CONFLICT)
    );
    expect(dupRes.body).toMatchObject({ code: "A0501", data: null });

    // 第二客户（不同手机号/姓名，name 筛选用）
    const createBRes = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/customers`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ name: "E2E 李阿福", mobile: mobileB, source: 4 })
        .expect(HttpStatus.OK)
    );
    expect(createBRes.body.code).toBe("00000");
    customerIdB = createBRes.body.data.id;
    createdCustomerIds.push(customerIdB);

    // 列表：mobile 精确筛到客户 A；name 模糊筛到客户 B
    const listRes = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/customers?mobile=${mobileA}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(listRes.body.code).toBe("00000");
    const listIds = (listRes.body.data.list as Array<{ id: string }>).map((row) => row.id);
    expect(listIds).toContain(customerId);
    expect(listIds).not.toContain(customerIdB);

    const nameRes = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/customers?name=${encodeURIComponent("李阿福")}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(nameRes.body.code).toBe("00000");
    const nameIds = (nameRes.body.data.list as Array<{ id: string }>).map((row) => row.id);
    expect(nameIds).toContain(customerIdB);
    expect(nameIds).not.toContain(customerId);
  });

  it("主链路C：更新(version 0→1) → 旧版本重放 A0511 → 软删 → 详情 A0510 → 同手机号重新建档（软删释放手机号）", async () => {
    // 更新：version 乐观锁命中，version 自增
    const updateRes = await withRetry429(() =>
      request(app.getHttpServer())
        .put(`${PREFIX}/customers/${customerId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ name: "E2E 张小萌（已改名）", remark: "已更新", version: 0 })
        .expect(HttpStatus.OK)
    );
    expect(updateRes.body.data.version).toBe(1);

    // 旧版本重放 → 409 + A0511（并发覆盖被乐观锁拦截）
    const conflictRes = await withRetry429(() =>
      request(app.getHttpServer())
        .put(`${PREFIX}/customers/${customerId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ name: "并发覆盖尝试", version: 0 })
        .expect(HttpStatus.CONFLICT)
    );
    expect(conflictRes.body).toMatchObject({ code: "A0511", data: null });

    // 软删
    const deleteRes = await withRetry429(() =>
      request(app.getHttpServer())
        .delete(`${PREFIX}/customers/${customerId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(deleteRes.body.code).toBe("00000");

    // 软删后详情不可见 → 404 + A0510
    const missingRes = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/customers/${customerId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.NOT_FOUND)
    );
    expect(missingRes.body).toMatchObject({ code: "A0510", data: null });

    // 软删释放手机号（部分唯一索引 WHERE deleted_at IS NULL）：同手机号可重新建档
    const recreateRes = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/customers`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ name: "E2E 张小萌（重新建档）", mobile: mobileA })
        .expect(HttpStatus.OK)
    );
    expect(recreateRes.body.code).toBe("00000");
    recreatedId = recreateRes.body.data.id;
    createdCustomerIds.push(recreatedId);
    expect(recreatedId).not.toBe(customerId);
  });

  it("越权：?tenant_id=999 列表行全部租户 1 + 平台 admin 403 A0302", async () => {
    // 越权③：带 ?tenant_id=999 的列表查询返回的行全部属于租户 1
    const listRes = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/customers?tenant_id=999`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(listRes.body.code).toBe("00000");
    const list = listRes.body.data.list as Array<{ tenantId: string }>;
    expect(Array.isArray(list)).toBe(true);
    for (const row of list) {
      expect(row.tenantId).toBe("1");
    }

    // 越权②：无租户上下文的平台 admin 调客户接口 → @RequireTenant 拒绝（403 + A0302）
    const forbiddenRes = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/customers`)
        .set("Authorization", `Bearer ${platformToken}`)
        .expect(HttpStatus.FORBIDDEN)
    );
    expect(forbiddenRes.body).toMatchObject({ code: "A0302", data: null });

    const createForbiddenRes = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/customers`)
        .set("Authorization", `Bearer ${platformToken}`)
        .send({ name: "平台越权", mobile: "10000000000" })
        .expect(HttpStatus.FORBIDDEN)
    );
    expect(createForbiddenRes.body).toMatchObject({ code: "A0302", data: null });
  });

  afterAll(async () => {
    // 兜底清理：物理清理本套件创建的客户行（软删的 + 重新建档存活的；避免
    // 部分唯一索引按 mobile 残留阻塞后续重跑；走基础客户端绕过租户扩展——清理脚本语义）
    if (app && createdCustomerIds.length > 0) {
      const prisma = app.get(PrismaService);
      await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
    }
    if (app) await app.close();
  });
});
