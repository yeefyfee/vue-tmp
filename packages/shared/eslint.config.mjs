/**
 * @peluvida/shared ESLint 基线（CROSS-02 类型红线）
 *
 * shared 是全栈共用的类型/常量/纯函数包，零运行时依赖，
 * 规则从紧：禁 explicit any 与 @ts-ignore（@ts-expect-error 需带 ≥8 字符说明）。
 *
 * 注意：eslint 相关 devDependencies 待用户在仓库根 `pnpm install` 后生效。
 */
import js from "@eslint/js";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**"],
  },

  js.configs.recommended,

  {
    files: ["src/**/*.ts", "test/**/*.cjs"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: ["./tsconfig.json"],
        sourceType: "module",
        ecmaVersion: "latest",
      },
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // CROSS-02 类型红线
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-expect-error": "allow-with-description",
          "ts-ignore": true,
          "minimumDescriptionLength": 8,
        },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-redeclare": "off",
      "@typescript-eslint/no-redeclare": "off",
      "no-undef": "off",
      eqeqeq: ["error", "always"],
      curly: "error",
    },
  },

  {
    files: ["test/**/*.cjs"],
    rules: {
      "no-undef": "off",
    },
  },
];
