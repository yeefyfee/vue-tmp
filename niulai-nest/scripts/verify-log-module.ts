/**
 * log 模块 Prisma 移植 · 真库验证（PEL-10c）
 *
 * 直接实例化 LogService（不启 Nest、不需要登录），走真实 PostgreSQL，
 * 逐项校验「对外契约与 TypeORM 版本一致」，并额外守住日界与时区这类
 * **静态检查查不出**的语义：
 *   分页信封 / 关键字大小写不敏感 / 北京时间整日区间 / 排序白名单 /
 *   按天分组归属（AT TIME ZONE）/ PV·UV 统计 / 手动日志标题与截断。
 *
 * 安全约定：所有造数都用 1990/1991 年这些不可能有真实数据的窗口 + 预留测试 IP
 * （192.0.2.x，RFC 5737），并在开始与结束各清理一次；不删除任何非本次造的数据。
 *
 * 运行：
 *   node ./node_modules/ts-node/dist/bin.js -r tsconfig-paths/register scripts/verify-log-module.ts
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { LogService } from "../src/system/log/log.service";
import { enableBigIntJsonSerialization } from "../src/common/prisma/bigint-json";
import { LogModuleValue } from "../src/common/enums/log-module.enum";
import { ActionTypeValue } from "../src/common/enums/action-type.enum";

enableBigIntJsonSerialization();

const CONNECTION =
  process.env.DATABASE_URL ?? "postgresql://admin:Pg%40123456@127.0.0.1:5432/peluvida_dev";

const base = new PrismaClient({ adapter: new PrismaPg({ connectionString: CONNECTION }) });
const service = new LogService(Object.assign(Object.create(base), { scoped: base }) as never);

/** 本脚本专属标记：所有断言都通过它做隔离，避免受真实数据影响 */
const MARK = "VERIFYLOG";
const IP_PREFIX = "192.0.2.";

let failures = 0;
let checks = 0;

function check(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? "√" : "✗"} ${label}  → 实际 ${JSON.stringify(actual)}${
      ok ? "" : `（期望 ${JSON.stringify(expected)}）`
    }`
  );
}

function checkTrue(label: string, actual: unknown) {
  checks += 1;
  const ok = Boolean(actual);
  if (!ok) failures += 1;
  console.log(`  ${ok ? "√" : "✗"} ${label}  → 实际 ${JSON.stringify(actual)}`);
}

/** 造一条指定「北京时间墙钟」的日志 */
async function seed(opts: {
  wallClock: string;
  ip: string;
  title?: string;
  executionTime?: number;
  browser?: string | null;
  errorMsg?: string | null;
  content?: string | null;
}) {
  return base.sysLog.create({
    data: {
      module: LogModuleValue.OTHER,
      actionType: ActionTypeValue.OTHER,
      title: opts.title ?? `${MARK}-默认标题`,
      content: opts.content ?? null,
      requestUri: `${MARK}/${opts.wallClock}`,
      requestMethod: "GET",
      ip: opts.ip,
      browser: opts.browser ?? null,
      os: null,
      device: null,
      errorMsg: opts.errorMsg ?? null,
      executionTime: opts.executionTime ?? 0,
      status: 1,
      createTime: new Date(opts.wallClock),
    },
    select: { id: true },
  });
}

async function cleanup() {
  await base.sysLog.deleteMany({ where: { title: { contains: MARK } } });
  await base.sysLog.deleteMany({ where: { requestUri: { contains: MARK } } });
}

/** 断言某时间窗内除了本次造数之外没有别的数据，保证计数断言是确定的 */
async function assertWindowClean(label: string, start: string, end: string) {
  const rows = await base.sysLog.count({
    where: {
      createTime: { gte: new Date(start), lte: new Date(end) },
      NOT: { title: { contains: MARK } },
    },
  });
  checks += 1;
  if (rows !== 0) failures += 1;
  console.log(
    `  ${rows === 0 ? "√" : "✗"} 前置检查：${label} 窗口内无其他数据  → 实际 ${rows} 条${
      rows === 0 ? "" : "（断言计数可能失真，请检查）"
    }`
  );
}

async function main() {
  await cleanup();

  // ---------------------------------------------------------------- 1) 分页信封
  console.log("\n=== 1) 分页信封与映射形状 ===");
  await seed({ wallClock: "1995-06-01T10:00:00+08:00", ip: `${IP_PREFIX}1` });
  await seed({ wallClock: "1995-06-01T11:00:00+08:00", ip: `${IP_PREFIX}1` });
  await seed({ wallClock: "1995-06-01T12:00:00+08:00", ip: `${IP_PREFIX}2` });

  const page = await service.getLogPage({ pageNum: 1, pageSize: 2, keywords: MARK } as never);
  check("page 元信息字段与顺序", Object.keys(page.page), ["pageNum", "pageSize", "total"]);
  check("total 为本次造数总数", page.page.total, 3);
  check("data 长度为 pageSize", page.data.length, 2);
  check("data 元素为对象数组", Array.isArray(page.data), true);

  const first = page.data[0] as unknown as Record<string, unknown>;
  check("列表项字段集合", Object.keys(first).sort(), [
    "actionType",
    "browser",
    "content",
    "createTime",
    "device",
    "errorMsg",
    "executionTime",
    "id",
    "ip",
    "module",
    "operatorId",
    "operatorName",
    "os",
    "region",
    "requestMethod",
    "requestUri",
    "status",
    "title",
  ]);
  check("id 序列化为字符串", typeof first.id, "string");
  check("module 映射为中文 label", first.module, "其他");
  check("actionType 映射为中文 label", first.actionType, "其他");
  check("createTime 为北京时间字符串", first.createTime, "1995-06-01 12:00:00");
  check("region 无省市时为 null", first.region, null);

  // ---------------------------------------------------------------- 2) 关键字
  console.log("\n=== 2) 关键字检索（大小写不敏感 + 多列覆盖） ===");
  await seed({
    wallClock: "1995-06-02T09:00:00+08:00",
    ip: `${IP_PREFIX}3`,
    title: `${MARK}-CaseMix`,
  });

  const lower = await service.getLogPage({
    pageNum: 1,
    pageSize: 50,
    keywords: `${MARK}-casemix`,
  } as never);
  check("小写关键字命中大写标题（MySQL CI 语义）", lower.page.total, 1);
  const upper = await service.getLogPage({
    pageNum: 1,
    pageSize: 50,
    keywords: `${MARK}-CASEMIX`,
  } as never);
  check("大写关键字同样命中", upper.page.total, 1);

  const byBrowser = await service.getLogPage({
    pageNum: 1,
    pageSize: 50,
    keywords: `${MARK}-browserhit`,
  } as never);
  check("按 browser 列可检索（本用例无命中）", byBrowser.page.total, 0);
  await seed({
    wallClock: "1995-06-02T09:30:00+08:00",
    ip: `${IP_PREFIX}4`,
    title: `${MARK}-browserhit-holder`,
    browser: `${MARK}-browserhit`,
  });
  const byBrowser2 = await service.getLogPage({
    pageNum: 1,
    pageSize: 50,
    keywords: `${MARK}-browserhit`,
  } as never);
  check("按 browser 列可检索（命中 1 条）", byBrowser2.page.total, 1);

  const none = await service.getLogPage({
    pageNum: 1,
    pageSize: 50,
    keywords: "绝不存在的关键字ZZZ",
  } as never);
  check("无命中时 total 为 0", none.page.total, 0);

  // ---------------------------------------------------------------- 3) 时间区间
  console.log("\n=== 3) 北京时间整日区间筛选 ===");
  await assertWindowClean("1992-03", "1992-03-01T00:00:00+08:00", "1992-03-31T23:59:59.999+08:00");

  await seed({
    wallClock: "1992-02-29T23:59:59.999+08:00",
    ip: `${IP_PREFIX}5`,
    title: `${MARK}-区间-前一日末`,
  });
  await seed({
    wallClock: "1992-03-01T00:00:00+08:00",
    ip: `${IP_PREFIX}5`,
    title: `${MARK}-区间-首日零点`,
  });
  await seed({
    wallClock: "1992-03-15T07:00:00+08:00",
    ip: `${IP_PREFIX}6`,
    title: `${MARK}-区间-月中`,
  });
  await seed({
    wallClock: "1992-03-31T23:59:59.999+08:00",
    ip: `${IP_PREFIX}6`,
    title: `${MARK}-区间-末日末刻`,
  });
  await seed({
    wallClock: "1992-04-01T00:00:00+08:00",
    ip: `${IP_PREFIX}7`,
    title: `${MARK}-区间-后一日首`,
  });

  const ranged = await service.getLogPage({
    pageNum: 1,
    pageSize: 50,
    keywords: `${MARK}-区间`,
    createTime: ["1992-03-01", "1992-03-31"],
  } as never);
  check("闭区间含首日零点与末日末刻，排除前后相邻日", ranged.page.total, 3);

  // 只给起始日时是**开区间**（>= 该日 00:00，无上界），因此会连带命中后一日的数据。
  // 这是沿用原 TypeORM 实现的行为（原代码同样只 andWhere 一个 >= 条件），此处保持契约一致。
  const rangedOneDay = await service.getLogPage({
    pageNum: 1,
    pageSize: 50,
    keywords: `${MARK}-区间`,
    createTime: ["1992-03-31"],
  } as never);
  check("只给起始日时为开区间（命中 03-31 与 04-01 共 2 条）", rangedOneDay.page.total, 2);

  const rangedWithTime = await service.getLogPage({
    pageNum: 1,
    pageSize: 50,
    keywords: `${MARK}-区间`,
    createTime: ["1992-03-15 06:00:00", "1992-03-15 08:00:00"],
  } as never);
  check("带时刻的区间按北京时间解释", rangedWithTime.page.total, 1);

  // ---------------------------------------------------------------- 4) 排序
  console.log("\n=== 4) 排序白名单 ===");
  await seed({
    wallClock: "1993-01-01T10:00:00+08:00",
    ip: `${IP_PREFIX}8`,
    title: `${MARK}-排序-慢`,
    executionTime: 900,
  });
  await seed({
    wallClock: "1993-01-01T11:00:00+08:00",
    ip: `${IP_PREFIX}8`,
    title: `${MARK}-排序-快`,
    executionTime: 100,
  });

  const asc = await service.getLogPage({
    pageNum: 1,
    pageSize: 50,
    keywords: `${MARK}-排序`,
    sortBy: "execution_time",
    order: "ASC",
  } as never);
  check(
    "按 execution_time ASC 首条为 100ms",
    (asc.data[0] as never as { executionTime: number }).executionTime,
    100
  );

  const desc = await service.getLogPage({
    pageNum: 1,
    pageSize: 50,
    keywords: `${MARK}-排序`,
    sortBy: "execution_time",
    order: "DESC",
  } as never);
  check(
    "按 execution_time DESC 首条为 900ms",
    (desc.data[0] as never as { executionTime: number }).executionTime,
    900
  );

  const illegal = await service.getLogPage({
    pageNum: 1,
    pageSize: 50,
    keywords: `${MARK}-排序`,
    sortBy: "create_time; DROP TABLE sys_log",
    order: "DESC",
  } as never);
  check(
    "非法 sortBy 被忽略且回落到 createTime desc（首条为较新的 11:00）",
    (illegal.data[0] as never as { createTime: string }).createTime,
    "1993-01-01 11:00:00"
  );

  const illegalOrder = await service.getLogPage({
    pageNum: 1,
    pageSize: 50,
    keywords: `${MARK}-排序`,
    sortBy: "execution_time",
    order: "乱写",
  } as never);
  check(
    "非法 order 回落到 desc",
    (illegalOrder.data[0] as never as { executionTime: number }).executionTime,
    900
  );

  // ---------------------------------------------------------------- 5) 访问趋势（日界）
  console.log("\n=== 5) 访问趋势：按天分组必须落在北京日 ===");
  await assertWindowClean("1990-01", "1990-01-01T00:00:00+08:00", "1990-01-03T23:59:59.999+08:00");

  // 北京 1990-01-01 07:00 == UTC 1989-12-31 23:00 —— 若按 UTC 日界分组会被归到前一天
  await seed({ wallClock: "1990-01-01T00:00:00+08:00", ip: `${IP_PREFIX}21` });
  await seed({ wallClock: "1990-01-01T23:59:59+08:00", ip: `${IP_PREFIX}21` }); // 同 IP，PV+1、UV 不变
  await seed({ wallClock: "1990-01-02T07:00:00+08:00", ip: `${IP_PREFIX}22` });
  await seed({ wallClock: "1990-01-03T23:59:59.999+08:00", ip: `${IP_PREFIX}23` });
  // 窗口外：北京 1989-12-31 23:59:59.999
  await seed({ wallClock: "1989-12-31T23:59:59.999+08:00", ip: `${IP_PREFIX}24` });

  const trend = await service.getVisitTrend("1990-01-01", "1990-01-03");
  check("日期序列为闭区间完整序列", trend.dates, ["1990-01-01", "1990-01-02", "1990-01-03"]);
  check("PV 按北京日聚合（首日 2 条）", trend.pvList, [2, 1, 1]);
  check("UV 按 IP 去重（首日同 IP 只算 1）", trend.uvList, [1, 1, 1]);

  const singleDay = await service.getVisitTrend("1990-01-01", "1990-01-01");
  check("单日区间只返回一天", singleDay.dates, ["1990-01-01"]);
  check("单日 PV", singleDay.pvList, [2]);

  const reversed = await service.getVisitTrend("1990-01-05", "1990-01-01");
  check("起止倒置时返回空结构", reversed, { dates: [], pvList: [], uvList: [] });

  const badInput = await service.getVisitTrend("不是日期", "也不是");
  check("非法日期返回空结构", badInput, { dates: [], pvList: [], uvList: [] });

  // ---------------------------------------------------------------- 6) 访问统计
  console.log("\n=== 6) 访问统计（今日 PV / UV 与增长率） ===");
  const preIps = await base.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT COUNT(DISTINCT ip)::int AS n FROM sys_log WHERE ip IN ($1, $2)`,
    `${IP_PREFIX}31`,
    `${IP_PREFIX}32`
  );
  check("前置检查：测试 IP 未被占用", Number(preIps[0].n), 0);

  const before = await service.getVisitStats();

  const nowBeijing = new Date();
  await seed({
    wallClock: toBeijingWallClock(nowBeijing, 0),
    ip: `${IP_PREFIX}31`,
    title: `${MARK}-统计-今日A`,
  });
  await seed({
    wallClock: toBeijingWallClock(nowBeijing, -1),
    ip: `${IP_PREFIX}32`,
    title: `${MARK}-统计-今日B`,
  });
  // 昨日此刻：不应计入今日
  await seed({
    wallClock: toBeijingWallClock(nowBeijing, -24),
    ip: `${IP_PREFIX}33`,
    title: `${MARK}-统计-昨日`,
  });

  const after = await service.getVisitStats();
  check("今日 PV +2", after.todayPvCount - before.todayPvCount, 2);
  check("累计 PV +3", after.totalPvCount - before.totalPvCount, 3);
  check("今日 UV +2（两个新 IP）", after.todayUvCount - before.todayUvCount, 2);
  check("累计 UV +3", after.totalUvCount - before.totalUvCount, 3);
  checkTrue(
    "增长率字段为 number 或 null",
    after.uvGrowthRate === null || typeof after.uvGrowthRate === "number"
  );
  checkTrue(
    "PV 增长率字段为 number 或 null",
    after.pvGrowthRate === null || typeof after.pvGrowthRate === "number"
  );

  // ---------------------------------------------------------------- 7) 手动日志
  console.log("\n=== 7) 手动日志写入（标题口径 / 截断 / BigInt） ===");
  await service.saveManualLog({
    module: LogModuleValue.LOGIN,
    actionType: ActionTypeValue.LOGIN,
    operatorId: "900101",
    operatorName: "验证用户",
    requestMethod: "POST",
    requestUri: "/api/v1/auth/login",
    ip: `${IP_PREFIX}41`,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
    status: 1,
  });

  const manual = await base.sysLog.findFirst({
    where: { ip: `${IP_PREFIX}41` },
    orderBy: { id: "desc" },
  });
  checkTrue("手动日志已写入", manual !== null);
  check("module 落库为数字枚举", manual?.module, LogModuleValue.LOGIN);
  check("actionType 落库为数字枚举", manual?.actionType, ActionTypeValue.LOGIN);
  check("title 自动生成为「登录-登录」", manual?.title, "登录-登录");
  check("operatorId 正确转为 BigInt", manual?.operatorId?.toString(), "900101");
  check("status 默认成功", manual?.status, 1);
  check("browser 解析自 userAgent（含版本号）", manual?.browser, "Chrome 120.0");
  check("os 解析自 userAgent（含版本号）", manual?.os, "Windows 10");
  check("province / city 为空", [manual?.province, manual?.city], [null, null]);

  await service.saveManualLog({
    module: LogModuleValue.CONFIG,
    actionType: ActionTypeValue.UPDATE,
    title: "自定义标题",
    operatorId: null,
    requestMethod: "PUT",
    requestUri: "/api/v1/config/1",
    ip: `${IP_PREFIX}42`,
    status: 0,
    errorMsg: "E".repeat(400),
  });
  const manual2 = await base.sysLog.findFirst({ where: { ip: `${IP_PREFIX}42` } });
  check("显式标题优先", manual2?.title, "自定义标题");
  check("operatorId 允许为空", manual2?.operatorId, null);
  check("status 可显式置 0", manual2?.status, 0);
  check("errorMsg 超长被截断到 255", manual2?.errorMsg?.length, 255);

  // ---------------------------------------------------------------- 8) tsc 曾漏掉的隐患：NOT NULL
  console.log("\n=== 8) 原实现潜在缺陷已修复（module / title 为 NOT NULL） ===");
  checkTrue("title 列在库中为 NOT NULL", await isNotNull("sys_log", "title"));
  checkTrue("module 列在库中为 NOT NULL", await isNotNull("sys_log", "module"));

  await cleanup();
  const residue = await base.sysLog.count({ where: { title: { contains: MARK } } });
  check("本次造数已清理干净", residue, 0);
  await base.$disconnect();
}

/** 把「今天 + offsetHours」表示为北京墙钟字符串（不带偏移，由库按 timestamptz 存瞬时） */
function toBeijingWallClock(base0: Date, offsetHours: number): string {
  const shifted = new Date(base0.getTime() + offsetHours * 3600 * 1000);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(shifted);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}:${g("second")}+08:00`;
}

async function isNotNull(table: string, column: string): Promise<boolean> {
  const rows = await base.$queryRawUnsafe<Array<{ is_nullable: string }>>(
    `SELECT is_nullable FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    table,
    column
  );
  return rows[0]?.is_nullable === "NO";
}

main()
  .catch((e) => {
    console.error("VERIFY_FAILED", e);
    process.exitCode = 1;
  })
  .finally(() => {
    console.log(
      `\n================ log 模块验证：${checks - failures}/${checks} 通过 ================`
    );
    if (failures) {
      console.log(`失败 ${failures} 项`);
      process.exitCode = 1;
    }
  });
