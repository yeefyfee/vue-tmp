/**
 * API 契约结构校验（零依赖）
 *
 * 定位：Phase -1 阶段的「最低保障」—— 在本机无法安装 OpenAPI 工具链时，
 * 仍能守住契约的关键口径不跑偏。
 *
 * 完整的规范校验（JSON Schema 合法性、$ref 可达性、与实现一致性）
 * 由 CROSS-15「OpenAPI 契约 CI 校验」接入正式工具后接管。
 *
 * 运行：node packages/api-contract/scripts/validate.mjs
 * 退出码：0 = 通过，1 = 有 ERROR
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractPath = resolve(__dirname, "../openapi.yaml");

const errors = [];
const warnings = [];
const oks = [];

const raw = readFileSync(contractPath, "utf8");

function check(condition, okMsg, errMsg) {
  if (condition) oks.push(okMsg);
  else errors.push(errMsg);
}

// 1. 版本与元信息
check(/^openapi:\s*3\.1\.\d+/m.test(raw), "openapi 版本为 3.1.x", "openapi 版本缺失或不是 3.1.x");
check(/^info:\s*$/m.test(raw), "存在 info 段", "缺少 info 段");
check(/^servers:\s*$/m.test(raw), "存在 servers 段", "缺少 servers 段");
check(/^paths:\s*$/m.test(raw), "存在 paths 段", "缺少 paths 段");
check(/^components:\s*$/m.test(raw), "存在 components 段", "缺少 components 段");

// 2. 关键口径：端点前缀必须是 /api/v1（决策 Q7）
check(
  /url:\s*https?:\/\/[^\s]*\/api\/v1\s*$/m.test(raw),
  "servers 使用 /api/v1 前缀",
  "servers 未使用 /api/v1 前缀（决策 Q7 要求统一为 /api/v1）"
);

// 3. 统一响应信封：code / msg / data，且外层字段名必须是 msg（决策 A4）
const apiResponseBlock = raw.match(/ApiResponse:\n([\s\S]*?)\n {4}\w/);
check(Boolean(apiResponseBlock), "定义了 ApiResponse 信封", "缺少 ApiResponse 定义");
if (apiResponseBlock) {
  const block = apiResponseBlock[1];
  check(/code:/.test(block), "ApiResponse 含 code 字段", "ApiResponse 缺少 code 字段");
  check(/\bmsg:/.test(block), "ApiResponse 含 msg 字段（外层保持 msg，零回归）", "ApiResponse 缺少 msg 字段");
  check(/data:/.test(block), "ApiResponse 含 data 字段", "ApiResponse 缺少 data 字段");
  check(
    !/^\s{8}message:/m.test(block),
    "未把外层 msg 改名为 message",
    "ApiResponse 出现了 message 字段：外层应保持 msg（决策 A4）"
  );
}

// 4. 分页信封：list / total / page / page_size（决策 Q5）
const pageBlock = raw.match(/PageResult:\n([\s\S]*?)\n {4}\w/);
check(Boolean(pageBlock), "定义了 PageResult 信封", "缺少 PageResult 定义");
if (pageBlock) {
  const block = pageBlock[1];
  for (const field of ["list", "total", "page", "page_size"]) {
    check(
      new RegExp(`^\\s{8}${field}:`, "m").test(block),
      `PageResult 含 ${field} 字段`,
      `PageResult 缺少 ${field} 字段（决策 Q5 要求 list/total/page/page_size）`
    );
  }
}

// 5. 错误信封
check(/ErrorResponse:/.test(raw), "定义了 ErrorResponse", "缺少 ErrorResponse 定义");
check(/details:/.test(raw), "错误信封含 details 字段", "错误信封缺少 details 字段");

// 6. 通用请求头（Authorization / X-Store-Id / Idempotency-Key / X-Client）
for (const header of ["bearerAuth", "StoreId", "IdempotencyKey", "Client"]) {
  check(raw.includes(`${header}:`), `声明了 ${header}`, `缺少 ${header} 声明`);
}

// 7. 金额统一「分」（决策 Q6）
check(/AmountCents:/.test(raw), "定义了金额统一类型 AmountCents", "缺少 AmountCents 类型");
check(
  /金额（分）/.test(raw),
  "金额字段描述标注了「分」",
  "金额字段描述未标注「分」（决策 Q6）"
);
const suspiciousMoney = [...raw.matchAll(/^\s{8}(\w*(?:amount|price|fee|balance)\w*):\s*$/gim)]
  .map((m) => m[1])
  .filter((name) => !/Cents$/i.test(name));
if (suspiciousMoney.length > 0) {
  warnings.push(
    `以下金额类字段名未以 Cents 结尾，请确认单位是否为「分」：${suspiciousMoney.join(", ")}`
  );
}

// 8. $ref 可达性（内部引用）
const refs = [...raw.matchAll(/\$ref:\s*"#\/([^"]+)"/g)].map((m) => m[1]);
const missingRefs = [];
for (const ref of refs) {
  const segments = ref.split("/");
  const leaf = segments[segments.length - 1];
  const targetPattern = new RegExp(`^\\s{2,6}${leaf}:\\s*$`, "m");
  if (!targetPattern.test(raw)) {
    missingRefs.push(ref);
  }
}
check(
  missingRefs.length === 0,
  `全部 ${refs.length} 个内部 $ref 均可解析`,
  `存在无法解析的 $ref：${missingRefs.join(", ")}`
);

// 9. 基础语法体检（重复 key 的粗查）
const topKeys = [...raw.matchAll(/^([a-zA-Z_]+):\s*$/gm)].map((m) => m[1]);
const dupTop = topKeys.filter((k, i) => topKeys.indexOf(k) !== i);
check(dupTop.length === 0, "顶层键无重复", `顶层键重复：${[...new Set(dupTop)].join(", ")}`);

// ---- 输出 ----
console.log("=== PeluVida API 契约结构校验 ===");
console.log(`文件：${contractPath}`);
console.log("");
for (const ok of oks) console.log(`  [OK]   ${ok}`);
for (const w of warnings) console.log(`  [WARN] ${w}`);
for (const e of errors) console.log(`  [FAIL] ${e}`);
console.log("");
console.log(`通过 ${oks.length} 项 / 警告 ${warnings.length} 项 / 失败 ${errors.length} 项`);

if (errors.length > 0) {
  console.log("\n结论：FAIL");
  process.exit(1);
}
console.log("\n结论：PASS");
