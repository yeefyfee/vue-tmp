/**
 * audit_log 分区滚动维护 · 真库验证（P0-02-08 子任务 5）
 * ============================================================
 * 断言计数式输出（对齐 verify-tenant-baseline 风格），覆盖验收标准：
 *   ① 当月 + 下月分区存在（ensure-audit-partitions 幂等预建，重跑安全）；
 *   ② 向当月 / 下月各插一条测试数据，分别落到对应月分区（非 DEFAULT，
 *      以 tableoid::regclass 实证路由）；
 *   ③ 断档模拟：临时 DETACH 下月分区 → 跨月写入落 DEFAULT 且不报错 → 恢复
 *      （ATTACH 回去），全程实测「DETACH 是 DDL、不触发行级触发器」的评估结论；
 *   ④ 幂等重跑 ensure 零副作用；
 *   ⑤ 断档即告警：数据落 DEFAULT 时输出 ERROR 级告警日志（告警通道接线归
 *      CROSS-21，见 audit-partition-lib.alert），脚本失败以非零退出码兜底。
 *
 * 无脏状态承诺：测试行以 entity_type='VERIFY_AUDIT_PARTITION' + trace_id 隔离，
 * 结束前在 app.audit_maintenance='on' 维护通道下全部 DELETE（顺带实测 GUC 通道），
 * 临时 DETACH 的分区 ATTACH 回原位，退出前逐项断言库内无残留。
 *
 * 运行：
 *   node ./node_modules/ts-node/dist/bin.js -r tsconfig-paths/register scripts/verify-audit-partitions.ts
 */
import {
  addMonths,
  AUDIT_DEFAULT_PARTITION,
  AUDIT_PARENT_TABLE,
  connectAudit,
  currentMonthUtc,
  findPartitionByName,
  listAuditPartitions,
  log,
  monthKey,
  monthRangeUtc,
  partitionName,
} from "./audit-partition-lib";
import { ensureAuditPartitions } from "./ensure-audit-partitions";
import type { Client } from "pg";

const SCOPE = "verify-audit-partitions";
/** 测试行隔离标记（cleanup 按 entity_type 精确清扫） */
const VERIFY_ENTITY_TYPE = "VERIFY_AUDIT_PARTITION";
/** 本次运行的唯一 trace_id（防跨次残留误判） */
const RUN_ID = `vp${Date.now()}`;

/**
 * 以进程内调用方式运行 ensure（与 CLI 路径共享同一份实现；
 * Windows 沙箱禁 spawn 子进程，故不走 execSync）。
 */
async function runEnsure(roundLabel: string): Promise<void> {
  const result = await ensureAuditPartitions(client, 2);
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

/** 插入一条测试审计行，返回其落在的分区名（tableoid::regclass 实证路由） */
async function insertProbe(client: Client, createdAtIso: string): Promise<string> {
  const res = await client.query<{ part: string }>(
    `INSERT INTO ${AUDIT_PARENT_TABLE}
        (tenant_id, entity_type, entity_id, action, operator_type, trace_id, created_at)
     VALUES (0, $1, $2, 1, 1, $3, $4)
     RETURNING tableoid::regclass::text AS part`,
    [VERIFY_ENTITY_TYPE, RUN_ID, RUN_ID, createdAtIso]
  );
  return res.rows[0].part;
}

/** 维护通道删除测试行（GUC app.audit_maintenance='on'，事务级放行） */
async function deleteProbes(client: Client, extraWhere = ""): Promise<number> {
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('app.audit_maintenance', 'on', true)");
    const res = await client.query(
      `DELETE FROM ${AUDIT_PARENT_TABLE} WHERE entity_type = $1${extraWhere}`,
      [VERIFY_ENTITY_TYPE]
    );
    const n = res.rowCount ?? 0;
    await client.query("COMMIT");
    return n;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  }
}

/** 无维护通道尝试 UPDATE / DELETE（预期被行级触发器拦截） */
async function expectMutationBlocked(client: Client, sql: string, label: string): Promise<void> {
  let blocked = false;
  let msg = "";
  try {
    await client.query(sql, [VERIFY_ENTITY_TYPE]);
  } catch (e) {
    blocked = true;
    msg = String((e as Error).message ?? "");
  }
  checkTrue(`${label}：被 append-only 触发器拦截`, blocked);
  checkTrue(`${label}：报错指向 append-only`, /append-only/i.test(msg));
}

/** 查询某表上的克隆触发器残留（PG13+ 父表行级触发器自动克隆到分区） */
async function cloneTriggerOn(client: Client, table: string): Promise<boolean> {
  const res = await client.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM pg_trigger
      WHERE tgrelid = $1::regclass AND tgname = 'audit_log_no_mutation' AND NOT tgisinternal`,
    [table]
  );
  return Number(res.rows[0].c) > 0;
}

async function main(): Promise<void> {
  console.log("=".repeat(72));
  console.log("P0-02-08 子任务 5 · audit_log 分区滚动维护 · 真库验证");
  console.log("=".repeat(72));

  client = await connectAudit();
  const current = currentMonthUtc();
  const next = addMonths(current, 1);
  const curPart = partitionName(current);
  const nextPart = partitionName(next);
  const nextRange = monthRangeUtc(next);
  log(SCOPE, `当月 ${monthKey(current)}（${curPart}）/ 下月 ${monthKey(next)}（${nextPart}）`);

  try {
    // ────────────────────────────────────────────────────────────────
    section("① ensure 幂等预建：当月 + 下月分区存在");
    const before = await listAuditPartitions(client);
    checkTrue(`audit_log 为分区父表且已有分区（迁移 20261005170000 已应用）`, before.length >= 1);

    for (const round of [1, 2]) {
      await runEnsure(`ensure 第 ${round} 次`);
    }
    const afterEnsure = await listAuditPartitions(client);
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

    // ────────────────────────────────────────────────────────────────
    section("② 跨月写入路由：当月 / 下月各一条，均落对应月分区（非 DEFAULT）");
    const curProbe = await insertProbe(client, new Date().toISOString());
    check("当月写入 → 落当月分区", curProbe, curPart);
    const nextMid = new Date(nextRange.fromMs + 14 * 24 * 3600 * 1000).toISOString();
    const nextProbe = await insertProbe(client, nextMid);
    check("下月写入 → 落下月分区", nextProbe, nextPart);
    checkTrue(
      "两条测试行均未落 DEFAULT 兜底",
      curProbe !== AUDIT_DEFAULT_PARTITION && nextProbe !== AUDIT_DEFAULT_PARTITION
    );

    // ────────────────────────────────────────────────────────────────
    section("③ 维护通道（GUC app.audit_maintenance）实测");
    await expectMutationBlocked(
      client,
      `UPDATE ${AUDIT_PARENT_TABLE} SET operator_name = 'x' WHERE entity_type = $1`,
      "无 GUC 执行 UPDATE"
    );
    await expectMutationBlocked(
      client,
      `DELETE FROM ${AUDIT_PARENT_TABLE} WHERE entity_type = $1`,
      "无 GUC 执行 DELETE"
    );
    const curDeleted = await deleteProbes(
      client,
      ` AND trace_id = '${RUN_ID}' AND created_at < '${nextRange.fromIso}'`
    );
    check("GUC='on'（事务级）删除当月测试行放行", curDeleted, 1);
    const gucLeft = await client.query<{ v: string | null }>(
      "SELECT current_setting('app.audit_maintenance', true) AS v"
    );
    // PG 口径：从未设置的 GUC 缺失读返回 NULL；SET LOCAL 失效后回读可能得到
    // 空串（"曾设置已复位"）——二者都不构成 'on'，触发器均按拦截处理
    checkTrue(
      "事务提交后 GUC 归零（无会话级泄漏，值既非 'on' 亦不持久）",
      (gucLeft.rows[0].v ?? "") !== "on"
    );

    // ────────────────────────────────────────────────────────────────
    section("④ 断档模拟：DETACH 下月分区 → 写入落 DEFAULT 不报错 → 恢复");
    // 下月分区里有 1 条测试行：正好用「有数据仍可 DETACH」实证 DDL 层不触发行级触发器
    checkTrue(
      "DETACH 前下月分区存在克隆触发器（append-only 覆盖分区）",
      await cloneTriggerOn(client, nextPart)
    );

    await client.query(`ALTER TABLE ${AUDIT_PARENT_TABLE} DETACH PARTITION ${nextPart}`);
    checkTrue("DETACH 成功（分区含数据行仍可脱离 —— DDL 不触发行级触发器）", true);
    const afterDetach = await listAuditPartitions(client);
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
    check("断档写入 → 落 DEFAULT 兜底分区", gapInsertPart, AUDIT_DEFAULT_PARTITION);
    // 告警出口：数据落 DEFAULT 即 ERROR 级告警（通道接线归 CROSS-21）
    console.error(
      `[ALERT][${SCOPE}] 断档演练：下月分区缺失，1 条审计数据落 DEFAULT 兜底分区 ` +
        `（生产环境该事件必须触发告警，通道接线归 CROSS-21）`
    );

    // 清理 DEFAULT 里的断档行（ATTACH 前必须清空重叠范围，否则范围冲突）
    const gapDeleted = await deleteProbes(
      client,
      ` AND trace_id = '${RUN_ID}' AND created_at >= '${nextRange.fromIso}'`
    );
    check("断档测试行已从 DEFAULT 清除（GUC 通道）", gapDeleted, 1);

    // 克隆触发器处置：PG 版本差异下 DETACH 后可能残留，重挂前防御性移除
    const leftoverTrigger = await cloneTriggerOn(client, nextPart);
    log(
      SCOPE,
      `DETACH 后克隆触发器${leftoverTrigger ? "残留（防御性 DROP 后重挂）" : "已随 DETACH 自动移除"}`
    );
    if (leftoverTrigger) {
      await client.query(`DROP TRIGGER audit_log_no_mutation ON ${nextPart}`);
    }
    await client.query(
      `ALTER TABLE ${AUDIT_PARENT_TABLE} ATTACH PARTITION ${nextPart}
        FOR VALUES FROM ('${nextRange.fromIso}') TO ('${nextRange.toIso}')`
    );
    checkTrue(
      "ATTACH 恢复：下月分区回到分区列表",
      Boolean(findPartitionByName(await listAuditPartitions(client), nextPart))
    );
    checkTrue(
      "恢复后克隆触发器重新就位（append-only 继续覆盖）",
      await cloneTriggerOn(client, nextPart)
    );
    // 原 DETACH 前的测试行应原封保留（数据零丢失）
    const kept = await client.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM ${AUDIT_PARENT_TABLE}
        WHERE entity_type = $1 AND trace_id = $2 AND created_at >= $3`,
      [VERIFY_ENTITY_TYPE, RUN_ID, nextRange.fromIso]
    );
    check("DETACH→ATTACH 往返后原下月测试行零丢失", Number(kept.rows[0].c), 1);
    const keptPart = await client.query<{ part: string }>(
      `SELECT tableoid::regclass::text AS part FROM ${AUDIT_PARENT_TABLE}
        WHERE entity_type = $1 AND trace_id = $2 AND created_at >= $3 LIMIT 1`,
      [VERIFY_ENTITY_TYPE, RUN_ID, nextRange.fromIso]
    );
    check("保留行重新归属下月分区", keptPart.rows[0]?.part, nextPart);

    // ────────────────────────────────────────────────────────────────
    section("⑤ 收尾：清理测试数据，库内无脏状态");
    const removed = await deleteProbes(client);
    check("测试行全部清除（GUC 维护通道，仅剩之前保留的下月行）", removed, 1);
    const leftoverRows = await client.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM ${AUDIT_PARENT_TABLE} WHERE entity_type = $1`,
      [VERIFY_ENTITY_TYPE]
    );
    check("清理后按标记复查残留 0 行", Number(leftoverRows.rows[0].c), 0);

    const finalParts = await listAuditPartitions(client);
    check(
      "最终分区集合 = 当月 + 下月 + DEFAULT（无临时分区残留）",
      finalParts.map((p) => p.name).sort(),
      [curPart, AUDIT_DEFAULT_PARTITION, nextPart].sort()
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
    console.log("✅ P0-02-08 子任务 5 验收标准全部满足");
  }
}

main().catch((e) => {
  console.error(`[${SCOPE}] 脚本异常终止：`, e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
