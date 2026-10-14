/**
 * 安装后自动构建 @peluvida/shared
 *
 * 为什么需要：
 * - `packages/shared/dist` 被 gitignore，干净检出时不存在；
 * - 后端（NestJS / CommonJS）通过 node_modules → `packages/shared/dist` 消费**构建产物**，
 *   若 dist 缺失或过期，后端会 import 解析失败或读到旧值；
 * - 本脚本挂在根 `postinstall`，确保 `pnpm install` 之后 dist 总是就绪。
 *
 * 设计：零依赖、不阻断安装（找不到 typescript 时只警告并正常退出）。
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sharedDir = join(root, "packages", "shared");
const tscEntry = join("node_modules", "typescript", "bin", "tsc");

const candidates = [
  join(sharedDir, tscEntry),
  join(root, tscEntry),
  join(root, "niulai-nest", tscEntry),
  join(root, "vue3-element-admin", tscEntry),
];

const found = candidates.find((p) => existsSync(p));

if (!found) {
  console.warn(
    "[peluvida] 未找到 typescript，已跳过 @peluvida/shared 构建。\n" +
      "           请手动执行：pnpm shared:build"
  );
  process.exit(0);
}

console.log("[peluvida] 构建 @peluvida/shared …");
const result = spawnSync(process.execPath, [found, "-p", "tsconfig.build.json"], {
  cwd: sharedDir,
  stdio: "inherit",
});

if (result.status !== 0) {
  console.error("[peluvida] @peluvida/shared 构建失败，请检查 packages/shared 源码");
  process.exit(result.status ?? 1);
}

console.log("[peluvida] @peluvida/shared 构建完成");
