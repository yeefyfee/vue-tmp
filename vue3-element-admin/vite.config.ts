import vue from "@vitejs/plugin-vue";
import type { PluginOption } from "vite";
import { type ConfigEnv, type UserConfig, loadEnv, defineConfig } from "vite";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import fs from "fs";

import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { ElementPlusResolver } from "unplugin-vue-components/resolvers";
import { mockDevServerPlugin } from "vite-plugin-mock-dev-server";
import UnoCSS from "unocss/vite";

// 兼容 Windows ESM 路径（替代 import.meta.dirname）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pathSrc = resolve(__dirname, "src");

// 安全读取package.json，规避import json解析失败
const pkgRaw = fs.readFileSync(resolve(__dirname, "./package.json"), "utf-8");
const pkg = JSON.parse(pkgRaw);
const { name, version } = pkg;

// 平台名称、版本信息
const __APP_INFO__ = {
  pkg: { name, version },
  buildTimestamp: Date.now(),
};

// Vite配置  https://cn.vitejs.dev/config
export default defineConfig(({ mode }: ConfigEnv): UserConfig => {
  const env = loadEnv(mode, process.cwd());

  return {
    resolve: {
      alias: {
        "@": pathSrc,
      },
    },
    css: {
      preprocessorOptions: {
        scss: {
          additionalData: `@use "@/styles/variables.scss" as *;`,
        },
      },
    },
    server: {
      host: "0.0.0.0",
      port: Number(env.VITE_APP_PORT || 9527),
      open: true,
      proxy: {
        [env.VITE_APP_BASE_API]: {
          changeOrigin: true,
          target: env.VITE_APP_API_URL,
          rewrite: (path: string) => path.replace(new RegExp(`^${env.VITE_APP_BASE_API}`), ""),
        },
      },
    },
    plugins: [
      vue(),
      ...(env.VITE_MOCK_DEV_SERVER === "true" ? [mockDevServerPlugin()] : []),
      UnoCSS(),
      AutoImport({
        imports: ["vue", "@vueuse/core", "pinia", "vue-router", "vue-i18n"],
        resolvers: [ElementPlusResolver({ importStyle: "sass" })],
        eslintrc: {
          enabled: false,
          filepath: "./.eslintrc-auto-import.json",
          globalsPropValue: true,
        },
        vueTemplate: true,
        dts: false,
      }),
      Components({
        resolvers: [ElementPlusResolver({ importStyle: "sass" })],
        dirs: ["src/components", "src/**/components"],
        dts: false,
      }),
    ] as PluginOption[],
    optimizeDeps: {
      include: [
        "vue",
        "vue-router",
        "element-plus",
        "pinia",
        "axios",
        "@vueuse/core",
        "codemirror-editor-vue3",
        "exceljs",
        "path-to-regexp",
        "echarts/core",
        "echarts/renderers",
        "echarts/charts",
        "echarts/components",
        "vue-i18n",
        "nprogress",
        "sortablejs",
        "qs",
        "vxe-table",
        "path-browserify",
        "lodash-es",
        "@element-plus/icons-vue",
        "element-plus/es",
        "element-plus/es/locale/lang/en",
        "element-plus/es/locale/lang/zh-cn",
        ...[
          "alert",
          "avatar",
          "backtop",
          "badge",
          "base",
          "breadcrumb",
          "breadcrumb-item",
          "button",
          "card",
          "cascader",
          "checkbox",
          "checkbox-group",
          "checkbox-button",
          "col",
          "color-picker",
          "config-provider",
          "collapse-transition",
          "date-picker",
          "descriptions",
          "descriptions-item",
          "dialog",
          "divider",
          "drawer",
          "dropdown",
          "dropdown-item",
          "dropdown-menu",
          "empty",
          "form",
          "form-item",
          "icon",
          "image",
          "image-viewer",
          "input",
          "input-number",
          "input-tag",
          "link",
          "loading",
          "menu",
          "menu-item",
          "message",
          "message-box",
          "notification",
          "option",
          "pagination",
          "popover",
          "progress",
          "radio",
          "radio-button",
          "radio-group",
          "row",
          "scrollbar",
          "select",
          "skeleton",
          "skeleton-item",
          "space",
          "step",
          "steps",
          "sub-menu",
          "switch",
          "tab-pane",
          "table",
          "table-column",
          "tabs",
          "tag",
          "text",
          "time-picker",
          "time-select",
          "timeline",
          "timeline-item",
          "tooltip",
          "tree",
          "tree-select",
          "upload",
          "watermark",
        ].map((c) => `element-plus/es/components/${c}/style/index`),
      ],
    },
    build: {
      chunkSizeWarningLimit: 1200,
      reportCompressedSize: false,
      cssMinify: "lightningcss",
      rolldownOptions: {
        checks: { pluginTimings: false },
        output: {
          entryFileNames: "js/[name].[hash].js",
          chunkFileNames: "js/[name].[hash].js",
          assetFileNames: (assetInfo) => {
            const assetName = assetInfo.names[0];
            if (!assetName) return "assets/[name].[hash][extname]";
            const info = assetName.split(".");
            let extType = info[info.length - 1];
            if (/\.(mp4|webm|ogg|mp3|wav|flac|aac)(\?.*)?$/i.test(assetName)) extType = "media";
            else if (/\.(png|jpe?g|gif|svg)(\?.*)?$/.test(assetName)) extType = "img";
            else if (/\.(woff2?|eot|ttf|otf)(\?.*)?$/i.test(assetName)) extType = "fonts";
            return `${extType}/[name].[hash].[ext]`;
          },
        },
      },
    },
    define: {
      __APP_INFO__: JSON.stringify(__APP_INFO__),
    },
  };
});
