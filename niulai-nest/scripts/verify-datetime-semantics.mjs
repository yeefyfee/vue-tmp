/**
 * 日期语义回归脚本（长期保留）
 *
 * 固化 PEL-10 探明的「Prisma + PostgreSQL timestamptz」时间契约。
 * 背景：迁移前本项目是 MySQL naive `datetime` + TypeORM/mysql2，
 * 其约定是「列值 = 本地墙钟」；而 Prisma 对时间列的约定是「列值 = 瞬时」。
 * 若沿用 naive `timestamp`，读写虽然自洽，但**按天分组会按 UTC 日界切分**
 * （北京时间 01-01 07:00 会被归到 12-31），且 psql 里看到的值与预期差 8 小时。
 * 故基线统一使用 `timestamptz(3)`，并由本脚本守住以下 4 条契约。
 *
 * 只操作 sys_log，执行前后均清理，不残留数据。
 * 运行：node scripts/verify-datetime-semantics.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

function loadEnvFile(fileName) {
  const p = path.join(process.cwd(), fileName);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    if (process.env[m[1]] !== undefined) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    process.env[m[1]] = val;
  }
}
loadEnvFile(".env");
loadEnvFile(`.env.${process.env.NODE_ENV || "dev"}`);

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL 未配置");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const TZ = "Asia/Shanghai";
const MARK = "VERIFY_DATETIME_SEMANTICS";

let pass = 0;
let fail = 0;
const failures = [];

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    failures.push(label);
    console.log(`  ❌ ${label}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`);
  }
}

function fmtInTz(date, timeZone = TZ) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const g = (t) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}:${g("second")}`;
}

async function main() {
  await prisma.sysLog.deleteMany({ where: { title: MARK } });

  console.log("\n【契约 1】写入「当前瞬时」→ 读回同一瞬时（now 往返无漂移）");
  {
    const before = Date.now();
    const row = await prisma.sysLog.create({
      data: { module: 99, actionType: 99, title: MARK, createTime: new Date() },
      select: { id: true, createTime: true },
    });
    const after = Date.now();
    const t = row.createTime.getTime();
    check("读回瞬时落在写入前后区间内", t >= before - 1000 && t <= after + 1000, true);
    await prisma.$executeRawUnsafe(`DELETE FROM sys_log WHERE id = $1`, row.id);
  }

  console.log("\n【契约 2】以 +08:00 偏移写入北京时间 → 落库为正确瞬时 → 读回仍为同一北京时间");
  {
    // 关键写法：显式带偏移，不依赖进程 TZ
    const beijingNoon = new Date("2025-01-01T12:00:00+08:00");
    const row = await prisma.sysLog.create({
      data: { module: 99, actionType: 99, title: MARK, createTime: beijingNoon },
      select: { id: true, createTime: true },
    });
    const raw = await prisma.$queryRawUnsafe(
      `SELECT create_time::text AS ts, (create_time AT TIME ZONE 'UTC')::text AS utc_wall FROM sys_log WHERE id = $1`,
      row.id
    );
    check("落库瞬时（UTC 视角）", raw[0].ts, "2025-01-01 04:00:00+00");
    check("读回按北京时间格式化", fmtInTz(row.createTime), "2025-01-01 12:00:00");
    check("读回按 UTC 格式化（应差 8 小时）", fmtInTz(row.createTime, "UTC"), "2025-01-01 04:00:00");
    await prisma.$executeRawUnsafe(`DELETE FROM sys_log WHERE id = $1`, row.id);
  }

  console.log("\n【契约 3】北京时间整日区间筛选能命中当日数据（含 23:59:59 边界）");
  {
    const rows = [];
    for (const wall of ["2025-01-01T00:00:00+08:00", "2025-01-01T23:59:59+08:00"]) {
      rows.push(
        await prisma.sysLog.create({
          data: { module: 99, actionType: 99, title: MARK, createTime: new Date(wall) },
          select: { id: true },
        })
      );
    }
    // 昨日 23:59:59（北京时间）应被排除
    const outside = await prisma.sysLog.create({
      data: {
        module: 99,
        actionType: 99,
        title: MARK,
        createTime: new Date("2024-12-31T23:59:59+08:00"),
      },
      select: { id: true },
    });

    const hit = await prisma.sysLog.count({
      where: {
        title: MARK,
        createTime: {
          gte: new Date("2025-01-01T00:00:00+08:00"),
          lte: new Date("2025-01-01T23:59:59.999+08:00"),
        },
      },
    });
    check("命中当日 2 条（不含昨日 23:59:59）", hit, 2);
    await prisma.$executeRawUnsafe(
      `DELETE FROM sys_log WHERE id = ANY($1::bigint[])`,
      [...rows.map((r) => r.id), outside.id]
    );
  }

  console.log("\n【契约 4】按天分组必须带 AT TIME ZONE，否则按 UTC 日界切分（跨日样本会被归错天）");
  {
    // 北京时间 2025-01-01 07:00 = UTC 2024-12-31 23:00 —— 正是日界陷阱样本
    const tricky = await prisma.sysLog.create({
      data: {
        module: 99,
        actionType: 99,
        title: MARK,
        createTime: new Date("2025-01-01T07:00:00+08:00"),
      },
      select: { id: true },
    });

    const naive = await prisma.$queryRawUnsafe(
      `SELECT to_char(create_time, 'YYYY-MM-DD') AS day FROM sys_log WHERE id = $1`,
      tricky.id
    );
    const withTz = await prisma.$queryRawUnsafe(
      `SELECT to_char(create_time AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS day FROM sys_log WHERE id = $1`,
      tricky.id
    );

    check("裸 to_char（UTC 日界）→ 归到前一天", naive[0].day, "2024-12-31");
    check("带 AT TIME ZONE → 正确归到北京日", withTz[0].day, "2025-01-01");
    await prisma.$executeRawUnsafe(`DELETE FROM sys_log WHERE id = $1`, tricky.id);
  }

  // 清理并确认无残留
  const residue = await prisma.sysLog.count({ where: { title: MARK } });
  check("探针数据已清理干净", residue, 0);

  await prisma.$disconnect();
}

main()
  .catch((e) => {
    console.error("VERIFY_FAILED", e);
    process.exitCode = 1;
  })
  .finally(() => {
    console.log(`\n================ 日期语义验证：${pass} 通过 / ${fail} 失败 ================`);
    if (failures.length) console.log("失败用例:\n  - " + failures.join("\n  - "));
    if (fail) process.exitCode = 1;
  });
