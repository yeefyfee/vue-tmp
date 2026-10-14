import path from "node:path";
import { fileURLToPath } from "node:url";

import js from "@eslint/js";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import prettierPlugin from "eslint-plugin-prettier";
import prettierConfig from "eslint-config-prettier";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/logs/**",
      "*.config.js",
      ".eslintrc.js",
    ],
  },

  js.configs.recommended,

  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: ["./tsconfig.json"],
        tsconfigRootDir: __dirname,
        sourceType: "module",
        ecmaVersion: "latest",
      },
      globals: {
        ...globals.node,
        ...globals.es2022,
        ...globals.jest,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      prettier: prettierPlugin,
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // CROSS-02 类型红线：禁止显式 any 与 @ts-ignore（@ts-expect-error 允许，未命中时会自身报错）
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-expect-error": "allow-with-description",
          "ts-ignore": true,
          minimumDescriptionLength: 8,
        },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",

      "no-console": "warn",
      "no-debugger": "error",
      "no-undef": "off",
      "no-redeclare": "off",
      eqeqeq: ["error", "always"],
      curly: "error",

      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },

  // 纯 JS 脚本（scripts/*.mjs、*.cjs）：只做 js.configs.recommended 会缺 Node 全局，
  // 于是 process / console / Buffer / setTimeout 全被报成 no-undef（实测 59 条纯噪音）。
  // 这些脚本是项目的校验网（verify-* / audit-* / smoke-boot），必须让 lint 对它们可用。
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
      "no-undef": "off",
      "no-console": "off",
    },
  },

  {
    files: ["**/*.d.ts"],
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-undef": "off",
      // d.ts 描述第三方弱类型 API（velocity/JSZip 等），允许 any
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // 校验脚本（verify-* / audit-* / smoke-boot）为开发期工具，类型收益低，豁免 any 红线
  {
    files: ["scripts/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // 单测 spec 允许 any（mock/断言场景）
  {
    files: ["**/*.spec.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // CROSS-02 存量豁免清单：以下 28 个生产文件含历史 explicit-any（共 78 处），
  // 重构触及对应文件时逐个摘除；不在清单内的文件立即受 no-explicit-any=error 约束。
  {
    files: [
      "src/auth/auth.controller.ts",
      "src/auth/auth.service.ts",
      "src/auth/guards/redis-token.guard.ts",
      "src/auth/strategies/jwt.strategy.ts",
      "src/codegen/codegen.service.ts",
      "src/common/decorators/data-permission.decorator.ts",
      "src/common/filters/http-exception.filter.ts",
      "src/common/guards/data-scope.guard.ts",
      "src/common/guards/jwt-auth.guard.ts",
      "src/common/interceptors/data-permission.interceptor.ts",
      "src/common/interceptors/request.interceptor.ts",
      "src/common/interceptors/response.interceptor.ts",
      "src/common/middleware/request-context.middleware.ts",
      "src/common/redis/redis.service.ts",
      "src/common/utils/serialize.util.ts",
      "src/file/file.controller.ts",
      "src/file/file.service.ts",
      "src/message/sse-session-registry.service.ts",
      "src/message/sse.controller.ts",
      "src/message/sse.service.ts",
      "src/system/dept/dept.controller.ts",
      "src/system/log/logging.interceptor.ts",
      "src/system/menu/dto/create-menu.dto.ts",
      "src/system/menu/menu.controller.ts",
      "src/system/menu/menu.service.ts",
      "src/system/role/role.controller.ts",
      "src/system/user/dto/update-user.dto.ts",
      "src/system/user/user.service.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  prettierConfig,
];
