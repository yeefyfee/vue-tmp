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
 * PeluVida OS E2E 骨架（CROSS-18）
 *
 * 范围：认证主流程（验证码 → 登录 → 受保护接口 → 刷新令牌）+ 4 条异常路径
 * （错误密码 / 无令牌 / 伪造令牌 / 错误验证码）。
 * 「核心业务闭环真实环境连续跑通 3 次含中断恢复」依赖业务域（服务/预约/订单）落地，
 * 届时以同框架追加闭环用例——本文件只保证框架与口径基线。
 *
 * 前置（真实环境）：
 *  1. PG（peluvida_dev）与 Redis 连通；
 *  2. 系统域种子已执行：`cd niulai-nest && pnpm db:seed`（CROSS-19，演示账号 admin/123456）。
 *
 * 运行：`cd niulai-nest && pnpm test:e2e`（jest --config ./test/jest-e2e.json）
 *
 * 口径对齐 main.ts / HttpExceptionFilter / LoginRequestDto：
 *  - 全局前缀 /api/v1；成功信封 { code: "00000", msg, data }（ResponseInterceptor）；
 *  - enableBigIntJsonSerialization 必须在任何响应序列化前调用；
 *  - 登录需图形验证码（captchaId + captchaCode 必填）；E2E 经应用容器内的
 *    RedisService 读取验证码文本（受控测试后门，key 规则与写侧同源）；
 *  - POST 无 @HttpCode → Nest 默认 201（登录/刷新）；
 *  - 刷新令牌走 query 参数（@Query("refreshToken")）；
 *  - 业务异常（BusinessException）保留 httpStatus（400/401）+ 信封 { code, msg, data: null }；
 *  - **参数校验错误经 filter 统一转 200 + A0400**（存量前端口径，勿改用例期望）。
 */

const PREFIX = "/api/v1";
const DEMO_USER = { username: "admin", password: "123456" };

describe("PeluVida OS · 认证主流程与异常路径 (e2e)", () => {
  let app: INestApplication;
  let redis: RedisService;

  /** 走真实 /auth/captcha 流程取得有效 captchaId，并从 Redis 读取其明文（受控后门） */
  async function obtainCaptcha(): Promise<{ captchaId: string; captchaCode: string }> {
    const res = await request(app.getHttpServer()).get(`${PREFIX}/auth/captcha`).expect(200);
    const captchaId: string = res.body.data.captchaId;
    const captchaCode = await redis.get<string>(`captcha:image:${captchaId}`);
    expect(captchaCode).toBeTruthy();
    return { captchaId, captchaCode: captchaCode as string };
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
  });

  beforeEach(async () => {
    // RateLimitMiddleware：每 IP 每秒 10 次。E2E 同一 IP 集中发请求，
    // 用例间错开窗口避免登录/验证码请求被 429 截胡（真实多客户端不会如此集中）。
    await new Promise((resolve) => setTimeout(resolve, 250));
  });

  afterAll(async () => {
    // 清理登录防爆破测试副作用（P0-02-07）：错密码用例会累计 auth:login:fail:admin，
    // 连续 5 轮 E2E 会把 admin 锁定 15 分钟并使后续轮次全挂——用例结束必须清零。
    if (redis) {
      await redis.delMultiple(["auth:login:fail:admin", "auth:login:lock:admin"]);
      // 清理 P0-03-02 用例副作用：黑名单为**全局键**（无租户前缀），TTL = token 剩余有效期；
      // 同时清扫历史遗留的带前缀黑名单键（旧缺陷版写出的键会污染命名空间断言）
      const client = redis.getClient();
      const blacklistKeys = [
        ...(await client.keys("auth:token:blacklist:*")),
        ...(await client.keys("tenant:*:auth:token:blacklist:*")),
      ];
      if (blacklistKeys.length > 0) await client.del(...blacklistKeys);
    }
    if (app) await app.close();
  });

  it("主流程：验证码 → 种子账号登录 → 受保护接口 → 刷新令牌", async () => {
    // 1) 取验证码并登录（种子账号，见 packages/db/prisma/seed.ts）
    const { captchaId, captchaCode } = await obtainCaptcha();
    const loginRes = await request(app.getHttpServer())
      .post(`${PREFIX}/auth/login`)
      .send({ ...DEMO_USER, captchaCode, captchaId })
      .expect(HttpStatus.CREATED);

    expect(loginRes.body).toMatchObject({ code: "00000" });
    const { accessToken, refreshToken, tokenType } = loginRes.body.data;
    expect(tokenType).toBe("Bearer");
    expect(typeof accessToken).toBe("string");
    expect(accessToken.length).toBeGreaterThan(0);
    expect(typeof refreshToken).toBe("string");

    // 2) 受保护接口：当前登录用户（无令牌/伪造令牌不可达，见异常用例）
    const meRes = await request(app.getHttpServer())
      .get(`${PREFIX}/users/me`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(HttpStatus.OK);

    expect(meRes.body).toMatchObject({ code: "00000" });
    expect(meRes.body.data.username).toBe("admin");

    // 3) 刷新令牌（旋转：新 refresh + 旧 refresh 入黑名单；query 参数传递）
    const refreshRes = await request(app.getHttpServer())
      .post(`${PREFIX}/auth/refresh-token`)
      .query({ refreshToken })
      .expect(HttpStatus.CREATED);

    expect(refreshRes.body).toMatchObject({ code: "00000" });
    expect(typeof refreshRes.body.data.accessToken).toBe("string");
    // 旋转生效：返回全新 refresh，而非入参原值（P0-02-02 验收）
    expect(refreshRes.body.data.refreshToken).toBeTruthy();
    expect(refreshRes.body.data.refreshToken).not.toBe(refreshToken);

    // 4) 重放防护：旋转后的旧 refresh 重放 → 401 + A0231（且触发全会话吊销）
    await new Promise((resolve) => setTimeout(resolve, 250));
    const replayRes = await request(app.getHttpServer())
      .post(`${PREFIX}/auth/refresh-token`)
      .query({ refreshToken })
      .expect(HttpStatus.UNAUTHORIZED);

    expect(replayRes.body).toMatchObject({ code: "A0231", data: null });
  });

  it("异常路径 ①：有效验证码 + 错误密码 → 400 + A0210 信封", async () => {
    const { captchaId, captchaCode } = await obtainCaptcha();
    const res = await request(app.getHttpServer())
      .post(`${PREFIX}/auth/login`)
      .send({ username: DEMO_USER.username, password: "wrong-password", captchaCode, captchaId })
      .expect(HttpStatus.BAD_REQUEST);

    expect(res.body).toMatchObject({ code: "A0210", data: null });
    expect(res.body.msg).toBeTruthy();
  });

  it("健康检查：GET /api/v1/health → 200 裸 JSON（P0-01-03，不包统一信封）", async () => {
    const res = await request(app.getHttpServer()).get(`${PREFIX}/health`).expect(HttpStatus.OK);

    expect(res.body).toMatchObject({ status: "ok", checks: { db: true, redis: true } });
  });

  it("异常路径 ②：无令牌访问受保护接口 → 401 + A0230 信封", async () => {
    const res = await request(app.getHttpServer())
      .get(`${PREFIX}/users/me`)
      .expect(HttpStatus.UNAUTHORIZED);

    expect(res.body).toMatchObject({ code: "A0230", data: null });
  });

  it("异常路径 ③：伪造令牌访问受保护接口 → 401 + A0230 信封", async () => {
    const res = await request(app.getHttpServer())
      .get(`${PREFIX}/users/me`)
      .set("Authorization", "Bearer not-a-real-jwt-token")
      .expect(HttpStatus.UNAUTHORIZED);

    expect(res.body).toMatchObject({ code: "A0230", data: null });
  });

  it("异常路径 ④：错误验证码登录 → 400 + A0240 信封", async () => {
    const { captchaId } = await obtainCaptcha();
    const res = await request(app.getHttpServer())
      .post(`${PREFIX}/auth/login`)
      .send({
        username: DEMO_USER.username,
        password: DEMO_USER.password,
        captchaCode: "0000",
        captchaId,
      })
      .expect(HttpStatus.BAD_REQUEST);

    expect(res.body).toMatchObject({ code: "A0240", data: null });
  });

  it("P0-03-02：租户上下文仅由令牌解析——参数伪造 tenant_id=999 被忽略（黑名单键落在 tenant:1: 命名空间）", async () => {
    // 1) 演示租户账号登录（seed：tenant_admin / 123456，sys_user.tenant_id = 1）
    const { captchaId, captchaCode } = await obtainCaptcha();
    const loginRes = await request(app.getHttpServer())
      .post(`${PREFIX}/auth/login`)
      .send({ username: "tenant_admin", password: "123456", captchaCode, captchaId })
      .expect(HttpStatus.CREATED);
    expect(loginRes.body.code).toBe("00000");
    const accessToken: string = loginRes.body.data.accessToken;
    expect(accessToken).toBeTruthy();

    // 2) 三路伪造 tenant_id=999（query / body / header）调注销：
    //    租户上下文只来自 JWT payload（DataScopeGuard → ALS），伪造值不影响任何服务端行为
    await request(app.getHttpServer())
      .delete(`${PREFIX}/auth/logout?tenant_id=999`)
      .set("Authorization", `Bearer ${accessToken}`)
      .set("X-Tenant-Id", "999")
      .send({ tenant_id: "999" })
      .expect(200);

    // 3) 键命名空间断言：黑名单为**全局键**（jti 全局唯一；校验发生在租户上下文装配前，
    //    见 RedisService.setGlobal）→ 不落任何租户前缀命名空间；请求参数伪造的 tenant:999: 更不应存在
    const client = redis.getClient();
    const globalKeys = await client.keys("auth:token:blacklist:*");
    expect(globalKeys.length).toBeGreaterThanOrEqual(1);
    const prefixedKeys = await client.keys("tenant:*:auth:token:blacklist:*");
    expect(prefixedKeys).toEqual([]);
    const tenant999Keys = await client.keys("tenant:999:*");
    expect(tenant999Keys).toEqual([]);

    // 4) 安全闭环（缺陷回归 #7）：登出后旧 access token 必须**立即失效**
    //    （黑名单命中 → 401 + A0230）。修复前该断言会拿到 200（黑名单读写键错位）。
    const afterLogout = await request(app.getHttpServer())
      .get(`${PREFIX}/users/me`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(afterLogout.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(afterLogout.body.code).toBe("A0230");
  });

  /**
   * P0-04-02 门店档案 API（FR-1 · 业务域首个模块）
   *
   * 覆盖两类断言：
   *  1. 主链路：创建 → 详情 → 列表筛选 → 更新（version 乐观锁，旧版本重放报 A0423）
   *     → 软删 → 详情 404（A0424）；
   *  2. 越权（P0-03-03 HTTP 层补口）：
   *     ① 创建时 query/body 伪造 tenant_id=999 → 创建成功但回读归属租户 1（参数被忽略）；
   *     ② 无租户上下文的平台 admin 调门店接口 → @RequireTenant 拒绝（403 + A0302）；
   *     ③ 带 ?tenant_id=999 的列表查询返回的行全部属于租户 1（扩展层注入租户条件）。
   */
  describe("P0-04-02 门店档案 API (e2e)", () => {
    let tenantToken: string; // 租户管理员（tenant_admin，tenant_id=1）
    let platformToken: string; // 平台级账号（admin，无租户归属）
    let storeId: string;
    const storeCode = `e2e-store-${Date.now()}`;
    /** 兜底清理集合：本 describe 内创建的门店 id，afterAll 统一软删 */
    const createdStoreIds: string[] = [];

    async function loginAndGetToken(username: string, password: string): Promise<string> {
      const { captchaId, captchaCode } = await obtainCaptcha();
      const res = await request(app.getHttpServer())
        .post(`${PREFIX}/auth/login`)
        .send({ username, password, captchaCode, captchaId })
        .expect(HttpStatus.CREATED);
      expect(res.body.code).toBe("00000");
      return res.body.data.accessToken as string;
    }

    beforeAll(async () => {
      tenantToken = await loginAndGetToken("tenant_admin", "123456");
      await new Promise((resolve) => setTimeout(resolve, 300));
      platformToken = await loginAndGetToken("admin", "123456");
    });

    it("主链路A：创建（query/body 伪造 tenant_id=999 被忽略）→ 详情归属租户 1", async () => {
      const createRes = await request(app.getHttpServer())
        .post(`${PREFIX}/stores?tenant_id=999`) // 越权①：query 伪造
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({
          code: storeCode,
          name: "E2E 测试门店",
          type: 1,
          province: "广东省",
          city: "深圳市",
          district: "南山区",
          address: "科技园路 1 号",
          longitude: 113.943,
          latitude: 22.54,
          phone: "0755-1234567",
          businessHours: { mon: [["09:00", "18:00"]], tue: [] },
          status: 1,
          tenant_id: "999", // 越权①：body 伪造（DTO 白名单应剥离）
        })
        .expect(HttpStatus.OK); // 全局 ResponseInterceptor 统一 200 信封（与系统域创建类接口口径一致）
      expect(createRes.body.code).toBe("00000");
      storeId = createRes.body.data.id;
      createdStoreIds.push(storeId);

      // 回读：租户归属恒为令牌租户 1（BigInt 垫片序列化为字符串），伪造的 999 不生效
      const detailRes = await request(app.getHttpServer())
        .get(`${PREFIX}/stores/${storeId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK);
      expect(detailRes.body.code).toBe("00000");
      expect(detailRes.body.data.tenantId).toBe("1");
      expect(detailRes.body.data.code).toBe(storeCode);
      expect(detailRes.body.data.version).toBe(0);
    });

    it("主链路B：列表筛选命中 → 更新(version 0→1) → 旧版本重放 A0423 → 软删 → 详情 A0424", async () => {
      // 列表：code 前缀筛到本用例门店
      const listRes = await request(app.getHttpServer())
        .get(`${PREFIX}/stores?code=${storeCode}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK);
      expect(listRes.body.code).toBe("00000");
      expect(listRes.body.data.total).toBeGreaterThanOrEqual(1);
      expect(listRes.body.data.list.some((row: { id: string }) => row.id === storeId)).toBe(true);

      // 更新：version 乐观锁命中，version 自增
      const updateRes = await request(app.getHttpServer())
        .put(`${PREFIX}/stores/${storeId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ name: "E2E 测试门店（已改名）", version: 0 })
        .expect(HttpStatus.OK);
      expect(updateRes.body.data.version).toBe(1);

      // 旧版本重放 → 409 + A0423（并发覆盖被乐观锁拦截）
      const conflictRes = await request(app.getHttpServer())
        .put(`${PREFIX}/stores/${storeId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ name: "并发覆盖尝试", version: 0 })
        .expect(HttpStatus.CONFLICT);
      expect(conflictRes.body).toMatchObject({ code: "A0423", data: null });

      // 软删
      const deleteRes = await request(app.getHttpServer())
        .delete(`${PREFIX}/stores/${storeId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK);
      expect(deleteRes.body.code).toBe("00000");

      // 软删后详情不可见 → 404 + A0424
      const missingRes = await request(app.getHttpServer())
        .get(`${PREFIX}/stores/${storeId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.NOT_FOUND);
      expect(missingRes.body).toMatchObject({ code: "A0424", data: null });
    });

    it("越权②：无租户上下文的平台 admin 调门店接口 → @RequireTenant 拒绝（403 + A0302）", async () => {
      const res = await request(app.getHttpServer())
        .get(`${PREFIX}/stores`)
        .set("Authorization", `Bearer ${platformToken}`)
        .expect(HttpStatus.FORBIDDEN);
      expect(res.body).toMatchObject({ code: "A0302", data: null });
    });

    it("越权③：带 ?tenant_id=999 的列表查询返回的行全部属于租户 1", async () => {
      const res = await request(app.getHttpServer())
        .get(`${PREFIX}/stores?tenant_id=999`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK);
      expect(res.body.code).toBe("00000");
      const list = res.body.data.list as Array<{ tenantId: string }>;
      expect(Array.isArray(list)).toBe(true);
      for (const row of list) {
        expect(row.tenantId).toBe("1");
      }
    });

    afterAll(async () => {
      // 兜底清理：统一软删本 describe 创建的门店（主链路已软删，此处覆盖异常中断残留；
      // 走基础客户端绕过租户扩展——清理脚本语义，仅命中本用例创建的 id 集合）
      if (app && createdStoreIds.length > 0) {
        const prisma = app.get(PrismaService);
        await prisma.store.updateMany({
          where: { id: { in: createdStoreIds }, deletedAt: null },
          data: { deletedAt: new Date() },
        });
      }
    });
  });

  /**
   * P0-04-03 房间资源 API（FR-2 · room CRUD + 房态查询）
   *
   * 覆盖：
   *  1. 主链路：创建（伪造 tenant_id 被忽略）→ roomNo 同门店重复 409（A0431）
   *     → 列表筛选 → 更新（version 乐观锁，旧版本重放报 A0432）→ 维护切换
   *     （4 放行 / 2 拒绝 A0433）→ 软删 → 详情 404（A0430）；
   *  2. 房态看板数据源：GET /rooms/availability 按 status 分组统计 + 房间清单，
   *     无效门店 404（A0435）；
   *  3. 越权：带 ?tenant_id=999 列表 → 行全部属于租户 1；平台 admin → 403 + A0302。
   *
   * 前置：本 describe 自建挂靠门店（afterAll 一并软删），不依赖 seed 门店。
   */
  describe("P0-04-03 房间资源 API (e2e)", () => {
    let tenantToken: string; // 租户管理员（tenant_admin，tenant_id=1）
    let platformToken: string; // 平台级账号（admin，无租户归属）
    let storeId: string;
    const storeCode = `e2e-room-store-${Date.now()}`;
    const roomNoA = `R${Date.now()}`; // 14 字符（DTO @Length(1,16) 上限，前缀过长会被校验拒绝 A0400）
    const roomNoB = `${roomNoA}b`; // 15 字符
    let roomAId: string;
    let roomBId: string;
    /** 兜底清理集合：本 describe 内创建的房间 id，afterAll 统一软删 */
    const createdRoomIds: string[] = [];

    async function loginAndGetToken(username: string, password: string): Promise<string> {
      const { captchaId, captchaCode } = await obtainCaptcha();
      const res = await request(app.getHttpServer())
        .post(`${PREFIX}/auth/login`)
        .send({ username, password, captchaCode, captchaId })
        .expect(HttpStatus.CREATED);
      expect(res.body.code).toBe("00000");
      return res.body.data.accessToken as string;
    }

    beforeAll(async () => {
      tenantToken = await loginAndGetToken("tenant_admin", "123456");
      await new Promise((resolve) => setTimeout(resolve, 300));
      platformToken = await loginAndGetToken("admin", "123456");
      await new Promise((resolve) => setTimeout(resolve, 300));

      // 自建挂靠门店（房间必属门店；afterAll 一并清理）
      const createRes = await request(app.getHttpServer())
        .post(`${PREFIX}/stores`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({
          code: storeCode,
          name: "E2E 房间测试门店",
          type: 1,
          province: "广东省",
          city: "深圳市",
          district: "南山区",
          address: "科技园路 2 号",
          phone: "0755-1234568",
          status: 1,
        })
        .expect(HttpStatus.OK);
      expect(createRes.body.code).toBe("00000");
      storeId = createRes.body.data.id as string;
      expect(storeId).toBeTruthy();
    });

    it("主链路A：创建（query/body 伪造 tenant_id=999 被忽略）+ roomNo 重复 409 + 详情归属租户 1", async () => {
      const createRes = await request(app.getHttpServer())
        .post(`${PREFIX}/rooms?tenant_id=999`) // 越权：query 伪造
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({
          storeId,
          roomNo: roomNoA,
          name: "E2E 测试房 A",
          roomType: 2,
          capacity: 1,
          tenant_id: "999", // 越权：body 伪造（DTO 白名单应剥离）
        })
        .expect(HttpStatus.OK); // 全局 ResponseInterceptor 统一 200 信封
      expect(createRes.body.code).toBe("00000");
      roomAId = createRes.body.data.id;
      createdRoomIds.push(roomAId);
      expect(createRes.body.data.roomNo).toBe(roomNoA);
      expect(createRes.body.data.status).toBe(1); // 创建即空闲（运行时房态默认值）
      expect(createRes.body.data.version).toBe(0);

      // roomNo 同门店内重复 → 409 + A0431
      const dupRes = await request(app.getHttpServer())
        .post(`${PREFIX}/rooms`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ storeId, roomNo: roomNoA, roomType: 1, capacity: 1 })
        .expect(HttpStatus.CONFLICT);
      expect(dupRes.body).toMatchObject({ code: "A0431", data: null });

      // 第二间房（availability / 看板清单用）
      const createBRes = await request(app.getHttpServer())
        .post(`${PREFIX}/rooms`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ storeId, roomNo: roomNoB, name: "E2E 测试房 B", roomType: 3, capacity: 2 })
        .expect(HttpStatus.OK);
      expect(createBRes.body.code).toBe("00000");
      roomBId = createBRes.body.data.id;
      createdRoomIds.push(roomBId);

      // 回读详情：租户归属恒为令牌租户 1（BigInt 垫片序列化为字符串），伪造的 999 不生效
      const detailRes = await request(app.getHttpServer())
        .get(`${PREFIX}/rooms/${roomAId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK);
      expect(detailRes.body.code).toBe("00000");
      expect(detailRes.body.data.tenantId).toBe("1");
      expect(detailRes.body.data.roomNo).toBe(roomNoA);
      expect(detailRes.body.data.status).toBe(1);
    });

    it("主链路B：列表筛选 → 更新(version 0→1) → 旧版本重放 A0432 → 维护切换 4 放行 / 2 拒绝 A0433", async () => {
      // 列表：storeId + roomNo 前缀筛到本用例两间房
      const listRes = await request(app.getHttpServer())
        .get(`${PREFIX}/rooms?storeId=${storeId}&roomNo=${roomNoA}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK);
      expect(listRes.body.code).toBe("00000");
      const listIds = (listRes.body.data.list as Array<{ id: string }>).map((row) => row.id);
      expect(listIds).toContain(roomAId);
      expect(listIds).toContain(roomBId);

      // 更新：version 乐观锁命中，version 自增
      const updateRes = await request(app.getHttpServer())
        .put(`${PREFIX}/rooms/${roomAId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ name: "E2E 测试房 A（已改名）", capacity: 3, version: 0 })
        .expect(HttpStatus.OK);
      expect(updateRes.body.data.version).toBe(1);

      // 旧版本重放 → 409 + A0432（并发覆盖被乐观锁拦截）
      const conflictRes = await request(app.getHttpServer())
        .put(`${PREFIX}/rooms/${roomAId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ name: "并发覆盖尝试", version: 0 })
        .expect(HttpStatus.CONFLICT);
      expect(conflictRes.body).toMatchObject({ code: "A0432", data: null });

      // 维护切换：目标 4（维护中）放行
      const switchRes = await request(app.getHttpServer())
        .patch(`${PREFIX}/rooms/${roomAId}/status`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ status: 4 })
        .expect(HttpStatus.OK);
      expect(switchRes.body.code).toBe("00000");

      // 维护切换：目标 2（在住，stay 状态机职责）拒绝 → 400 + A0433
      const invalidRes = await request(app.getHttpServer())
        .patch(`${PREFIX}/rooms/${roomAId}/status`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ status: 2 })
        .expect(HttpStatus.BAD_REQUEST);
      expect(invalidRes.body).toMatchObject({ code: "A0433", data: null });
    });

    it("主链路C：availability 分组统计 + 房间清单 → 软删 → 软删后详情 A0430、看板不再可见", async () => {
      // 看板数据源：A 已置维护（4），B 空闲（1）
      const boardRes = await request(app.getHttpServer())
        .get(`${PREFIX}/rooms/availability?storeId=${storeId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK);
      expect(boardRes.body.code).toBe("00000");
      expect(boardRes.body.data.storeId).toBe(storeId);
      const summary = boardRes.body.data.summary as Array<{ status: number; count: number }>;
      expect(summary.map((s) => s.status)).toEqual([1, 2, 3, 4]); // 1~4 全量补零
      expect(summary.find((s) => s.status === 4).count).toBeGreaterThanOrEqual(1);
      expect(summary.find((s) => s.status === 1).count).toBeGreaterThanOrEqual(1);
      const boardRooms = boardRes.body.data.rooms as Array<{
        id: string;
        roomNo: string;
        status: number;
      }>;
      const roomAInBoard = boardRooms.find((row) => row.id === roomAId);
      expect(roomAInBoard).toMatchObject({ roomNo: roomNoA, status: 4 });

      // 软删 A
      const deleteRes = await request(app.getHttpServer())
        .delete(`${PREFIX}/rooms/${roomAId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK);
      expect(deleteRes.body.code).toBe("00000");

      // 看板不再包含软删房间
      const boardAfterRes = await request(app.getHttpServer())
        .get(`${PREFIX}/rooms/availability?storeId=${storeId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK);
      const roomsAfter = boardAfterRes.body.data.rooms as Array<{ id: string }>;
      expect(roomsAfter.some((row) => row.id === roomAId)).toBe(false);

      // 软删后详情不可见 → 404 + A0430
      const missingRes = await request(app.getHttpServer())
        .get(`${PREFIX}/rooms/${roomAId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.NOT_FOUND);
      expect(missingRes.body).toMatchObject({ code: "A0430", data: null });
    });

    it("越权：?tenant_id=999 列表行全部租户 1 + 平台 admin 403 + 无效门店看板 404（A0435）", async () => {
      // 错峰：上一用例（主链路C）7 连发后固定限流窗口可能仍未滚动，先留出窗口
      await new Promise((resolve) => setTimeout(resolve, 400));

      // 越权③：带 ?tenant_id=999 的列表查询返回的行全部属于租户 1
      const listRes = await request(app.getHttpServer())
        .get(`${PREFIX}/rooms?tenant_id=999&storeId=${storeId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK);
      expect(listRes.body.code).toBe("00000");
      const list = listRes.body.data.list as Array<{ tenantId: string }>;
      expect(Array.isArray(list)).toBe(true);
      for (const row of list) {
        expect(row.tenantId).toBe("1");
      }

      // 越权②：无租户上下文的平台 admin 调房间接口 → @RequireTenant 拒绝（403 + A0302）
      const forbiddenRes = await request(app.getHttpServer())
        .get(`${PREFIX}/rooms`)
        .set("Authorization", `Bearer ${platformToken}`)
        .expect(HttpStatus.FORBIDDEN);
      expect(forbiddenRes.body).toMatchObject({ code: "A0302", data: null });

      // 看板：storeId 不属于本租户（不存在的 uuid）→ 404 + A0435
      const notFoundRes = await request(app.getHttpServer())
        .get(`${PREFIX}/rooms/availability?storeId=00000000-0000-4000-8000-000000000000`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.NOT_FOUND);
      expect(notFoundRes.body).toMatchObject({ code: "A0435", data: null });
    });

    afterAll(async () => {
      // 兜底清理：统一软删本 describe 创建的房间与挂靠门店（走基础客户端绕过租户扩展
      // ——清理脚本语义，仅命中本用例创建的 id 集合）
      if (app) {
        const prisma = app.get(PrismaService);
        if (createdRoomIds.length > 0) {
          await prisma.room.updateMany({
            where: { id: { in: createdRoomIds }, deletedAt: null },
            data: { deletedAt: new Date() },
          });
        }
        if (storeId) {
          await prisma.store.updateMany({
            where: { id: storeId, deletedAt: null },
            data: { deletedAt: new Date() },
          });
        }
      }
    });
  });

  /**
   * P0-02-08 审计查询 API（子任务 4 · 租户内）
   *
   * 覆盖：
   *  1. 主链路：tenant_admin 创建 / 更新门店（@Audit 自动轨 fire-and-forget 落库）
   *     → GET /audit-logs 断 200，返回项 tenantId 全为 "1"（**租户隔离验收**：
   *     租户 A 查不到租户 B 数据），分页信封对齐 A4（list/total/page/page_size）；
   *  2. 筛选：entityType + entityId（更新轨带 :id 提取）+ action 命中目标行；
   *  3. 越权：平台 admin（JWT 无租户上下文）→ @RequireTenant 拒绝（403 + A0302）。
   *
   * 断言口径：全局 ResponseInterceptor 统一 200 信封，一律断 200；
   * 每个 it 内 HTTP 请求 ≤ 5。
   */
  describe("P0-02-08 审计查询 API (e2e)", () => {
    let tenantToken: string; // 租户管理员（tenant_admin，tenant_id=1）
    let platformToken: string; // 平台级账号（admin，无租户归属）
    let storeId: string;
    const storeCode = `e2e-audit-store-${Date.now()}`;
    /** 兜底清理集合：本 describe 创建的门店 id，afterAll 统一软删 */
    const createdStoreIds: string[] = [];

    /** 受控测试后门：清空全局限流计数器（rate_limiter:ip:*，RedisService 同库） */
    async function resetRateLimiter(): Promise<void> {
      const client = redis.getClient();
      const limiterKeys = await client.keys("rate_limiter:ip:*");
      if (limiterKeys.length > 0) await client.del(...limiterKeys);
    }

    /**
     * 带 429 重试的请求包装。
     *
     * 开发机上常有并行的测试进程共享同一 Redis 限流键（同源 IP 计数），会把
     * 他进程的突发流量算到本套件头上，造成与自身请求量不符的 429 假失败——
     * 命中 429 时清一次计数器并重试（仅重试一次，重试仍失败照常上抛）。
     */
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

    async function loginAndGetToken(username: string, password: string): Promise<string> {
      await resetRateLimiter();
      const { captchaId, captchaCode } = await withRetry429(() => obtainCaptcha());
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
      tenantToken = await loginAndGetToken("tenant_admin", "123456");
      await new Promise((resolve) => setTimeout(resolve, 300));
      platformToken = await loginAndGetToken("admin", "123456");
    });

    beforeEach(async () => {
      // 受控测试后门（同 afterAll 清黑名单键的既有惯例）：清空全局限流计数器，
      // 隔离并行测试进程共享 Redis 造成的 429 假失败（见 withRetry429 注释）
      await resetRateLimiter();
    });

    it('主链路：创建+更新门店触发审计 → GET /audit-logs 返回项 tenantId 全为 "1"（租户隔离）', async () => {
      // 1) 创建门店（POST 无 :id 路由参数 → 自动轨 entityId 落空串，仅作操作留痕）
      const createRes = await withRetry429(
        () =>
          request(app.getHttpServer())
            .post(`${PREFIX}/stores`)
            .set("Authorization", `Bearer ${tenantToken}`)
            .send({
              code: storeCode,
              name: "E2E 审计测试门店",
              type: 1,
              province: "广东省",
              city: "深圳市",
              district: "南山区",
              address: "科技园路 3 号",
              phone: "0755-1234569",
              status: 1,
            })
            .expect(HttpStatus.OK) // 全局 ResponseInterceptor 统一 200 信封
      );
      expect(createRes.body.code).toBe("00000");
      storeId = createRes.body.data.id as string;
      createdStoreIds.push(storeId);
      expect(storeId).toBeTruthy();

      // 2) 更新门店（PUT 带 :id → 自动轨 entityId 提取 params.id，可按对象回溯）
      await resetRateLimiter();
      const updateRes = await withRetry429(() =>
        request(app.getHttpServer())
          .put(`${PREFIX}/stores/${storeId}`)
          .set("Authorization", `Bearer ${tenantToken}`)
          .send({ name: "E2E 审计测试门店（已改名）", version: 0 })
          .expect(HttpStatus.OK)
      );
      expect(updateRes.body.code).toBe("00000");

      // 3) 自动轨为 fire-and-forget（tap 内不等待），稍候落库完成再查询
      await new Promise((resolve) => setTimeout(resolve, 800));

      // 4) 租户内查询：断 200 + A4 分页信封 + 租户隔离（行全属租户 1）
      await resetRateLimiter();
      const listRes = await withRetry429(() =>
        request(app.getHttpServer())
          .get(`${PREFIX}/audit-logs?page=1&page_size=20`)
          .set("Authorization", `Bearer ${tenantToken}`)
          .expect(HttpStatus.OK)
      );
      expect(listRes.body.code).toBe("00000");
      const page = listRes.body.data as {
        list: Array<{ tenantId: string; entityType: string; entityId: string; action: number }>;
        total: number;
        page: number;
        page_size: number;
      };
      expect(["list", "total", "page", "page_size"].sort()).toEqual(Object.keys(page).sort());
      expect(page.total).toBeGreaterThanOrEqual(2);
      expect(page.page).toBe(1);
      expect(page.page_size).toBe(20);
      expect(Array.isArray(page.list)).toBe(true);
      // 租户隔离验收：返回项 tenantId 全为 "1"（BigInt 序列化为字符串）
      for (const row of page.list) {
        expect(row.tenantId).toBe("1");
      }
      // 更新轨可按对象回溯：entityType=store 且 entityId=本用例门店 id
      const updateRow = page.list.find(
        (row) => row.entityType === "store" && row.entityId === storeId
      );
      expect(updateRow).toBeTruthy();
      expect(updateRow!.action).toBe(2); // AuditAction.UPDATE
    });

    it("筛选：entityType + entityId + action 精确命中更新轨审计行", async () => {
      const res = await withRetry429(() =>
        request(app.getHttpServer())
          .get(`${PREFIX}/audit-logs?entityType=store&entityId=${storeId}&action=2`)
          .set("Authorization", `Bearer ${tenantToken}`)
          .expect(HttpStatus.OK)
      );
      expect(res.body.code).toBe("00000");
      const page = res.body.data as {
        list: Array<{ entityType: string; entityId: string; action: number }>;
        total: number;
      };
      expect(page.total).toBeGreaterThanOrEqual(1);
      for (const row of page.list) {
        expect(row.entityType).toBe("store");
        expect(row.entityId).toBe(storeId);
        expect(row.action).toBe(2);
      }
    });

    it("越权：无租户上下文的平台 admin 调审计查询 → @RequireTenant 拒绝（403 + A0302）", async () => {
      const res = await withRetry429(() =>
        request(app.getHttpServer())
          .get(`${PREFIX}/audit-logs`)
          .set("Authorization", `Bearer ${platformToken}`)
          .expect(HttpStatus.FORBIDDEN)
      );
      expect(res.body).toMatchObject({ code: "A0302", data: null });
    });

    afterAll(async () => {
      // 兜底清理：统一软删本 describe 创建的门店（走基础客户端绕过租户扩展）
      if (app && createdStoreIds.length > 0) {
        const prisma = app.get(PrismaService);
        await prisma.store.updateMany({
          where: { id: { in: createdStoreIds }, deletedAt: null },
          data: { deletedAt: new Date() },
        });
      }
    });
  });

  /**
   * P0-04-04 / P0-04-05 营业时间 · 门店日历 · 门店配置 API（FR-3 / FR-4）
   *
   * 覆盖：
   *  1. 每周营业时段（store.business_hours 整存整取）：GET 空模板（7 天键齐全）→
   *     PUT 合法包（version 乐观锁 0→1）→ GET 回显 → 非法包 400（A0436）；
   *  2. 日期级例外日历（store_calendar，同日同店唯一）：POST → 按月 GET →
   *     重复 409（A0438）→ 软删 → 复删 404（A0439）→ 越权门店 404（A0424）；
   *  3. 门店配置（store.config，浅 merge 平台默认值）：GET 默认值 → PATCH 合并
   *     （version 自增）→ GET 回显 → 非法值 DTO 拦截 200 + A0400（A0437 单测兜底）
   *     → 旧版本重放 409（A0423）；
   *  4. 越权：无租户上下文的平台 admin → 403 + A0302。
   *
   * 口径：创建类接口全局拦截器统一 200 信封；BusinessException 保留 httpStatus。
   * it 内请求均 ≤ 5 次（RateLimitMiddleware 每 IP 每秒 10 次 + 用例间 250ms 错峰）。
   */
  describe("P0-04-04/05 营业时间 · 日历 · 门店配置 API (e2e)", () => {
    let tenantToken: string; // 租户管理员（tenant_admin，tenant_id=1）
    let platformToken: string; // 平台级账号（admin，无租户归属）
    let storeId: string;
    const storeCode = `e2e-bh-store-${Date.now()}`;
    /** 例外日所在月与日期（取当月 15 日：恒为合法日历日，且与月查询参数同月） */
    const now = new Date();
    const e2eMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const e2eDate = `${e2eMonth}-15`;
    /** 合法 7 天整包时段（PUT 用） */
    const validWeekly = {
      mon: [["09:00", "18:00"]],
      tue: [],
      wed: [
        ["09:00", "12:00"],
        ["13:00", "18:00"],
      ],
      thu: [],
      fri: [["09:00", "21:00"]],
      sat: [["08:00", "20:00"]],
      sun: [],
    };

    async function loginAndGetToken(username: string, password: string): Promise<string> {
      const { captchaId, captchaCode } = await obtainCaptcha();
      const res = await request(app.getHttpServer())
        .post(`${PREFIX}/auth/login`)
        .send({ username, password, captchaCode, captchaId })
        .expect(HttpStatus.CREATED);
      expect(res.body.code).toBe("00000");
      return res.body.data.accessToken as string;
    }

    beforeAll(async () => {
      tenantToken = await loginAndGetToken("tenant_admin", "123456");
      // RateLimitMiddleware（每 IP 每秒 10 次）：登录 4 连发（captcha+login ×2）后
      // 集中在 beforeAll，须主动错峰，避免首个用例的请求被 429 截胡
      await new Promise((resolve) => setTimeout(resolve, 500));
      platformToken = await loginAndGetToken("admin", "123456");
      await new Promise((resolve) => setTimeout(resolve, 500));

      // 自建挂靠门店（营业时间/日历/配置均挂在门店维度；afterAll 一并清理）
      const createRes = await request(app.getHttpServer())
        .post(`${PREFIX}/stores`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({
          code: storeCode,
          name: "E2E 营业时间测试门店",
          type: 1,
          province: "广东省",
          city: "深圳市",
          district: "南山区",
          address: "科技园路 3 号",
          phone: "0755-1234569",
          status: 1,
        })
        .expect(HttpStatus.OK);
      expect(createRes.body.code).toBe("00000");
      storeId = createRes.body.data.id as string;
      expect(storeId).toBeTruthy();
    });

    it("主链路A：营业时段 GET 空模板（7 天键）→ PUT 整存（version 0→1）→ GET 回显 → 非法包 400 A0436", async () => {
      // 1) 从未配置 → 7 天键齐全的空模板 + 乐观锁 version
      const emptyRes = await request(app.getHttpServer())
        .get(`${PREFIX}/stores/${storeId}/business-hours`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK);
      expect(emptyRes.body.code).toBe("00000");
      expect(emptyRes.body.data.storeId).toBe(storeId);
      expect(Object.keys(emptyRes.body.data.businessHours).sort()).toEqual(
        ["fri", "mon", "sat", "sun", "thu", "tue", "wed"].sort()
      );
      expect(emptyRes.body.data.version).toBe(0);

      // 2) 整存整取：合法 7 天包，version 0→1
      const putRes = await request(app.getHttpServer())
        .put(`${PREFIX}/stores/${storeId}/business-hours`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ version: 0, businessHours: validWeekly })
        .expect(HttpStatus.OK);
      expect(putRes.body.code).toBe("00000");
      expect(putRes.body.data.version).toBe(1);
      expect(putRes.body.data.businessHours.mon).toEqual([["09:00", "18:00"]]);

      // 3) 回显
      const savedRes = await request(app.getHttpServer())
        .get(`${PREFIX}/stores/${storeId}/business-hours`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK);
      expect(savedRes.body.data.businessHours.fri).toEqual([["09:00", "21:00"]]);
      expect(savedRes.body.data.businessHours.tue).toEqual([]);

      // 4) 非法包（缺 sun 键）→ 400 + A0436（service 层整包校验，BusinessException 保留 httpStatus）
      const missingDay = { ...validWeekly } as Record<string, unknown>;
      delete missingDay.sun;
      const invalidRes = await request(app.getHttpServer())
        .put(`${PREFIX}/stores/${storeId}/business-hours`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ version: 1, businessHours: missingDay })
        .expect(HttpStatus.BAD_REQUEST);
      expect(invalidRes.body).toMatchObject({ code: "A0436", data: null });
    });

    it("主链路B：日历 POST（type=1 节假日闭店）→ 按月 GET 命中 → 同日重复 409 A0438", async () => {
      // 1) 新建例外日
      const createRes = await request(app.getHttpServer())
        .post(`${PREFIX}/stores/${storeId}/calendar`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ date: e2eDate, type: 1, remark: "E2E 节假日" })
        .expect(HttpStatus.OK); // 创建类接口全局 ResponseInterceptor 统一 200 信封
      expect(createRes.body.code).toBe("00000");
      expect(createRes.body.data.type).toBe(1);
      expect(createRes.body.data.tenantId).toBe("1");
      expect(createRes.body.data.id).toBeTruthy();

      // 2) 按月列出：命中刚建的例外日（date 为 DATE 列，序列化保留 yyyy-MM-dd 前缀）
      const listRes = await request(app.getHttpServer())
        .get(`${PREFIX}/stores/${storeId}/calendar?month=${e2eMonth}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK);
      expect(listRes.body.code).toBe("00000");
      expect(listRes.body.data.storeId).toBe(storeId);
      const items = listRes.body.data.items as Array<{ id: string; date: string; type: number }>;
      const hit = items.find((row) => row.date.startsWith(e2eDate));
      expect(hit).toBeTruthy();
      expect(hit!.type).toBe(1);

      // 3) 同日同店重复 → 409 + A0438（唯一约束，软删不腾位）
      const dupRes = await request(app.getHttpServer())
        .post(`${PREFIX}/stores/${storeId}/calendar`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ date: e2eDate, type: 2 })
        .expect(HttpStatus.CONFLICT);
      expect(dupRes.body).toMatchObject({ code: "A0438", data: null });
    });

    it("主链路C：日历 DELETE（软删）→ 复删 404 A0439 → 越权门店（不存在 uuid）日历 404 A0424", async () => {
      // 取回例外日 id（按月 GET）
      const listRes = await request(app.getHttpServer())
        .get(`${PREFIX}/stores/${storeId}/calendar?month=${e2eMonth}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK);
      const items = listRes.body.data.items as Array<{ id: string; date: string }>;
      const entryId = items.find((row) => row.date.startsWith(e2eDate))!.id;
      expect(entryId).toBeTruthy();

      // 错峰：限流窗口（RateLimitMiddleware 每 IP 每秒 10 次，固定窗口）
      await new Promise((resolve) => setTimeout(resolve, 350));

      // 1) 软删
      const deleteRes = await request(app.getHttpServer())
        .delete(`${PREFIX}/stores/${storeId}/calendar/${entryId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK);
      expect(deleteRes.body.code).toBe("00000");

      // 2) 复删（已软删不可见）→ 404 + A0439
      const reDeleteRes = await request(app.getHttpServer())
        .delete(`${PREFIX}/stores/${storeId}/calendar/${entryId}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.NOT_FOUND);
      expect(reDeleteRes.body).toMatchObject({ code: "A0439", data: null });

      // 错峰：限流窗口
      await new Promise((resolve) => setTimeout(resolve, 350));

      // 3) 越权：storeId 不属于本租户（不存在的 uuid）→ 404 + A0424（列表与创建同口径）
      const foreignStoreId = "00000000-0000-4000-8000-000000000000";
      const foreignListRes = await request(app.getHttpServer())
        .get(`${PREFIX}/stores/${foreignStoreId}/calendar?month=${e2eMonth}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.NOT_FOUND);
      expect(foreignListRes.body).toMatchObject({ code: "A0424", data: null });

      const foreignCreateRes = await request(app.getHttpServer())
        .post(`${PREFIX}/stores/${foreignStoreId}/calendar`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ date: e2eDate, type: 3, openTime: "10:00", closeTime: "16:00" })
        .expect(HttpStatus.NOT_FOUND);
      expect(foreignCreateRes.body).toMatchObject({ code: "A0424", data: null });
    });

    it("主链路D：config GET 默认值 → PATCH 合并（version 自增）→ GET 回显 → 非法值 400 A0437 → 旧版本重放 A0423", async () => {
      // 1) 从未配置 → 平台默认值全量（粒度 30 / 提前量 2 / 取消截止 24 / 10:00 / 18:00 / 推送开）
      const defaultRes = await request(app.getHttpServer())
        .get(`${PREFIX}/stores/${storeId}/config`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK);
      expect(defaultRes.body.code).toBe("00000");
      expect(defaultRes.body.data.config).toEqual({
        slotGranularityMin: 30,
        bookingLeadHours: 2,
        cancelCutoffHours: 24,
        boardingCheckinTime: "10:00",
        boardingCheckoutTime: "18:00",
        pushEnabled: true,
      });
      const configVersion: number = defaultRes.body.data.version;

      // 2) PATCH 部分更新（浅 merge）：粒度 15 + 推送关
      const patchRes = await request(app.getHttpServer())
        .patch(`${PREFIX}/stores/${storeId}/config`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ version: configVersion, slotGranularityMin: 15, pushEnabled: false })
        .expect(HttpStatus.OK);
      expect(patchRes.body.code).toBe("00000");
      expect(patchRes.body.data.version).toBe(configVersion + 1);
      expect(patchRes.body.data.config.slotGranularityMin).toBe(15);
      expect(patchRes.body.data.config.pushEnabled).toBe(false);
      // 未覆盖键保留默认（浅 merge 语义）
      expect(patchRes.body.data.config.bookingLeadHours).toBe(2);

      // 3) 回显合并结果
      const savedRes = await request(app.getHttpServer())
        .get(`${PREFIX}/stores/${storeId}/config`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK);
      expect(savedRes.body.data.config.cancelCutoffHours).toBe(24);

      // 错峰：限流窗口（RateLimitMiddleware 每 IP 每秒 10 次，固定窗口）
      await new Promise((resolve) => setTimeout(resolve, 350));

      // 4) 非法值（粒度不在 15/30/60）→ DTO 声明式校验拦截，经 filter 统一转 200 + A0400
      //    （存量前端口径：参数校验错误不抛 http 状态；service 层 A0437 直调兜底由单测覆盖）
      const invalidRes = await request(app.getHttpServer())
        .patch(`${PREFIX}/stores/${storeId}/config`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ version: configVersion + 1, slotGranularityMin: 20 })
        .expect(HttpStatus.OK);
      expect(invalidRes.body).toMatchObject({ code: "A0400", data: null });

      // 错峰：限流窗口
      await new Promise((resolve) => setTimeout(resolve, 350));

      // 5) 旧版本重放 → 409 + A0423（并发覆盖被乐观锁拦截）
      const conflictRes = await request(app.getHttpServer())
        .patch(`${PREFIX}/stores/${storeId}/config`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ version: configVersion, bookingLeadHours: 48 })
        .expect(HttpStatus.CONFLICT);
      expect(conflictRes.body).toMatchObject({ code: "A0423", data: null });
    });

    it("越权：无租户上下文的平台 admin 调营业时间/配置接口 → 403 + A0302", async () => {
      const bhRes = await request(app.getHttpServer())
        .get(`${PREFIX}/stores/${storeId}/business-hours`)
        .set("Authorization", `Bearer ${platformToken}`)
        .expect(HttpStatus.FORBIDDEN);
      expect(bhRes.body).toMatchObject({ code: "A0302", data: null });

      const configRes = await request(app.getHttpServer())
        .get(`${PREFIX}/stores/${storeId}/config`)
        .set("Authorization", `Bearer ${platformToken}`)
        .expect(HttpStatus.FORBIDDEN);
      expect(configRes.body).toMatchObject({ code: "A0302", data: null });
    });

    afterAll(async () => {
      // 兜底清理：物理清理本 describe 的日历行（避免唯一索引残留阻塞后续重跑），
      // 再软删挂靠门店（走基础客户端绕过租户扩展——清理脚本语义）
      if (app) {
        const prisma = app.get(PrismaService);
        if (storeId) {
          await prisma.storeCalendar.deleteMany({ where: { storeId } });
          await prisma.store.updateMany({
            where: { id: storeId, deletedAt: null },
            data: { deletedAt: new Date() },
          });
        }
      }
    });
  });

  describe("P0-04-06/07 总部-门店两级 · 批量下发 · 日历视图 API (e2e)", () => {
    let tenantToken: string; // 租户管理员（tenant_admin，tenant_id=1，ROOT 直放）
    let platformToken: string; // 平台级账号（admin，无租户归属）
    let storeId: string;
    const storeCode = `e2e-hq-store-${Date.now()}`;
    /** 例外日所在月与日期：当月 15 日（type=1 闭店）/ 16 日（type=3 特殊营业） */
    const now = new Date();
    const e2eMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const closedDate = `${e2eMonth}-15`;
    const specialDate = `${e2eMonth}-16`;
    /** 不存在 uuid（合法格式，归属校验必然失败 → 部分成功语义的 failed 项） */
    const foreignStoreId = "00000000-0000-4000-8000-000000000000";
    /** 合法 7 天整包时段（周一营业、周二闭店，供 weekly 回落断言） */
    const validWeekly = {
      mon: [["09:00", "18:00"]],
      tue: [],
      wed: [["09:00", "18:00"]],
      thu: [],
      fri: [["09:00", "18:00"]],
      sat: [["09:00", "18:00"]],
      sun: [],
    };

    /** "yyyy-MM-dd" → UTC 星期几（0=周日…6=周六；纯 UTC 口径，禁进程时区漂移） */
    function utcDayOf(dateStr: string): number {
      const [y, m, d] = dateStr.split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    }

    async function loginAndGetToken(username: string, password: string): Promise<string> {
      const { captchaId, captchaCode } = await obtainCaptcha();
      const res = await request(app.getHttpServer())
        .post(`${PREFIX}/auth/login`)
        .send({ username, password, captchaCode, captchaId })
        .expect(HttpStatus.CREATED);
      expect(res.body.code).toBe("00000");
      return res.body.data.accessToken as string;
    }

    beforeAll(async () => {
      tenantToken = await loginAndGetToken("tenant_admin", "123456");
      await new Promise((resolve) => setTimeout(resolve, 500));
      platformToken = await loginAndGetToken("admin", "123456");
      await new Promise((resolve) => setTimeout(resolve, 500));

      // 自建挂靠门店 + 周时段 + 两个例外日（afterAll 一并清理）
      const createRes = await request(app.getHttpServer())
        .post(`${PREFIX}/stores`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({
          code: storeCode,
          name: "E2E 总部两级测试门店",
          type: 1,
          province: "广东省",
          city: "深圳市",
          district: "南山区",
          address: "科技园路 9 号",
          phone: "0755-1234570",
          status: 1,
        })
        .expect(HttpStatus.OK);
      expect(createRes.body.code).toBe("00000");
      storeId = createRes.body.data.id as string;
      expect(storeId).toBeTruthy();

      await new Promise((resolve) => setTimeout(resolve, 350));
      const putRes = await request(app.getHttpServer())
        .put(`${PREFIX}/stores/${storeId}/business-hours`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ version: 0, businessHours: validWeekly })
        .expect(HttpStatus.OK);
      expect(putRes.body.code).toBe("00000");

      await new Promise((resolve) => setTimeout(resolve, 350));
      const closedRes = await request(app.getHttpServer())
        .post(`${PREFIX}/stores/${storeId}/calendar`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ date: closedDate, type: 1, remark: "E2E 节假日闭店" })
        .expect(HttpStatus.OK);
      expect(closedRes.body.code).toBe("00000");

      await new Promise((resolve) => setTimeout(resolve, 350));
      const specialRes = await request(app.getHttpServer())
        .post(`${PREFIX}/stores/${storeId}/calendar`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ date: specialDate, type: 3, openTime: "10:00", closeTime: "16:00" })
        .expect(HttpStatus.OK);
      expect(specialRes.body.code).toBe("00000");
    });

    it("主链路A：calendar-view 聚合——例外日优先（type1 闭店/type3 特殊时段），无例外日回落周时段", async () => {
      const viewRes = await request(app.getHttpServer())
        .get(`${PREFIX}/stores/${storeId}/calendar-view?month=${e2eMonth}`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK);
      expect(viewRes.body.code).toBe("00000");
      expect(viewRes.body.data.storeId).toBe(storeId);

      const days = viewRes.body.data.days as Array<{
        date: string;
        open: boolean;
        source: string;
        periods: [string, string][];
        calendarType?: number;
      }>;

      // 整月逐日齐全：天数与月份实际天数一致
      const [year, month] = e2eMonth.split("-").map(Number);
      const expectedDayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
      expect(days).toHaveLength(expectedDayCount);

      // 例外日优先：type=1 节假日闭店（周时段即便营业也让位于闭店）
      const closed = days.find((day) => day.date === closedDate);
      expect(closed).toEqual({
        date: closedDate,
        open: false,
        source: "calendar",
        periods: [],
        calendarType: 1,
      });

      // 例外日优先：type=3 特殊营业用其 openTime/closeTime
      const special = days.find((day) => day.date === specialDate);
      expect(special).toEqual({
        date: specialDate,
        open: true,
        source: "calendar",
        periods: [["10:00", "16:00"]],
        calendarType: 3,
      });

      // 无例外日回落周时段：当月第一个周一 → 营业（weekly 口径）
      const firstMonday = days.find((day) => day.source === "weekly" && utcDayOf(day.date) === 1);
      expect(firstMonday).toBeTruthy();
      expect(firstMonday!.open).toBe(true);
      expect(firstMonday!.periods).toEqual([["09:00", "18:00"]]);

      // 当月第一个周二 → 周时段无配置 = 闭店
      const firstTuesday = days.find((day) => day.source === "weekly" && utcDayOf(day.date) === 2);
      expect(firstTuesday).toBeTruthy();
      expect(firstTuesday!.open).toBe(false);
      expect(firstTuesday!.periods).toEqual([]);
    });

    it("主链路B：批量下发部分成功——本租户门店成功、外部 uuid 进 failed；GET config 回显覆盖键", async () => {
      const dispatchRes = await request(app.getHttpServer())
        .post(`${PREFIX}/stores/batch-dispatch-config`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({
          storeIds: [storeId, foreignStoreId],
          config: { pushEnabled: false, slotGranularityMin: 60 },
        })
        .expect(HttpStatus.OK); // 创建/写类接口全局统一 200 信封
      expect(dispatchRes.body.code).toBe("00000");
      expect(dispatchRes.body.data.total).toBe(2);

      // 部分成功：本租户门店成功（含自增后 version），外部 uuid 归属失败 A0424
      const succeeded = dispatchRes.body.data.succeeded as Array<{
        storeId: string;
        version: number;
      }>;
      expect(succeeded).toHaveLength(1);
      expect(succeeded[0].storeId).toBe(storeId);
      expect(typeof succeeded[0].version).toBe("number");

      const failed = dispatchRes.body.data.failed as Array<{ storeId: string; code: string }>;
      expect(failed).toHaveLength(1);
      expect(failed[0]).toMatchObject({ storeId: foreignStoreId, code: "A0424" });

      // 错峰：限流窗口（RateLimitMiddleware 每 IP 每秒 10 次，固定窗口）
      await new Promise((resolve) => setTimeout(resolve, 350));

      // 回显：下发键覆盖生效，未覆盖键保留平台默认（浅 merge 语义）
      const configRes = await request(app.getHttpServer())
        .get(`${PREFIX}/stores/${storeId}/config`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK);
      expect(configRes.body.data.config.pushEnabled).toBe(false);
      expect(configRes.body.data.config.slotGranularityMin).toBe(60);
      expect(configRes.body.data.config.bookingLeadHours).toBe(2);
    });

    it("异常路径：空 storeIds → 400 A0440；非法配置键/值 → 400 A0437（请求级整体拒绝）", async () => {
      // 1) 空 storeIds → A0440（本轮新错误码）
      const emptyRes = await request(app.getHttpServer())
        .post(`${PREFIX}/stores/batch-dispatch-config`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ storeIds: [], config: { pushEnabled: false } })
        .expect(HttpStatus.BAD_REQUEST);
      expect(emptyRes.body).toMatchObject({ code: "A0440", data: null });

      // 错峰：限流窗口
      await new Promise((resolve) => setTimeout(resolve, 350));

      // 2) 非法配置键（白名单外）→ A0437
      const invalidKeyRes = await request(app.getHttpServer())
        .post(`${PREFIX}/stores/batch-dispatch-config`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ storeIds: [storeId], config: { evilKey: 1 } })
        .expect(HttpStatus.BAD_REQUEST);
      expect(invalidKeyRes.body).toMatchObject({ code: "A0437", data: null });

      // 错峰：限流窗口
      await new Promise((resolve) => setTimeout(resolve, 350));

      // 3) 合法键但非法值（粒度不在 15/30/60）→ A0437
      const invalidValueRes = await request(app.getHttpServer())
        .post(`${PREFIX}/stores/batch-dispatch-config`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .send({ storeIds: [storeId], config: { slotGranularityMin: 20 } })
        .expect(HttpStatus.BAD_REQUEST);
      expect(invalidValueRes.body).toMatchObject({ code: "A0437", data: null });
    });

    it("权限双向：tenant_admin 可访问总览/日历视图（ROOT 直放）；平台 admin 无租户上下文 → 403 + A0302", async () => {
      // 有权限：租户管理员访问 tenant-overview，命中本 describe 自建门店摘要
      const overviewRes = await request(app.getHttpServer())
        .get(`${PREFIX}/stores/tenant-overview`)
        .set("Authorization", `Bearer ${tenantToken}`)
        .expect(HttpStatus.OK);
      expect(overviewRes.body.code).toBe("00000");
      const items = overviewRes.body.data.items as Array<{
        id: string;
        config: Record<string, unknown>;
        calendarExceptionCount: number;
      }>;
      const hit = items.find((row) => row.id === storeId);
      expect(hit).toBeTruthy();
      expect(hit!.calendarExceptionCount).toBeGreaterThanOrEqual(2);
      expect(hit!.config.pushEnabled).toBe(false); // 批量下发的覆盖已进总览摘要

      // 错峰：限流窗口
      await new Promise((resolve) => setTimeout(resolve, 350));

      // 无权限：平台 admin（无租户上下文）→ TenantContextGuard fail-closed 403 + A0302
      const overviewDenied = await request(app.getHttpServer())
        .get(`${PREFIX}/stores/tenant-overview`)
        .set("Authorization", `Bearer ${platformToken}`)
        .expect(HttpStatus.FORBIDDEN);
      expect(overviewDenied.body).toMatchObject({ code: "A0302", data: null });

      const viewDenied = await request(app.getHttpServer())
        .get(`${PREFIX}/stores/${storeId}/calendar-view?month=${e2eMonth}`)
        .set("Authorization", `Bearer ${platformToken}`)
        .expect(HttpStatus.FORBIDDEN);
      expect(viewDenied.body).toMatchObject({ code: "A0302", data: null });
    });

    afterAll(async () => {
      // 兜底清理：物理清理日历行（唯一索引不残留），再软删挂靠门店
      if (app) {
        const prisma = app.get(PrismaService);
        if (storeId) {
          await prisma.storeCalendar.deleteMany({ where: { storeId } });
          await prisma.store.updateMany({
            where: { id: storeId, deletedAt: null },
            data: { deletedAt: new Date() },
          });
        }
      }
    });
  });
});
