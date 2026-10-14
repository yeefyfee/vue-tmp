import { SetMetadata } from "@nestjs/common";

/**
 * @Idempotent 装饰器元数据键（P0-07-01）
 *
 * 与 `@Audit()` / `@Log()` 同构：`SetMetadata` 写入、`Reflector` 读取。
 * ⚠️ 读取方（IdempotencyInterceptor）必须对 `Reflector` 做**值导入**——
 * type-only import 不产生运行时值，emitDecoratorMetadata 会把构造参数
 * 序列化为 Object，全局 APP_INTERCEPTOR 注册时 DI 解析失败（项目铁律）。
 */
export const IDEMPOTENT_METADATA = "idempotency_metadata";

/** 默认结果缓存 TTL：24 小时（决策 A4：幂等窗口按天级） */
export const DEFAULT_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

/** 默认处理中占位锁 TTL：60 秒（并发窗口远小于业务处理时长即可） */
export const DEFAULT_IDEMPOTENCY_LOCK_TTL_SECONDS = 60;

/**
 * `@Idempotent()` 可配元数据
 *
 * - `ttlSeconds`：命中结果的缓存时长（默认 24h），窗口内同 key 回放首次结果；
 * - `lockTtlSeconds`：并发生效的「处理中」占位锁时长（默认 60s），
 *   防止同一 key 的并发请求同时穿透到 handler；
 * - `required`：是否强制要求 `Idempotency-Key` 请求头。
 *   - `false`（默认）：缺失则**跳过幂等**（直通 handler）——避免非必需接口
 *     因未携带头而报错，兼容存量调用方；
 *   - `true`：缺失则 400（`A0411`）——支付 / 下单等强一致写接口应启用。
 */
export interface IdempotencyOptions {
  ttlSeconds?: number;
  lockTtlSeconds?: number;
  required?: boolean;
}

/** 规范化后的幂等配置（拦截器消费的最终形态，字段全部有确定值） */
export interface IdempotencyConfig {
  ttlSeconds: number;
  lockTtlSeconds: number;
  required: boolean;
}

/** 将可选入参规范化为确定值配置（非法 TTL 回落默认值，语义与 RedisService.set 一致） */
export function normalizeIdempotencyOptions(options?: IdempotencyOptions): IdempotencyConfig {
  return {
    ttlSeconds:
      typeof options?.ttlSeconds === "number" && options.ttlSeconds > 0
        ? options.ttlSeconds
        : DEFAULT_IDEMPOTENCY_TTL_SECONDS,
    lockTtlSeconds:
      typeof options?.lockTtlSeconds === "number" && options.lockTtlSeconds > 0
        ? options.lockTtlSeconds
        : DEFAULT_IDEMPOTENCY_LOCK_TTL_SECONDS,
    required: options?.required ?? false,
  };
}

/**
 * 幂等装饰器（P0-07-01 · 统一请求适配器约定）
 *
 * **opt-in**：默认不全局启用，仅标注的接口参与幂等判定（避免全站 POST
 * 突然要求 `Idempotency-Key` 打破存量调用与 E2E 基线）。
 *
 * 用法：
 * ```ts
 * @Post()
 * @Idempotent()                       // 默认 24h 窗口；缺失 key 跳过
 * async createStore(@Body() dto: CreateStoreDto) { ... }
 *
 * @Post()
 * @Idempotent({ required: true })     // 支付 / 下单：强制携带 Idempotency-Key
 * async pay() { ... }
 * ```
 */
export const Idempotent = (options: IdempotencyOptions = {}) =>
  SetMetadata(IDEMPOTENT_METADATA, normalizeIdempotencyOptions(options));
