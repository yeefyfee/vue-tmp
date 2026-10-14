/**
 * timeline_event 分区滚动维护 · 真库验证（P0-06-01 子任务）
 * ============================================================
 * 断言计数式输出（对齐 verify-audit-partitions 风格），覆盖验收标准：
 *   ① 当月 + 下月分区存在（ensure-timeline-partitions 幂等预建，重跑安全）；
 *   ② 向当月 / 下月各插一条测试事件，分别落到对应月分区（非 DEFAULT，
 *      以 tableoid::regclass 实证路由）；
 *   ③ 复合主键与分区键实证：pg_constraint 读出 (id, event_time) 复合主键，
 *      pg_class.relispartition 核实三分区均为真实分区；
 *   ④ 断档模拟：临时 DETACH 下月分区 → 跨月写入落 DEFAULT 且不报错 → 恢复
 *      （ATTACH 回去）；
 *   ⑤ 幂等重跑 ensure 零副作用；
 *   ⑥ timeline 无拦改删触发器（与 audit_log 的差异）：UPDATE/DELETE 直通，
 *      测试行直接 DELETE 清理（顺带实证「允许修正」语义）。
 *
 * 无脏状态承诺：测试行以 pet_id 哨兵 uuid 隔离，结束前全部 DELETE，
 * 临时 DETACH 的分区 ATTACH 回原位，退出前逐项断言库内无残留。
 *
 * 运行：
 *   node ./node_modules/ts-node/dist/bin.js -r tsconfig-paths/register scripts/verify-timeline-partitions.ts
 */
import {
  addMonths,
  TIMELINE_DEFAULT_PARTITION,
  TIMELINE_PARENT_TABLE,
  connectTimeline,
  currentMonthUtc,
  findPartitionByName,
  listTimelinePartitions,
  log,
  monthKey,
  monthRangeUtc,
  partitionName,
} from "./timeline-partition-lib";
import { ensureTimelinePartitions } from "./ensure-timeline-partitions";
import type { Client } from "pg";

const SCOPE = "verify-timeline-partitions";
/** 测试行隔离标记（cleanup 按哨兵 pet_id 精确清扫） */
const VERIFY_PET_ID = "00000000-0000-4000-8000-000000000ce4";
/** 本次运行的唯一 content 标记（防跨次残留误判） */
const RUN_ID = `vt${Date.now()}`;

/**
 * 以进程内调用方式运行 ensure（与 CLI 路径共享同一份实现；
 * Windows 沙箱禁 spawn 子进程，故不走 execSync）。
 */
async function runEnsure(roundLabel: string): Promise<void> {
  const result = await ensureTimelinePartitions(client, 2);
  log(
    SCOPE,
    `${roundLabel} 运行成功（missing=${result.missing}，` +
      `${result.months.map((m) => `${m.month}:${m.outcome}`).join(", ")}）`
  );
}

/** verify 独享的共享连接（runEnsure 等进程内调用复用，避免多连接语义分叉） */
let client: Client;

let passed = 0;
let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed += 1;
  else failures += 1;
  console.log(
    `  ${ok ? "√" : "✗"} ${label}  → 实际 ${JSON.stringify(actual)}${ok ? "" : `（期望 ${JSON.stringify(expected)}）`}`
  );
}

function checkTrue(label: string, cond: boolean): void {
  if (cond) passed += 1;
  else failures += 1;
  console.log(`  ${cond ? "√" : "✗"} ${label}`);
}

function section(title: string): void {
  console.log(`\n${title}`);
}

/** 插入一条测试时间线事件，返回其落在的分区名（tableoid::regclass 实证路由） */
async function insertProbe(client: Client, eventTimeIso: string): Promise<string> {
  const res = await client.query<{ part: string; id: string }>(
    `INSERT INTO ${TIMELINE_PARENT_TABLE}
        (tenant_id, pet_id, event_type, content, event_time)
     VALUES (0, $1, 8, $2, $3)
     RETURNING tableoid::regclass::text AS part, id::text AS id`,
    [VERIFY_PET_ID, RUN_ID, eventTimeIso]
  );
  return res.rows[0].part;
}

/** 删除测试行（timeline 无拦改删触发器，直接 DELETE——顺带实证「允许修正」语义） */
async function deleteProbes(client: Client, extraWhere = ""): Promise<number> {
  const res = await client.query(
    `DELETE FROM ${TIMELINE_PARENT_TABLE} WHERE pet_id = $1${extraWhere}`,
    [VERIFY_PET_ID]
  );
  return res.rowCount ?? 0;
}

/** 读分区父表的复合主键列清单（分区表主键必须含分区键的实证） */
async function primaryKeyColumns(client: Client): Promise<string[]> {
  const res = await client.query<{ col: string }>(
    `SELECT a.attname AS col
       FROM pg_index i
       JOIN pg_class c ON c.oid = i.indrelid
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
      WHERE c.relname = $1 AND i.indisprimary
      ORDER BY a.attnum`,
    [TIMELINE_PARENT_TABLE]
  );
  return res.rows.map((r) => r.col);
}

/** 核实表为真实分区（relispartition） */
async function isPartition(client: Client, table: string): Promise<boolean> {
  const res = await client.query<{ relispartition: boolean }>(
    `SELECT relispartition FROM pg_class WHERE relname = $1`,
    [table]
  );
  return res.rows[0]?.relispartition === true;
}

/** 查询某表上的行级触发器残留（timeline 明确不建拦改删触发器，应为 0） */
async function rowTriggerCount(client: Client, table: string): Promise<number> {
  const res = await client.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM pg_trigger
      WHERE tgrelid = $1::regclass AND NOT tgisinternal`,
    [table]
  );
  return Number(res.rows[0].c);
}

async function main(): Promise<void> {
  console.log("=".repeat(72));
  console.log("P0-06-01 子任务 · timeline_event 分区 · 真库验证");
  console.log("=".repeat(72));

  client = await connectTimeline();
  const current = currentMonthUtc();
  const next = addMonths(current, 1);
  const curPart = partitionName(current);
  const nextPart = partitionName(next);
  const nextRange = monthRangeUtc(next);
  log(SCOPE, `当月 ${monthKey(current)}（${curPart}）/ 下月 ${monthKey(next)}（${nextPart}）`);

  try {
    // ────────────────────────────────────────────────────────────────
    section("① ensure 幂等预建：当月 + 下月分区存在（relispartition 实证）");
    const before = await listTimelinePartitions(client);
    checkTrue(
      "timeline_event 为分区父表且已有分区（迁移 20261007150000 已应用）",
      before.length >= 1
    );

    for (const round of [1, 2]) {
      await runEnsure(`ensure 第 ${round} 次`);
    }
    const afterEnsure = await listTimelinePartitions(client);
    checkTrue("当月分区存在", Boolean(findPartitionByName(afterEnsure, curPart)));
    checkTrue("下月分区存在", Boolean(findPartitionByName(afterEnsure, nextPart)));
    checkTrue(
      "DEFAULT 兜底分区存在",
      afterEnsure.some((p) => p.isDefault)
    );
    check(
      "幂等重跑：分区集合零增量（无多余分区被建出）",
      afterEnsure.map((p) => p.name),
      before.map((p) => p.name)
    );
    checkTrue("当月分区 relispartition=true（真实分区）", await isPartition(client, curPart));
    checkTrue("下月分区 relispartition=true（真实分区）", await isPartition(client, nextPart));
    check(
      "分区表主键为复合主键 (id, event_time)（含分区键）",
      (await primaryKeyColumns(client)).sort(),
      ["event_time", "id"].sort()
    );
    check(
      "分区父表无行级触发器（无拦改删触发器，允许修正）",
      await rowTriggerCount(client, TIMELINE_PARENT_TABLE),
      0
    );

    // ────────────────────────────────────────────────────────────────
    section("② 跨月写入路由：当月 / 下月各一条，均落对应月分区（非 DEFAULT）");
    const curProbe = await insertProbe(client, new Date().toISOString());
    check("当月写入 → 落当月分区", curProbe, curPart);
    const nextMid = new Date(nextRange.fromMs + 14 * 24 * 3600 * 1000).toISOString();
    const nextProbe = await insertProbe(client, nextMid);
    check("下月写入 → 落下月分区", nextProbe, nextPart);
    checkTrue(
      "两条测试行均未落 DEFAULT 兜底",
      curProbe !== TIMELINE_DEFAULT_PARTITION && nextProbe !== TIMELINE_DEFAULT_PARTITION
    );

    // ────────────────────────────────────────────────────────────────
    section("③ 允许修正语义实证：UPDATE 直通（无触发器拦截）");
    let updateError = "";
    try {
      await client.query(
        `UPDATE ${TIMELINE_PARENT_TABLE} SET content = content || ':fixed' WHERE pet_id = $1`,
        [VERIFY_PET_ID]
      );
    } catch (e) {
      updateError = String((e as Error).message ?? "");
    }
    check("UPDATE 直通不报错（timeline 允许修正，与 audit_log 差异点）", updateError, "");

    // ────────────────────────────────────────────────────────────────
    section("④ 断档模拟：DETACH 下月分区 → 写入落 DEFAULT 不报错 → 恢复");
    await client.query(`ALTER TABLE ${TIMELINE_PARENT_TABLE} DETACH PARTITION ${nextPart}`);
    checkTrue("DETACH 成功", true);
    const afterDetach = await listTimelinePartitions(client);
    checkTrue("DETACH 后下月分区已不在分区列表", !findPartitionByName(afterDetach, nextPart));

    // 断档写入：跨月时间点落 DEFAULT，不报错（验收标准「断档不报错」）
    let gapInsertPart = "";
    let gapInsertError = "";
    try {
      gapInsertPart = await insertProbe(client, nextMid);
    } catch (e) {
      gapInsertError = String((e as Error).message ?? "");
    }
    check("断档写入不报错", gapInsertError, "");
    check("断档写入 → 落 DEFAULT 兜底分区", gapInsertPart, TIMELINE_DEFAULT_PARTITION);
    // 告警出口：数据落 DEFAULT 即 ERROR 级告警（通道接线归 CROSS-21）
    console.error(
      `[ALERT][${SCOPE}] 断档演练：下月分区缺失，1 条时间线数据落 DEFAULT 兜底分区 ` +
        `（生产环境该事件必须触发告警，通道接线归 CROSS-21）`
    );

    // 清理 DEFAULT 里的断档行（ATTACH 前必须清空重叠范围，否则范围冲突）
    const gapDeleted = await deleteProbes(client, ` AND event_time >= '${nextRange.fromIso}'`);
    check("断档测试行已从 DEFAULT 清除", gapDeleted, 1);

    await client.query(
      `ALTER TABLE ${TIMELINE_PARENT_TABLE} ATTACH PARTITION ${nextPart}
        FOR VALUES FROM ('${nextRange.fromIso}') TO ('${nextRange.toIso}')`
    );
    checkTrue(
      "ATTACH 恢复：下月分区回到分区列表",
      Boolean(findPartitionByName(await listTimelinePartitions(client), nextPart))
    );
    // 原 DETACH 前的测试行应原封保留（数据零丢失）
    const kept = await client.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM ${TIMELINE_PARENT_TABLE}
        WHERE pet_id = $1 AND content = $2 AND event_time >= $3`,
      [VERIFY_PET_ID, `${RUN_ID}:fixed`, nextRange.fromIso]
    );
    check("DETACH→ATTACH 往返后原下月测试行零丢失", Number(kept.rows[0].c), 1);
    const keptPart = await client.query<{ part: string }>(
      `SELECT tableoid::regclass::text AS part FROM ${TIMELINE_PARENT_TABLE}
        WHERE pet_id = $1 AND content = $2 AND event_time >= $3 LIMIT 1`,
      [VERIFY_PET_ID, `${RUN_ID}:fixed`, nextRange.fromIso]
    );
    check("保留行重新归属下月分区", keptPart.rows[0]?.part, nextPart);

    // ────────────────────────────────────────────────────────────────
    section("⑤ 收尾：清理测试数据，库内无脏状态");
    const removed = await deleteProbes(client);
    check("测试行全部清除（直接 DELETE，无触发器拦阻）", removed, 2);
    const leftoverRows = await client.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM ${TIMELINE_PARENT_TABLE} WHERE pet_id = $1`,
      [VERIFY_PET_ID]
    );
    check("清理后按哨兵复查残留 0 行", Number(leftoverRows.rows[0].c), 0);

    const finalParts = await listTimelinePartitions(client);
    check(
      "最终分区集合 = 当月 + 下月 + DEFAULT（无临时分区残留）",
      finalParts.map((p) => p.name).sort(),
      [curPart, TIMELINE_DEFAULT_PARTITION, nextPart].sort()
    );
    await runEnsure("收尾复跑 ensure");
    checkTrue("退出前 ensure 再跑一次仍幂等安全", true);
  } finally {
    // 兜底清扫：即使中途断言失败也不留测试行（DETACH 态由断言保证已恢复；
    // 若异常发生在 DETACH 与 ATTACH 之间，重跑本脚本前需手工 ATTACH，
    // 该状态会被①的分区缺失断言立刻暴露，不会静默）
    await deleteProbes(client).catch(() => {});
    await client.end();
  }

  console.log("\n" + "=".repeat(72));
  console.log(`结论：通过 ${passed} 项，失败 ${failures} 项`);
  if (failures > 0) {
    process.exitCode = 1;
  } else {
    console.log("✅ P0-06-01 timeline_event 分区验收标准全部满足");
  }
}

main().catch((e) => {
  console.error(`[${SCOPE}] 脚本异常终止：`, e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
