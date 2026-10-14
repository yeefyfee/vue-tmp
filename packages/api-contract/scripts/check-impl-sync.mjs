/**
 * 契约 ↔ 实现一致性校验（CROSS-15，零依赖）
 *
 * 输入：
 *  - `openapi.export.json` —— 从实现导出的 OpenAPI 快照（`contract:export` 生成并提交）
 *  - `openapi.yaml`        —— 契约（契约先行，三端唯一基线）
 *
 * 校验口径：
 *  1. 快照存在且可解析（缺失 = 红灯，提示重新导出）；
 *  2. 快照全部路径带 /api/v1 前缀（决策 Q7）；
 *  3. 快照所有 JSON 响应均为统一信封 { code, msg, data }（决策 A4）；
 *  4. 分页端点必须出现 page / page_size 查询参数（决策 Q5）；
 *  5. 契约中**已实现**的路径（出现在快照里）方法集合一致；
 *    契约中尚未实现的路径仅计数报告（契约先行的正常状态）。
 *
 * 运行：node packages/api-contract/scripts/check-impl-sync.mjs
 * 退出码：0 = 通过，1 = 有 ERROR
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const exportPath = resolve(__dirname, "../openapi.export.json");
const contractPath = resolve(__dirname, "../openapi.yaml");

const errors = [];
const oks = [];
const notes = [];
function check(cond, okMsg, errMsg) {
  if (cond) oks.push(okMsg);
  else errors.push(errMsg);
}

// ── 1. 快照存在且可解析 ──────────────────────────────
let doc;
try {
  doc = JSON.parse(readFileSync(exportPath, "utf8"));
  oks.push("openapi.export.json 存在且可解析");
} catch {
  errors.push(
    "openapi.export.json 缺失或不可解析 —— 请先在 niulai-nest 运行 `contract:export` 导出并提交快照"
  );
}

// ── 2/3/4. 快照口径 ──────────────────────────────────
let exportPaths = {};
if (doc) {
  exportPaths = doc.paths ?? {};
  const pathKeys = Object.keys(exportPaths);

  check(
    pathKeys.length > 0,
    `快照包含 ${pathKeys.length} 个路径`,
    "快照没有任何路径（导出为空）"
  );
  const badPrefix = pathKeys.filter((p) => !p.startsWith("/api/v1"));
  check(
    badPrefix.length === 0,
    "全部路径带 /api/v1 前缀（Q7）",
    `以下路径缺 /api/v1 前缀：${badPrefix.slice(0, 5).join(", ")}`
  );

  // 信封检查：所有 JSON 响应的 schema.type === object 且 required 含 code/msg/data
  const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);
  const nonEnvelope = [];
  let envelopeCount = 0;
  for (const [p, item] of Object.entries(exportPaths)) {
    for (const [m, op] of Object.entries(item)) {
      if (!HTTP_METHODS.has(m)) continue;
      const responses = op?.responses ?? {};
      for (const [status, res] of Object.entries(responses)) {
        const schema = res?.content?.["application/json"]?.schema;
        if (!schema) continue;
        const ok =
          schema.type === "object" &&
          Array.isArray(schema.required) &&
          ["code", "msg", "data"].every((k) => schema.required.includes(k));
        if (ok) envelopeCount += 1;
        else nonEnvelope.push(`${m.toUpperCase()} ${p} (${status})`);
      }
    }
  }
  check(
    nonEnvelope.length === 0,
    `${envelopeCount} 个 JSON 响应均为统一信封 code/msg/data（A4）`,
    `以下响应缺统一信封：${nonEnvelope.slice(0, 5).join("; ")}`
  );

  // 分页参数检查（Q5）：凡响应信封 data 内含 list 的（列表端点），须有 page/page_size 查询参数
  const listEndpoints = [];
  for (const [p, item] of Object.entries(exportPaths)) {
    for (const [m, op] of Object.entries(item)) {
      if (!HTTP_METHODS.has(m) || m !== "get") continue;
      const text = JSON.stringify(op);
      if (/"list"/.test(text) && /"total"/.test(text)) listEndpoints.push({ p, op });
    }
  }
  const missingPage = [];
  for (const { p, op } of listEndpoints) {
    const params = op?.parameters ?? [];
    const names = params
      .filter((q) => q?.in === "query")
      .map((q) => q?.name);
    if (!names.includes("page") || !names.includes("page_size")) missingPage.push(p);
  }
  check(
    missingPage.length === 0,
    listEndpoints.length === 0
      ? "快照暂无列表端点（业务域落地后自动启用 Q5 检查）"
      : "列表端点均带 page / page_size 查询参数（Q5）",
    `以下列表端点缺 page/page_size：${missingPage.slice(0, 5).join(", ")}`
  );
}

// ── 5. 契约中已实现路径的方法集合一致性 ──────────────
// 从 yaml 提取 paths 下的两级键（2 空格缩进的 /path 与其下的 method）
const raw = readFileSync(contractPath, "utf8");
const contractPaths = {};
let inPaths = false;
let currentPath = null;
for (const line of raw.split(/\r?\n/)) {
  if (/^paths:\s*$/.test(line)) {
    inPaths = true;
    continue;
  }
  if (inPaths) {
    const pathMatch = line.match(/^ {2}(\/[^\s:]+):\s*$/);
    if (pathMatch) {
      currentPath = pathMatch[1];
      contractPaths[currentPath] = new Set();
      continue;
    }
    const methodMatch = line.match(/^ {4}(get|post|put|patch|delete|head|options):\s*$/);
    if (methodMatch && currentPath) contractPaths[currentPath].add(methodMatch[1]);
    // 回到顶层（非缩进）则 paths 段结束
    if (/^[^\s]/.test(line) && !/^paths:/.test(line)) inPaths = false;
  }
}

const contractPathKeys = Object.keys(contractPaths);
let implementedInContract = 0;
let methodMismatches = [];
let pendingInContract = 0;

// 契约路径不带 /api/v1 前缀（servers 承担），快照路径带前缀 ⇒ 比对时剥前缀归一化
const exportPathSet = new Set(
    Object.keys(exportPaths).map((p) => p.replace(/^\/api\/v1/, "") || "/")
  );
  const exportPathByRel = {};
  for (const [p, item] of Object.entries(exportPaths)) {
    exportPathByRel[p.replace(/^\/api\/v1/, "") || "/"] = item;
  }
  for (const [cp, methods] of Object.entries(contractPaths)) {
    const normalized = cp.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
    if (!exportPathSet.has(cp) && !exportPathSet.has(normalized)) {
      pendingInContract += 1;
      continue;
    }
    implementedInContract += 1;
    const target = exportPathByRel[cp] ?? exportPathByRel[normalized];
  const exportMethods = new Set(
    Object.keys(target).filter((k) =>
      ["get", "post", "put", "patch", "delete", "head", "options"].includes(k)
    )
  );
  for (const m of methods) {
    if (!exportMethods.has(m)) methodMismatches.push(`${m.toUpperCase()} ${cp}（契约有、实现缺）`);
  }
}
notes.push(
  `契约路径 ${contractPathKeys.length} 个：已实现 ${implementedInContract}，契约先行待实现 ${pendingInContract}`
);
check(
  methodMismatches.length === 0,
  "契约中已实现路径的方法集合一致",
  `方法不一致：${methodMismatches.slice(0, 5).join("; ")}`
);

// ── 输出 ─────────────────────────────────────────────
console.log("========================================================================");
console.log("CROSS-15 · 契约 ↔ 实现一致性校验");
console.log("========================================================================");
for (const ok of oks) console.log(`  √ ${ok}`);
for (const note of notes) console.log(`  ℹ ${note}`);
for (const err of errors) console.log(`  ✗ ${err}`);
console.log("========================================================================");
if (errors.length > 0) {
  console.log(`结论：ERROR × ${errors.length}`);
  process.exitCode = 1;
} else {
  console.log("结论：契约与实现一致 ✅");
}
