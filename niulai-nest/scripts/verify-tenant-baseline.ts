/**
 * 租户隔离基线 · 真库验证（PEL-11）
 *
 * 验收标准对齐（清单 PEL-11）：
 *   1. 无租户上下文的查询被拒绝 —— 扩展内核 fail-closed（真 Prisma $extends 实测）+ 守卫级 requireTenantId；
 *   2. Redis 键带 `tenant:` 前缀 —— 真 Redis 实测物理键名（走真实 RedisService）；
 *   3. `sys_dept` 未被改造为租户 —— schema + information_schema 双重断言。
 * 另验 RLS 骨架：`app_current_tenant_id()` 读取 GUC `app.tenant_id`（事务级 SET LOCAL）；
 * RLS 策略模板 `app_enable_tenant_rls(regclass)` 以临时验证表实测
 * （fail-closed / 租户过滤 / 同事务切 GUC / WITH CHECK 拦截跨租户写入）。
 *
 * 运行：
 *   node ./node_modules/ts-node/dist/bin.js -r tsconfig-paths/register scripts/verify-tenant-baseline.ts
 *
 * 业务域扩展（2026-10-05）：第 9 节覆盖业务域 P0 四表
 * （store / service_category / room / staff）的 RLS 元数据与扩展层双租户隔离。
 */
import * as fs from "fs";
import * as path from "path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { Client as PgClient } from "pg";
import { RequestContext } from "../src/common/context/request-context";
import type { CurrentUserInfo } from "../src/common/interfaces/current-user.interface";
import { registerTenantScopedModels } from "../src/tenant/tenant.constants";
import {
  resolveTenantWhereFromContext,
  TenantContextMissingError,
} from "../src/tenant/prisma/tenant-scope.extension";
import { TenantContextService } from "../src/tenant/tenant-context.service";
import { RedisService } from "../src/common/redis/redis.service";

const CONNECTION =
  process.env.DATABASE_URL ?? "postgresql://admin:Pg%40123456@127.0.0.1:5432/peluvida_dev";
const REDIS_HOST = process.env.REDIS_HOST ?? "127.0.0.1";
const REDIS_PORT = Number(process.env.REDIS_PORT ?? 6379);
const REDIS_DB = Number(process.env.REDIS_DB ?? 7);

const base = new PrismaClient({ adapter: new PrismaPg({ connectionString: CONNECTION }) });
const rawRedis = new Redis({ host: REDIS_HOST, port: REDIS_PORT, db: REDIS_DB });
/** 走真实 RedisService（仅注入底层客户端），前缀逻辑本身就是被测对象 */
const cache = new RedisService({ getOrThrow: () => rawRedis } as never);

/** 探针租户与键（刻意用高位 ID / 前缀，避免与真实数据碰撞） */
const T = "900042";
const T_OTHER = "900043";
const PROBE_KEY = `tenant:probe:${Date.now()}`;

let passed = 0;
let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed += 1;
  else failures += 1;
  console.log(
    `  ${ok ? "√" : "✗"} ${label}  → 实际 ${JSON.stringify(actual)}${ok ? "" : `（期望 ${JSON.stringify(expected)}）`}`
  );
}
function checkTrue(label: string, cond: boolean) {
  if (cond) passed += 1;
  else failures += 1;
  console.log(`  ${cond ? "√" : "✗"} ${label}`);
}
function section(title: string) {
  console.log(`\n${title}`);
}

/** 供第 4 节实测的「CROSS-09 挂链预览」扩展：用纯函数内核拦截 $allModels */
function buildTenantPreviewExtension() {
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          void operation;
          if (!model) return query(args);
          const r = resolveTenantWhereFromContext(model);
          if (r.action === "reject") throw r.error;
          if (r.action === "inject") {
            // 与 data-scope.extension.ts 同构：args 本身就是查询参数对象
            const currentWhere = (args as { where?: unknown }).where;
            const mergedWhere = { ...((currentWhere ?? {}) as object), ...r.where };
            return query({ ...(args as object), where: mergedWhere } as typeof args);
          }
          return query(args);
        },
      },
    },
  });
}

async function section1_env() {
  section("1) 环境与前置");
  await base.$queryRaw`SELECT 1`;
  checkTrue("PostgreSQL 可达", true);
  checkTrue("Redis 可达", (await rawRedis.ping()) === "PONG");

  const fnRows = await base.$queryRaw<Array<{ cnt: bigint }>>`
    SELECT count(*)::bigint AS cnt FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'app_current_tenant_id'`;
  check("RLS 骨架函数已登记（migrate deploy 已应用）", Number(fnRows[0]?.cnt ?? 0), 1);

  const mig = await base.$queryRaw<Array<{ c: bigint }>>`
    SELECT count(*)::bigint AS c FROM _prisma_migrations WHERE migration_name LIKE '%tenant_rls_baseline%'`;
  check("_prisma_migrations 已登记 tenant_rls_baseline", Number(mig[0]?.c ?? 0) >= 1, true);
}

function section2_context() {
  section("2) 上下文基座（AsyncLocalStorage 租户锚点）");
  RequestContext.run(() => {
    check("初始无租户", RequestContext.getTenantId(), null);
    RequestContext.setTenantId("   ");
    check("空白值归一化为 null", RequestContext.getTenantId(), null);
    RequestContext.setTenantId("900042");
    check("正常写入", RequestContext.getTenantId(), "900042");

    const svc = new TenantContextService();
    check("服务读取一致", svc.getTenantId(), "900042");
  });

  // requireTenantId：无上下文必须抛 A0302（fail-closed）
  RequestContext.run(() => {
    try {
      new TenantContextService().requireTenantId();
      checkTrue("requireTenantId 无上下文应抛 A0302", false);
    } catch (e: any) {
      const resp = e?.response ?? e?.getResponse?.();
      checkTrue("requireTenantId 无上下文抛 A0302（fail-closed）", resp?.code === "A0302");
    }
  });

  // initUserContext 随用户上下文写入租户（DataScopeGuard 的写入路径）
  RequestContext.run(() => {
    const user: CurrentUserInfo = {
      userId: "900101",
      deptId: "0",
      deptTreePath: "0",
      dataScopes: [],
      roles: [],
      tenantId: "900042",
    };
    RequestContext.initUserContext(user);
    check("initUserContext 同源写入租户", RequestContext.getTenantId(), "900042");
  });

  // 请求间隔离
  RequestContext.run(() => {
    RequestContext.setTenantId("1");
    RequestContext.run(() => {
      check("嵌套 store 隔离（内层为 null）", RequestContext.getTenantId(), null);
    });
    check("外层不受内层影响", RequestContext.getTenantId(), "1");
  });
}

async function section3_redis() {
  section("3) Redis 租户前缀（真实 RedisService × 物理 Redis）");
  await rawRedis.del(PROBE_KEY, `tenant:${T}:${PROBE_KEY}`, `tenant:${T_OTHER}:${PROBE_KEY}`);

  // 无上下文：平台级键保持原样（历史行为不变）
  await cache.set(PROBE_KEY, "platform");
  checkTrue("无上下文 set：物理键不带前缀", (await rawRedis.keys(PROBE_KEY)).length === 1);
  check("无上下文 get：原键可读", await cache.get(PROBE_KEY), "platform");

  // 有租户上下文：键自动改写为 tenant:<id>:<key>
  await RequestContext.run(async () => {
    RequestContext.setTenantId(T);
    await cache.set(PROBE_KEY, "tenant-scoped");
    checkTrue(
      "有上下文 set：物理键 = tenant:<id>:<key>",
      (await rawRedis.keys(`tenant:${T}:${PROBE_KEY}`)).length === 1
    );
    check("有上下文 get：读到自己的值", await cache.get(PROBE_KEY), "tenant-scoped");
  });

  // 跨租户隔离：另一租户读不到（键名不同）
  await RequestContext.run(async () => {
    RequestContext.setTenantId(T_OTHER);
    check("租户 B 读不到租户 A 的数据", await cache.get(PROBE_KEY), null);
  });
  // 平台侧（无上下文）读原键仍是平台值
  check("平台侧读原键：仍是平台值", await cache.get(PROBE_KEY), "platform");

  // deletePattern 前缀生效：只清当前租户的键
  await RequestContext.run(async () => {
    RequestContext.setTenantId(T);
    await cache.set(`${PROBE_KEY}:a`, 1);
    await cache.set(`${PROBE_KEY}:b`, 2);
    check("有上下文 deletePattern 只清租户键", await cache.deletePattern(`${PROBE_KEY}:*`), 2);
  });
  check("平台键未被误删", await cache.get(PROBE_KEY), "platform");

  await rawRedis.del(PROBE_KEY, `tenant:${T}:${PROBE_KEY}`, `tenant:${T_OTHER}:${PROBE_KEY}`);
}

async function section4_extension_failclosed() {
  section("4) 扩展内核：无租户上下文的查询被拒绝（fail-closed）");
  registerTenantScopedModels("SysConfig"); // 进程内登记，仅本脚本生效（CROSS-09 会改为按表登记）
  const tenantExtended = buildTenantPreviewExtension();

  // 名单内模型 + 无上下文 → 拒绝（验收标准 1 的真链路证明）
  let rejected = false;
  try {
    await RequestContext.run(() => tenantExtended.sysConfig.findMany());
  } catch (e) {
    rejected = e instanceof TenantContextMissingError;
  }
  checkTrue("名单内模型（SysConfig）无上下文 findMany 被拒绝", rejected);

  // 名单外模型不受影响：平台级表照常可查
  const userRows = await tenantExtended.sysUser.findMany({ take: 1 });
  checkTrue("平台级模型（SysUser）照常可查", Array.isArray(userRows));
}

async function section5_rls() {
  section("5) RLS 骨架：GUC 读写（事务级 SET LOCAL）");
  const pg = new PgClient({ connectionString: CONNECTION });
  await pg.connect();
  try {
    const unset = await pg.query("SELECT public.app_current_tenant_id() AS v");
    check("未设置 GUC：返回 NULL", unset.rows[0].v, null);

    await pg.query("BEGIN");
    await pg.query("SELECT set_config('app.tenant_id', $1, true)", [T]);
    const set = await pg.query("SELECT public.app_current_tenant_id() AS v");
    check("事务内 set_config 后读到租户", String(set.rows[0].v), T);
    await pg.query("ROLLBACK");

    const after = await pg.query("SELECT public.app_current_tenant_id() AS v");
    check("事务结束（SET LOCAL 失效）：回到 NULL", after.rows[0].v, null);
  } finally {
    await pg.end();
  }
}

async function section6_dept_untouched() {
  section("6) sys_dept 未被改造为租户（验收标准 3）");
  const cols = await base.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sys_dept'`;
  const names = cols.map((c) => c.column_name);
  checkTrue("sys_dept 无 tenant_id 列", !names.includes("tenant_id"));

  const schemaText = fs.readFileSync(
    path.join(__dirname, "..", "..", "packages", "db", "prisma", "schema.prisma"),
    "utf8"
  );
  const deptBlock = schemaText.match(/model SysDept \{[\s\S]*?\n\}/)?.[0] ?? "";
  checkTrue(
    "schema.prisma 的 SysDept 无 tenantId 字段",
    deptBlock.length > 0 && !deptBlock.includes("tenantId")
  );
}

async function section7_source_anchors() {
  section("7) 令牌链路锚点（防回退的代码级断言）");
  const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

  checkTrue(
    "jwt.strategy 解析 payload.tenantId",
    read("src", "auth", "strategies", "jwt.strategy.ts").includes("payload.tenantId")
  );
  checkTrue(
    "auth.service 签发与刷新均携带 tenantId",
    read("src", "auth", "auth.service.ts").split("tenantId:").length - 1 >= 2
  );
  checkTrue(
    "DataScopeGuard 写入租户上下文",
    read("src", "common", "guards", "data-scope.guard.ts").includes("tenantId")
  );
  checkTrue(
    "RequestContext 具备租户锚点",
    read("src", "common", "context", "request-context.ts").includes("getTenantId")
  );
  checkTrue(
    "RedisService 全方法走租户前缀",
    read("src", "common", "redis", "redis.service.ts").includes("TENANT_REDIS_PREFIX")
  );
}

async function section8_rls_policy_template() {
  section("8) RLS 策略模板实测（app_enable_tenant_rls：fail-closed × 租户过滤 × WITH CHECK）");
  // ⚠️ 连接身份 admin 是 superuser，superuser 永远绕过 RLS（含 FORCE）；
  //    策略行为必须以「普通角色」实测才贴近生产（应用连接应为非属主角色）。
  //    用 SET ROLE 切到临时探针角色 rls_probe（NOLOGIN，无需口令），测完即弃。
  const pg = new PgClient({ connectionString: CONNECTION });
  await pg.connect();
  // 验证表用普通表而非 TEMP TABLE（TEMP TABLE 的 RLS 行为有边角），测完 DROP
  const TABLE = "rls_verify_tmp";
  const PROBE_ROLE = "rls_probe";
  // 删探针角色：public schema 的 USAGE 是 shared dependency，必须先 REVOKE 再 DROP
  // （本库 public schema 已 REVOKE PUBLIC 的 USAGE，GRANT 后残留会卡住下一次运行）
  const dropProbeRole = async () => {
    await pg.query(`REVOKE USAGE ON SCHEMA public FROM ${PROBE_ROLE}`).catch(() => {});
    await pg.query(`DROP ROLE IF EXISTS ${PROBE_ROLE}`);
  };
  try {
    // 清理历史残留（上次异常中断可能留下同名表/角色）
    await pg.query(`DROP TABLE IF EXISTS public.${TABLE}`);
    await dropProbeRole();

    await pg.query(
      `CREATE TABLE public.${TABLE} (
         id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
         tenant_id bigint NOT NULL,
         name text NOT NULL
       )`
    );
    await pg.query(`SELECT public.app_enable_tenant_rls('${TABLE}'::regclass)`);
    // 幂等性：模板函数可重复调用（业务表接入即一行）
    await pg.query(`SELECT public.app_enable_tenant_rls('${TABLE}'::regclass)`);
    checkTrue("幂等：app_enable_tenant_rls 可重复调用", true);

    // 建探针角色并授权（幂等）：NOLOGIN + 非 owner，RLS 对它无条件生效
    await pg.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rls_probe') THEN
           CREATE ROLE rls_probe NOLOGIN;
         END IF;
       END $$;`
    );
    await pg.query(`GRANT SELECT, INSERT ON public.${TABLE} TO ${PROBE_ROLE}`);
    // PG16 容器已把 public schema 的 USAGE 从 PUBLIC 收回，探针角色需单独补
    await pg.query(`GRANT USAGE ON SCHEMA public TO ${PROBE_ROLE}`);
    // identity 列的序列独立授权（避免 PG 版本对隐式授权的语义差异）
    await pg.query(
      `DO $$
       DECLARE seq text;
       BEGIN
         seq := pg_get_serial_sequence('public.${TABLE}', 'id');
         EXECUTE format('GRANT USAGE ON SEQUENCE %s TO rls_probe', seq);
       END $$;`
    );

    // 元数据断言：ENABLE + FORCE + 策略定义
    const rel = await pg.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = '${TABLE}'::regclass`
    );
    check("表已 ENABLE ROW LEVEL SECURITY", rel.rows[0].relrowsecurity, true);
    check("表已 FORCE（属主同样受约束）", rel.rows[0].relforcerowsecurity, true);
    const pol = await pg.query(
      `SELECT qual, with_check FROM pg_policies
       WHERE schemaname = 'public' AND tablename = $1 AND policyname = 'tenant_isolation'`,
      [TABLE]
    );
    check("策略 tenant_isolation 已注册", pol.rows.length, 1);
    checkTrue(
      "策略 USING / WITH CHECK 均引用 app_current_tenant_id",
      String(pol.rows[0]?.qual ?? "").includes("app_current_tenant_id") &&
        String(pol.rows[0]?.with_check ?? "").includes("app_current_tenant_id")
    );

    // ===== 以下全部以 rls_probe（普通角色）身份实测 =====
    await pg.query(`SET ROLE ${PROBE_ROLE}`);

    // 种子数据：各租户事务内写入（WITH CHECK 放行自己的租户）
    await pg.query("BEGIN");
    await pg.query("SELECT set_config('app.tenant_id', '1', true)");
    await pg.query(`INSERT INTO public.${TABLE} (tenant_id, name) VALUES (1, 'a1'), (1, 'a2')`);
    await pg.query("COMMIT");
    await pg.query("BEGIN");
    await pg.query("SELECT set_config('app.tenant_id', '2', true)");
    await pg.query(`INSERT INTO public.${TABLE} (tenant_id, name) VALUES (2, 'b1'), (2, 'b2')`);
    await pg.query("COMMIT");

    // fail-closed：GUC 从未设置的连接看不到任何行
    const closed = await pg.query(`SELECT count(*)::int AS c FROM public.${TABLE}`);
    check("GUC 未设置：查询 0 行（fail-closed）", closed.rows[0].c, 0);

    // 事务内租户过滤 + 同事务切换 GUC（SET LOCAL 语义）
    await pg.query("BEGIN");
    await pg.query("SELECT set_config('app.tenant_id', '1', true)");
    const t1 = await pg.query(
      `SELECT count(*)::int AS c, min(tenant_id) AS mn, max(tenant_id) AS mx FROM public.${TABLE}`
    );
    check("GUC=1：只见租户 1 的 2 行", [t1.rows[0].c, t1.rows[0].mn, t1.rows[0].mx], [2, "1", "1"]);
    await pg.query("SELECT set_config('app.tenant_id', '2', true)");
    const t2 = await pg.query(
      `SELECT count(*)::int AS c, min(tenant_id) AS mn, max(tenant_id) AS mx FROM public.${TABLE}`
    );
    check(
      "同事务切 GUC=2：只见租户 2 的 2 行",
      [t2.rows[0].c, t2.rows[0].mn, t2.rows[0].mx],
      [2, "2", "2"]
    );
    await pg.query("ROLLBACK");

    // WITH CHECK：GUC=2 却写 tenant_id=1 → 违反策略必须报错
    let withCheckRejected = false;
    let withCheckMsg = "";
    await pg.query("BEGIN");
    await pg.query("SELECT set_config('app.tenant_id', '2', true)");
    try {
      await pg.query(`INSERT INTO public.${TABLE} (tenant_id, name) VALUES (1, 'evil')`);
    } catch (e: any) {
      withCheckRejected = true;
      withCheckMsg = String(e?.message ?? "");
    }
    await pg.query("ROLLBACK");
    checkTrue("GUC=2 写 tenant_id=1 被 WITH CHECK 拒绝", withCheckRejected);
    checkTrue("报错消息指向 row-level security", /row-level security/i.test(withCheckMsg));

    // 切回 admin 身份（DROP 等 DDL 需要）
    await pg.query("RESET ROLE");

    // 兜底确认：系统域表未被 FORCE 误伤（模板函数只对显式调用的表生效）
    const sysRls = await pg.query(
      `SELECT count(*)::int AS c FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'sys_user' AND (c.relrowsecurity OR c.relforcerowsecurity)`
    );
    check("系统域表（sys_user）未被启用 RLS", sysRls.rows[0].c, 0);
  } finally {
    // 清理：防御性回滚 + 切回 admin，再 DROP 验证表与探针角色
    await pg.query("RESET ROLE").catch(() => {});
    await pg.query("ROLLBACK").catch(() => {});
    await pg.query(`DROP TABLE IF EXISTS public.${TABLE}`);
    await dropProbeRole();
    const gone = await pg.query(`SELECT to_regclass('public.${TABLE}') AS t`);
    check("验证表已 DROP（无残留）", gone.rows[0].t, null);
    await pg.end();
  }
}

async function section9_biz_domain_tenant_isolation() {
  section("9) 业务域扩展层双租户隔离（store / service_category / room / staff）");
  // ⚠️ 同第 8 节：admin 是 superuser，superuser 绕过 RLS（含 FORCE）——
  //    数据层隔离靠「扩展层注入 where 条件」实测（业务查询的真实路径）；
  //    RLS 策略本身的真过滤已由第 8 节 rls_probe 角色实测覆盖。
  const T1 = "900001";
  const T2 = "900002";
  const SUFFIX = `pb${Date.now()}`; // 唯一后缀防撞（探针租户 + code 双保险）

  // ① RLS 元数据：四表 ENABLE + FORCE + 策略 tenant_isolation 已注册
  const meta = await base.$queryRaw<Array<{ relname: string; rls: boolean; force: boolean }>>`
    SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS force
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('store', 'service_category', 'room', 'staff')`;
  checkTrue("四表均已 ENABLE ROW LEVEL SECURITY", meta.length === 4 && meta.every((r) => r.rls));
  checkTrue("四表均已 FORCE ROW LEVEL SECURITY", meta.length === 4 && meta.every((r) => r.force));
  const pols = await base.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_policies
    WHERE schemaname = 'public' AND policyname = 'tenant_isolation'
      AND tablename IN ('store', 'service_category', 'room', 'staff')`;
  check("四表策略 tenant_isolation 已注册", pols.length, 4);

  const ext = buildTenantPreviewExtension();

  // ② 探针租户残留清理（上次异常中断兜底）+ 种子数据（superuser 视角，绕 RLS）
  const probeWhere = { tenantId: { in: [BigInt(T1), BigInt(T2)] } };
  const preDel = await base.store.deleteMany({ where: probeWhere });
  check("前置清理：探针租户 store 残留删除", Number(preDel.count) >= 0, true);

  const s1 = await base.store.create({
    data: {
      tenantId: BigInt(T1),
      code: `vft${SUFFIX}a`,
      name: "隔离验证店A",
      province: "p",
      city: "c",
      district: "d",
      address: "addr",
      phone: "10000000000",
    },
  });
  const s2 = await base.store.create({
    data: {
      tenantId: BigInt(T2),
      code: `vft${SUFFIX}b`,
      name: "隔离验证店B1",
      province: "p",
      city: "c",
      district: "d",
      address: "addr",
      phone: "10000000001",
    },
  });
  const s3 = await base.store.create({
    data: {
      tenantId: BigInt(T2),
      code: `vft${SUFFIX}c`,
      name: "隔离验证店B2",
      province: "p",
      city: "c",
      district: "d",
      address: "addr",
      phone: "10000000002",
    },
  });
  const seeded = await base.store.count({ where: probeWhere });
  check("种子数据：探针租户 store 共 3 行", Number(seeded), 3);

  // ③ 扩展层双租户隔离（名单内模型 Store：findMany 注入 where.tenantId）
  await RequestContext.run(async () => {
    RequestContext.setTenantId(T1);
    const rows = await ext.store.findMany();
    check("租户 900001 视角：只见本租户 1 行", rows.length, 1);
    check(
      "租户 900001 视角：tenantId 全为 900001 且含种子行",
      rows.map((r) => String(r.tenantId)),
      [T1]
    );
    checkTrue(
      "租户 900001 视角：不含 900002 的行",
      rows.every((r) => r.id !== s2.id && r.id !== s3.id) && rows.some((r) => r.id === s1.id)
    );
  });

  await RequestContext.run(async () => {
    RequestContext.setTenantId(T2);
    const rows = await ext.store.findMany();
    check("租户 900002 视角：只见本租户 2 行", rows.length, 2);
    checkTrue(
      "租户 900002 视角：不含 900001 的行",
      rows.every((r) => String(r.tenantId) === T2) && !rows.some((r) => r.id === s1.id)
    );
  });

  // ④ fail-closed：名单内模型无 ALS 上下文一律拒绝（三态语义的 reject 支路）
  const rejectedModels: string[] = [];
  for (const m of ["store", "serviceCategory", "room", "staff"] as const) {
    try {
      await (ext as never as Record<string, { findMany: () => Promise<unknown> }>)[m].findMany();
    } catch (e) {
      if (e instanceof TenantContextMissingError) rejectedModels.push(m);
    }
  }
  check("无上下文查四模型均被 reject（TenantContextMissingError）", rejectedModels, [
    "store",
    "serviceCategory",
    "room",
    "staff",
  ]);

  // ⑤ 清理并确认无残留
  await base.store.deleteMany({ where: probeWhere });
  const leftover = await base.store.count({ where: probeWhere });
  check("清理后：探针租户 store 残留 0 行", Number(leftover), 0);
}

async function cleanup() {
  await rawRedis.del(PROBE_KEY, `tenant:${T}:${PROBE_KEY}`, `tenant:${T_OTHER}:${PROBE_KEY}`);
  await base.$disconnect();
  rawRedis.disconnect();
}

async function main() {
  console.log("=".repeat(72));
  console.log("PEL-11 租户隔离基线 · 真库验证");
  console.log("=".repeat(72));
  try {
    await section1_env();
    section2_context();
    await section3_redis();
    await section4_extension_failclosed();
    await section5_rls();
    await section6_dept_untouched();
    await section7_source_anchors();
    await section8_rls_policy_template();
    await section9_biz_domain_tenant_isolation();
  } finally {
    await cleanup();
  }
  console.log("\n" + "=".repeat(72));
  console.log(`结论：通过 ${passed} 项，失败 ${failures} 项`);
  if (failures > 0) {
    process.exitCode = 1;
  } else {
    console.log("✅ PEL-11 验收标准全部满足");
  }
}

main().catch((e) => {
  console.error("脚本异常终止：", e);
  process.exitCode = 1;
});
