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
 * P0-05-07 客户合并 FR-7 + P0-05-08 客户模块权限点 · API E2E
 * （独立 spec，禁动 test/app.e2e-spec.ts 及任何既有 spec）
 *
 * 覆盖：
 *  1. 前置：建档 source / target 两个客户 → 宠物（主人 source）→ 绑定宠物到 source
 *     → 给 source 记一条触达留痕；
 *  2. **正常合并**：`POST /customers/merge { sourceId, targetId }` 成功 →
 *     响应 `{ targetId, movedPets:1, movedReachLogs:1, mergedSourceId:sourceId }`；
 *  3. **合并后校验**：源客户列表 / 详情不可见（软删归档，DB 侧恒租户 + remark 追加）；
 *     宠物归属改判为 target；「按 target 可查宠物」；触达记录已迁往 target；
 *  4. 自我合并拒绝：sourceId===targetId → 400 A0529；
 *  5. **在途转移护栏**：source 存在在途转移申请 → 合并 409 A0528。
 *
 * 口径对齐 p0-05 / p0-05-03 / p0-05-04-06 e2e：
 *  - 全局前缀 /api/v1；成功信封 { code: "00000", msg, data }；创建类断言一律 200；
 *  - 每 it 内 HTTP 请求 ≤ 5（RateLimitMiddleware 每 IP 每秒 10 次）；
 *  - 限流错峰 + 清键（rate_limiter:ip:*）；afterAll 兜底物理清理（库内无脏状态）。
 *
 * 前置：PG / Redis 连通 + 系统域种子已执行（tenant_admin / 123456，tenant_id=1）。
 * 运行：node node_modules/jest/bin/jest.js --config ./test/jest-e2e.json p0-05-07-08 --runInBand
 */

const PREFIX = "/api/v1";

describe("P0-05-07/08 客户合并 · 权限点 (e2e)", () => {
  let app: INestApplication;
  let redis: RedisService;
  let prisma: PrismaService;
  let tenantToken: string; // 租户管理员（tenant_admin，tenant_id=1）
  let platformToken: string; // 平台级账号（admin，无租户归属）

  // 主链（正常合并）
  let sourceId: string;
  let targetId: string;
  let petId: string;
  // 护栏链（在途转移拒绝）
  let sourceBId: string;
  let targetBId: string;
  let petBId: string;

  const sourceMobile = `138${Date.now()}`;
  const targetMobile = `139${Date.now()}`;
  const sourceBMobile = `137${Date.now()}`;
  const targetBMobile = `136${Date.now()}`;
  const reachContent = `E2E 合并触达留痕 ${Date.now()}`;

  const createdCustomerIds: string[] = [];
  const createdPetIds: string[] = [];

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

  /** 建档客户并登记清理 */
  async function createCustomer(name: string, mobile: string): Promise<string> {
    const res = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/customers`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ name, mobile })
        .expect(HttpStatus.OK)
    );
    expect(res.body.code).toBe("00000");
    const id: string = res.body.data.id;
    createdCustomerIds.push(id);
    return id;
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

  it("前置：建档 source/target → 宠物（主人 source）→ 绑定到 source → 记一条触达", async () => {
    sourceId = await createCustomer("E2E 合并源客户", sourceMobile);
    targetId = await createCustomer("E2E 合并目标客户", targetMobile);

    const pet = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/pets`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ name: "E2E 合并旺财", ownerCustomerId: sourceId, petType: 1 })
        .expect(HttpStatus.OK)
    );
    expect(pet.body.code).toBe("00000");
    petId = pet.body.data.id;
    createdPetIds.push(petId);

    const bind = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/customers/${sourceId}/pets`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ petId })
        .expect(HttpStatus.OK)
    );
    expect(bind.body.code).toBe("00000");
    expect(bind.body.data).toMatchObject({ customerId: sourceId, petId });

    const reach = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/customers/${sourceId}/reach-logs`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ channel: 4, content: reachContent })
        .expect(HttpStatus.OK)
    );
    expect(reach.body.code).toBe("00000");
    expect(reach.body.data.customerId).toBe(sourceId);
  });

  it("正常合并：POST /customers/merge → 迁移宠物归属/关联/触达，源客户归档", async () => {
    const res = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/customers/merge`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ sourceId, targetId })
        .expect(HttpStatus.OK)
    );
    expect(res.body.code).toBe("00000");
    expect(res.body.data).toMatchObject({
      targetId,
      movedPets: 1,
      movedReachLogs: 1,
      mergedSourceId: sourceId,
    });
  });

  it("合并后：源客户列表/详情不可见（已归档，备注追加）；宠物归 target；按 target 可查宠物；触达已迁移", async () => {
    // ① 源客户详情不可见（软删 → 404 A0510）
    const sourceDetail = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/customers/${sourceId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.NOT_FOUND)
    );
    expect(sourceDetail.body).toMatchObject({ code: "A0510", data: null });

    // ② 源客户列表不可见（mobile 精确筛选 → 空）
    const sourceList = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/customers?mobile=${sourceMobile}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(sourceList.body.code).toBe("00000");
    expect(sourceList.body.data.total).toBe(0);

    // ③ 宠物归属改判为 target（权威字段 ownerCustomerId）
    const petDetail = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/pets/${petId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(petDetail.body.data.ownerCustomerId).toBe(targetId);

    // ④ 按 target 可查宠物（关联已迁移）
    const targetPets = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/customers/${targetId}/pets`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    const petIdsOnTarget = (targetPets.body.data as Array<{ petId: string }>).map((r) => r.petId);
    expect(petIdsOnTarget).toContain(petId);

    // ⑤ 触达记录已迁往 target + 源客户归档备注（DB 侧核对；base client 绕过租户扩展）
    const targetReach = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/customers/${targetId}/reach-logs`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    const contents = (targetReach.body.data.list as Array<{ content: string }>).map(
      (r) => r.content
    );
    expect(contents).toContain(reachContent);

    const archivedSource = await prisma.customer.findFirst({ where: { id: sourceId } });
    expect(archivedSource).not.toBeNull();
    expect(archivedSource?.deletedAt).not.toBeNull();
    expect(archivedSource?.remark).toContain(`已合并至 E2E 合并目标客户(${targetId})`);

    const migratedReach = await prisma.reachLog.findFirst({
      where: { customerId: targetId, content: reachContent },
    });
    expect(migratedReach).not.toBeNull();
  });

  it("自我合并拒绝：sourceId===targetId → 400 A0529", async () => {
    const res = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/customers/merge`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ sourceId: targetId, targetId })
        .expect(HttpStatus.BAD_REQUEST)
    );
    expect(res.body).toMatchObject({ code: "A0529", data: null });
  });

  it("在途转移护栏前置：建档 sourceB/targetB → 宠物（主人 sourceB）→ 发起在途转移申请", async () => {
    sourceBId = await createCustomer("E2E 护栏源客户", sourceBMobile);
    targetBId = await createCustomer("E2E 护栏目标客户", targetBMobile);

    const pet = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/pets`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ name: "E2E 护栏旺财", ownerCustomerId: sourceBId, petType: 1 })
        .expect(HttpStatus.OK)
    );
    expect(pet.body.code).toBe("00000");
    petBId = pet.body.data.id;
    createdPetIds.push(petBId);

    // sourceB 发起转移给 targetB → 生成在途申请（status=1）
    const transfer = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/pets/${petBId}/transfer`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ toCustomerId: targetBId })
        .expect(HttpStatus.OK)
    );
    expect(transfer.body.code).toBe("00000");
    expect(transfer.body.data.status).toBe(1);
  });

  it("在途转移护栏：source 存在在途转移申请 → 409 A0528（拒绝合并）", async () => {
    const res = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/customers/merge`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ sourceId: sourceBId, targetId: targetBId })
        .expect(HttpStatus.CONFLICT)
    );
    expect(res.body).toMatchObject({ code: "A0528", data: null });

    // 源客户不受影响（护栏生效：未归档）
    const sourceBDetail = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/customers/${sourceBId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(sourceBDetail.body.code).toBe("00000");
  });

  it("越权：平台 admin（无租户上下文）调用合并 → 403 A0302", async () => {
    const res = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/customers/merge`)
        .set("Authorization", `Bearer ${platformToken}`)
        .send({ sourceId, targetId })
        .expect(HttpStatus.FORBIDDEN)
    );
    expect(res.body).toMatchObject({ code: "A0302", data: null });
  });

  afterAll(async () => {
    if (app) {
      // 兜底清理：物理清理本套件创建的触达 / 转移申请 / 归属关联 / 宠物 / 客户行
      // （admin 为超级用户，直连基础客户端绕过 RLS；库内无脏状态）
      if (createdPetIds.length > 0) {
        await prisma.reachLog.deleteMany({ where: { customerId: { in: createdCustomerIds } } });
        await prisma.petTransferRequest.deleteMany({
          where: {
            OR: [{ petId: { in: createdPetIds } }, { fromCustomerId: { in: createdCustomerIds } }],
          },
        });
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
