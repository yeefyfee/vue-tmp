/**
 * 契约 Mock 服务（CROSS-15，零依赖）
 *
 * 定位：契约先行阶段的**结构 Mock** —— 三端在实现落地前对接契约形状。
 * 读取 openapi.yaml 的 paths 清单，为契约内路径返回统一信封的样例数据；
 * 支持 {param} 路径通配与 ?__status=N 错误模拟。
 *
 * ⚠️ 这是骨架期 Mock（形状正确、数据非真实）。业务域契约稳定后可替换为
 *    Prism 等规范 Mock（openapi.yaml 已是标准 3.1，切换零成本）。
 *
 * 运行：node packages/api-contract/scripts/mock-server.mjs   （默认 :4100，MOCK_PORT 可覆盖）
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractPath = resolve(__dirname, "../openapi.yaml");
const PORT = Number(process.env.MOCK_PORT ?? 4100);

/** 从契约 yaml 提取 paths 下的路径与 method（2 空格缩进的顶层结构） */
function extractContractPaths() {
  const raw = readFileSync(contractPath, "utf8");
  const map = new Map(); // path -> Set<method>
  let inPaths = false;
  let current = null;
  for (const line of raw.split(/\r?\n/)) {
    if (/^paths:\s*$/.test(line)) {
      inPaths = true;
      continue;
    }
    if (inPaths) {
      const pathMatch = line.match(/^ {2}(\/[^\s:]+):\s*$/);
      if (pathMatch) {
        current = pathMatch[1];
        map.set(current, new Set());
        continue;
      }
      const methodMatch = line.match(/^ {4}(get|post|put|patch|delete|head|options):\s*$/);
      if (methodMatch && current) map.get(current).add(methodMatch[1].toUpperCase());
      if (/^[^\s]/.test(line) && !/^paths:/.test(line)) inPaths = false;
    }
  }
  return map;
}

const CONTRACT = extractContractPaths();

/** /pets/{petId}/timeline 形态 ↔ 实际请求路径匹配 */
function matchContractPath(requestPath) {
  for (const [pattern, methods] of CONTRACT) {
    const regex = new RegExp(
      `^${pattern.replace(/\{[^}]+\}/g, "[^/]+").replace(/\//g, "\\/")}$`
    );
    if (regex.test(requestPath)) return { pattern, methods };
  }
  return null;
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "x-mock-source": "peluvida-contract-skeleton",
    "access-control-allow-origin": "*",
  });
  res.end(body);
}

const server = createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "access-control-allow-headers": "content-type,authorization,x-store-id,idempotency-key",
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  // 契约元信息：GET /__contract 返回路径清单（便于三端自检）
  if (url.pathname === "/__contract") {
    send(res, 200, {
      code: 0,
      msg: "ok",
      data: {
        source: "openapi.yaml（契约骨架）",
        paths: [...CONTRACT.entries()].map(([p, m]) => ({ path: p, methods: [...m] })),
      },
    });
    return;
  }

  const matched = matchContractPath(url.pathname);
  if (!matched) {
    send(res, 404, { code: "MOCK_PATH_NOT_IN_CONTRACT", msg: `路径不在契约中：${url.pathname}`, data: null });
    return;
  }
  if (!matched.methods.has(req.method)) {
    send(res, 405, { code: "MOCK_METHOD_NOT_IN_CONTRACT", msg: `${req.method} 未在契约 ${matched.pattern} 中定义`, data: null });
    return;
  }

  // ?__status=N 模拟异常路径（E2E 异常用例/前端错误态联调用）
  const forced = Number(url.searchParams.get("__status") ?? 0);
  if (forced >= 400) {
    send(res, forced, { code: "MOCK_FORCED_ERROR", msg: `Mock 模拟错误（__status=${forced}）`, data: null });
    return;
  }

  send(res, 200, {
    code: 0,
    msg: "ok",
    data: {
      mock: true,
      contractPath: matched.pattern,
      method: req.method,
      pathParams: Object.fromEntries(url.searchParams.entries()),
      note: "契约骨架 Mock：形状正确，数据非真实",
    },
  });
});

server.listen(PORT, () => {
  console.log(`[mock-server] 契约 Mock 已启动：http://localhost:${PORT}`);
  console.log(`[mock-server] 契约路径 ${CONTRACT.size} 个；示例：GET /__contract 查看清单，?__status=500 模拟错误`);
});
