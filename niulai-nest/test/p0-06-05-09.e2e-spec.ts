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
 * P0-06-05 行为标签 API + P0-06-09 宠物模块权限点 E2E（独立 spec，禁动任何已有 spec）
 *
 * 覆盖（FR-4）：
 *  - 标签库 CRUD：创建（租户级）→ 列表（启用/停用筛选）→ 更新（PATCH + version
 *    乐观锁）→ 软删；
 *  - 宠物打标签：PUT /pets/:id/tags 全量替换（联动房间/任务钩子被调用）；
 *  - 按标签筛宠物：GET /pets?behaviorTagId=（分页）；
 *  - 错误码：同名 A0610 / 不存在 A0611 / 版本冲突 A0612 / 无效标签 A0605；
 *  - 越权：平台 admin（无租户上下文）调标签接口 → 403 + A0302。
 *
 * 口径对齐 p0-06.e2e-spec.ts：
 *  - 全局前缀 /api/v1；成功信封 { code: "00000", msg, data }；
 *  - 创建/更新/删除类断言一律 200（统一信封，踩坑 32）；
 *  - 每 it 内 HTTP 请求受 RateLimitMiddleware（每 IP 每秒 10 次）约束：beforeEach
 *    清限流键 + withRetry429（清键重试一次）；
 *  - afterAll 兜底清理（物理删本套件创建的宠物/标签关联/标签/客户行）。
 *  - **串行运行**：node node_modules/.bin/jest --config ./test/jest-e2e.json p0-06-05-09 --runInBand
 *
 * 前置：PG / Redis 连通 + 系统域种子已执行（tenant_admin / 123456，tenant_id=1）。
 */

const PREFIX = "/api/v1";

describe("P0-06-05 行为标签 API + P0-06-09 权限点 (e2e)", () => {
  let app: INestApplication;
  let redis: RedisService;
  let prisma: PrismaService;
  let tenantToken: string; // 租户管理员（tenant_admin，tenant_id=1）
  let platformToken: string; // 平台级账号（admin，无租户归属）
  let customerId: string; // 宠物主人
  let petId: string; // 主链路宠物
  let tagAId: string; // 启用标签（主链路）
  let tagBId: string; // 停用标签（筛选用）
  const mobileA = `137${Date.now()}`;
  const createdTagIds: string[] = [];
  const createdPetIds: string[] = [];

  /** 受控测试后门：清空全局限流计数器（rate_limiter:ip:*，RedisService 同库） */
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
    await new Promise((resolve) => setTimeout(resolve, 400));

    // 前置：主人客户建档 + 宠物建档（走真实接口）
    const customerRes = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/customers`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ name: "E2E 标签宠主", mobile: mobileA })
        .expect(HttpStatus.OK)
    );
    expect(customerRes.body.code).toBe("00000");
    customerId = customerRes.body.data.id;

    const petRes = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/pets`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ name: "E2E 标签旺财", ownerCustomerId: customerId, petType: 1 })
        .expect(HttpStatus.OK)
    );
    expect(petRes.body.code).toBe("00000");
    petId = petRes.body.data.id;
    createdPetIds.push(petId);
  });

  beforeEach(async () => {
    await resetRateLimiter();
  });

  it("主链A：创建标签（启用/停用）→ 同名 A0610 → 列表按 status 筛选 → 给宠物打标签（全量替换）→ 按标签筛宠物", async () => {
    // 创建启用标签
    const tagRes = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/behavior-tags`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ name: `E2E咬人${Date.now()}`, sort: 1, status: 1 })
        .expect(HttpStatus.OK)
    );
    expect(tagRes.body.code).toBe("00000");
    tagAId = tagRes.body.data.id;
    createdTagIds.push(tagAId);
    expect(tagRes.body.data.tenantId).toBe("1"); // 归属令牌租户
    expect(tagRes.body.data.version).toBe(0);

    // 创建停用标签
    const tagBRes = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/behavior-tags`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ name: `E2E应激${Date.now()}`, sort: 2, status: 0 })
        .expect(HttpStatus.OK)
    );
    expect(tagBRes.body.code).toBe("00000");
    tagBId = tagBRes.body.data.id;
    createdTagIds.push(tagBId);

    // 同名重复创建 → 409 + A0610
    const dupRes = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/behavior-tags`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ name: tagRes.body.data.name })
        .expect(HttpStatus.CONFLICT)
    );
    expect(dupRes.body).toMatchObject({ code: "A0610", data: null });

    // 列表：status=1 命中启用标签，不含停用标签
    const listEnabled = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/behavior-tags?status=1`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(listEnabled.body.code).toBe("00000");
    const enabledIds = (listEnabled.body.data.list as Array<{ id: string }>).map((r) => r.id);
    expect(enabledIds).toContain(tagAId);
    expect(enabledIds).not.toContain(tagBId);

    // 列表：status=0 命中停用标签
    const listDisabled = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/behavior-tags?status=0`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    const disabledIds = (listDisabled.body.data.list as Array<{ id: string }>).map((r) => r.id);
    expect(disabledIds).toContain(tagBId);

    // 给宠物打标签（全量替换）
    const assignRes = await withRetry429(() =>
      request(app.getHttpServer())
        .put(`${PREFIX}/pets/${petId}/tags`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ behaviorTagIds: [tagAId] })
        .expect(HttpStatus.OK)
    );
    expect(assignRes.body.code).toBe("00000");
    expect(assignRes.body.data.behaviorTags).toEqual([expect.objectContaining({ id: tagAId })]);
    // 完整度：基础 40 + 标签 4 = 44
    expect(assignRes.body.data.profileCompleteness).toBe(44);

    // 按标签筛宠物（分页）：命中该宠物
    const petList = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/pets?behaviorTagId=${tagAId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(petList.body.code).toBe("00000");
    const petIds = (petList.body.data.list as Array<{ id: string }>).map((r) => r.id);
    expect(petIds).toContain(petId);
  });

  it("主链B：更新标签（PATCH + version 乐观锁）→ 旧版本重放 A0612 → 不存在 A0611", async () => {
    // 正常更新（sort + status）
    const updateRes = await withRetry429(() =>
      request(app.getHttpServer())
        .patch(`${PREFIX}/behavior-tags/${tagAId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ sort: 9, version: 0 })
        .expect(HttpStatus.OK)
    );
    expect(updateRes.body.code).toBe("00000");
    expect(updateRes.body.data.sort).toBe(9);
    expect(updateRes.body.data.version).toBe(1);

    // 旧版本重放 → 409 + A0612
    const conflictRes = await withRetry429(() =>
      request(app.getHttpServer())
        .patch(`${PREFIX}/behavior-tags/${tagAId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ sort: 10, version: 0 })
        .expect(HttpStatus.CONFLICT)
    );
    expect(conflictRes.body).toMatchObject({ code: "A0612", data: null });

    // 不存在的标签 → 404 + A0611
    const missingRes = await withRetry429(() =>
      request(app.getHttpServer())
        .patch(`${PREFIX}/behavior-tags/00000000-0000-4000-8000-000000000000`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ sort: 1, version: 0 })
        .expect(HttpStatus.NOT_FOUND)
    );
    expect(missingRes.body).toMatchObject({ code: "A0611", data: null });
  });

  it("校验：打标签用不存在/跨租户标签 → A0605", async () => {
    const assignRes = await withRetry429(() =>
      request(app.getHttpServer())
        .put(`${PREFIX}/pets/${petId}/tags`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ behaviorTagIds: ["00000000-0000-4000-8000-0000000000ff"] })
        .expect(HttpStatus.BAD_REQUEST)
    );
    expect(assignRes.body).toMatchObject({ code: "A0605", data: null });
  });

  it("越权：平台 admin（无租户上下文）调行为标签接口 → 403 + A0302", async () => {
    const listForbidden = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/behavior-tags`)
        .set("Authorization", `Bearer ${platformToken}`)
        .expect(HttpStatus.FORBIDDEN)
    );
    expect(listForbidden.body).toMatchObject({ code: "A0302", data: null });

    const createForbidden = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/behavior-tags`)
        .set("Authorization", `Bearer ${platformToken}`)
        .send({ name: "平台越权标签" })
        .expect(HttpStatus.FORBIDDEN)
    );
    expect(createForbidden.body).toMatchObject({ code: "A0302", data: null });
  });

  it("软删标签：DELETE → 200；该标签从启用列表消失；宠物按该标签筛选不再命中；详情标签清空", async () => {
    const delRes = await withRetry429(() =>
      request(app.getHttpServer())
        .delete(`${PREFIX}/behavior-tags/${tagAId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(delRes.body.code).toBe("00000");

    // 启用列表不再包含已软删标签
    const listRes = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/behavior-tags?status=1`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    const enabledIds = (listRes.body.data.list as Array<{ id: string }>).map((r) => r.id);
    expect(enabledIds).not.toContain(tagAId);

    // 按已软删标签筛宠物：关联已被清除 → 不再命中该宠物
    const petList = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/pets?behaviorTagId=${tagAId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    const petIds = (petList.body.data.list as Array<{ id: string }>).map((r) => r.id);
    expect(petIds).not.toContain(petId);

    // 宠物详情：行为标签已清空
    const detailRes = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/pets/${petId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(detailRes.body.data.behaviorTags).toEqual([]);
  });

  afterAll(async () => {
    if (app) {
      if (createdPetIds.length > 0) {
        await prisma.petBehaviorTag.deleteMany({ where: { petId: { in: createdPetIds } } });
        await prisma.pet.deleteMany({ where: { id: { in: createdPetIds } } });
      }
      if (createdTagIds.length > 0) {
        await prisma.petBehaviorTag.deleteMany({ where: { tagId: { in: createdTagIds } } });
        await prisma.behaviorTag.deleteMany({ where: { id: { in: createdTagIds } } });
      }
      if (customerId) {
        await prisma.customer.deleteMany({ where: { id: customerId } });
      }
      await app.close();
    }
  });
});
