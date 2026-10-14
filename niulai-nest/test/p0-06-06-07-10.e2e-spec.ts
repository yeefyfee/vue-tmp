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
import { RequestContext } from "../src/common/context/request-context";
import { enableBigIntJsonSerialization } from "../src/common/prisma/bigint-json";
import { QUEUE_REGISTRY } from "../src/queue/queue.module";
import type { QueueRegistry } from "../src/queue/queue-registry";
import { TIMELINE_QUEUE } from "../src/queue/queue-registry";
import { processTimelineWriteJob } from "../src/queue/timeline/timeline.processor";
import { TimelineWriteService } from "../src/pet/timeline-write.service";

/**
 * P0-06-06 统一事件模型 + P0-06-07 异步写入/不可改删/冲正纠错 + P0-06-10 写入 SDK E2E
 * （独立 spec，禁动任何已有 spec）
 *
 * 覆盖：
 *  - 手工补录事件 → 分页查询（eventType / eventName / refType+refId / visibleToOwner 筛选、
 *    eventTime desc、BigInt id 字符串化）；
 *  - 异步写入（recordAsync 入队 → 消费器 processTimelineWriteJob 落库 → 最终可见）；
 *  - 事件详情（命中 + 不存在 A0613）；
 *  - **不可改删**：raw UPDATE / DELETE 被行级触发器拒（P0001）；
 *  - **冲正纠错**：POST /revise 追加冲正事件且**原事件保持不变**；
 *  - 校验：未登记事件名且无 eventType → A0614；
 *  - 越权：平台 admin（无租户上下文）→ 403 + A0302。
 *
 * 口径对齐 p0-06-05-09.e2e-spec.ts：
 *  - 全局前缀 /api/v1；成功信封 { code: "00000", msg, data }；
 *  - 创建/更新/写入类断言一律 200（统一信封，踩坑 32）；
 *  - beforeEach 清限流键 + withRetry429（每 IP 每秒 10 次，踩坑 36）；
 *  - afterAll 兜底清理（timeline 行经 GUC app.timeline_maintenance='on' 受控删除）。
 *  - **串行运行**：node node_modules/.bin/jest --config ./test/jest-e2e.json p0-06-06-07-10 --runInBand
 *
 * 前置：PG / Redis 连通 + 系统域种子已执行（tenant_admin / 123456，tenant_id=1）。
 */

const PREFIX = "/api/v1";

describe("P0-06-06/07/10 宠物时间线（统一事件模型 / 异步写入 / 冲正） (e2e)", () => {
  let app: INestApplication;
  let redis: RedisService;
  let prisma: PrismaService;
  let registry: QueueRegistry;
  let timelineWrite: TimelineWriteService;
  let tenantToken: string;
  let platformToken: string;
  let customerId: string;
  let petId: string;
  const mobileA = `138${Date.now()}`;

  /** 主链路事件 id（字符串） */
  let eventHealthId: string;
  let eventWeightId: string;
  let eventTagsId: string;

  const refHealthId = "11111111-1111-4111-8111-111111111111";
  const refWeightId = "22222222-2222-4222-8222-222222222222";

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

  async function manualEvent(body: Record<string, unknown>): Promise<request.Response> {
    return withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/pets/${petId}/timeline`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send(body)
        .expect(HttpStatus.OK)
    );
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
    registry = app.get(QUEUE_REGISTRY);
    timelineWrite = app.get(TimelineWriteService);

    tenantToken = await loginAndGetToken("tenant_admin", "123456");
    await new Promise((resolve) => setTimeout(resolve, 400));
    platformToken = await loginAndGetToken("admin", "123456");
    await new Promise((resolve) => setTimeout(resolve, 400));

    // 前置：主人客户建档 + 宠物建档（走真实接口）
    const customerRes = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/customers`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ name: "E2E 时间线宠主", mobile: mobileA })
        .expect(HttpStatus.OK)
    );
    expect(customerRes.body.code).toBe("00000");
    customerId = customerRes.body.data.id;

    const petRes = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/pets`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ name: "E2E 时间线旺财", ownerCustomerId: customerId, petType: 1 })
        .expect(HttpStatus.OK)
    );
    expect(petRes.body.code).toBe("00000");
    petId = petRes.body.data.id;
  });

  beforeEach(async () => {
    await resetRateLimiter();
  });

  it("主链A：手工补录事件 → 分页筛选（eventType / refType+refId / visibleToOwner）→ BigInt id 字符串化", async () => {
    // 手工补录 3 条（事件名 `模块.动作`，事件类型/可见性按事件名回落）
    const healthRes = await manualEvent({
      eventName: "health.record.created",
      content: "疫苗建档（时间线 E2E）",
      refType: "health_record",
      refId: refHealthId,
    });
    expect(healthRes.body.code).toBe("00000");
    expect(typeof healthRes.body.data.id).toBe("string");
    eventHealthId = healthRes.body.data.id;
    expect(healthRes.body.data.eventName).toBe("health.record.created");
    expect(healthRes.body.data.eventType).toBe(5); // MEDICAL
    expect(healthRes.body.data.visibleToOwner).toBe(true);
    expect(healthRes.body.data.actorType).toBe(1);
    expect(healthRes.body.data.refType).toBe("health_record");
    expect(healthRes.body.data.refId).toBe(refHealthId);

    const weightRes = await manualEvent({
      eventName: "weight.recorded",
      content: "体重 12.5kg",
      payload: { weightKg: "12.50", weighedAt: "2026-10-07" },
      refType: "weight",
      refId: refWeightId,
    });
    expect(weightRes.body.code).toBe("00000");
    eventWeightId = weightRes.body.data.id;
    expect(weightRes.body.data.eventType).toBe(6); // WEIGHT
    expect(weightRes.body.data.payload).toMatchObject({ weightKg: "12.50" });

    const tagsRes = await manualEvent({
      eventName: "pet.tags.changed",
      content: "行为标签变更",
      refType: "pet",
      refId: petId,
    });
    expect(tagsRes.body.code).toBe("00000");
    eventTagsId = tagsRes.body.data.id;
    expect(tagsRes.body.data.eventType).toBe(8); // SYSTEM
    expect(tagsRes.body.data.visibleToOwner).toBe(false); // pet.tags.changed 默认不可见

    // 筛选：refType + refId 精确定位
    const byRef = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/pets/${petId}/timeline?refType=weight&refId=${refWeightId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(byRef.body.code).toBe("00000");
    const refIds = (byRef.body.data.list as Array<{ id: string }>).map((r) => r.id);
    expect(refIds).toContain(eventWeightId);
    expect(refIds).not.toContain(eventHealthId);

    // 筛选：eventType=6 命中体重事件
    const byType = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/pets/${petId}/timeline?eventType=6`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    const typeIds = (byType.body.data.list as Array<{ id: string }>).map((r) => r.id);
    expect(typeIds).toContain(eventWeightId);

    // 筛选：visibleToOwner=false 命中标签事件，不含可见事件
    const byInvisible = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/pets/${petId}/timeline?visibleToOwner=false`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    const invisibleIds = (byInvisible.body.data.list as Array<{ id: string }>).map((r) => r.id);
    expect(invisibleIds).toContain(eventTagsId);
    expect(invisibleIds).not.toContain(eventHealthId);

    // 信封分页字段
    expect(byRef.body.data).toHaveProperty("total");
    expect(byRef.body.data).toHaveProperty("page");
    expect(byRef.body.data).toHaveProperty("page_size");
  });

  it("主链B：事件详情（命中 + 不存在 A0613）", async () => {
    const detail = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/pets/${petId}/timeline/${eventHealthId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(detail.body.code).toBe("00000");
    expect(detail.body.data.id).toBe(eventHealthId);
    expect(detail.body.data.eventName).toBe("health.record.created");

    const missing = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/pets/${petId}/timeline/999999999`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.NOT_FOUND)
    );
    expect(missing.body).toMatchObject({ code: "A0613", data: null });
  });

  it("主链C：异步写入（recordAsync 入队 → 消费器落库 → 最终可见）", async () => {
    // 入队（租户上下文内）——worker 进程不在本 spec 运行，故手动取任务并消费
    const enqueued = await RequestContext.run(async () => {
      RequestContext.setTenantId("1");
      return timelineWrite.recordAsync({
        tenantId: "1",
        petId,
        eventName: "pet.updated",
        content: "异步写入：宠物资料更新",
        refType: "pet",
        refId: petId,
      });
    });
    expect(enqueued).toMatchObject({ enqueued: true, tenantId: "1" });

    // 从租户队列取出该任务（键空间 = peluvida:queue:tenant:1:pet-timeline）
    const queue = registry.createQueue(TIMELINE_QUEUE, "1");
    const jobs = await queue.getJobs(["waiting", "delayed", "active"]);
    const job = jobs.find(
      (j) =>
        (j.data as { petId?: string; eventName?: string })?.petId === petId &&
        (j.data as { eventName?: string })?.eventName === "pet.updated"
    );
    expect(job).toBeTruthy();

    // 消费（恢复租户上下文 → 统一 SDK 落库）
    const result = await processTimelineWriteJob(job as never, prisma);
    expect(result.tenantId).toBe("1");
    expect(result.eventName).toBe("pet.updated");
    await job!.remove();

    // 最终可见
    const list = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/pets/${petId}/timeline?eventName=pet.updated`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    const ids = (list.body.data.list as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(result.eventId);
  });

  it("主链D：不可改删——raw UPDATE / DELETE 被行级触发器拒（P0001）", async () => {
    let updateError = "";
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE timeline_event SET content = 'HACK' WHERE id = $1`,
        BigInt(eventHealthId)
      );
    } catch (error) {
      updateError = String((error as Error).message);
    }
    expect(updateError).toMatch(/append-only/);

    let deleteError = "";
    try {
      await prisma.$executeRawUnsafe(
        `DELETE FROM timeline_event WHERE id = $1`,
        BigInt(eventHealthId)
      );
    } catch (error) {
      deleteError = String((error as Error).message);
    }
    expect(deleteError).toMatch(/append-only/);

    // 原事件保持未改动
    const detail = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/pets/${petId}/timeline/${eventHealthId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(detail.body.data.content).toBe("疫苗建档（时间线 E2E）");
  });

  it("主链E：冲正纠错——追加冲正事件且原事件保持不变", async () => {
    const before = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/pets/${petId}/timeline/${eventHealthId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );

    const reviseRes = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/pets/${petId}/timeline/${eventHealthId}/revise`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ reason: "录入错误，改为 2026-10-08", changes: { recordDate: "2026-10-08" } })
        .expect(HttpStatus.OK)
    );
    expect(reviseRes.body.code).toBe("00000");
    expect(reviseRes.body.data.eventName).toBe("timeline.event.revised");
    expect(reviseRes.body.data.refType).toBe("timeline_event");
    expect(reviseRes.body.data.refId).toBe(eventHealthId);
    expect(reviseRes.body.data.payload).toMatchObject({
      originalEventId: eventHealthId,
      originalEventName: "health.record.created",
      reason: "录入错误，改为 2026-10-08",
    });
    const revisionId = reviseRes.body.data.id;

    // 原事件保持不变（逐字段比对）
    const after = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/pets/${petId}/timeline/${eventHealthId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    expect(after.body.data).toEqual(before.body.data);

    // 冲正事件可按 refType+refId 关联回原事件
    const byRef = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/pets/${petId}/timeline?refType=timeline_event&refId=${eventHealthId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    const ids = (byRef.body.data.list as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(revisionId);
  });

  it("校验：未登记事件名且未给 eventType → A0614；越权平台账号 → A0302", async () => {
    const bad = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/pets/${petId}/timeline`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ eventName: "nope.unknown" })
        .expect(HttpStatus.BAD_REQUEST)
    );
    expect(bad.body).toMatchObject({ code: "A0614", data: null });

    const forbidden = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/pets/${petId}/timeline`)
        .set("Authorization", `Bearer ${platformToken}`)
        .expect(HttpStatus.FORBIDDEN)
    );
    expect(forbidden.body).toMatchObject({ code: "A0302", data: null });
  });

  afterAll(async () => {
    if (app) {
      // timeline_event 不可改删 → 经 GUC 受控维护通道清理本套件创建的事件行
      if (petId) {
        try {
          await prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(`SELECT set_config('app.timeline_maintenance', 'on', true)`);
            await tx.$executeRawUnsafe(`DELETE FROM timeline_event WHERE pet_id = $1`, petId);
          });
        } catch {
          // 清理尽力而为
        }
        await prisma.petBehaviorTag.deleteMany({ where: { petId } });
        await prisma.pet.deleteMany({ where: { id: petId } });
      }
      if (customerId) {
        await prisma.customer.deleteMany({ where: { id: customerId } });
      }
      await app.close();
    }
  });
});
