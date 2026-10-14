#!/usr/bin/env node
/**
 * PeluVida OS 红线检查（CROSS-05：R01–R11 自动化）
 *
 * 规则映射（R 编号在此固化，全文任务与本脚本冲突处以此为准）：
 *   R01  删测试               删除 *.spec.ts / *.test.* / test/** 文件              → FAIL
 *   R02  跳校验               新增 it.skip/describe.skip/test.skip/@ts-nocheck/
 *                             eslint-disable no-explicit-any 等绕过语句            → FAIL
 *   R03  硬编码密钥           源码新增行内 password/secret/apiKey/token 字面量       → FAIL
 *                             （排除占位符与 .env* 文件本身）
 *   R04  越权改公共模块       改动 niulai-nest/src/common/** 或 packages/shared/**  → WARN（CODEOWNERS 强制 owner review 兜底）
 *   R05  擅改数据模型         改动 packages/db/prisma/**（schema 与迁移，CROSS-08 归位）→ WARN（数据模型变更须随任务单声明）
 *   R06  擅改权限             改动 shared/rbac.ts、common/guards、auth 鉴权链       → WARN
 *   R07  擅改 API 名          改动 packages/api-contract/**（契约变更须评审）        → WARN
 *   R08  绕租户隔离           新增 $queryRaw/$executeRaw（冻结基线：禁手写原生 SQL）→ FAIL
 *   R09  伪造测试             新增 expect(true)/toBe(1) 恒真断言、测试内 skip       → FAIL
 *   R10  引入未约定依赖       package.json 新依赖不在白名单
 *                             （scripts/red-line-allowlist.json）                   → FAIL
 *   R11  泄露敏感信息         sk-/AKIA/私钥块/带密码连接串；.env* 被 git 跟踪        → FAIL
 *   RX   禁区功能重建           新增 game/suno/wxma 等已剥离业务模块路径               → FAIL（附加项）
 *
 * 用法：
 *   node scripts/check-red-lines.mjs --base <sha>   # CI：扫描 <sha>..HEAD 的变更（含新增行）
 *   node scripts/check-red-lines.mjs                # 本地：扫描工作区未提交变更
 *   node scripts/check-red-lines.mjs --all          # 全量扫描所有受检源码（验收/巡检）
 *
 * 退出码：存在 FAIL → 1（阻塞 CI）；仅 WARN → 0（GitHub 告警输出）。
 * 零依赖：仅用 node 内置模块。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const args = process.argv.slice(2);

/* ────────────────────────── 规则常量 ────────────────────────── */

/** 源码扫描范围（R02/R03/R08/R09/R11 行级规则的受检文件） */
const SOURCE_GLOBS = [
  /^niulai-nest\/src\//,
  /^packages\/[^/]+\/src\//,
  /^vue3-element-admin\/src\//,
];

/** 禁区功能路径（PEL-02/03 已剥离的业务模块，重建即违规） */
const FORBIDDEN_PATHS = [
  /niulai-nest\/src\/(game|suno|wxma)\//,
  /vue3-element-admin\/src\/(game|suno|wxma)\//,
  /mini_game\//,
  /app_portal\//,
];

const SKIP_PATTERN =
  /\b(it|test|describe)\.skip\b|\bxit\(|\bxdescribe\b|\bit\.only\b|\btest\.only\b/;

const BYPASS_PATTERN =
  /@ts-nocheck|eslint-disable[^\n]*no-explicit-any|eslint-disable[^\n]*@typescript-eslint\/ban-ts-comment/;

/** 硬编码凭据：键名 = ≥12 字符的字母数字混合字面量，且值 ≠ 键名本身（排除枚举/fixture 误报） */
const HARDCODED_SECRET_PATTERN =
  /\b(password|passwd|secret|secretKey|accessKeySecret|apiKey|api_key|token)\b\s*[:=]\s*["']([^"']{12,})["']/i;
const SECRET_PLACEHOLDER =
  /^(change_me|your[_-]|xxx|placeholder|\$\{|\$\{|process\.env|<[^>]+>|exemple|dummy|sample|test[_-]?secret|minioadmin)/i;

/** 原生 SQL 存量豁免（PEL 基线合法用途，冻结清单——新文件使用原生 SQL 立即报错） */
const RAW_SQL_EXEMPT_FILES = new Set([
  "niulai-nest/src/codegen/codegen.service.ts", // 代码生成器的表内省（information_schema 查询）是功能本质
  "niulai-nest/src/common/prisma/prisma.service.ts", // SELECT 1 健康探活
  "niulai-nest/src/system/log/log.service.ts", // 日志按天分组 to_char AT TIME ZONE（移植铁律 #4 的既定实现）
  "niulai-nest/src/system/role/role-permission.service.ts", // 角色-权限聚合树查询
]);

/** 原生 SQL（冻结基线禁手写 SQL；Prisma 引擎/迁移文件豁免） */
const RAW_SQL_PATTERN = /\$(queryRaw|executeRaw)(Unsafe)?\s*[<(`]/;

/** 伪造测试：恒真断言 */
const FAKE_ASSERT_PATTERN =
  /expect\(\s*(true|1)\s*\)|\.toBe\(1\)\s*;?\s*\/\/\s*always|expect\( Boolean\(true\) \)/;

/** 泄露敏感信息的高危串 */
const LEAK_PATTERNS = [
  { name: "OpenAI/DashScope Key", re: /\bsk-[a-zA-Z0-9]{20,}\b/ },
  { name: "AWS AccessKeyId", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "私钥块", re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  // 连接串：用户:密码@ 形态；排除 ${...} 模板插值段（拼装模板不是泄露）
  {
    name: "带密码连接串",
    re: /(postgres(ql)?|mysql|redis|mongodb(\+srv)?):\/\/[^:\s"'@]+:(?!\$\{)[^@\s"'{]{8,}@/,
  },
];

/** R04/R06/R07 的关注路径（WARN 级） */
const WARN_PATH_RULES = [
  {
    id: "R04",
    label: "越权改公共模块",
    test: (f) => /^niulai-nest\/src\/common\//.test(f) || /^packages\/shared\//.test(f),
  },
  {
    id: "R06",
    label: "擅改权限",
    test: (f) =>
      /packages\/shared\/src\/rbac\.ts$/.test(f) ||
      /^niulai-nest\/src\/common\/guards\//.test(f) ||
      /^niulai-nest\/src\/auth\//.test(f),
  },
  { id: "R07", label: "擅改 API 名", test: (f) => /^packages\/api-contract\//.test(f) },
  {
    id: "R05",
    label: "擅改数据模型",
    test: (f) => /prisma\/schema\.prisma$/.test(f) || /prisma\/migrations\//.test(f),
  },
];

/* ────────────────────────── 基础设施 ────────────────────────── */

function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", cwd: ROOT });
  } catch (err) {
    if (err.code === "EBUSY") {
      console.error(
        "[red-lines] 子进程 git 调用被系统拦截（EBUSY）。diff 模式需要 git；请改用 --all（纯文件系统扫描）或在正常终端运行。"
      );
      process.exit(2);
    }
    throw err;
  }
}

/** --all 模式：纯 fs 递归遍历受检源码目录（不依赖 git，兼容受限环境） */
function walkSources(dir, rel = "", out = []) {
  const SKIP_DIRS = new Set([
    "node_modules",
    "dist",
    ".git",
    ".workbuddy",
    "coverage",
    "logs",
    ".husky",
  ]);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      walkSources(abs, relPath, out);
    } else if (
      isSourceFile(relPath) ||
      (/(^|\/)package\.json$/.test(relPath) && !isExcludedFromLineScan(relPath))
    ) {
      out.push(relPath);
    }
  }
  return out;
}

const findings = [];
function report(id, level, message) {
  findings.push({ id, level, message });
}

function isSourceFile(f) {
  return SOURCE_GLOBS.some((re) => re.test(f));
}

function isExcludedFromLineScan(f) {
  // .env* 文件本身不扫行级凭据（R11 用「git 跟踪」规则覆盖它）；锁文件与产物排除
  return /\.env/.test(path.basename(f)) || /pnpm-lock\.yaml$/.test(f) || /^.*\/dist\//.test(f);
}

/* ────────────────────────── 变更集收集 ────────────────────────── */

/** @returns {{mode:'diff'|'all', files:Set<string>, addedLines:Map<string,string[]>}} */
function collectChanges() {
  const addedLines = new Map();
  const files = new Set();

  if (args.includes("--all")) {
    // 全量模式：fs 遍历受检源码，整文件内容作为「新增行」（不依赖 git，可在受限环境运行）
    const found = walkSources(ROOT);
    for (const f of found) {
      files.add(f);
      const abs = path.join(ROOT, f);
      addedLines.set(f, fs.readFileSync(abs, "utf8").split(/\r?\n/));
    }
    return { mode: "all (filesystem)", files, addedLines };
  }

  // diff 模式
  let base = null;
  const baseIdx = args.indexOf("--base");
  if (baseIdx !== -1 && args[baseIdx + 1]) base = args[baseIdx + 1];

  let diffOut;
  if (base) {
    diffOut = git(["diff", "-U0", `${base}...HEAD`]);
  } else {
    diffOut = git(["diff", "-U0", "HEAD"]); // 工作区未提交变更
  }

  let currentFile = null;
  for (const line of diffOut.split(/\r?\n/)) {
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (fileMatch) {
      currentFile = fileMatch[1];
      files.add(currentFile);
      continue;
    }
    if (/^\+\+\+|^---|^@@|^diff |^index /.test(line) || !currentFile) continue;
    if (!line.startsWith("+")) continue;
    const content = line.slice(1);
    if (isExcludedFromLineScan(currentFile)) continue;
    if (!addedLines.has(currentFile)) addedLines.set(currentFile, []);
    addedLines.get(currentFile).push(content);
  }

  // 删除文件清单（R01）
  const nameStatus = base
    ? git(["diff", "--name-status", `${base}...HEAD`])
    : git(["diff", "--name-status", "HEAD"]);
  for (const line of nameStatus.split("\n")) {
    const m = line.match(/^D\t(.+)$/);
    if (m) files.add(`__deleted__:${m[1]}`);
  }

  return { mode: base ? `diff ${base}..HEAD` : "diff (working tree)", files, addedLines };
}

/* ────────────────────────── 检查器 ────────────────────────── */

function checkDeletedTests(files) {
  for (const f of files) {
    if (!f.startsWith("__deleted__:")) continue;
    const p = f.slice("__deleted__:".length);
    if (
      /\.spec\.tsx?$/.test(p) ||
      /\.test\.[tj]sx?$/.test(p) ||
      /(^|\/)test\/.+\.tsx?$/.test(p) ||
      /(^|\/)e2e\/.+\.tsx?$/.test(p)
    ) {
      report("R01", "FAIL", `删除了测试文件：${p}`);
    }
  }
}

function checkAddedLines(files, addedLines) {
  for (const [f, lines] of addedLines) {
    if (!isSourceFile(f)) continue;

    if (FORBIDDEN_PATHS.some((re) => re.test(f))) {
      report("RX", "FAIL", `禁区功能路径（已剥离业务模块不得重建）：${f}`);
    }

    for (const ln of lines) {
      if (SKIP_PATTERN.test(ln) && /\.spec\.|\.test\.|\/test\//.test(f)) {
        report("R02", "FAIL", `${f}: 跳过测试（${ln.trim().slice(0, 80)}）`);
      }
      if (BYPASS_PATTERN.test(ln)) {
        report("R02", "FAIL", `${f}: 绕过类型红线（${ln.trim().slice(0, 80)}）`);
      }
      const secret = ln.match(HARDCODED_SECRET_PATTERN);
      if (secret && !SECRET_PLACEHOLDER.test(secret[2])) {
        report("R03", "FAIL", `${f}: 疑似硬编码凭据（键 ${secret[1]}，值已隐去）`);
      }
      if (
        RAW_SQL_PATTERN.test(ln) &&
        !/prisma\/migrations\//.test(f) &&
        !RAW_SQL_EXEMPT_FILES.has(f)
      ) {
        report(
          "R08",
          "FAIL",
          `${f}: 手写原生 SQL（${ln.trim().slice(0, 60)}）——冻结基线禁止；如确属框架级基础设施，请在 RAW_SQL_EXEMPT_FILES 登记理由`
        );
      }
      if (FAKE_ASSERT_PATTERN.test(ln) && /\.spec\.|\.test\./.test(f)) {
        report("R09", "FAIL", `${f}: 伪造断言（${ln.trim().slice(0, 80)}）`);
      }
      for (const { name, re } of LEAK_PATTERNS) {
        if (re.test(ln)) {
          report("R11", "FAIL", `${f}: 疑似泄露${name}（内容已隐去）`);
        }
      }
    }
  }
}

function checkWarnPaths(files) {
  for (const f of files) {
    if (f.startsWith("__deleted__:")) continue;
    for (const rule of WARN_PATH_RULES) {
      if (rule.test(f)) {
        report(rule.id, "WARN", `触碰「${rule.label}」关注路径：${f}（须在任务单中声明变更理由）`);
      }
    }
  }
}

function checkDependencies(files, addedLines) {
  const pkgFiles = [...files].filter(
    (f) => /(^|\/)package\.json$/.test(f) && !f.startsWith("__deleted__:")
  );
  if (pkgFiles.length === 0) return;

  let allow = { dependencies: [], devDependencies: [] };
  const allowPath = path.join(ROOT, "scripts", "red-line-allowlist.json");
  if (fs.existsSync(allowPath)) {
    allow = JSON.parse(fs.readFileSync(allowPath, "utf8"));
  }

  for (const f of pkgFiles) {
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));
    } catch {
      continue;
    }
    for (const section of ["dependencies", "devDependencies"]) {
      const deps = pkg[section] || {};
      const allowed = new Set([
        ...(allow[section] || []),
        ...(allow[section === "dependencies" ? "devDependencies" : "dependencies"] || []),
      ]);
      // 全量模式下新旧对比不可得，只报告白名单完全缺失的；diff 模式下若 package.json 被改则逐项查
      for (const name of Object.keys(deps)) {
        const isChangedLine = addedLines.get(f)?.some((l) => l.includes(`"${name}"`)) ?? true;
        if (!allowed.has(name) && (addedLines.size === 0 || isChangedLine)) {
          report(
            "R10",
            "FAIL",
            `${f}: 引入未约定依赖「${name}」（${section}）——先在 scripts/red-line-allowlist.json 登记并说明用途`
          );
        }
      }
    }
  }
}

function checkTrackedEnv() {
  const tracked = git(["ls-files"]).split("\n").filter(Boolean);
  for (const f of tracked) {
    if (
      /\.env($|\.[^.]+$)/.test(path.basename(f)) &&
      f !== ".env.example" &&
      !/\.env\.example/.test(f)
    ) {
      report("R11", "FAIL", `敏感文件被 git 跟踪：${f}（.env* 只允许 .env.example 入库）`);
    }
  }
}

/* ────────────────────────── 主流程 ────────────────────────── */

const { mode, files, addedLines } = collectChanges();

checkDeletedTests(files);
checkAddedLines(files, addedLines);
checkWarnPaths(files);
checkDependencies(files, addedLines);
// R11 子项「.env* 被 git 跟踪」需要 git；--all 纯 fs 模式跳过（CI diff 模式生效）
if (!args.includes("--all")) {
  checkTrackedEnv();
}

const fails = findings.filter((f) => f.level === "FAIL");
const warns = findings.filter((f) => f.level === "WARN");

console.log(`\n[red-lines] 检查模式：${mode}`);
console.log(
  `[red-lines] 变更文件 ${files.size} 个，命中 FAIL=${fails.length}，WARN=${warns.length}\n`
);

for (const f of warns) console.log(`  ⚠️  [${f.id}] ${f.message}`);
for (const f of fails) console.log(`  ❌ [${f.id}] ${f.message}`);

if (fails.length > 0) {
  console.error(
    `\n[red-lines] ❌ 触碰红线 ${fails.length} 处，禁止合并。处理方式：删除违规内容，或（依赖类）在 scripts/red-line-allowlist.json 登记约定。`
  );
  process.exit(1);
}
if (warns.length > 0) {
  console.log(
    `\n[red-lines] ⚠️  有 ${warns.length} 处 WARN 级变更（公共模块/数据模型/权限/契约），请确认已在任务单声明。`
  );
}
console.log("\n[red-lines] ✅ 红线检查通过");
