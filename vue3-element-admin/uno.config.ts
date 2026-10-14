// https://unocss.nodejs.cn/guide/config-file
import {
  defineConfig,
  presetAttributify,
  presetIcons,
  presetUno,
  transformerDirectives,
  transformerVariantGroup,
} from "unocss";

import { FileSystemIconLoader } from "@iconify/utils/lib/loader/node-loaders";
import fs from "fs";
// PeluVida 设计令牌（CROSS-16）：语义色 / 字号唯一来源，构建期内联进 Uno theme
import { SEMANTIC_COLORS, FONT_SIZE_WEB } from "@peluvida/shared";

// 本地SVG图标目录
const iconsDir = "./src/assets/icons";

// 读取本地 SVG 目录，自动生成 safelist
const generateSafeList = () => {
  try {
    return fs
      .readdirSync(iconsDir)
      .filter((file) => file.endsWith(".svg"))
      .map((file) => `i-svg:${file.replace(".svg", "")}`);
  } catch (error) {
    console.error("无法读取图标目录:", error);
    return [];
  }
};

export default defineConfig({
  // 自定义快捷类
  shortcuts: {
    "wh-full": "w-full h-full",
    "flex-center": "flex justify-center items-center",
    "flex-x-center": "flex justify-center",
    "flex-y-center": "flex items-center",
    "flex-x-start": "flex items-center justify-start",
    "flex-x-between": "flex items-center justify-between",
    "flex-x-end": "flex items-center justify-end",
  },
  theme: {
    colors: {
      primary: "var(--el-color-primary)",
      primary_dark: "var(--el-color-primary-light-5)",
      // PeluVida 语义色（CROSS-16，来源 @peluvida/shared SEMANTIC_COLORS）
      info: SEMANTIC_COLORS.info,
      success: SEMANTIC_COLORS.success,
      warning: SEMANTIC_COLORS.warning,
      danger: SEMANTIC_COLORS.danger,
      neutral: SEMANTIC_COLORS.neutral,
    },
    fontSize: {
      // PeluVida 字号 token（Web：20/16/14/12px）
      "page-title": `${FONT_SIZE_WEB.pageTitle}px`,
      "section-title": `${FONT_SIZE_WEB.sectionTitle}px`,
      body: `${FONT_SIZE_WEB.body}px`,
      helper: `${FONT_SIZE_WEB.helper}px`,
    },
    breakpoints: Object.fromEntries(
      [640, 768, 1024, 1280, 1536, 1920, 2560].map((size, index) => [
        ["sm", "md", "lg", "xl", "2xl", "3xl", "4xl"][index],
        `${size}px`,
      ])
    ),
  },
  presets: [
    presetUno(),
    presetAttributify(),
    presetIcons({
      // 额外属性
      extraProperties: {
        display: "inline-block",
        width: "1em",
        height: "1em",
      },
      // 图表集合
      collections: {
        // svg 是图标集合名称，使用 `i-svg:图标名` 调用
        svg: FileSystemIconLoader(iconsDir, (svg) => {
          // 如果 `fill` 没有定义，则添加 `fill="currentColor"`
          return svg.includes('fill="') ? svg : svg.replace(/^<svg /, '<svg fill="currentColor" ');
        }),
      },
    }),
  ],
  safelist: generateSafeList(),
  transformers: [transformerDirectives(), transformerVariantGroup()],
});
