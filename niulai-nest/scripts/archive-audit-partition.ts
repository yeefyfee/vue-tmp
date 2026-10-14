/**
 * audit_log 分区归档 DETACH 骨架 —— P0-02-08 子任务 5（CROSS-21/22 接口预留）
 * ============================================================
 * 职责：把指定月份的月分区从 audit_log 父表 DETACH，作为审计数据留存到期 /
 *       归档的最小落地。评估报告结论：DETACH 是 DDL 层操作，不触发行级
 *       BEFORE UPDATE/DELETE 触发器，与 append-only 天然不冲突（真库实测
 *       见 verify-audit-partitions.ts 的断档/DETACH 段）。
 *
 * 流程：校验参数与分区存在 → 安全护栏（禁动当月及未来月份）→
 *       归档导出钩子（CROSS-21/22 预留）→ DETACH → 终检并报告。
 *
 * 骨架边界（CROSS-21/22 接口预留）：
 *   - exportArchiveHook 当前为**显式 no-op**（返回 hook-not-wired），
 *     接线归档存储（对象存储 / 冷表 / 外部合规仓库）时只改该函数；
 *   - DETACH 后的表成为普通表，其后续处置（转储后 DROP / 改名封存 /
 *     迁移到归档库）由 CROSS-22 归档策略决定，本脚本不动它、不删数据。
 *
 * 用法：
 *   node ./node_modules/ts-node/dist/bin.js -r tsconfig-paths/register \
 *     scripts/archive-audit-partition.ts --month=2026-09 [--force]
 *   --force：允许对当月/未来月份执行（仅限演练，生产禁用）
 */
import {
  AUDIT_PARENT_TABLE,
  connectAudit,
  currentMonthUtc,
  DATABASE_URL,
  findPartitionByName,
  InvalidMonthError,
  listAuditPartitions,
  log,
  monthKey,
  monthRangeUtc,
  parseBoundToRange,
  parseMonthArg,
  partitionName,
} from "./audit-partition-lib";

const SCOPE = "archive-audit-partition";

/** 解析命令行参数 */
function resolveArgs(): { ym: { year: number; month: number }; force: boolean } {
  const monthArg = process.argv.find((a) => a.startsWith("--month="));
  const force = process.argv.includes("--force");
  const ym = parseMonthArg(monthArg?.split("=")[1]);
  return { ym, force };
}

/**
 * 归档导出钩子（CROSS-21/22 接口预留）。
 *
 * 预期契约：DETACH 前把分区数据完整导出到归档存储，成功返回 exported=true；
 * 失败抛错 ⇒ 调用方中止 DETACH（宁可留着也不丢审计数据）。
 * 当前为骨架 no-op：未接归档存储前始终返回 exported=false，
 * 主流程据此打印 WARN 但继续 DETACH（骨架期不阻断维护动作）。
 */
async function exportArchiveHook(input: {
  month: string;
  partitionName: string;
  rowCount: number;
}): Promise<{ exported: boolean; reason: string }> {
  void input;
  return { exported: false, reason: "hook-not-wired: 归档存储对接归 CROSS-21/22" };
}

/** 比较年月先后：a < b 返回负数 */
function compareYm(a: { year: number; month: number }, b: { year: number; month: number }): number {
  return a.year * 12 + a.month - (b.year * 12 + b.month);
}

async function main(): Promise<void> {
  const { ym, force } = resolveArgs();
  const month = monthKey(ym);
  const target = partitionName(ym);
  log(SCOPE, `连接 ${DATABASE_URL.replace(/:[^:@/]+@/, ":***@")}，目标分区 ${target}`);

  const client = await connectAudit();
  try {
    // ① 分区存在性校验（必须是 audit_log 的直接分区，而非遗留普通表）
    const partitions = await listAuditPartitions(client);
    const part = findPartitionByName(partitions, target);
    if (!part) {
      throw new Error(
        `分区 ${target} 不存在或不是 ${AUDIT_PARENT_TABLE} 的直接分区。` +
          `现有分区：${partitions.map((p) => p.name).join(", ")}`
      );
    }

    // ② 边界口径核对：分区的实际范围应与目标月 UTC 月界一致（防手工建的错位分区）
    const range = monthRangeUtc(ym);
    const bound = parseBoundToRange(part.bound);
    if (!bound || bound.fromMs !== range.fromMs || bound.toMs !== range.toMs) {
      throw new Error(
        `分区 ${target} 的边界（${part.bound}）与 ${month} 的 UTC 月界不一致，中止归档`
      );
    }

    // ③ 安全护栏：只允许归档严格早于当月的分区（--force 仅限演练）
    const current = currentMonthUtc();
    if (compareYm(ym, current) >= 0 && !force) {
      throw new Error(
        `拒绝归档 ${month}：只允许严格早于当月（${monthKey(current)}）的分区。` +
          `确需演练请加 --force（生产禁用）。`
      );
    }

    // ④ 归档前快照 + 导出钩子（CROSS-21/22 预留）
    const cnt = await client.query<{ c: number }>(`SELECT count(*)::int AS c FROM "${target}"`);
    const rowCount = Number(cnt.rows[0].c);
    log(SCOPE, `归档前快照：${target} 共 ${rowCount} 行`);

    const hook = await exportArchiveHook({ month, partitionName: target, rowCount });
    if (!hook.exported) {
      log(SCOPE, `WARN：归档导出钩子未接线（${hook.reason}），按骨架流程继续 DETACH`);
    }

    // ⑤ DETACH（DDL 层，不触发行级触发器；真库实测见 verify-audit-partitions.ts）
    log(SCOPE, `执行 ALTER TABLE ${AUDIT_PARENT_TABLE} DETACH PARTITION ${target}`);
    await client.query(`ALTER TABLE "${AUDIT_PARENT_TABLE}" DETACH PARTITION "${target}"`);

    // ⑥ 终检：不再是分区 + 数据原封不动留在原地
    const after = await listAuditPartitions(client);
    if (findPartitionByName(after, target)) {
      throw new Error(`终检失败：${target} DETACH 后仍在分区列表中`);
    }
    const kept = await client.query<{ c: number }>(`SELECT count(*)::int AS c FROM "${target}"`);
    const keptCount = Number(kept.rows[0].c);
    log(
      SCOPE,
      `完成：${target} 已脱离 ${AUDIT_PARENT_TABLE}（现分区：` +
        `${after.map((p) => p.name).join(", ")}）。数据 ${keptCount}/${rowCount} 行原封保留在独立表 ` +
        `${target} 中，后续转储/改名/迁移到归档库由 CROSS-22 归档策略处置。`
    );
    if (keptCount !== rowCount) {
      console.error(`[${SCOPE}] ERROR：DETACH 前后行数不一致（${rowCount} → ${keptCount}）`);
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  if (e instanceof InvalidMonthError) {
    console.error(`[${SCOPE}] ${e.message}。用法：--month=YYYY-MM [--force]`);
  } else {
    console.error(`[${SCOPE}] 脚本异常终止：`, e instanceof Error ? e.message : e);
  }
  process.exitCode = 1;
});
