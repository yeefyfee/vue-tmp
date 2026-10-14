/**
 * OpenAPI 契约导出（CROSS-15）
 *
 * 从**当前实现**生成 OpenAPI 文档快照，落 `packages/api-contract/openapi.export.json`：
 *  - CI 每次构建后重新导出并与提交的快照做 git diff —— 接口实现变更未同步快照即红灯
 *    （「实现与契约不一致时 CI 失败」的机械保证）；
 *  - 契约（openapi.yaml，契约先行）与实现导出的一致性比对见
 *    `packages/api-contract/scripts/check-impl-sync.mjs`。
 *
 * 后处理（导出与拦截器的行为对齐）：
 *  1. 所有 JSON 响应包一层统一信封 { code, msg, data }（ResponseInterceptor 在运行期
 *     做同样的事，但 Swagger 元数据不含它，须在此显式表达）；
 *  2. 键序归一化排序，保证快照 diff 稳定（不受 Map 遍历序影响）。
 *
 * 运行（需 PG / Redis 可达，app.init() 会建立连接）：
 *   node ./node_modules/ts-node/dist/bin.js -r tsconfig-paths/register scripts/export-openapi.ts
 */
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import type { OpenAPIObject } from "@nestjs/swagger";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import * as fs from "fs";
import * as path from "path";

const OUT = path.resolve(__dirname, "..", "..", "packages", "api-contract", "openapi.export.json");

/** 递归排序对象键（数组保序），保证快照 diff 稳定 */
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortDeep((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/** 统一信封包裹（与 ResponseInterceptor 的运行期行为一致） */
function envelopeWrap(original: unknown): Record<string, unknown> {
  return {
    type: "object",
    required: ["code", "msg", "data"],
    properties: {
      code: { description: "0=成功；非 0 为错误码（数值或「域_对象_原因」字符串，决策 A4）" },
      msg: { type: "string", description: "提示信息（外层保持 msg，零回归）" },
      data: original ?? { description: "业务数据；无内容时为 null", nullable: true },
    },
  };
}

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });
  try {
    // 与 main.ts 保持一致：前缀必须先于 createDocument（影响文档 paths）
    app.setGlobalPrefix("/api/v1");
    await app.init();

    const config = new DocumentBuilder()
      .setTitle("PeluVida OS")
      .setDescription("PeluVida OS —— 宠物门店数字化经营系统 · 管理端接口文档")
      .setVersion("1.0")
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);

    // 信封后处理：所有 JSON 响应包 { code, msg, data }；
    // 无 content 的响应也补默认信封（运行期拦截器对一切响应生效，文档须显式表达）
    const paths = (document as OpenAPIObject).paths ?? {};
    for (const p of Object.values(paths)) {
      for (const op of Object.values(p as Record<string, unknown>)) {
        if (!op || typeof op !== "object") continue;
        const responses = (op as { responses?: Record<string, unknown> }).responses;
        if (!responses) continue;
        for (const res of Object.values(responses)) {
          const r = res as { content?: Record<string, unknown> };
          const json = r.content?.["application/json"] as { schema?: unknown } | undefined;
          if (json) {
            json.schema = envelopeWrap(json.schema);
          } else {
            r.content = {
              "application/json": { schema: envelopeWrap(undefined) },
            };
          }
        }
      }
    }

    const sorted = sortDeep(document) as OpenAPIObject;
    fs.writeFileSync(OUT, JSON.stringify(sorted, null, 2) + "\n", "utf8");
    const pathCount = Object.keys(paths).length;
    console.log(
      `[export-openapi] 已导出 ${pathCount} 个路径 → packages/api-contract/openapi.export.json`
    );
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error("[export-openapi] 导出失败：", e);
  process.exitCode = 1;
});
