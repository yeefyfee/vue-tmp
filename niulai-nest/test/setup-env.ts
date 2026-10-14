/**
 * E2E 环境预载（jest setupFiles，在任何测试模块 import 之前执行）
 *
 * 背景：jest 强制 NODE_ENV=test，而 PeluVida 的真实配置在 `.env.dev`
 * （`.env` 仅存放需手工同步的少量覆盖项）。ConfigModule.forRoot 的 validate
 * 在 AppModule 被 import 时同步执行，因此必须在模块加载前把变量注入 process.env。
 *
 * 语义与 ConfigModule/env.validation 约定一致：先 `.env` 后 `.env.dev`，
 * 已存在的 process.env 一律不覆盖（dotenv 默认行为）。
 */
import { resolve } from "node:path";
import * as dotenv from "dotenv";

dotenv.config({ path: resolve(__dirname, "../.env") });
dotenv.config({ path: resolve(__dirname, "../.env.dev") });
