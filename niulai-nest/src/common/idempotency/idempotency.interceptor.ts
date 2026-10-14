import {
  Injectable,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
// Reflector 必须值导入：type-only import 不产生运行时值，emitDecoratorMetadata
// 会把构造参数序列化为 Object，DI 无法识别 → APP_INTERCEPTOR 全局注册时解析失败
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import { createHash } from "node:crypto";
import { from, mergeAll, of, throwError, type Observable } from "rxjs";
import { catchError, mergeMap } from "rxjs/operators";

import { RequestContext } from "../context/request-context";
import { RedisService } from "../redis/redis.service";
import { BusinessException } from "../exceptions/business.exception";
import { ErrorCode } from "../enums/error-code.enum";
import { IDEMPOTENT_METADATA, type IdempotencyConfig } from "./idempotency.decorator";

/**
 * 幂等命中的缓存载荷（P0-07-01）
 *
 * - `fingerprint`：请求指纹（method + route + body 的 sha256），用于「同 key
 *   不同请求体」的误用检测；
 * - `statusCode`：首次响应状态码（回放时还原，保证 status 一致）；
 * - `body`：首次响应的**最终信封**（`{ code, msg, data }`，已过 ResponseInterceptor
 *   日期格式化），回放时原样返回以保证 body 字节级一致。
 */
interface StoredIdempotentResult {
  fingerprint: string;
  statusCode: number;
  body: unknown;
}

/** 幂等锁获取结果：`true` 已抢到 / `false` 被占用 / `null` Redis 异常（fail-open） */
type LockResult = boolean | null;

/**
 * 幂等拦截器（P0-07-01 · 统一请求适配器约定 · 决策 A4）
 *
 * 仅在标注 `@Idempotent()` 的路由上生效（读取方法/类级元数据），其余路由直通。
 *
 * ## 为什么用全局 `APP_INTERCEPTOR`（而非 `@UseInterceptors`）注册
 *
 * Nest 拦截器链顺序为 `[...APP_INTERCEPTOR 全局, ...类级, ...方法级]`，且
 * **`app.useGlobalInterceptors(new ResponseInterceptor())` 在 `NestFactory.create`
 * 之后追加**，故 `APP_INTERCEPTOR` 位于 `ResponseInterceptor` **上游（外层）**。
 * 三点关键收益：
 *  1. 本拦截器的 `next.handle()` 发出的即 `ResponseInterceptor` 加工后的
 *     **最终信封** `{ code, msg, data }` —— 可原样缓存、原样回放，不受日期
 *     序列化二次加工影响（`body` 字节级一致）；
 *  2. 回放时直接 `of(缓存信封)` 短路，不调用 `next.handle()`，因此
 *     `ResponseInterceptor` 不会对回放值二次包装；
 *  3. opt-in 语义（无 `@Idempotent` 元数据即直通）与 `AuditInterceptor`（P0-02-08）
 *     完全一致，不改变存量 50 例 E2E 行为。
 *
 * 若改用 `@UseInterceptors`（方法级）注册，拦截器会落在 `ResponseInterceptor`
 * **下游（内层）**，`next.handle()` 只能拿到 handler 原始返回值，缓存/回放会遇到
 * Date 对象 JSON 化（→ ISO 串）与 ResponseInterceptor 二次加工的不一致问题。
 *
 * ## 幂等协议
 *
 * - **首次请求**：`SET NX EX` 抢占「处理中」占位锁（短 TTL）→ 执行 handler →
 *   缓存最终信封（状态码 + body + 指纹，长 TTL）→ 释放锁 → 正常返回。
 * - **重复请求**：命中已缓存结果 → 返回首次结果（同 status/body）+ 响应头
 *   `Idempotency-Replayed: true`。
 * - **并发同 key**：未抢到锁且首次请求仍在处理中 → 409（`A0408`「请求处理中」）。
 * - **指纹不符**：同 key 但请求体不同 → 409（`A0409`「幂等键已用于不同的请求」）。
 * - **失败不缓存**：handler 抛错时不写缓存、立即释放锁（允许调用方修正后重试）。
 * - **Redis 异常 fail-open**：锁/读取异常时直接执行 handler（幂等是保护机制，
 *   不因 Redis 抖动阻断正常写链路），并记 warn 日志。
 *
 * ## 键命名空间（键规范 CROSS-10）
 *
 * - 结果键：`idem:{method}:{route}:{key}`
 * - 锁 键：`idem:{method}:{route}:{key}:lock`
 *
 * `RedisService` 在**有租户上下文时自动追加** `tenant:<id>:` 前缀（PEL-11），
 * 本拦截器**不再重复拼租户**；无租户上下文（平台级接口）照常工作。
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly redis: RedisService,
    private readonly reflector: Reflector
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // 仅 HTTP；RPC/WS 等上下文不参与
    if (context.getType() !== "http") {
      return next.handle();
    }

    // opt-in：无 @Idempotent 元数据一律直通（默认不全局启用）
    const config = this.reflector.getAllAndOverride<IdempotencyConfig>(IDEMPOTENT_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!config) {
      return next.handle();
    }

    const idempotencyKey = RequestContext.getIdempotencyKey();
    if (!idempotencyKey) {
      // 缺失幂等键：required=true 强一致写接口拒绝（A0411）；
      // 否则跳过幂等直通（兼容存量非必需写接口，见装饰器 required 说明）
      if (config.required) {
        throw new BusinessException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED);
      }
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();

    const method = String(req?.method ?? "POST").toUpperCase();
    const route = this.resolveRoute(req);
    const baseKey = `idem:${method}:${route}:${idempotencyKey}`;
    const fingerprint = this.fingerprint(method, route, req?.body);

    // process 为异步（Redis I/O）：from(Promise<Observable>).pipe(mergeAll()) 展平
    return from(
      this.process(context, next, {
        res,
        resultKey: baseKey,
        lockKey: `${baseKey}:lock`,
        fingerprint,
        config,
      })
    ).pipe(mergeAll());
  }

  /**
   * 幂等核心流程：读缓存 → 抢锁 → 执行/回放/冲突。
   * 返回一个 Observable（回放为 `of(缓存信封)`；首次为 handler 的 observable 链）。
   */
  private async process(
    context: ExecutionContext,
    next: CallHandler,
    params: {
      res: Response;
      resultKey: string;
      lockKey: string;
      fingerprint: string;
      config: IdempotencyConfig;
    }
  ): Promise<Observable<unknown>> {
    const { res, resultKey, lockKey, fingerprint, config } = params;

    // 1) 已完成的重复请求 → 回放（含指纹校验）
    const cached = await this.redis.get<StoredIdempotentResult>(resultKey);
    if (cached) {
      return this.replay(res, cached, fingerprint);
    }

    // 2) 抢占「处理中」占位锁
    const acquired = await this.acquireLock(lockKey, config.lockTtlSeconds);

    // Redis 异常：fail-open，直通 handler（记 warn，不因 Redis 抖动阻断写链路）
    if (acquired === null) {
      this.logger.warn(`幂等锁不可用（Redis 异常），降级直通：${resultKey}`);
      return next.handle();
    }

    // 3) 未抢到锁：首次请求仍在处理中，或恰在「锁释放前/结果写入后」的竞态窗口
    if (!acquired) {
      const replayed = await this.redis.get<StoredIdempotentResult>(resultKey);
      if (replayed) {
        return this.replay(res, replayed, fingerprint);
      }
      throw new BusinessException(ErrorCode.IDEMPOTENCY_REQUEST_IN_PROGRESS);
    }

    // 4) 抢到锁：执行 handler → 缓存最终信封 → 释放锁（缓存成功后再返回值，保证
    //    首次响应发出时结果已落 Redis，重复请求可确定性回放）
    return next.handle().pipe(
      mergeMap((body) =>
        from(
          (async () => {
            // statusCode：此处为 Nest 默认（POST=201），上游 XRequestInterceptor
            // 会在发送前把 POST 的 201 归一为 200；回放时还原同一值即可得到一致口径
            const payload: StoredIdempotentResult = {
              fingerprint,
              statusCode: typeof res?.statusCode === "number" ? res.statusCode : 200,
              body,
            };
            await this.redis.set(resultKey, payload, config.ttlSeconds);
            await this.releaseLock(lockKey);
            return body;
          })()
        )
      ),
      // handler 抛错：不写缓存，立即释放锁（允许调用方修正后重试）
      catchError((err) =>
        from(this.releaseLock(lockKey)).pipe(mergeMap(() => throwError(() => err)))
      )
    );
  }

  /**
   * 回放首次结果：
   * - 指纹一致 → 还原状态码 + 打 `Idempotency-Replayed: true` 头 + 返回缓存信封；
   * - 指纹不符 → 409（A0409，幂等键被复用于不同请求体）。
   */
  private replay(
    res: Response,
    cached: StoredIdempotentResult,
    fingerprint: string
  ): Observable<unknown> {
    if (cached.fingerprint !== fingerprint) {
      throw new BusinessException(ErrorCode.IDEMPOTENCY_KEY_REUSED);
    }
    try {
      res?.setHeader?.("Idempotency-Replayed", "true");
    } catch {
      // 头已发出等边界：回放主体不受影响
    }
    if (typeof cached.statusCode === "number") {
      res.statusCode = cached.statusCode;
    }
    return of(cached.body);
  }

  /**
   * 抢占「处理中」占位锁：原生 `SET key 1 EX <ttl> NX`（原子）。
   * 键名经 `scopedKey()` 应用租户前缀，与 RedisService 的键前缀规则对齐。
   */
  private async acquireLock(lockKey: string, ttlSeconds: number): Promise<LockResult> {
    try {
      const client = this.redis.getClient();
      const result = await client.set(this.redis.scopedKey(lockKey), "1", "EX", ttlSeconds, "NX");
      return result === "OK";
    } catch (err) {
      this.logger.error("幂等锁获取异常", err as Error);
      return null; // Redis 异常 → fail-open
    }
  }

  /** 释放「处理中」占位锁（幂等，失败仅告警） */
  private async releaseLock(lockKey: string): Promise<void> {
    try {
      await this.redis.del(lockKey);
    } catch (err) {
      this.logger.warn(`幂等锁释放异常：${lockKey} —— ${(err as Error)?.message ?? err}`);
    }
  }

  /** 解析路由（用于键命名空间与指纹），取不含 query 的路径 */
  private resolveRoute(req: Request): string {
    const path = req?.path || req?.url || "unknown";
    return String(path).split("?")[0] || "unknown";
  }

  /** 请求指纹：method + route + body（键排序稳定序列化）的 sha256 */
  private fingerprint(method: string, route: string, body: unknown): string {
    const payload = `${method}\n${route}\n${stableStringify(body ?? null)}`;
    return createHash("sha256").update(payload).digest("hex");
  }
}

/**
 * 稳定序列化：对象键排序后拼接，保证「同内容不同键序」的请求体得到同一指纹。
 * 仅用于指纹计算，非通用 JSON 序列化。
 */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}
