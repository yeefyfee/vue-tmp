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
 * P0-08 媒体段 E2E（统一上传 / 图片处理 / 可见性；独立 spec，禁动任何已有 spec）
 *
 * 覆盖：
 *  - 主链A 预签名上传（local 驱动 → uploadMode=direct）→ 确认（pending→confirmed）→ 重复确认 A0713；
 *  - 主链B 服务端直传（multipart 图片）→ mediaType=1 / 尺寸探测 / 缩略图降级（passthrough）；
 *  - 主链C 单实体最多 9 张（9 张成功，第 10 张 A0712）；
 *  - 主链D 可见性：PUT 更新 visibleToOwner → 列表按 visibleToOwner 过滤命中；
 *  - 主链E 上传回调（按 objectKey 确认）；
 *  - 校验与越权：不存在媒体 A0711 / 关联宠物不存在 A0601 / 平台账号（无租户）A0302。
 *
 * 口径对齐 p0-06-06-07-10.e2e-spec.ts：
 *  - 全局前缀 /api/v1；成功信封 { code: "00000", msg, data }；创建/写入类断言 200；
 *  - beforeEach 清限流键 + withRetry429（每 IP 每秒 10 次）；
 *  - afterAll 兜底清理（media 行 + 时间线行经 GUC 受控删除）。
 *  - **串行运行**：node ./node_modules/jest/bin/jest.js --config ./test/jest-e2e.json --runInBand test/p0-08-media.e2e-spec.ts
 *
 * 前置：PG / Redis 连通 + 系统域种子已执行（tenant_admin / 123456，tenant_id=1）；
 *      媒体存储驱动缺省 local（MEDIA_STORAGE_DRIVER 未设置）。
 */

const PREFIX = "/api/v1";

/** 构造一张含 IHDR 的合法 PNG 头（宽高已知，便于断言尺寸探测） */
function makePng(width: number, height: number): Buffer {
  const b = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  Buffer.from([0x00, 0x00, 0x00, 0x0d]).copy(b, 8);
  Buffer.from("IHDR", "ascii").copy(b, 12);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

describe("P0-08 媒体段（统一上传 / 图片处理 / 可见性） (e2e)", () => {
  let app: INestApplication;
  let redis: RedisService;
  let prisma: PrismaService;
  let tenantToken: string;
  let platformToken: string;
  let customerId: string;
  let petId: string;
  let pet2Id: string;
  const mobileA = `139${Date.now()}`;

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

  async function createPet(name: string): Promise<string> {
    const res = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/pets`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ name, ownerCustomerId: customerId, petType: 1 })
        .expect(HttpStatus.OK)
    );
    expect(res.body.code).toBe("00000");
    return res.body.data.id as string;
  }

  /** 服务端直传一张图片 */
  async function uploadImage(refId: string, width = 64, height = 64) {
    return withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/media/upload`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .field("refType", "pet")
        .field("refId", refId)
        .attach("file", makePng(width, height), { filename: "photo.png", contentType: "image/png" })
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

    tenantToken = await loginAndGetToken("tenant_admin", "123456");
    await new Promise((resolve) => setTimeout(resolve, 400));
    platformToken = await loginAndGetToken("admin", "123456");
    await new Promise((resolve) => setTimeout(resolve, 400));

    const customerRes = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/customers`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ name: "E2E 媒体宠主", mobile: mobileA })
        .expect(HttpStatus.OK)
    );
    expect(customerRes.body.code).toBe("00000");
    customerId = customerRes.body.data.id;
    petId = await createPet("E2E 媒体旺财");
  });

  beforeEach(async () => {
    await resetRateLimiter();
  });

  it("主链A：预签名（direct 模式）→ 确认（pending→confirmed）→ 重复确认 A0713", async () => {
    const presigned = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/media/presign`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ refType: "pet", refId: petId, mimeType: "image/png", fileName: "a.png" })
        .expect(HttpStatus.OK)
    );
    expect(presigned.body.code).toBe("00000");
    const mediaId: string = presigned.body.data.mediaId;
    expect(presigned.body.data.uploadMode).toBe("direct");
    expect(presigned.body.data.uploadUrl).toBeNull();
    expect(presigned.body.data.driver).toBe("local");
    expect(presigned.body.data.mediaType).toBe(1);
    expect(presigned.body.data.objectKey).toContain(`media/pet/1/${petId}/`);
    expect(presigned.body.data.maxPerEntity).toBe(9);

    const confirmed = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/media/${mediaId}/confirm`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ fileSize: 1234 })
        .expect(HttpStatus.OK)
    );
    expect(confirmed.body.code).toBe("00000");
    expect(confirmed.body.data.uploadStatus).toBe(2);
    expect(confirmed.body.data.confirmedAt).toBeTruthy();

    // 重复确认 → A0713
    const again = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/media/${mediaId}/confirm`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({})
        .expect(HttpStatus.CONFLICT)
    );
    expect(again.body).toMatchObject({ code: "A0713", data: null });
  });

  it("主链B：服务端直传（图片）→ mediaType=1 / 尺寸探测 / 缩略图降级", async () => {
    const res = await uploadImage(petId, 64, 48);
    expect(res.body.code).toBe("00000");
    const d = res.body.data;
    expect(d.mediaType).toBe(1);
    expect(d.uploadStatus).toBe(2);
    expect(d.mimeType).toBe("image/png");
    expect(d.width).toBe(64);
    expect(d.height).toBe(48);
    expect(typeof d.fileSize).toBe("string");
    // 无原生图像库 → 透传降级：不产出缩略图 / 不施加水印
    expect(d.thumbnailUrl).toBeNull();
    expect(d.watermarked).toBe(false);
    expect(typeof d.url).toBe("string");
    expect(d.storageDriver).toBe("local");
  });

  it("主链C：单实体最多 9 张（9 张成功，第 10 张 A0712）", async () => {
    pet2Id = await createPet("E2E 媒体旺财2");
    for (let i = 0; i < 9; i += 1) {
      const res = await uploadImage(pet2Id, 20, 20);
      expect(res.body.code).toBe("00000");
    }
    const overflow = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/media/upload`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .field("refType", "pet")
        .field("refId", pet2Id)
        .attach("file", makePng(20, 20), { filename: "x.png", contentType: "image/png" })
        .expect(HttpStatus.BAD_REQUEST)
    );
    expect(overflow.body).toMatchObject({ code: "A0712", data: null });
  });

  it("主链D：可见性——PUT 更新 visibleToOwner → 列表过滤命中", async () => {
    const up = await uploadImage(petId, 30, 30);
    const mediaId = up.body.data.id;
    const version = up.body.data.version;
    expect(up.body.data.visibleToOwner).toBe(true);

    const updated = await withRetry429(() =>
      request(app.getHttpServer())
        .put(`${PREFIX}/media/${mediaId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ visibleToOwner: false, version })
        .expect(HttpStatus.OK)
    );
    expect(updated.body.code).toBe("00000");
    expect(updated.body.data.visibleToOwner).toBe(false);

    const invisible = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/media?refType=pet&refId=${petId}&visibleToOwner=false`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    const invisibleIds = (invisible.body.data.list as Array<{ id: string }>).map((r) => r.id);
    expect(invisibleIds).toContain(mediaId);
    expect(invisible.body.data).toHaveProperty("total");
    expect(invisible.body.data).toHaveProperty("page");
    expect(invisible.body.data).toHaveProperty("page_size");

    const visible = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/media?refType=pet&refId=${petId}&visibleToOwner=true`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK)
    );
    const visibleIds = (visible.body.data.list as Array<{ id: string }>).map((r) => r.id);
    expect(visibleIds).not.toContain(mediaId);
  });

  it("主链E：上传回调（按 objectKey 确认 pending 记录）", async () => {
    const presigned = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/media/presign`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ refType: "pet", refId: petId, mimeType: "image/png" })
        .expect(HttpStatus.OK)
    );
    const objectKey = presigned.body.data.objectKey;

    const cb = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/media/callback`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ objectKey, size: 999, mimeType: "image/png" })
        .expect(HttpStatus.OK)
    );
    expect(cb.body.code).toBe("00000");
    expect(cb.body.data.uploadStatus).toBe(2);
    expect(cb.body.data.fileSize).toBe("999");
  });

  it("校验与越权：不存在媒体 A0711 / 关联宠物不存在 A0601 / 平台账号 A0302", async () => {
    const notFound = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/media/00000000-0000-4000-8000-000000000000`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.NOT_FOUND)
    );
    expect(notFound.body).toMatchObject({ code: "A0711", data: null });

    const badRef = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/media/presign`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({
          refType: "pet",
          refId: "00000000-0000-4000-8000-000000000000",
          mimeType: "image/png",
        })
        .expect(HttpStatus.NOT_FOUND)
    );
    expect(badRef.body).toMatchObject({ code: "A0601", data: null });

    const forbidden = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/media`)
        .set("Authorization", `Bearer ${platformToken}`)
        .expect(HttpStatus.FORBIDDEN)
    );
    expect(forbidden.body).toMatchObject({ code: "A0302", data: null });
  });

  afterAll(async () => {
    if (app) {
      const petIds = [petId, pet2Id].filter(Boolean);
      if (petIds.length > 0) {
        await prisma.media.deleteMany({ where: { refId: { in: petIds } } });
        // 时间线不可改删 → 经 GUC 受控维护通道清理本套件写入的 photo.uploaded 事件
        try {
          await prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(`SELECT set_config('app.timeline_maintenance', 'on', true)`);
            await tx.$executeRawUnsafe(
              `DELETE FROM timeline_event WHERE pet_id = ANY($1::uuid[])`,
              petIds
            );
          });
        } catch {
          // 清理尽力而为
        }
        await prisma.petBehaviorTag.deleteMany({ where: { petId: { in: petIds } } });
        await prisma.pet.deleteMany({ where: { id: { in: petIds } } });
      }
      if (customerId) {
        await prisma.customer.deleteMany({ where: { id: customerId } });
      }
      await app.close();
    }
  });
});
