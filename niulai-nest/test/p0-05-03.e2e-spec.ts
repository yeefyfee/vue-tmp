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
 * P0-05-03 多宠物归属 FR-2 API E2E（customer_pet 归属 + pet_transfer_request 审批流
 * · 独立 spec，禁动 test/app.e2e-spec.ts）
 *
 * 覆盖：
 *  1. 前置：客户 A / B 建档 → 宠物（主人 A）→ 绑定宠物到 A（归属关联建立，isPrimary）；
 *  2. **核心验收「未审批不可变更归属」**：发起转移申请（生成待审批）后回读 ——
 *     pet.ownerCustomerId 仍为 A、A 列表仍含该宠物、B 列表不含；
 *  3. 审批通过 → 事务内改归属：pet.ownerCustomerId 变 B、A 列表不含、B 列表含；
 *  4. 状态机 + 冲突：重复在途申请 409（A0515）、已绑定他主绑定 409（A0514）、
 *     拒绝 1→3 且归属不变；
 *  5. 越权：?tenant_id=999 列表行恒租户 1；平台 admin（无租户上下文）→ 403 A0302；
 *     解绑当前归属 → 409 A0519（归属变更须经审批）。
 *
 * 口径对齐 p0-05 / p0-06 e2e：
 *  - 全局前缀 /api/v1；成功信封 { code: "00000", msg, data }；
 *  - 断言一律 200 信封（BusinessException 保留 httpStatus）；
 *  - 每 it 内 HTTP 请求 ≤ 5（RateLimitMiddleware 每 IP 每秒 10 次）；
 *  - 限流错峰 + 清键（rate_limiter:ip:*）；afterAll 兜底物理清理（库内无脏状态）。
 *
 * 前置：PG / Redis 连通 + 系统域种子已执行（tenant_admin / 123456，tenant_id=1）。
 * 运行：node node_modules/.bin/jest --config ./test/jest-e2e.json p0-05-03
 */

const PREFIX = "/api/v1";

describe("P0-05-03 多宠物归属 FR-2 API (e2e)", () => {
  let app: INestApplication;
  let redis: RedisService;
  let prisma: PrismaService;
  let tenantToken: string; // 租户管理员（tenant_admin，tenant_id=1）
  let platformToken: string; // 平台级账号（admin，无租户归属）
  let customerA: string;
  let customerB: string;
  let petId: string;
  let transferId: string; // 主链转移申请（审批通过）
  let transferId2: string; // 复发起转移申请（拒绝）
  const mobileA = `137${Date.now()}`;
  const mobileB = `136${Date.now()}`;
  const createdPetIds: string[] = [];
  const createdCustomerIds: string[] = [];

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

  it("前置+绑定：客户 A/B 建档 → 宠物（主人 A）→ 绑定到 A（归属关联 isPrimary）", async () => {
    const cA = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/customers`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ name: "E2E 宠主甲", mobile: mobileA })
        .expect(HttpStatus.OK)
    );
    expect(cA.body.code).toBe("00000");
    customerA = cA.body.data.id;
    createdCustomerIds.push(customerA);

    const cB = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/customers`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ name: "E2E 宠主乙", mobile: mobileB })
        .expect(HttpStatus.OK)
    );
    expect(cB.body.code).toBe("00000");
    customerB = cB.body.data.id;
    createdCustomerIds.push(customerB);

    const pet = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/pets`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ name: "E2E 归属旺财", ownerCustomerId: customerA, petType: 1 })
        .expect(HttpStatus.OK)
    );
    expect(pet.body.code).toBe("00000");
    petId = pet.body.data.id;
    createdPetIds.push(petId);

    const bind = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/customers/${customerA}/pets`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ petId })
        .expect(HttpStatus.OK)
    );
    expect(bind.body.code).toBe("00000");
    expect(bind.body.data).toMatchObject({ customerId: customerA, petId, isPrimary: true });

    const listRes = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/customers/${customerA}/pets`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    const petIds = (listRes.body.data as Array<{ petId: string }>).map((row) => row.petId);
    expect(petIds).toContain(petId);
  });

  it("核心验收：发起转移申请生成待审批，未审批时归属保持不变（A 列表仍含 / B 列表不含）", async () => {
    const applyRes = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/pets/${petId}/transfer`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ toCustomerId: customerB, reason: "家庭变更" })
        .expect(HttpStatus.OK)
    );
    expect(applyRes.body.code).toBe("00000");
    transferId = applyRes.body.data.id;
    expect(applyRes.body.data.status).toBe(1);
    expect(applyRes.body.data.fromCustomerId).toBe(customerA);
    expect(applyRes.body.data.toCustomerId).toBe(customerB);

    // ⭐ 核心断言：未审批 → pet.ownerCustomerId 仍为 A
    const detail = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/pets/${petId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(detail.body.data.ownerCustomerId).toBe(customerA);

    // A 的宠物列表仍包含该宠物
    const listA = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/customers/${customerA}/pets`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect((listA.body.data as Array<{ petId: string }>).map((r) => r.petId)).toContain(petId);

    // B 的宠物列表不含该宠物
    const listB = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/customers/${customerB}/pets`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect((listB.body.data as Array<{ petId: string }>).map((r) => r.petId)).not.toContain(petId);
  });

  it("审批通过：归属变更 —— pet.ownerCustomerId=B、A 列表不含、B 列表含", async () => {
    const approveRes = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/pet-transfers/${transferId}/approve`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(approveRes.body.code).toBe("00000");
    expect(approveRes.body.data.status).toBe(2);

    const detail = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/pets/${petId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(detail.body.data.ownerCustomerId).toBe(customerB);

    const listA = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/customers/${customerA}/pets`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect((listA.body.data as Array<{ petId: string }>).map((r) => r.petId)).not.toContain(petId);

    const listB = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/customers/${customerB}/pets`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect((listB.body.data as Array<{ petId: string }>).map((r) => r.petId)).toContain(petId);
  });

  it("在途唯一：重复发起转移 409（A0515）；已归属他主绑定 409（A0514）", async () => {
    // 现主人为 B → 发起 B→A 转移申请
    const apply = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/pets/${petId}/transfer`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ toCustomerId: customerA })
        .expect(HttpStatus.OK)
    );
    expect(apply.body.code).toBe("00000");
    transferId2 = apply.body.data.id;

    // 重复在途申请 → 409 A0515
    const dup = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/pets/${petId}/transfer`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ toCustomerId: customerA })
        .expect(HttpStatus.CONFLICT)
    );
    expect(dup.body).toMatchObject({ code: "A0515", data: null });

    // 宠物现主人为 B → 绑定到 A 被拒（A0514，引导走转移申请）
    const conflict = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/customers/${customerA}/pets`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ petId })
        .expect(HttpStatus.CONFLICT)
    );
    expect(conflict.body).toMatchObject({ code: "A0514", data: null });
  });

  it("拒绝：1→3 记录拒绝理由，归属保持不变（ownerCustomerId 仍 B）", async () => {
    const rejectRes = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/pet-transfers/${transferId2}/reject`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ rejectReason: "暂不同意" })
        .expect(HttpStatus.OK)
    );
    expect(rejectRes.body.code).toBe("00000");
    expect(rejectRes.body.data.status).toBe(3);
    expect(rejectRes.body.data.rejectReason).toBe("暂不同意");

    const detail = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/pets/${petId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(detail.body.data.ownerCustomerId).toBe(customerB);
  });

  it("越权：?tenant_id=999 列表行恒租户 1；平台 admin 403（A0302）；解绑当前归属 409（A0519）", async () => {
    // 越权①：带 ?tenant_id=999 的分页查询返回的行全部属于租户 1
    const listRes = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/pet-transfers?tenant_id=999`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(listRes.body.code).toBe("00000");
    const list = listRes.body.data.list as Array<{ tenantId: string }>;
    expect(Array.isArray(list)).toBe(true);
    for (const row of list) {
      expect(row.tenantId).toBe("1");
    }

    // 越权②：无租户上下文的平台 admin → 403 A0302
    const forbiddenRes = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/pet-transfers`)
        .set("Authorization", `Bearer ${platformToken}`)
        .expect(HttpStatus.FORBIDDEN)
    );
    expect(forbiddenRes.body).toMatchObject({ code: "A0302", data: null });

    const createForbiddenRes = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/pets/${petId}/transfer`)
        .set("Authorization", `Bearer ${platformToken}`)
        .send({ toCustomerId: customerA })
        .expect(HttpStatus.FORBIDDEN)
    );
    expect(createForbiddenRes.body).toMatchObject({ code: "A0302", data: null });

    // 设计校验：解绑宠物当前归属关联被禁止（归属变更须经审批）→ 409 A0519
    const unbindRes = await withRetry429(() =>
      request(app.getHttpServer())
        .delete(`${PREFIX}/customers/${customerB}/pets/${petId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.CONFLICT)
    );
    expect(unbindRes.body).toMatchObject({ code: "A0519", data: null });
  });

  afterAll(async () => {
    if (app) {
      // 兜底清理：物理清理本套件创建的转移申请 / 归属关联 / 宠物 / 客户行
      // （admin 为超级用户，直连基础客户端绕过 RLS；库内无脏状态）
      if (createdPetIds.length > 0) {
        await prisma.petTransferRequest.deleteMany({ where: { petId: { in: createdPetIds } } });
        await prisma.customerPet.deleteMany({ where: { petId: { in: createdPetIds } } });
        await prisma.pet.deleteMany({ where: { id: { in: createdPetIds } } });
      }
      if (createdCustomerIds.length > 0) {
        await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
      }
      await app.close();
    }
  });
});
