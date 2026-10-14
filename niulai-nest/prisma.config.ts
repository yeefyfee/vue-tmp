/**
 * Prisma CLI 配置（PEL-10）
 *
 * Prisma 7 起，数据源连接串不再允许写在 schema.prisma 内，改为在此处提供。
 *
 * 环境变量加载顺序刻意对齐 Nest 的 ConfigModule 约定：
 *   先 `.env`（先加载者优先），再 `.env.<NODE_ENV || dev>`；
 *   已存在的 process.env 一律不覆盖（与 dotenv 行为一致）。
 * 这样 `pnpm prisma:migrate` 与 `pnpm start:dev` 读到的库完全一致，不会出现
 * 「CLI 连 A 库、应用连 B 库」这类最难查的错配。
 */
import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "prisma/config";

/**
 * 自 cwd 向上查找后端工程根（以 Nest 入口 src/main.ts 为标记）。
 * 刻意不用 import.meta.dirname / __dirname：前者要求 ESM，后者在 ESM 下未定义，
 * 而这个文件既会被 Prisma CLI 以 TS 加载，也会被 tsc 静态检查（工程为 CJS）。
 *
 * CROSS-08 起 schema 唯一存放于 <仓库根>/packages/db/prisma/（本文件仍在 niulai-nest），
 * 故 ROOT 只负责定位 .env 所在的后端工程根；schema / migrations 路径见文件底部 defineConfig。
 */
function findBackendRoot(start: string = process.cwd()): string {
  let dir = start;
  for (;;) {
    if (fs.existsSync(path.join(dir, "src", "main.ts"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

const ROOT = findBackendRoot();
/** 仓库根 = 后端工程根的上一级（逻辑 monorepo 布局，物理迁移 A3 后再调整） */
const REPO_ROOT = path.resolve(ROOT, "..");
/** schema 唯一存放地（CROSS-08）：packages/db/prisma */
const DB_DIR = path.join(REPO_ROOT, "packages", "db", "prisma");

function loadEnvFile(fileName: string) {
  const file = path.join(ROOT, fileName);
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(".env");
loadEnvFile(`.env.${process.env.NODE_ENV || "dev"}`);

// 刻意不用 env("DATABASE_URL")：该 helper 在变量缺失时直接抛错，
// 会让 `prisma generate`（不需要连库）在干净检出 / CI 上莫名失败。
if (!process.env.DATABASE_URL) {
  const c = (k: string, d = "") => process.env[k] ?? d;
  process.env.DATABASE_URL =
    `postgresql://${c("PG_USER", "postgres")}:${encodeURIComponent(c("PG_PASSWORD"))}` +
    `@${c("PG_HOST", "localhost")}:${c("PG_PORT", "5432")}/${c("PG_DB", "peluvida_dev")}`;
}

export default defineConfig({
  // 绝对路径：与发起 CLI 的 cwd 无关（schema 已归位 packages/db，见 CROSS-08）
  schema: path.join(DB_DIR, "schema.prisma"),
  migrations: {
    path: path.join(DB_DIR, "migrations"),
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
