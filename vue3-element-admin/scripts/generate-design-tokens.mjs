/**
 * 设计令牌生成脚本（CROSS-16，决策 A5）
 *
 * 从 `@peluvida/shared`（语义色 / 字号的**唯一来源**）生成
 * `src/styles/design-tokens.scss` —— Element Plus 主题变量与语义 CSS 变量。
 *
 * 运行：`node scripts/generate-design-tokens.mjs`
 * 触发时机：`@peluvida/shared` 的 tokens 变更后手动重跑一次（产物入库，供 Review）。
 * ⚠️ 产物为 AUTO-GENERATED，禁止手改；改色值请去 `packages/shared/src/tokens.ts`。
 */
import { createRequire } from "module";
import { writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const root = dirname(fileURLToPath(import.meta.url));

const shared = require("@peluvida/shared");
const { SEMANTIC_COLORS, FONT_SIZE_WEB } = shared;
if (!SEMANTIC_COLORS || !FONT_SIZE_WEB) {
  console.error("[design-tokens] @peluvida/shared 缺少 tokens 导出，请先构建 shared 包");
  process.exit(1);
}

/** Element Plus 变量对齐语义色的映射（--el-color-* → SEMANTIC_COLORS） */
const EP_ALIGNMENT = [
  ["--el-color-info", "info"],
  ["--el-color-success", "success"],
  ["--el-color-warning", "warning"],
  ["--el-color-danger", "danger"],
  ["--el-color-error", "danger"],
];

const lines = [];
lines.push("/**");
lines.push(" * PeluVida 设计令牌（AUTO-GENERATED —— 勿手改）");
lines.push(" * 来源：@peluvida/shared 的 SEMANTIC_COLORS / FONT_SIZE_WEB（决策 A5 唯一来源）");
lines.push(" * 重新生成：node scripts/generate-design-tokens.mjs");
lines.push(" */");
lines.push("");
lines.push(":root {");
for (const [token, hex] of Object.entries(SEMANTIC_COLORS)) {
  lines.push(`  --peluvida-color-${token}: ${hex};`);
}
for (const [epVar, token] of EP_ALIGNMENT) {
  lines.push(`  ${epVar}: ${SEMANTIC_COLORS[token]};`);
}
lines.push(`  --el-font-size-base: ${FONT_SIZE_WEB.body}px;`);
lines.push(`  --el-font-size-small: ${FONT_SIZE_WEB.helper}px;`);
lines.push(`  --el-font-size-medium: ${FONT_SIZE_WEB.sectionTitle}px;`);
lines.push(`  --el-font-size-large: ${FONT_SIZE_WEB.pageTitle}px;`);
lines.push("");
lines.push("  /* 业务侧请优先使用语义 token（--peluvida-*），EP 变量仅作组件对齐 */");
lines.push("  --peluvida-font-page-title: " + FONT_SIZE_WEB.pageTitle + "px;");
lines.push("  --peluvida-font-section-title: " + FONT_SIZE_WEB.sectionTitle + "px;");
lines.push("  --peluvida-font-body: " + FONT_SIZE_WEB.body + "px;");
lines.push("  --peluvida-font-helper: " + FONT_SIZE_WEB.helper + "px;");
lines.push("}");
lines.push("");

const outPath = join(root, "..", "src", "styles", "design-tokens.scss");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, lines.join("\n"), "utf8");
console.log(`[design-tokens] generated ${outPath} (${SEMANTIC_COLORS ? Object.keys(SEMANTIC_COLORS).length : 0} colors)`);
