/**
 * CROSS-09 租户 RLS + 扩展挂链 · 真库验证
 *
 * 验收标准对齐（清单 CROSS-09）：
 *   1. 无 tenant 上下文查询被拒绝 —— 真实 PrismaService.scoped 链实测（fail-closed）；
 *   2. 双租户互不可见 —— 临时表 + `app_enable_tenant_rls()` + 非属主角色实测 RLS；
 *   3. GUC 写入侧 —— `PrismaService.withTenantContext()` 事务级 set_config 实测。
 *
 * 运行：
 *   node ./node_modules/ts-node/dist/bin.js -r tsconfig-paths/register scripts/verify-tenant-rls.ts
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Client as PgClient } from "pg";
import { RequestContext } from "../src/common/context/request-context";
import { PrismaService } from "../src/common/prisma/prisma.service";
import { TenantContextMissingError } from "../src/tenant/prisma/tenant-scope.extension";
import { registerTenantScopedModels } from "../src/tenant/tenant.constants";

const CONNECTION =
  process.env.DATABASE_URL ?? "postgresql://admin:Pg%40123456@127.0.0.1:5432/peluvida_dev";

/** PrismaService 需要的 ConfigService 最小桩（只取 database.url） */
const configStub = { getOrThrow: () => CONNECTION, get: () => undefined } as never;

const service = new PrismaService(configStub);
const admin = new PgClient({ connectionString: CONNECTION });

let passed = 0;
let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = safeJson(actual);
  const e = safeJson(expected);
  const ok = a === e;
  if (ok) passed += 1;
  else failures += 1;
  console.log(`  ${ok ? "√" : "✗"} ${label}  → 实际 ${a}${ok ? "" : `（期望 ${e}）`}`);
}
function checkTrue(label: string, cond: boolean) {
  if (cond) passed += 1;
  else failures += 1;
  console.log(`  ${cond ? "√" : "✗"} ${label}`);
}
function section(title: string) {
  console.log(`\n${title}`);
}
function safeJson(v: unknown): string {
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Error) return `${v.name}: ${v.message.slice(0, 120)}`;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
/** 在事务内设置 GUC 后执行回调（模拟非 PrismaService 客户端的租户事务） */
async function inTenant<T>(
  client: PrismaClient,
  tenantId: string,
  fn: (tx: PrismaClient) => Promise<T>
): Promise<T> {
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx as unknown as PrismaClient);
  });
}
async function catchError(fn: () => Promise<unknown>): Promise<Error | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e as Error;
  }
}

async function main() {
  console.log("========================================================================");
  console.log("CROSS-09 租户 RLS + 扩展挂链 · 真库验证");
  console.log("========================================================================");

  // ⚠️ 本机沙箱实测：pg 客户端不显式 connect() 直接 query() 会静默终止，必须先连接
  await admin.connect();

  const SUFFIX = Date.now().toString(36);
  const TABLE = `rls_probe_${SUFFIX}`;
  const ROLE = `rls_probe_role_${SUFFIX}`;
  const ROLE_PASSWORD = `Rls_${SUFFIX}!x`;

  // ── 1) 前置：机具函数已登记（migrate deploy 产物）────────────────
  section("1) RLS 机具函数已登记");
  const fns = await admin.query<{ proname: string }>(
    `SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace
       AND proname IN ('app_current_tenant_id','app_enable_tenant_rls')`
  );
  const names = fns.rows.map((r) => r.proname).sort();
  check("app_current_tenant_id + app_enable_tenant_rls 均存在", names, [
    "app_current_tenant_id",
    "app_enable_tenant_rls",
  ]);

  // ── 2) 扩展挂链（真实 PrismaService.scoped）──────────────────────
  section("2) 扩展挂链：名单内模型在 scoped 链上被拦截/注入");
  registerTenantScopedModels("SysConfig"); // 借系统模型当注入探针（该表无 tenant_id 列，报错即注入证据）

  const rejectErr = await catchError(() => service.scoped.sysConfig.findMany());
  checkTrue(
    "无上下文 findMany 被拒绝（fail-closed）",
    rejectErr instanceof TenantContextMissingError
  );

  const injectReadErr = await catchError(() =>
    RequestContext.run(async () => {
      RequestContext.setTenantId("900100");
      return service.scoped.sysConfig.findMany();
    })
  );
  checkTrue(
    "有上下文 findMany 注入 tenantId 到达查询（该表无此列 → 报错含 tenantId）",
    injectReadErr !== null && /tenantId|tenant_id/i.test(injectReadErr.message)
  );

  const injectCreateErr = await catchError(() =>
    RequestContext.run(async () => {
      RequestContext.setTenantId("900100");
      return service.scoped.sysConfig.create({
        data: { configName: "probe", configKey: "probe", configValue: "probe" },
      });
    })
  );
  checkTrue(
    "有上下文 create 注入 data.tenantId 到达查询（报错含 tenantId）",
    injectCreateErr !== null && /tenantId|tenant_id/i.test(injectCreateErr.message)
  );

  const baseRows = await service.sysConfig.findMany();
  checkTrue("基础客户端（系统级通道）不受影响，findMany 正常", Array.isArray(baseRows));

  // ── 3) withTenantContext：GUC 写入侧 ─────────────────────────────
  section("3) withTenantContext 事务 GUC（SET LOCAL 语义）");
  const inside = await service.withTenantContext("900100", async (tx) => {
    const rows = await tx.$queryRaw<Array<{ t: bigint | null }>>`
      SELECT public.app_current_tenant_id() AS t`;
    return rows[0]?.t;
  });
  check("事务内读到租户 900100", inside !== undefined ? inside.toString() : inside, "900100");

  const after = await service.$queryRaw<Array<{ t: bigint | null }>>`
    SELECT public.app_current_tenant_id() AS t`;
  check("事务外自动还原（无残留）", after[0]?.t ?? null, null);

  const badErr = await catchError(() => service.withTenantContext("not-a-number", async () => 1));
  checkTrue("非法租户 ID 被拒绝（fail-closed）", badErr !== null);

  // ── 4) RLS 机具端到端（临时表 + 非属主角色）──────────────────────
  section("4) RLS 端到端：双租户互不可见（非 superuser 角色实测）");
  await admin.query(`CREATE TABLE public.${TABLE} (id int PRIMARY KEY, tenant_id bigint NOT NULL)`);
  await admin.query(`SELECT public.app_enable_tenant_rls('public.${TABLE}'::regclass)`);
  // admin 是 superuser（绕过 RLS），直接造数：租户 1 × 2 行、租户 2 × 1 行
  await admin.query(`INSERT INTO public.${TABLE} (id, tenant_id) VALUES (1,1),(2,1),(3,2)`);
  await admin.query(`CREATE ROLE "${ROLE}" LOGIN PASSWORD '${ROLE_PASSWORD}'`);
  await admin.query(`GRANT USAGE ON SCHEMA public TO "${ROLE}"`);
  await admin.query(`GRANT SELECT, INSERT ON public.${TABLE} TO "${ROLE}"`);
  const roleUrl = `postgresql://${ROLE}:${encodeURIComponent(ROLE_PASSWORD)}@127.0.0.1:5432/peluvida_dev`;
  const probe = new PrismaClient({ adapter: new PrismaPg({ connectionString: roleUrl }) });

  try {
    const countNoGuc = await probe.$queryRawUnsafe(
      `SELECT count(*)::bigint AS c FROM public."${TABLE}"`
    );
    check("无 GUC 连接看不到任何行（fail-closed）", Number(countNoGuc[0]?.c ?? -1), 0);

    const tenant1 = await inTenant(probe, "1", async (tx) =>
      tx.$queryRawUnsafe(`SELECT count(*)::bigint AS c FROM public."${TABLE}"`)
    );
    check("租户 1 可见 2 行", Number(tenant1[0]?.c ?? -1), 2);

    const tenant2 = await inTenant(probe, "2", async (tx) =>
      tx.$queryRawUnsafe(`SELECT count(*)::bigint AS c FROM public."${TABLE}"`)
    );
    check("租户 2 只见 1 行（与租户 1 互不可见）", Number(tenant2[0]?.c ?? -1), 1);

    const insertNoGuc = await catchError(async () => {
      await probe.$executeRawUnsafe(`INSERT INTO public."${TABLE}" (id, tenant_id) VALUES (10, 2)`);
    });
    checkTrue(
      "无 GUC 写入被 RLS 拒绝",
      insertNoGuc !== null && /row-level security/i.test(insertNoGuc.message)
    );

    const insertCross = await inTenant(probe, "2", async (tx) =>
      catchError(async () => {
        await tx.$executeRawUnsafe(`INSERT INTO public."${TABLE}" (id, tenant_id) VALUES (11, 1)`);
      })
    );
    checkTrue(
      "租户 2 写租户 1 的行被 WITH CHECK 拒绝",
      insertCross !== null && /row-level security/i.test(insertCross.message)
    );

    const insertOwn = await inTenant(probe, "2", async (tx) => {
      await tx.$executeRawUnsafe(`INSERT INTO public."${TABLE}" (id, tenant_id) VALUES (12, 2)`);
      return true;
    });
    checkTrue("租户 2 写自己的行正常", insertOwn === true);
  } finally {
    await probe.$disconnect();
  }

  // ── 5) 清理与结论 ────────────────────────────────────────────────
  section("5) 清理");
  await admin.query(`DROP TABLE IF EXISTS public."${TABLE}"`);
  // DROP OWNED 撤销该角色的全部对象授权（如 schema USAGE），否则 DROP ROLE 报 2BP01
  await admin.query(`DROP OWNED BY "${ROLE}"`);
  await admin.query(`DROP ROLE IF EXISTS "${ROLE}"`);
  const leftover = await admin.query(
    `SELECT count(*)::int AS c FROM pg_tables WHERE tablename LIKE 'rls_probe_%'`
  );
  check("临时表已清理", leftover.rows[0]?.c, 0);
  await service.$disconnect();
  await admin.end();

  console.log("\n========================================================================");
  console.log(`结论：通过 ${passed} 项，失败 ${failures} 项`);
  if (failures > 0) {
    process.exitCode = 1;
    return;
  }
  console.log("✅ CROSS-09 验收标准全部满足");
}

main().catch((e) => {
  console.error("[verify-tenant-rls] 运行失败：", e);
  process.exitCode = 1;
});
