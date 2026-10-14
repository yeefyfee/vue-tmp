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
 * P0-06-03 健康档案 API（FR-2）+ P0-06-04 体重曲线 API（FR-3）E2E
 * （独立 spec，禁动 test/app.e2e-spec.ts）
 *
 * 覆盖：
 *  1. 前置：客户建档 + 宠物建档（宠物归属锚点）；
 *  2. 健康档案 CRUD：建档（疫苗/驱虫，伪造 tenant_id 被忽略）→ 按 recordType 列表
 *     → 有效性判定（疫苗有效 Y / 驱虫过期 N）→ 更正（乐观锁 version 自增）→ 软删
 *     → 列表不再可见；
 *  3. 体重曲线：记录 3 条（乱序落库）→ 曲线按 weighedAt 升序返回（验收「按时间正确
 *     排序」）→ pet 当前体重快照 = 最新称重；
 *  4. 越权：带 ?tenant_id=999 的健康档案列表行全部属于租户 1；平台 admin（无租户
 *     上下文）调健康/体重接口 → @RequireTenant 拒绝（403 + A0302）。
 *
 * 口径对齐 p0-06.e2e-spec.ts：
 *  - 全局前缀 /api/v1；成功信封 { code: "00000", msg, data }；
 *  - 断言一律 200 信封（BusinessException 保留 httpStatus）；
 *  - 每 it 内 HTTP 请求 ≤ 5（RateLimitMiddleware 每 IP 每秒 10 次）；
 *  - 限流错峰 + 清键（rate_limiter:ip:*）；afterAll 兜底清理。
 *
 * 前置：PG / Redis 连通 + 系统域种子已执行（tenant_admin / 123456，tenant_id=1）。
 * 运行：node node_modules/.bin/jest --config ./test/jest-e2e.json p0-06-03
 */

const PREFIX = "/api/v1";

describe("P0-06-03 健康档案 + P0-06-04 体重曲线 API (e2e)", () => {
  let app: INestApplication;
  let redis: RedisService;
  let prisma: PrismaService;
  let tenantToken: string; // 租户管理员（tenant_admin，tenant_id=1）
  let platformToken: string; // 平台级账号（admin，无租户归属）
  let customerId: string;
  let petId: string;
  let vaccineId: string;
  let dewormId: string;
  const mobileA = `137${Date.now()}`;
  const createdPetIds: string[] = [];

  /** 受控测试后门：清空全局限流计数器（rate_limiter:ip:*） */
  async function resetRateLimiter(): Promise<void> {
    const client = redis.getClient();
    const limiterKeys = await client.keys("rate_limiter:ip:*");
    if (limiterKeys.length > 0) await client.del(...limiterKeys);
  }

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
  });

  beforeEach(async () => {
    await resetRateLimiter();
  });

  it("前置+建档+列表：客户→宠物→疫苗/驱虫建档（伪造 tenant_id 被忽略）→ recordType=1 列表", async () => {
    // 前置：主人客户建档
    const customerRes = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/customers`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ name: "E2E 健康宠主", mobile: mobileA })
        .expect(HttpStatus.OK)
    );
    expect(customerRes.body.code).toBe("00000");
    customerId = customerRes.body.data.id;

    // 宠物建档
    const petRes = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/pets`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ name: "E2E 健康汪", ownerCustomerId: customerId, petType: 1 })
        .expect(HttpStatus.OK)
    );
    expect(petRes.body.code).toBe("00000");
    petId = petRes.body.data.id;
    createdPetIds.push(petId);

    // 疫苗建档（未来到期；body 伪造 tenant_id，应被 DTO 白名单剥离）
    const vaccineRes = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/pets/${petId}/health`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({
          recordType: 1,
          recordDate: "2024-01-01",
          expireDate: "2999-01-01",
          content: "狂犬疫苗",
          tenant_id: "999",
        })
        .expect(HttpStatus.OK)
    );
    expect(vaccineRes.body.code).toBe("00000");
    vaccineId = vaccineRes.body.data.id;
    expect(vaccineRes.body.data.tenantId).toBe("1"); // 租户归属恒为令牌租户

    // 驱虫建档（已过期）
    const dewormRes = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/pets/${petId}/health`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({
          recordType: 2,
          recordDate: "2020-01-01",
          expireDate: "2020-02-01",
          content: "体内驱虫",
        })
        .expect(HttpStatus.OK)
    );
    expect(dewormRes.body.code).toBe("00000");
    dewormId = dewormRes.body.data.id;

    // 按 recordType 列表：仅疫苗可见
    const listRes = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/pets/${petId}/health?recordType=1`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(listRes.body.code).toBe("00000");
    const list = listRes.body.data.list as Array<{ id: string; recordType: number }>;
    expect(list.map((r) => r.id)).toContain(vaccineId);
    expect(list.every((r) => r.recordType === 1)).toBe(true);
  });

  it("有效性判定：疫苗在有效期内=Y，驱虫已过期=N（供入住疫苗校验消费）", async () => {
    const res = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/pets/${petId}/health/validity`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(res.body.code).toBe("00000");
    expect(res.body.data.petId).toBe(petId);
    const items = res.body.data.items as Array<{
      recordType: number;
      valid: boolean;
      hasRecord: boolean;
      expireDate: string | null;
    }>;
    const vaccine = items.find((i) => i.recordType === 1)!;
    const deworm = items.find((i) => i.recordType === 2)!;
    expect(vaccine.valid).toBe(true);
    expect(vaccine.hasRecord).toBe(true);
    expect(vaccine.expireDate).toBeTruthy();
    expect(deworm.valid).toBe(false);
    expect(res.body.data.allValid).toBe(false);
  });

  it("更正/软删：乐观锁 version 自增 → 软删 → recordType=2 列表不再可见", async () => {
    // 更正驱虫（version 0 → 1）
    const updateRes = await withRetry429(() =>
      request(app.getHttpServer())
        .put(`${PREFIX}/pets/${petId}/health/${dewormId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ version: 0, content: "更正：体内驱虫(批号B)" })
        .expect(HttpStatus.OK)
    );
    expect(updateRes.body.code).toBe("00000");
    expect(updateRes.body.data.version).toBe(1);

    // 软删
    const deleteRes = await withRetry429(() =>
      request(app.getHttpServer())
        .delete(`${PREFIX}/pets/${petId}/health/${dewormId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(deleteRes.body.code).toBe("00000");

    // 列表不再可见
    const listRes = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/pets/${petId}/health?recordType=2`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    const list = listRes.body.data.list as Array<{ id: string }>;
    expect(list.map((r) => r.id)).not.toContain(dewormId);
  });

  it("体重曲线：乱序落库 → 曲线按 weighedAt 升序（验收）；pet 快照=最新称重", async () => {
    // 乱序：先落 03-01，再落 01-01，再落 02-01
    for (const [weighedAt, weightKg] of [
      ["2025-03-01", "12.00"],
      ["2025-01-01", "10.00"],
      ["2025-02-01", "11.00"],
    ]) {
      const res = await withRetry429(() =>
        request(app.getHttpServer())
          .post(`${PREFIX}/pets/${petId}/weights`)
          .set("Authorization", `Bearer ${tenantToken}`)
          .send({ weighedAt, weightKg })
          .expect(HttpStatus.OK)
      );
      expect(res.body.code).toBe("00000");
    }

    // 曲线：默认升序
    const curveRes = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/pets/${petId}/weight-curve`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(curveRes.body.code).toBe("00000");
    expect(curveRes.body.data.order).toBe("asc");
    const points = curveRes.body.data.points as Array<{ weighedAt: string; weightKg: string }>;
    expect(points.length).toBeGreaterThanOrEqual(3);
    // 按时间正确排序（升序）：相邻比较非递减
    for (let i = 1; i < points.length; i += 1) {
      expect(points[i - 1].weighedAt <= points[i].weighedAt).toBe(true);
    }
    // pet 当前体重快照 = 最新称重（12.00）
    expect(Number(curveRes.body.data.weightKg)).toBe(12);

    // pet 详情快照同步
    const petRes = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/pets/${petId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(Number(petRes.body.data.weightKg)).toBe(12);
  });

  it("越权：?tenant_id=999 列表行全部租户 1 + 平台 admin 403 A0302", async () => {
    // 越权①：伪造 tenant_id 查询，返回行仍是租户 1
    const listRes = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/pets/${petId}/health?tenant_id=999`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(listRes.body.code).toBe("00000");
    const list = listRes.body.data.list as Array<{ tenantId: string }>;
    for (const row of list) {
      expect(row.tenantId).toBe("1");
    }

    // 越权②：平台 admin（无租户上下文）→ 403 + A0302
    const healthForbidden = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/pets/${petId}/health`)
        .set("Authorization", `Bearer ${platformToken}`)
        .expect(HttpStatus.FORBIDDEN)
    );
    expect(healthForbidden.body).toMatchObject({ code: "A0302", data: null });

    const weightForbidden = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/pets/${petId}/weights`)
        .set("Authorization", `Bearer ${platformToken}`)
        .send({ weighedAt: "2025-01-01", weightKg: "1.00" })
        .expect(HttpStatus.FORBIDDEN)
    );
    expect(weightForbidden.body).toMatchObject({ code: "A0302", data: null });
  });

  afterAll(async () => {
    if (app) {
      // 兜底清理：物理清理本套件创建的健康档案 / 体重 / 时间线 / 宠物 / 客户行
      // （走基础客户端绕过租户扩展——清理脚本语义）
      if (createdPetIds.length > 0) {
        await prisma.healthRecord.deleteMany({ where: { petId: { in: createdPetIds } } });
        await prisma.weight.deleteMany({ where: { petId: { in: createdPetIds } } });
        // timeline_event 自 P0-06-07 起为 append-only（触发器拦截 UPDATE/DELETE）：
        // 测试清理必须经 GUC 受控维护通道，否则会抛 P0001 导致 suite 起不来。
        try {
          await prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(`SELECT set_config('app.timeline_maintenance', 'on', true)`);
            await tx.$executeRawUnsafe(
              `DELETE FROM timeline_event WHERE pet_id = ANY($1::uuid[])`,
              createdPetIds
            );
          });
        } catch {
          // 清理尽力而为，不阻断 afterAll
        }
        await prisma.pet.deleteMany({ where: { id: { in: createdPetIds } } });
      }
      if (customerId) {
        await prisma.customer.deleteMany({ where: { id: customerId } });
      }
      await app.close();
    }
  });
});
