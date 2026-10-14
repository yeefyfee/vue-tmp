/**
 * 审计 diff / 脱敏 / JSONB 归一化工具（P0-02-08，纯函数可单测）
 *
 * 口径（Q5，按评估推荐，待拍板可调）：
 *  - before/after 只存**变更字段**（省空间、diff 清晰），不做全量快照；
 *  - 敏感键名脱敏为 "***"，最小清单 password / secret / token / authorization
 *    （键名小写后**包含匹配**，覆盖 password_hash / accessToken / refresh_token
 *    等变体——保守脱敏宁可错杀，误伤可接受）。
 *
 * 另承担 JSONB 归一化：BigInt → string（jsonb 不支持 BigInt，金额「分」整数
 * 以字符串形态入库——A1/Q6 金额口径下数值精度无损）、Date → ISO 字符串。
 */

/** 脱敏占位符 */
export const AUDIT_REDACTED = "***";

/** 敏感键名最小清单（小写包含匹配；待拍板可调——如追加身份证号 / 手机号） */
const SENSITIVE_KEY_PATTERNS = ["password", "secret", "token", "authorization"] as const;

/** 递归深度上限（防御循环引用 / 超深嵌套炸栈） */
const MAX_REDACT_DEPTH = 10;

/** 键名是否命中敏感清单（小写包含匹配） */
export function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((p) => normalized.includes(p));
}

/**
 * 递归脱敏 + JSONB 归一化（返回新对象，不改入参）。
 * 对象 / 数组深遍历；命中敏感键的值整体替换为 "***"（不保留形状，防结构侧信道）。
 */
export function redactAuditValue<T>(value: T, depth = 0): T {
  if (value === null || value === undefined) return value;
  const type = typeof value;
  if (type === "bigint") return String(value) as unknown as T;
  if (value instanceof Date) return value.toISOString() as unknown as T;
  if (type !== "object") return value; // string / number / boolean 原样
  if (depth >= MAX_REDACT_DEPTH) return "[MAX_DEPTH]" as unknown as T;

  if (Array.isArray(value)) {
    return value.map((item) => redactAuditValue(item, depth + 1)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? AUDIT_REDACTED : redactAuditValue(val, depth + 1);
  }
  return out as T;
}

/** 结构化深比较（键序无关；BigInt 按值比较） */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "bigint" && typeof b === "bigint") return a === b; // 上面 === 已覆盖，防兜底误判
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== "object" || typeof b !== "object") return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  const ka = Object.keys(a as Record<string, unknown>);
  const kb = Object.keys(b as Record<string, unknown>);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(b, k) &&
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
  );
}

/** diff 结果：两侧都已脱敏 / 归一化；无任何变更时两侧为 null */
export interface AuditDiff {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

/**
 * 构造「只含变更字段」的 before/after diff（脱敏在 diff 之后整体做）。
 *
 * 语义：
 *  - 键在两侧都有且 deepEqual 相同 → 剔除（未变更不留痕）；
 *  - 键只在 after 出现 → 新增字段：after 侧保留，before 侧不写键；
 *  - 键只在 before 出现 → 删除字段：before 侧保留，after 侧不写键；
 *  - before 为空、after 非空（create 语义）→ before=null，after=脱敏全量；
 *  - 两侧都空 → { before: null, after: null }。
 */
export function buildAuditDiff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined
): AuditDiff {
  const hasBefore = before !== null && before !== undefined;
  const hasAfter = after !== null && after !== undefined;
  if (!hasBefore && !hasAfter) return { before: null, after: null };

  // create / delete 语义：单侧快照全量留痕（delete 的 after 侧为 null）
  if (!hasBefore || !hasAfter) {
    return {
      before: hasBefore ? (redactAuditValue(before) as Record<string, unknown>) : null,
      after: hasAfter ? (redactAuditValue(after) as Record<string, unknown>) : null,
    };
  }

  const b = redactAuditValue(before) as Record<string, unknown>;
  const a = redactAuditValue(after) as Record<string, unknown>;
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const diffBefore: Record<string, unknown> = {};
  const diffAfter: Record<string, unknown> = {};
  for (const key of keys) {
    const inBefore = Object.prototype.hasOwnProperty.call(b, key);
    const inAfter = Object.prototype.hasOwnProperty.call(a, key);
    if (inBefore && inAfter && deepEqual(b[key], a[key])) continue; // 未变更
    if (inBefore) diffBefore[key] = b[key];
    if (inAfter) diffAfter[key] = a[key];
  }
  return {
    before: Object.keys(diffBefore).length ? diffBefore : null,
    after: Object.keys(diffAfter).length ? diffAfter : null,
  };
}
