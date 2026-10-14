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
 * P0-06-02 宠物档案 API E2E（pet CRUD · 独立 spec，禁动 test/app.e2e-spec.ts）
 *
 * 覆盖：
 *  1. 前置客户建档（/customers，宠物主人归属锚点）；
 *  2. CRUD 主链：创建宠物（伪造 tenant_id 被忽略，完整度=40 基础档）→ 详情归属
 *     租户 1 → 更新填充生日/品种/体重/照片/绝育/芯片/毛色（完整度 40→96，
 *     「字段填充越多分越高」验收）→ 挂行为标签再更新（完整度→100 满档）→
 *     旧版本重放 409（A0602）→ 软删 → 详情 404（A0601）；
 *  3. 校验类：主人客户不存在/跨租户 400（A0603）；
 *  4. 越权：带 ?tenant_id=999 的列表查询返回的行全部属于租户 1；平台 admin
 *     （无租户上下文）调宠物接口 → @RequireTenant 拒绝（403 + A0302）。
 *
 * 口径对齐 p0-05.e2e-spec.ts：
 *  - 全局前缀 /api/v1；成功信封 { code: "00000", msg, data }；
 *  - 断言一律 200 信封（BusinessException 保留 httpStatus）；
 *  - 每 it 内 HTTP 请求 ≤ 5（RateLimitMiddleware 每 IP 每秒 10 次）；
 *  - 限流错峰 + 清键（rate_limiter:ip:* 每 IP 10 次/s，429 重试一次）；
 *  - afterAll 兜底清理（物理删宠物/标签关联/标签/客户行，库内无脏状态）。
 *
 * 前置：PG / Redis 连通 + 系统域种子已执行（tenant_admin / 123456，tenant_id=1）。
 * 运行：node node_modules/.bin/jest --config ./test/jest-e2e.json p0-06
 */

const PREFIX = "/api/v1";

describe("P0-06-02 宠物档案 API (e2e)", () => {
  let app: INestApplication;
  let redis: RedisService;
  let prisma: PrismaService;
  let tenantToken: string; // 租户管理员（tenant_admin，tenant_id=1）
  let platformToken: string; // 平台级账号（admin，无租户归属）
  let customerId: string; // 主链路客户（宠物主人）
  let petId: string; // 主链路宠物（软删）
  let tagId: string; // 行为标签（prisma 直建，评分满档用）
  const mobileA = `137${Date.now()}`; // 16 位数字，DTO @Matches(1~20 位数字) 内
  /** 兜底清理集合：本套件创建的宠物 id，afterAll 统一物理清理 */
  const createdPetIds: string[] = [];

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
    prisma = app.get(PrismaService);

    tenantToken = await loginAndGetToken("tenant_admin", "123456");
    await new Promise((resolve) => setTimeout(resolve, 400));
    platformToken = await loginAndGetToken("admin", "123456");
    await new Promise((resolve) => setTimeout(resolve, 400));

    // 行为标签直建（P0-06-05 才开放标签 API，此处受控直插 tenant 1 行）
    const tag = await prisma.behaviorTag.create({
      data: { tenantId: BigInt("1"), name: `E2E咬人${Date.now()}`, sort: 1, status: 1 },
    });
    tagId = tag.id;
  });

  beforeEach(async () => {
    // 受控测试后门（同 p0-05 惯例）：用例间清空全局限流计数器，
    // 隔离固定窗口（每 IP 每秒 10 次）跨用例累积造成的 429 假失败
    await resetRateLimiter();
  });

  it("前置+主链路A：客户建档 → 创建宠物（伪造 tenant_id=999 被忽略）→ 详情归属租户 1、完整度=40", async () => {
    // 前置：主人客户建档（/customers 范式复用）
    const createCustomerRes = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/customers`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ name: "E2E 宠主小萌", mobile: mobileA })
        .expect(HttpStatus.OK)
    );
    expect(createCustomerRes.body.code).toBe("00000");
    customerId = createCustomerRes.body.data.id;

    // 创建宠物：query/body 伪造 tenant_id 均被剥离
    const createRes = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/pets?tenant_id=999`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({
          name: "E2E 旺财",
          ownerCustomerId: customerId,
          petType: 1,
          tenant_id: "999", // 越权：body 伪造（DTO 白名单应剥离）
        })
        .expect(HttpStatus.OK)
    );
    expect(createRes.body.code).toBe("00000");
    petId = createRes.body.data.id;
    createdPetIds.push(petId);
    expect(createRes.body.data.version).toBe(0);
    // 完整度基础档：name(20) + owner(10) + petType(10) = 40
    expect(createRes.body.data.profileCompleteness).toBe(40);

    // 回读：租户归属恒为令牌租户 1（BigInt 垫片序列化为字符串），伪造的 999 不生效
    const detailRes = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/pets/${petId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(detailRes.body.code).toBe("00000");
    expect(detailRes.body.data.tenantId).toBe("1");
    expect(detailRes.body.data.name).toBe("E2E 旺财");
    expect(detailRes.body.data.profileCompleteness).toBe(40);
  });

  it("主链路B：字段填充越多分越高（更新 40→96）→ 挂行为标签（→100 满档）", async () => {
    // 填充 birthday(+10)/breed(+8)/weightKg(+10)/photoUrl(+10)/sterilized(+7)/chipNo(+7)/coatColor(+4)
    const updateRes = await withRetry429(() =>
      request(app.getHttpServer())
        .put(`${PREFIX}/pets/${petId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({
          birthday: "2022-03-01",
          breed: "金毛",
          weightKg: "12.50",
          photoUrl: "https://cdn.example.com/woof.jpg",
          sterilized: true,
          chipNo: "CHIP-E2E-001",
          coatColor: "金色",
          version: 0,
        })
        .expect(HttpStatus.OK)
    );
    expect(updateRes.body.code).toBe("00000");
    expect(updateRes.body.data.version).toBe(1);
    expect(updateRes.body.data.profileCompleteness).toBe(96);

    // 挂行为标签（全量替换语义）→ +4 = 100
    const tagRes = await withRetry429(() =>
      request(app.getHttpServer())
        .put(`${PREFIX}/pets/${petId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ behaviorTagIds: [tagId], version: 1 })
        .expect(HttpStatus.OK)
    );
    expect(tagRes.body.data.profileCompleteness).toBe(100);
    expect(tagRes.body.data.behaviorTags).toEqual([expect.objectContaining({ id: tagId })]);

    // 列表：ownerCustomerId 精确筛到主链宠物
    const listRes = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/pets?ownerCustomerId=${customerId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(listRes.body.code).toBe("00000");
    const listIds = (listRes.body.data.list as Array<{ id: string }>).map((row) => row.id);
    expect(listIds).toContain(petId);
  });

  it("主链路C：旧版本重放 A0602 → 主人客户无效 A0603 → 软删 → 详情 A0601", async () => {
    // 旧版本重放 → 409 + A0602（并发覆盖被乐观锁拦截）
    const conflictRes = await withRetry429(() =>
      request(app.getHttpServer())
        .put(`${PREFIX}/pets/${petId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ name: "并发覆盖尝试", version: 0 })
        .expect(HttpStatus.CONFLICT)
    );
    expect(conflictRes.body).toMatchObject({ code: "A0602", data: null });

    // 主人客户指向不存在的 uuid → 400 + A0603（跨租户在 RLS 下同码，防枚举）
    const ownerRes = await withRetry429(() =>
      request(app.getHttpServer())
        .put(`${PREFIX}/pets/${petId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ ownerCustomerId: "00000000-0000-4000-8000-00000000dead", version: 2 })
        .expect(HttpStatus.BAD_REQUEST)
    );
    expect(ownerRes.body).toMatchObject({ code: "A0603", data: null });

    // 软删
    const deleteRes = await withRetry429(() =>
      request(app.getHttpServer())
        .delete(`${PREFIX}/pets/${petId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(deleteRes.body.code).toBe("00000");

    // 软删后详情不可见 → 404 + A0601
    const missingRes = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/pets/${petId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.NOT_FOUND)
    );
    expect(missingRes.body).toMatchObject({ code: "A0601", data: null });
  });

  it("越权：?tenant_id=999 列表行全部租户 1 + 平台 admin 403 A0302", async () => {
    // 越权①：带 ?tenant_id=999 的列表查询返回的行全部属于租户 1
    const listRes = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/pets?tenant_id=999`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(listRes.body.code).toBe("00000");
    const list = listRes.body.data.list as Array<{ tenantId: string }>;
    expect(Array.isArray(list)).toBe(true);
    for (const row of list) {
      expect(row.tenantId).toBe("1");
    }

    // 越权②：无租户上下文的平台 admin 调宠物接口 → @RequireTenant 拒绝（403 + A0302）
    const forbiddenRes = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/pets`)
        .set("Authorization", `Bearer ${platformToken}`)
        .expect(HttpStatus.FORBIDDEN)
    );
    expect(forbiddenRes.body).toMatchObject({ code: "A0302", data: null });

    const createForbiddenRes = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/pets`)
        .set("Authorization", `Bearer ${platformToken}`)
        .send({ name: "平台越权", ownerCustomerId: customerId, petType: 1 })
        .expect(HttpStatus.FORBIDDEN)
    );
    expect(createForbiddenRes.body).toMatchObject({ code: "A0302", data: null });
  });

  afterAll(async () => {
    // 兜底清理：物理清理本套件创建的宠物 / 标签关联 / 标签 / 客户行
    // （走基础客户端绕过租户扩展——清理脚本语义；库内无脏状态）
    if (app) {
      if (createdPetIds.length > 0) {
        await prisma.petBehaviorTag.deleteMany({ where: { petId: { in: createdPetIds } } });
        await prisma.pet.deleteMany({ where: { id: { in: createdPetIds } } });
      }
      if (tagId) {
        await prisma.behaviorTag.deleteMany({ where: { id: tagId } });
      }
      if (customerId) {
        await prisma.customer.deleteMany({ where: { id: customerId } });
      }
      await app.close();
    }
  });
});
