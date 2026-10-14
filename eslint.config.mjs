/**
 * PeluVida OS 根 ESLint 基线（CROSS-02）
 *
 * 职责：管理 monorepo 根目录散落的 JS/MJS 文件（scripts/*.mjs 等）。
 * 各子工程（niulai-nest / vue3-element-admin / packages/shared）有各自的
 * flat config，由 `pnpm lint`（turbo run lint）分包执行——本文件不重复覆盖子工程。
 *
 * 类型红线（禁 explicit any / @ts-ignore）在各子工程配置中强制执行：
 * - niulai-nest/eslint.config.mjs
 * - vue3-element-admin/eslint.config.ts
 * - packages/shared/eslint.config.mjs
 */
import js from "@eslint/js";
import globals from "globals";

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.workbuddy/**",
      // 子工程由各自 flat config 与 turbo 编排 lint，根配置只管根散文件
      "niulai-nest/**",
      "vue3-element-admin/**",
      "packages/**",
      "**/*.ts",
      "**/*.tsx",
      "**/*.vue",
    ],
  },

  js.configs.recommended,

  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    languageOptions: {
      sourceType: "module",
      ecmaVersion: "latest",
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    rules: {
      // 根目录脚本是构建/同步工具，允许 console 输出
      "no-console": "off",
    },
  },
];
