/**
 * PeluVida OS 根 lint-staged 配置（CROSS-03 提交约束）
 *
 * monorepo 要点：staged 文件是仓库根相对路径，而各子工程的 eslint/prettier
 * 需要在各自包目录内运行（flat config 就近解析）。因此统一走
 * `pnpm --filter <pkg> exec <bin>` 并把文件路径重写为包内相对路径。
 *
 * 入口：.husky/pre-commit（pnpm exec lint-staged）
 */
import path from "node:path";

/** 把文件列表转成包内相对路径并拼出 pnpm --filter exec 命令 */
function filterCmd(pkg, bin, args = "") {
  return (filenames) => {
    const files = filenames
      .map((f) => path.relative(pkg, f).replaceAll("\\", "/"))
      .map((f) => (f.includes(" ") ? `"${f}"` : f))
      .join(" ");
    return `pnpm --filter ${pkg} exec ${bin} ${args} ${files}`.trim();
  };
}

export default {
  // 后端 NestJS
  "niulai-nest/{src,scripts,test}/**/*.ts": [
    filterCmd("niulai-nest", "eslint", "--fix"),
    filterCmd("niulai-nest", "prettier", "--write"),
  ],
  "niulai-nest/*.{json,yaml,yml,mjs}": [filterCmd("niulai-nest", "prettier", "--write")],

  // 前端 Vue3
  "vue3-element-admin/src/**/*.{vue,ts,js}": [
    filterCmd("vue3-element-admin", "eslint", "--fix"),
    filterCmd("vue3-element-admin", "prettier", "--write"),
  ],
  "vue3-element-admin/src/**/*.{scss,css}": [
    filterCmd("vue3-element-admin", "stylelint", "--fix"),
    filterCmd("vue3-element-admin", "prettier", "--write"),
  ],
  "vue3-element-admin/**/*.{json,html,md}": [filterCmd("vue3-element-admin", "prettier", "--write")],

  // 共享包
  "packages/shared/src/**/*.ts": [
    filterCmd("@peluvida/shared", "eslint", "--fix"),
    filterCmd("@peluvida/shared", "prettier", "--write"),
  ],

  // 根目录散文件
  "scripts/**/*.mjs": ["eslint --fix", "prettier --write"],
  "*.md": ["prettier --write"],
  "*.{json,yaml,yml}": ["prettier --write"],
};
