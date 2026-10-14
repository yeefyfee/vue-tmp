import eslint from "@eslint/js";
import globals from "globals";
import * as typescriptEslint from "typescript-eslint";
import pluginVue from "eslint-plugin-vue";
import vueParser from "vue-eslint-parser";
import configPrettier from "eslint-config-prettier";
import fs from "node:fs";

let autoImportGlobals: Record<string, "readonly"> = {};
try {
  autoImportGlobals =
    JSON.parse(fs.readFileSync("./.eslintrc-auto-import.json", "utf-8")).globals || {};
} catch (error) {
  console.warn("Could not load auto-import globals", error);
}

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/*.min.*",
      "**/auto-imports.d.ts",
      "**/components.d.ts",
      "types/**/*.d.ts",
    ],
  },

  eslint.configs.recommended,
  ...pluginVue.configs["flat/recommended"],
  ...typescriptEslint.configs.recommended,

  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts,vue}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2022,
        ...autoImportGlobals,
        __APP_INFO__: "readonly",
      },
    },
    plugins: {
      vue: pluginVue,
      "@typescript-eslint": typescriptEslint.plugin,
    },
    rules: {
      // 基础规则
      "no-console": ["error", { allow: ["warn", "error", "debug"] }],
      "no-debugger": "error",

      // ES6+ 规则
      "prefer-const": "error",
      "no-var": "error",
      "object-shorthand": "error",

      // 最佳实践
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-multi-spaces": "error",
      "no-multiple-empty-lines": ["error", { max: 1, maxBOF: 0, maxEOF: 0 }],

      // 禁用与 TypeScript 冲突的规则
      "no-unused-vars": "off",
      "no-undef": "off",
      "no-redeclare": "off",
      // CROSS-02 类型红线：禁 @ts-ignore（@ts-expect-error 需带 ≥8 字符说明）
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-expect-error": "allow-with-description",
          "ts-ignore": true,
          minimumDescriptionLength: 8,
        },
      ],
    },
  },

  {
    files: ["**/*.vue"],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        parser: typescriptEslint.parser,
        extraFileExtensions: [".vue"],
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      "vue/multi-word-component-names": "off",
      "vue/no-v-html": "off",
      "vue/require-default-prop": "off",
      "vue/require-explicit-emits": "error",
      "vue/no-unused-vars": "error",
      "vue/no-mutating-props": "off",
      "vue/valid-v-for": "warn",
      "vue/no-template-shadow": "warn",
      "vue/return-in-computed-property": "warn",
      "vue/block-order": [
        "error",
        {
          order: ["template", "script", "style"],
        },
      ],
      "vue/html-self-closing": [
        "error",
        {
          html: {
            void: "always",
            normal: "never",
            component: "always",
          },
          svg: "always",
          math: "always",
        },
      ],
      "vue/component-name-in-template-casing": ["error", "PascalCase"],
      // CROSS-02 类型红线：vue SFC 同样禁显式 any
      "@typescript-eslint/no-explicit-any": "error",
    },
  },

  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      parser: typescriptEslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      // CROSS-02 类型红线：禁显式 any 与 @ts-ignore（@ts-expect-error 需带说明）
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-expect-error": "allow-with-description",
          "ts-ignore": true,
          minimumDescriptionLength: 8,
        },
      ],
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-unused-expressions": "warn",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          fixStyle: "separate-type-imports",
          prefer: "type-imports",
        },
      ],
      "@typescript-eslint/no-import-type-side-effects": "error",
    },
  },

  {
    files: ["**/*.d.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },

  {
    files: ["**/components/CURD/**/*.{ts,vue}"],
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      // CURD 为上游模板代码生成区，存量 @ts-ignore 集中于此（PageModal/PageSearch）
      "@typescript-eslint/ban-ts-comment": "off",
    },
  },

  // CROSS-02 存量豁免清单：以下 8 个文件含历史 explicit-any（共 23 处，上游 vue3-element-admin 存量），
  // 重构触及对应文件时逐个摘除；不在清单内的文件立即受 no-explicit-any=error 约束。
  // 已摘除：src/utils/request.ts（01-06 全局请求层重写后 0 处 explicit-any）。
  {
    files: [
      "src/components/TableSelect/index.vue",
      "src/components/InputTag/index.vue",
      "src/components/DictSelect/index.vue",
      "src/components/Upload/FileUpload.vue",
      "src/components/WangEditor/index.vue",
      "src/components/IconSelect/index.vue",
      "src/utils/download.ts",
      "src/views/system/user/components/UserImportDialog.vue",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  {
    rules: {
      ...configPrettier.rules,
      "arrow-body-style": "off",
      "prefer-arrow-callback": "off",
    },
  },
];
