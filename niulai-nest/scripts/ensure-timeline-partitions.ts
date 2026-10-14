/**
 * timeline_event 分区预建脚本（幂等）—— P0-06-01 子任务
 * ============================================================
 * 职责：确保「当月 + 下月」月分区存在，缺则按 UTC 月界补建；
 *       DEFAULT 兜底分区缺失时一并补建（防御迁移未跑全的极端情况）。
 *
 * 幂等性：先查系统目录（pg_inherits / pg_class.relpartbound），已覆盖目标月的
 *         分区（无论名字）直接跳过 ⇒ 重复运行零副作用、零报错。
 *
 * 定时调度：独立脚本 + package.json scripts 登记（timeline:ensure-partitions），
 *         由外部调度（cron / CI / CROSS-21 任务框架）周期调用即可。
 *
 * DEFAULT 重叠固有约束（迁移注释）：DEFAULT 分区已有落在目标月范围的数据时，
 * 直接建月分区会因范围重叠失败。本脚本检测到该情况即**报错退出并告警**，
 * 不自动搬数据——搬移（DETACH / 转移 / ATTACH）属 CROSS-21 归档流程的职责。
 *
 * 用法：
 *   node ./node_modules/ts-node/dist/bin.js -r tsconfig-paths/register \
 *     scripts/ensure-timeline-partitions.ts [--months=N]   # N≥1，默认 2（当月+下月）
 */
import type { Client } from "pg";
import {
  TIMELINE_DEFAULT_PARTITION,
  TIMELINE_PARENT_TABLE,
  connectTimeline,
  countDefaultRowsInRange,
  currentMonthUtc,
  DATABASE_URL,
  findPartitionCovering,
  listTimelinePartitions,
  log,
  addMonths,
  alert,
  monthKey,
  monthRangeUtc,
  partitionName,
} from "./timeline-partition-lib";

const SCOPE = "ensure-timeline-partitions";

/** 解析 --months=N 参数（默认 2：当月 + 下月） */
function resolveMonthsFromArgv(): number {
  const hit = process.argv.find((a) => a.startsWith("--months="));
  if (!hit) return 2;
  const n = Number(hit.split("=")[1]);
  if (!Number.isInteger(n) || n < 1 || n > 24) {
    throw new Error(`非法 --months 参数「${hit}」，期望 1~24 的整数`);
  }
  return n;
}

/** 确认父表确为声明式分区表（防误连库 / 迁移未应用的脏环境） */
async function assertPartitionedParent(client: Client): Promise<void> {
  const res = await client.query<{ relkind: string | null }>(
    `SELECT relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = $1`,
    [TIMELINE_PARENT_TABLE]
  );
  if (res.rows.length === 0) {
    throw new Error(`表 ${TIMELINE_PARENT_TABLE} 不存在——请先执行 prisma migrate deploy`);
  }
  if (res.rows[0].relkind !== "p") {
    throw new Error(
      `表 ${TIMELINE_PARENT_TABLE} 存在但 relkind=${res.rows[0].relkind}（非分区父表 'p'），环境不符`
    );
  }
}

/** 幂等预建目标月份的月分区 */
async function ensureMonthPartition(
  client: Client,
  ym: { year: number; month: number }
): Promise<"exists" | "created"> {
  const partitions = await listTimelinePartitions(client);
  const existing = findPartitionCovering(partitions, ym);
  if (existing) {
    log(SCOPE, `跳过 ${monthKey(ym)}：既有分区 ${existing.name} 已覆盖目标范围`);
    return "exists";
  }

  // DEFAULT 重叠检查：有数据 ⇒ 不自动搬移，报错并告警（CROSS-21 职责）
  const stranded = await countDefaultRowsInRange(client, ym);
  if (stranded > 0) {
    alert(
      SCOPE,
      `DEFAULT 分区内有 ${stranded} 行落在 ${monthKey(ym)} 范围，须先搬移（DETACH/转移/ATTACH，` +
        `见迁移 20261007150000 注释）后才能建月分区。本脚本不自动搬数据，流程归 CROSS-21。`
    );
    throw new Error(
      `DEFAULT 分区与 ${monthKey(ym)} 目标范围存在数据重叠（${stranded} 行），中止建分区`
    );
  }

  const name = partitionName(ym);
  const range = monthRangeUtc(ym);
  log(SCOPE, `建分区 ${name} FOR VALUES FROM ('${range.fromIso}') TO ('${range.toIso}')`);
  await client.query(
    `CREATE TABLE "${name}" PARTITION OF "${TIMELINE_PARENT_TABLE}"
      FOR VALUES FROM ('${range.fromIso}') TO ('${range.toIso}')`
  );
  return "created";
}

/** 单次 ensure 运行的结果摘要（verify 脚本进程内调用时用于断言） */
export interface EnsureResult {
  /** 每个目标月份的处理结果 */
  months: Array<{ month: string; outcome: "exists" | "created" }>;
  /** 终检缺失项数量（0 = 全部覆盖） */
  missing: number;
}

/**
 * ensure 核心逻辑（可进程内复用；CLI 入口见文件底部 main）。
 * 幂等：重复调用零副作用。verify-timeline-partitions 直接调用本函数
 * （Windows 沙箱禁 spawn 子进程），与 CLI 路径共享同一份实现。
 */
export async function ensureTimelinePartitions(
  client: Client,
  months: number
): Promise<EnsureResult> {
  await assertPartitionedParent(client);

  // DEFAULT 兜底分区防御性补建（正常已由迁移创建）
  const partitions = await listTimelinePartitions(client);
  if (!partitions.some((p) => p.isDefault)) {
    log(SCOPE, `DEFAULT 兜底分区缺失，补建 ${TIMELINE_DEFAULT_PARTITION}`);
    await client.query(
      `CREATE TABLE "${TIMELINE_DEFAULT_PARTITION}" PARTITION OF "${TIMELINE_PARENT_TABLE}" DEFAULT`
    );
  }

  // 预建当月起连续 months 个月的月分区（默认：当月 + 下月）
  const current = currentMonthUtc();
  const outcomes: EnsureResult["months"] = [];
  for (let i = 0; i < months; i += 1) {
    const ym = addMonths(current, i);
    const outcome = await ensureMonthPartition(client, ym);
    outcomes.push({ month: monthKey(ym), outcome });
  }

  // 终检：目标月份全部被覆盖 + DEFAULT 存在
  const after = await listTimelinePartitions(client);
  let missing = 0;
  for (let i = 0; i < months; i += 1) {
    const ym = addMonths(current, i);
    if (!findPartitionCovering(after, ym)) {
      alert(SCOPE, `终检失败：${monthKey(ym)} 仍无覆盖分区`);
      missing += 1;
    }
  }
  if (!after.some((p) => p.isDefault)) missing += 1;

  // 断档哨兵：DEFAULT 里出现「未来月份」的行 = 曾发生断档，数据滞留兜底分区
  const futureEdge = monthRangeUtc(addMonths(current, months));
  const stranded = await client.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM ${TIMELINE_DEFAULT_PARTITION} WHERE event_time >= $1`,
    [futureEdge.fromIso]
  );
  if (Number(stranded.rows[0].c) > 0) {
    alert(
      SCOPE,
      `DEFAULT 分区滞留 ${stranded.rows[0].c} 行未来数据（>= ${futureEdge.fromIso}），` +
        `历史上发生过断档，需人工核实并纳入归档（CROSS-21/22）。`
    );
  }

  log(
    SCOPE,
    `完成：${months} 个月份覆盖校验通过（缺 ${missing} 项），当前分区：` +
      after.map((p) => p.name).join(", ")
  );
  return { months: outcomes, missing };
}

async function main(): Promise<void> {
  const months = resolveMonthsFromArgv();
  log(SCOPE, `连接 ${DATABASE_URL.replace(/:[^:@/]+@/, ":***@")}`);
  const client = await connectTimeline();
  try {
    const result = await ensureTimelinePartitions(client, months);
    if (result.missing > 0) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

/** 直接执行时才跑 CLI 入口（被 import 时不产生副作用） */
if (require.main === module) {
  main().catch((e) => {
    console.error(`[${SCOPE}] 脚本异常终止：`, e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
