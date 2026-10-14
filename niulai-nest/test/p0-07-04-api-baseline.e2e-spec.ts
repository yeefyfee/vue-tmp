import { Test } from "@nestjs/testing";
import type { TestingModule } from "@nestjs/testing";
import { ValidationPipe, HttpStatus } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import type { ValidationError } from "class-validator";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import * as request from "supertest";
import { AppModule } from "../src/app.module";
import { ResponseInterceptor } from "../src/common/interceptors/response.interceptor";
import { BusinessException } from "../src/common/exceptions/business.exception";
import { ErrorCode } from "../src/common/enums/error-code.enum";
import { RedisService } from "../src/common/redis/redis.service";
import { PrismaService } from "../src/common/prisma/prisma.service";
import { enableBigIntJsonSerialization } from "../src/common/prisma/bigint-json";

/**
 * P0-07-04 API 基础集成测试（E2E）
 *
 * 目的：对「统一响应信封 / 分页契约 / 参数校验 / 认证 / 租户隔离 / 分页入参命名分裂」
 * 做一次面向真实运行栈的基线固化（baseline snapshot）。
 *
 * 原则（对齐任务要求）：
 *  - 真实 AppModule + 真 PostgreSQL(peluvida_dev) + 真 Redis(DB7)，**零 mock**；
 *  - 主体只做「登录 + 读」；唯一例外是 E2（AT-003 跨租户隔离证明）：它用**裸 Prisma 客户端**
 *    （绕过租户扩展，与 packages/db/prisma/seed.ts 同口径）额外 provision 一个隔离的第二租户
 *    + 1 条客户（标记前缀 QATEN2_），并在 afterAll 硬删干净、在 beforeAll 做幂等预清理，
 *    确保不留残留、不污染其它 spec 的计数断言；
 *  - 限流窗口为 1s / 10 次（RateLimitMiddleware，键 rate_limiter:ip:*），
 *    本套件在同一 it 内连发多请求，故每个请求前都重置限流计数，避免并行/密集请求打出
 *    A0502(429) 假失败。
 *
 * 契约事实（来源）：
 *  - 成功信封 { code:"00000", msg:"成功", data }（src/common/interceptors/response.interceptor.ts）
 *  - 列表 data = { list, total, page, page_size }（page/page_size 出参恒 snake_case）
 *  - camelCase 端点用 BaseQueryDto(pageNum/pageSize)，仅 /media 与 /audit-logs 用 snake_case
 *  - 校验失败 → BusinessException(A0400, 400)（src/main.ts exceptionFactory）
 *  - 错误信封 data 恒 null；未认证 401 A0230；客户不存在 404 A0510
 *  - AT-003 租户隔离由 **E2** 用「真实第二租户数据」证明；E1 仅覆盖输入侧防篡改。
 *
 * 前置：PG / Redis 连通 + 系统域种子已执行（tenant_admin / 123456，tenant_id=1）。
 * 运行：node ./node_modules/jest/bin/jest.js --config ./test/jest-e2e.json --runInBand \
 *         test/p0-07-04-api-baseline
 */

const PREFIX = "/api/v1";

/** 统一列表信封的键集（契约快照） */
const PAGE_ENVELOPE_KEYS = ["list", "page", "page_size", "total"];

/** 契约一致性广度扫描覆盖的 11 个列表端点（含 camelCase 与 snake_case 两种入参口径） */
const LIST_ENVELOPE_ENDPOINTS = [
  "/customers",
  "/pets",
  "/stores",
  "/rooms",
  "/users",
  "/roles",
  "/dicts",
  "/configs",
  "/logs",
  "/media",
  "/audit-logs",
];

/** 只读基线端点：用于 afterAll 校验本套件未产生任何业务数据 */
const READONLY_BASELINE_ENDPOINTS = ["/customers", "/pets", "/stores", "/rooms", "/media"];

/** E2 第二租户隔离夹具：唯一 code + 客户标记前缀（可精确清理，绝不误伤演示数据） */
const TENANT2_CODE = "QATEN2_E2E";
const TENANT2_CUSTOMER_NAME = "QATEN2_隔离客户";
const TENANT2_CUSTOMER_MOBILE = "90000000002";

interface GetOptions {
  token?: string;
  headers?: Record<string, string>;
}

describe("P0-07-04 API 基础集成 (e2e)", () => {
  let app: INestApplication;
  let redis: RedisService;
  let prisma: PrismaService;
  let tenantToken: string;
  /** 只读基线：登录后立即快照各业务列表 total */
  const baselineTotals = new Map<string, number>();

  /** 清空全局限流计数器（rate_limiter:ip:*，与 RedisService 同库） */
  async function resetRateLimiter(): Promise<void> {
    const client = redis.getClient();
    const keys = await client.keys("rate_limiter:ip:*");
    if (keys.length > 0) {
      await client.del(...keys);
    }
  }

  /**
   * 限流安全的 GET 封装：每个请求前重置限流计数；
   * 若仍命中 429 / A0502，退避后重试（最多 5 次），保证串行密集请求不产生假失败。
   */
  async function apiGet(path: string, options: GetOptions = {}): Promise<request.Response> {
    const issue = (): request.Test => {
      let req = request(app.getHttpServer()).get(`${PREFIX}${path}`);
      if (options.token) {
        req = req.set("Authorization", `Bearer ${options.token}`);
      }
      if (options.headers) {
        for (const [key, value] of Object.entries(options.headers)) {
          req = req.set(key, value);
        }
      }
      return req;
    };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await resetRateLimiter();
      const res = await issue();
      if (res.status === HttpStatus.TOO_MANY_REQUESTS || res.body?.code === "A0502") {
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      return res;
    }

    await resetRateLimiter();
    const fallback = await issue();
    return fallback;
  }

  /** 验证码 → 登录 → 返回 accessToken（成功为 HTTP 201 + code 00000） */
  async function loginAndGetToken(username: string, password: string): Promise<string> {
    const captchaRes = await apiGet("/auth/captcha");
    expect(captchaRes.status).toBe(HttpStatus.OK);
    const captchaId = captchaRes.body.data.captchaId as string;
    const captchaCode = (await redis.get<string>(`captcha:image:${captchaId}`)) as string;
    expect(captchaCode).toBeTruthy();

    await resetRateLimiter();
    const loginRes = await request(app.getHttpServer())
      .post(`${PREFIX}/auth/login`)
      .send({ username, password, captchaCode, captchaId })
      .expect(HttpStatus.CREATED);
    expect(loginRes.body.code).toBe("00000");
    return loginRes.body.data.accessToken as string;
  }

  /**
   * 幂等清理 E2 的第二租户夹具：按唯一 code 定位租户 → 删其名下客户 → 删租户。
   *
   * 用**裸 Prisma 客户端**（`prisma.tenant` / `prisma.customer`，未经租户扩展），
   * 口径与 packages/db/prisma/seed.ts 一致（seed 同样以裸 PrismaClient 跨租户写入）。
   * beforeAll 先跑一次（自愈上一轮残留）、afterAll 再跑一次（硬删本轮数据），均可重复执行。
   */
  async function cleanupTenant2(): Promise<void> {
    const tenant2 = await prisma.tenant.findFirst({ where: { code: TENANT2_CODE } });
    if (!tenant2) {
      return;
    }
    await prisma.customer.deleteMany({ where: { tenantId: tenant2.id } });
    await prisma.tenant.deleteMany({ where: { id: tenant2.id } });
  }

  beforeAll(async () => {
    // 必须在任何响应序列化之前完成（与 src/main.ts 一致）
    enableBigIntJsonSerialization();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(PREFIX);
    app.useGlobalInterceptors(new ResponseInterceptor(app.get(Reflector), app.get(ConfigService)));
    // 全局管道：与 src/main.ts 保持一致（含 exceptionFactory）。
    // ⚠️ 说明：任务骨架 p0-07-01 的 ValidationPipe 省略了 exceptionFactory（该 spec 不触发
    //    DTO 校验失败）。本套件覆盖「DTO 校验失败 = HTTP 400 + A0400」契约，必须复刻 main.ts 的
    //    exceptionFactory：否则默认 BadRequestException 会命中 HttpExceptionFilter 的
    //    BAD_REQUEST 特殊分支被改写为 HTTP 200 + A0400（见 http-exception.filter.ts:94-98）。
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        transformOptions: { enableImplicitConversion: true },
        whitelist: true,
        forbidNonWhitelisted: false,
        exceptionFactory: (errors: ValidationError[]) => {
          const collect = (list: ValidationError[]): string[] => {
            const out: string[] = [];
            for (const item of list) {
              if (item.constraints) {
                out.push(...Object.values(item.constraints));
              }
              if (item.children && item.children.length > 0) {
                out.push(...collect(item.children));
              }
            }
            return out;
          };
          const messages = collect(errors)
            .map((message) => String(message).trim())
            .filter(Boolean);
          const msg = messages[0] || ErrorCode.USER_REQUEST_PARAMETER_ERROR.msg;
          return new BusinessException({
            code: ErrorCode.USER_REQUEST_PARAMETER_ERROR.code,
            msg,
            httpStatus: HttpStatus.BAD_REQUEST,
          });
        },
      })
    );
    await app.init();

    redis = app.get(RedisService);
    prisma = app.get(PrismaService);

    // 幂等预清理：清掉上一轮（可能崩溃残留）的 QATEN2_ 夹具，保证本轮基线计数干净。
    await cleanupTenant2();

    tenantToken = await loginAndGetToken("tenant_admin", "123456");

    for (const endpoint of READONLY_BASELINE_ENDPOINTS) {
      const res = await apiGet(endpoint, { token: tenantToken });
      baselineTotals.set(endpoint, res.body.data.total as number);
    }
  });

  beforeEach(async () => {
    await resetRateLimiter();
  });

  describe("统一列表信封（契约一致性）", () => {
    it("A1 广度扫描：11 个列表端点均返回统一分页信封", async () => {
      const problems: string[] = [];
      for (const endpoint of LIST_ENVELOPE_ENDPOINTS) {
        const res = await apiGet(endpoint, { token: tenantToken });
        const data = res.body?.data;

        if (res.status !== HttpStatus.OK) {
          problems.push(`${endpoint}: HTTP ${res.status}（期望 200）`);
        }
        if (res.body?.code !== "00000") {
          problems.push(`${endpoint}: code=${res.body?.code}（期望 00000）`);
        }
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          problems.push(`${endpoint}: data 非对象`);
          continue;
        }
        if (!Array.isArray(data.list)) {
          problems.push(`${endpoint}: data.list 非数组`);
        }
        if (typeof data.total !== "number") {
          problems.push(`${endpoint}: data.total 非 number`);
        }
        if (typeof data.page !== "number") {
          problems.push(`${endpoint}: data.page 非 number`);
        }
        if (typeof data.page_size !== "number") {
          problems.push(`${endpoint}: data.page_size 非 number`);
        }
      }
      // 空数组 = 全部通过；失败时一次性列出所有异常端点，便于定位
      expect(problems).toEqual([]);
    });

    it("A2 信封键集严格相等（契约快照）", async () => {
      const endpoints = ["/customers", "/pets", "/stores", "/media"];
      const observed: Record<string, string[]> = {};
      for (const endpoint of endpoints) {
        const res = await apiGet(endpoint, { token: tenantToken });
        expect(res.status).toBe(HttpStatus.OK);
        expect(res.body.code).toBe("00000");
        observed[endpoint] = Object.keys(res.body.data as Record<string, unknown>).sort();
      }

      const expected: Record<string, string[]> = {};
      for (const endpoint of endpoints) {
        expected[endpoint] = [...PAGE_ENVELOPE_KEYS];
      }
      expect(observed).toEqual(expected);
    });

    it("A3 非分页树形端点：/depts、/menus 返回裸数组（无 list/total/page）", async () => {
      const observed: Record<
        string,
        { status: number; code: string; isArray: boolean; hasList: boolean }
      > = {};
      for (const endpoint of ["/depts", "/menus"]) {
        const res = await apiGet(endpoint, { token: tenantToken });
        const data = res.body.data;
        observed[endpoint] = {
          status: res.status,
          code: res.body.code,
          isArray: Array.isArray(data),
          hasList:
            data !== null &&
            typeof data === "object" &&
            Object.prototype.hasOwnProperty.call(data, "list"),
        };
      }

      expect(observed).toEqual({
        "/depts": { status: HttpStatus.OK, code: "00000", isArray: true, hasList: false },
        "/menus": { status: HttpStatus.OK, code: "00000", isArray: true, hasList: false },
      });
    });
  });

  describe("分页默认值与生效（AT-009）", () => {
    it("B1 GET /customers 不带分页参数 → 默认 page=1 / page_size=20", async () => {
      const res = await apiGet("/customers", { token: tenantToken });
      expect(res.status).toBe(HttpStatus.OK);
      const data = res.body.data;
      expect(data.page).toBe(1);
      expect(data.page_size).toBe(20);
      expect(data.list.length).toBeLessThanOrEqual(20);
    });

    it("B2 GET /customers?pageNum=1&pageSize=2 → page=1 / page_size=2", async () => {
      const res = await apiGet("/customers?pageNum=1&pageSize=2", { token: tenantToken });
      expect(res.status).toBe(HttpStatus.OK);
      const data = res.body.data;
      expect(data.page).toBe(1);
      expect(data.page_size).toBe(2);
      expect(data.list.length).toBeLessThanOrEqual(2);
    });

    it("B3 GET /customers?pageNum=2&pageSize=1 → page=2 / page_size=1", async () => {
      const res = await apiGet("/customers?pageNum=2&pageSize=1", { token: tenantToken });
      expect(res.status).toBe(HttpStatus.OK);
      const data = res.body.data;
      expect(data.page).toBe(2);
      expect(data.page_size).toBe(1);
      expect(data.list.length).toBeLessThanOrEqual(1);
    });

    it("B4 snake_case 端点 GET /media?page=2&page_size=1 → page=2 / page_size=1", async () => {
      const res = await apiGet("/media?page=2&page_size=1", { token: tenantToken });
      expect(res.status).toBe(HttpStatus.OK);
      const data = res.body.data;
      expect(data.page).toBe(2);
      expect(data.page_size).toBe(1);
      expect(data.list.length).toBeLessThanOrEqual(1);
    });
  });

  describe("边界与非法参数（健壮性）", () => {
    it("C1 GET /customers?pageNum=0 → 400 + A0400（@Min(1)）", async () => {
      const res = await apiGet("/customers?pageNum=0", { token: tenantToken });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
      expect(res.body).toMatchObject({ code: "A0400", data: null });
    });

    it("C2 GET /customers?pageSize=9999 → 400 + A0400（@Max(100)）", async () => {
      const res = await apiGet("/customers?pageSize=9999", { token: tenantToken });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
      expect(res.body).toMatchObject({ code: "A0400", data: null });
    });

    it("C3 GET /media?page=0 → 400 + A0400（snake_case 端点同口径）", async () => {
      const res = await apiGet("/media?page=0", { token: tenantToken });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
      expect(res.body).toMatchObject({ code: "A0400", data: null });
    });

    it("C4 GET /customers?sortBy=__proto__&order=ASC → 200（白名单静默回退，不 500/不注入）", async () => {
      const res = await apiGet("/customers?sortBy=__proto__&order=ASC", { token: tenantToken });
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.code).toBe("00000");
    });

    it("C5 GET /customers?order=NOTDIR → 400 + A0400（@IsIn 值域约束）", async () => {
      const res = await apiGet("/customers?order=NOTDIR", { token: tenantToken });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
      expect(res.body).toMatchObject({ code: "A0400", data: null });
    });
  });

  describe("认证与错误信封（安全）", () => {
    it("D1 无 Authorization → 401 + A0230", async () => {
      const res = await apiGet("/customers");
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(res.body).toMatchObject({ code: "A0230", data: null });
    });

    it("D2 伪造 token → 401 + data 为 null", async () => {
      const res = await apiGet("/customers", { token: "not-a-jwt" });
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(res.body.code).toBe("A0230");
      expect(res.body.data).toBeNull();
    });

    it("D3 GET /customers/<随机 uuid v4> 不存在 → 404 + A0510", async () => {
      const res = await apiGet(`/customers/${crypto.randomUUID()}`, { token: tenantToken });
      expect(res.status).toBe(HttpStatus.NOT_FOUND);
      expect(res.body).toMatchObject({ code: "A0510", data: null });
    });
  });

  describe("租户隔离（AT-003）", () => {
    it("E1 伪造 tenantId 查询参数 / tenant_id 请求头被忽略（输入侧防篡改）", async () => {
      const base = await apiGet("/customers?pageNum=1&pageSize=20", { token: tenantToken });
      expect(base.status).toBe(HttpStatus.OK);
      const baseTotal = base.body.data.total as number;

      // ① 伪造 tenant 查询参数：QueryCustomerDto 未声明 tenantId → whitelist 剥离，忽略
      const fakeQuery = await apiGet("/customers?tenantId=999&pageNum=1&pageSize=20", {
        token: tenantToken,
      });
      expect(fakeQuery.status).toBe(HttpStatus.OK);
      expect(fakeQuery.body.code).toBe("00000");
      expect(fakeQuery.body.data.total).toBe(baseTotal);

      // ② 伪造 tenant_id 请求头：租户只认 ALS 上下文（JWT payload），头被忽略
      const fakeHeader = await apiGet("/customers?pageNum=1&pageSize=20", {
        token: tenantToken,
        headers: { tenant_id: "999" },
      });
      expect(fakeHeader.status).toBe(HttpStatus.OK);
      expect(fakeHeader.body.code).toBe("00000");
      expect(fakeHeader.body.data.total).toBe(baseTotal);
    });

    it("E2 [AT-003] 真实第二租户数据：租户 1 读不到（列表不混入 / 直读 404 A0510）", async () => {
      // provision：用**裸 Prisma 客户端**（绕过租户扩展）写入隔离的第二租户 + 1 条客户，
      // 口径与 packages/db/prisma/seed.ts 一致（seed 亦以裸 PrismaClient 跨租户写入）。
      const tenant2 = await prisma.tenant.create({
        data: {
          name: "QATEN2_隔离验证租户",
          code: TENANT2_CODE,
          status: 1,
          plan: "starter",
          featureFlags: {},
        },
      });
      const created = await prisma.customer.create({
        data: {
          tenantId: tenant2.id,
          name: TENANT2_CUSTOMER_NAME,
          mobile: TENANT2_CUSTOMER_MOBILE,
        },
      });

      // 反向自证：直读库确认数据**确实写入**且 tenant_id = 第二租户，
      // 且该租户 id 确实不同于演示租户（tenant_id=1）——否则 404 可能只是「压根没建成」。
      const persisted = await prisma.customer.findUnique({ where: { id: created.id } });
      expect(persisted).not.toBeNull();
      expect(String(persisted?.tenantId)).toBe(String(tenant2.id));
      expect(String(tenant2.id)).not.toBe("1");

      // ① 租户 1 列表 total 与基线相等 ⇒ 租户 2 的客户**未混入**租户 1 列表
      const listRes = await apiGet("/customers?pageNum=1&pageSize=100", { token: tenantToken });
      expect(listRes.status).toBe(HttpStatus.OK);
      expect(listRes.body.code).toBe("00000");
      expect(listRes.body.data.total).toBe(baselineTotals.get("/customers"));
      const listIds = (listRes.body.data.list as Array<{ id: string }>).map((item) => item.id);
      expect(listIds).not.toContain(created.id);

      // ② 租户 1 token 直读租户 2 客户 → 404 + A0510（跨租户直读被拒且不泄露存在性）
      const detailRes = await apiGet(`/customers/${created.id}`, { token: tenantToken });
      expect(detailRes.status).toBe(HttpStatus.NOT_FOUND);
      expect(detailRes.body).toMatchObject({ code: "A0510", data: null });
    });
  });

  describe("现状固化：分页入参命名分裂", () => {
    it("F1 [特征化] camelCase 端点收到 snake_case 分页参数 → 被白名单剥离，回落默认值", async () => {
      // ⚠️ 这是特征化测试（characterization），固化「现状」而非断言其为缺陷：
      // camelCase 端点（customers/pets/stores/rooms/users/roles/dicts/configs/logs）使用
      // BaseQueryDto 的 pageNum/pageSize；而 /media 与 /audit-logs 使用 snake_case page/page_size。
      // 对 camelCase 端点发送 page/page_size 时，全局 ValidationPipe（whitelist:true，
      // forbidNonWhitelisted:false）会静默剥离这两个「未声明属性」，分页于是回落到默认 1 / 20。
      // 将来若统一分页入参命名，本断言会失败并被测试捕获，提示同步调整。
      const res = await apiGet("/customers?page=2&page_size=1", { token: tenantToken });
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.code).toBe("00000");
      expect(res.body.data.page).toBe(1);
      expect(res.body.data.page_size).toBe(20);
    });
  });

  afterAll(async () => {
    if (!app) {
      return;
    }
    // 只读兜底核对：租户 1 各业务列表 total 应与登录后基线一致
    // （即 E2 写入的第二租户数据未泄漏进租户 1；框架 LoggerMiddleware 写 sys_log 属平台日志，非业务数据）。
    // ⚠️ 必须 try/finally 包住断言：失败态下若不 close 会挂起 jest 进程
    //    （did not exit one second after the test run has completed），
    //    而这恰恰是最需要诊断信息的时刻。
    try {
      for (const endpoint of READONLY_BASELINE_ENDPOINTS) {
        const res = await apiGet(endpoint, { token: tenantToken });
        expect(res.body.data.total).toBe(baselineTotals.get(endpoint));
      }
    } finally {
      // 硬删 E2 的第二租户夹具（租户 2 + 其名下客户），确保零残留
      await cleanupTenant2();
      await app.close();
    }
  });
});
