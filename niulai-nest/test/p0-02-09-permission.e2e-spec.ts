import { Test } from "@nestjs/testing";
import type { TestingModule } from "@nestjs/testing";
import { ValidationPipe, HttpStatus } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import * as request from "supertest";
import * as bcrypt from "bcrypt";
import { AppModule } from "../src/app.module";
import { ResponseInterceptor } from "../src/common/interceptors/response.interceptor";
import { RedisService } from "../src/common/redis/redis.service";
import { PrismaService } from "../src/common/prisma/prisma.service";
import { enableBigIntJsonSerialization } from "../src/common/prisma/bigint-json";

/**
 * P0-02-09 权限（RBAC）端到端验证 · 独立 spec（禁动既有 E2E）
 *
 * 验收链（核心 = 无权限拒绝）：
 *  1. ROOT 直放：tenant_admin（ROOT）请求受限接口成功（00000）；
 *  2. **无权限拒绝**：自建「最小权限角色（不授目标权限）+ 测试用户」，登录后请求
 *     受限接口 → 403 + A0300（统一信封）；证明权限校验真实生效而非摆设；
 *  3. @Public 免鉴权：GET /auth/captcha 无 token 成功；
 *  4. 未登录：受限接口无 token → 401 + A0230；
 *  5. 导航隐藏一致性：无权限角色 GET /menus/routes → 不含任何路由（客户模块被隐藏）。
 *
 * 前置：PG(peluvida_dev) / Redis 连通 + 系统域种子（tenant_admin / admin / ROOT）。
 * 安全红线：**不触碰演示账号**（admin id=91、tenant_admin id=92、ROLE id=157、
 * 租户 id=1）；自建数据一律 `p009_` 前缀，afterAll 按外键顺序硬删清理。
 *
 * 口径：全局前缀 /api/v1；成功信封 { code:"00000", msg, data }；
 * 业务异常统一信封（BusinessException 保留 httpStatus；ForbiddenException→403+A0300、
 * 未认证→401+A0230）；每 it HTTP ≤ 5（RateLimitMiddleware 每 IP 每秒 10 次）。
 */

const PREFIX = "/api/v1";

describe("P0-02-09 权限（RBAC）E2E", () => {
  let app: INestApplication;
  let redis: RedisService;
  let prisma: PrismaService;

  let rootToken: string; // tenant_admin（ROOT）
  let limitedToken: string; // 最小权限用户

  const suffix = Date.now();
  const roleCode = `p009_role_${suffix}`; // ≤32 chars
  const roleName = `p009_角色_${suffix}`; // ≤64 chars，唯一
  const username = `p009_user_${suffix}`; // ≤64 chars
  const password = "123456";

  let roleId: bigint;
  let userId: bigint;

  // ── 空助手（与既有 E2E 同口径）─────────────────────────────────
  async function resetRateLimiter(): Promise<void> {
    const client = redis.getClient();
    const keys = await client.keys("rate_limiter:ip:*");
    if (keys.length > 0) await client.del(...keys);
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

  async function loginAndGetToken(user: string, pass: string): Promise<string> {
    await resetRateLimiter();
    const { captchaId, captchaCode } = await obtainCaptcha();
    const res = await withRetry429(() =>
      request(app.getHttpServer())
        .post(`${PREFIX}/auth/login`)
        .send({ username: user, password: pass, captchaCode, captchaId })
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

    // 自建「最小权限角色」：不授 customer:list / store:list / pet:list（无菜单关联）
    const role = await prisma.sysRole.create({
      data: { name: roleName, code: roleCode, status: 1, dataScope: 1, isDeleted: 0 },
    });
    roleId = role.id;

    // 测试用户：租户 1 内（拿到租户上下文），仅绑上述角色
    const user = await prisma.sysUser.create({
      data: {
        username,
        nickname: "p009 权限测试用户",
        password: bcrypt.hashSync(password, 8),
        tenantId: 1n,
        status: 1,
        isDeleted: 0,
      },
    });
    userId = user.id;
    await prisma.sysUserRole.create({ data: { userId: user.id, roleId: role.id } });

    // 登录两个账号
    rootToken = await loginAndGetToken("tenant_admin", "123456");
    await new Promise((resolve) => setTimeout(resolve, 300));
    limitedToken = await loginAndGetToken(username, password);
  });

  beforeEach(async () => {
    await resetRateLimiter();
  });

  afterAll(async () => {
    if (prisma) {
      // 按外键顺序清理（不触碰演示数据）
      await prisma.sysUserRole.deleteMany({ where: { userId } });
      await prisma.sysUser.deleteMany({ where: { username } });
      await prisma.sysRoleMenu.deleteMany({ where: { roleId } });
      await prisma.sysRole.deleteMany({ where: { code: roleCode } });
    }
    if (redis) {
      await resetRateLimiter();
      const client = redis.getClient();
      // 清理权限缓存字段 + 会话/版本键 + 登录限流键（避免污染同库后续套件）
      await client.hdel("system:role:perms", roleCode);
      const keys = [
        ...(await client.keys(`auth:user:jwt_session:${userId}`)),
        ...(await client.keys(`auth:user:token_version:${userId}`)),
        ...(await client.keys(`auth:login:*${username}`)),
      ];
      if (keys.length > 0) await client.del(...keys);
    }
    if (app) await app.close();
  });

  it("ROOT 直放：tenant_admin 请求受限接口（/customers /stores /pets）全部 00000", async () => {
    for (const path of ["/customers", "/stores", "/pets"]) {
      const res = await withRetry429(() =>
        request(app.getHttpServer())
          .get(`${PREFIX}${path}`)
          .set("Authorization", `Bearer ${rootToken}`)
          .expect(HttpStatus.OK)
      );
      expect(res.body.code).toBe("00000");
    }
  });

  it("无权限拒绝（核心）：最小权限用户请求受限接口 → 403 + A0300", async () => {
    for (const path of ["/customers", "/stores", "/pets"]) {
      const res = await withRetry429(() =>
        request(app.getHttpServer())
          .get(`${PREFIX}${path}`)
          .set("Authorization", `Bearer ${limitedToken}`)
          .expect(HttpStatus.FORBIDDEN)
      );
      expect(res.body).toMatchObject({ code: "A0300", data: null });
    }
  });

  it("@Public 免鉴权：GET /auth/captcha 无 token → 成功", async () => {
    const res = await withRetry429(() =>
      request(app.getHttpServer()).get(`${PREFIX}/auth/captcha`).expect(200)
    );
    expect(res.body.code).toBe("00000");
    expect(res.body.data.captchaId).toBeTruthy();
  });

  it("未登录：受限接口无 token → 401 + A0230", async () => {
    const res = await withRetry429(() =>
      request(app.getHttpServer()).get(`${PREFIX}/customers`).expect(HttpStatus.UNAUTHORIZED)
    );
    expect(res.body).toMatchObject({ code: "A0230", data: null });
  });

  it("导航隐藏与 403 一致：无权限角色 GET /menus/routes → 不含客户模块（空路由）", async () => {
    const res = await withRetry429(() =>
      request(app.getHttpServer())
        .get(`${PREFIX}/menus/routes`)
        .set("Authorization", `Bearer ${limitedToken}`)
        .expect(HttpStatus.OK)
    );
    expect(res.body.code).toBe("00000");
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(0);
    expect(JSON.stringify(res.body.data)).not.toContain("customer");
  });
});
