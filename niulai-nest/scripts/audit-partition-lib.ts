/**
 * audit_log 分区滚动维护 · 共享工具库（P0-02-08 子任务 5）
 *
 * 被 ensure-audit-partitions / archive-audit-partition / verify-audit-partitions
 * 三个脚本共用，统一分区命名与边界口径：
 *   - 命名惯例：audit_log_pYYYY_MM（对齐迁移 20261005170000_audit_log_partitioned）；
 *   - 边界口径：UTC 月界（迁移内分区边界为 'YYYY-MM-01 00:00:00+00'，左闭右开），
 *     created_at 为 TIMESTAMPTZ，分区边界是绝对时刻 ⇒ 全程用 UTC 计算月，
 *     与服务器本地时区无关。
 *
 * 运行方式（与 verify-tenant-baseline 同法）：
 *   node ./node_modules/ts-node/dist/bin.js -r tsconfig-paths/register scripts/<脚本>.ts
 */
import { Client } from "pg";

/** 真库连接串（默认指向共用 pg16 容器的 peluvida_dev，可用环境变量覆盖） */
export const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://admin:Pg%40123456@127.0.0.1:5432/peluvida_dev";

/** 分区父表（声明式 RANGE(created_at) 分区） */
export const AUDIT_PARENT_TABLE = "audit_log";
/** DEFAULT 兜底分区名（断档时数据落这里而不是报错） */
export const AUDIT_DEFAULT_PARTITION = "audit_log_default";
/** 月分区命名前缀：audit_log_pYYYY_MM */
export const PARTITION_NAME_PREFIX = "audit_log_p";

/** 年月（month 为 1~12 的自然月） */
export interface YearMonth {
  year: number;
  month: number;
}

/** 月分区的 UTC 范围（左闭右开 [from, to)） */
export interface MonthRange {
  fromIso: string;
  toIso: string;
  fromMs: number;
  toMs: number;
}

/** 从系统目录读出的分区元信息 */
export interface PartitionInfo {
  /** 分区表名 */
  name: string;
  /** pg_get_expr(relpartbound) 原文；DEFAULT 分区为 "DEFAULT" */
  bound: string | null;
  /** 是否 DEFAULT 兜底分区 */
  isDefault: boolean;
}

/** 月界解析错误 */
export class InvalidMonthError extends Error {
  constructor(got: string) {
    super(`非法月份参数「${got}」，期望 YYYY-MM（如 2026-11）`);
    this.name = "InvalidMonthError";
  }
}

/** 两位补零 */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 校验并解析 YYYY-MM 参数 */
export function parseMonthArg(arg: string | undefined): YearMonth {
  if (!arg) throw new InvalidMonthError(String(arg));
  const m = /^(\d{4})-(\d{2})$/.exec(arg.trim());
  if (!m) throw new InvalidMonthError(arg);
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new InvalidMonthError(arg);
  return { year, month };
}

/** YYYY-MM 文本 */
export function monthKey(ym: YearMonth): string {
  return `${ym.year}-${pad2(ym.month)}`;
}

/** 月分区名：audit_log_pYYYY_MM */
export function partitionName(ym: YearMonth): string {
  return `${PARTITION_NAME_PREFIX}${ym.year}_${pad2(ym.month)}`;
}

/** 加减月份（跨年安全；month 为 1~12） */
export function addMonths(ym: YearMonth, delta: number): YearMonth {
  const zeroBased = ym.year * 12 + (ym.month - 1) + delta;
  return { year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 };
}

/** 当前 UTC 年月 */
export function currentMonthUtc(now: Date = new Date()): YearMonth {
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

/** 年月 → UTC 月界 [from, to)，格式对齐迁移（'YYYY-MM-01 00:00:00+00'） */
export function monthRangeUtc(ym: YearMonth): MonthRange {
  const from = new Date(Date.UTC(ym.year, ym.month - 1, 1));
  const to = new Date(Date.UTC(ym.year, ym.month, 1));
  return {
    fromIso: `${ym.year}-${pad2(ym.month)}-01 00:00:00+00`,
    toIso: `${to.getUTCFullYear()}-${pad2(to.getUTCMonth() + 1)}-01 00:00:00+00`,
    fromMs: from.getTime(),
    toMs: to.getTime(),
  };
}

/** 建立真库连接（调用方负责 end()） */
export async function connectAudit(): Promise<Client> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  return client;
}

/**
 * 列出 audit_log 的全部直接分区（pg_inherits × pg_class.relpartbound）。
 * 不查间接分区（本方案无子分区层级）。
 */
export async function listAuditPartitions(client: Client): Promise<PartitionInfo[]> {
  const res = await client.query<{ relname: string; bound: string | null }>(
    `SELECT c.relname,
            pg_get_expr(c.relpartbound, c.oid) AS bound
       FROM pg_inherits i
       JOIN pg_class c ON c.oid = i.inhrelid
       JOIN pg_class p ON p.oid = i.inhparent
      WHERE p.relname = $1
      ORDER BY c.relname`,
    [AUDIT_PARENT_TABLE]
  );
  return res.rows.map((r) => ({
    name: r.relname,
    bound: r.bound,
    isDefault: (r.bound ?? "").trim().toUpperCase() === "DEFAULT",
  }));
}

/** 解析 relpartbound 文本 → 月界；DEFAULT 或无法解析时返回 null */
export function parseBoundToRange(bound: string | null): MonthRange | null {
  if (!bound) return null;
  const m = /FOR VALUES FROM \('(.+?)'\) TO \('(.+?)'\)/.exec(bound);
  if (!m) return null;
  const fromMs = Date.parse(m[1]);
  const toMs = Date.parse(m[2]);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return null;
  return { fromIso: m[1], toIso: m[2], fromMs, toMs };
}

/** 找到范围完全覆盖目标月份的既有分区（含"命名不同但范围吻合"的情况） */
export function findPartitionCovering(
  partitions: PartitionInfo[],
  ym: YearMonth
): PartitionInfo | undefined {
  const range = monthRangeUtc(ym);
  return partitions.find((p) => {
    const b = parseBoundToRange(p.bound);
    return b !== null && b.fromMs <= range.fromMs && range.toMs <= b.toMs;
  });
}

/** 按精确名字找分区 */
export function findPartitionByName(
  partitions: PartitionInfo[],
  name: string
): PartitionInfo | undefined {
  return partitions.find((p) => p.name === name);
}

/**
 * 统计 DEFAULT 兜底分区中落在目标月范围内的行数。
 * DEFAULT 分区是普通表（无子分区），可直接按范围查询。
 * 行数 > 0 ⇒ 新建同范围月分区会与 DEFAULT 重叠而失败，
 * 须先按 CROSS-21 流程搬移数据（本脚本不自动搬，见评估报告固有约束说明）。
 */
export async function countDefaultRowsInRange(client: Client, ym: YearMonth): Promise<number> {
  const range = monthRangeUtc(ym);
  const res = await client.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM ${AUDIT_DEFAULT_PARTITION}
      WHERE created_at >= $1 AND created_at < $2`,
    [range.fromIso, range.toIso]
  );
  return res.rows[0]?.c ?? 0;
}

/** 追加一行标准日志（带脚本名前缀，长输出可重定向文件） */
export function log(scope: string, message: string): void {
  console.log(`[${scope}] ${message}`);
}

/** 告警出口（断档 / 数据落 DEFAULT 等需要人工介入的事件）。
 *  当前实现为 stderr ERROR 日志；告警通道（钉钉/飞书 webhook 等）
 *  由 CROSS-21 统一接线，届时只改本函数，调用方语义不变。 */
export function alert(scope: string, message: string): void {
  console.error(`[ALERT][${scope}] ${message}`);
}
