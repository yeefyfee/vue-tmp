import "reflect-metadata"; // 装饰器元数据 polyfill：jest 环境需显式加载（main.ts 的 import 链不生效）
import { Reflector } from "@nestjs/core";
import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { firstValueFrom, of, throwError } from "rxjs";

import { IdempotencyInterceptor } from "./idempotency.interceptor";
import {
  Idempotent,
  IDEMPOTENT_METADATA,
  DEFAULT_IDEMPOTENCY_TTL_SECONDS,
  DEFAULT_IDEMPOTENCY_LOCK_TTL_SECONDS,
} from "./idempotency.decorator";
import { RequestContext } from "../context/request-context";
import { BusinessException } from "../exceptions/business.exception";
import { ErrorCode } from "../enums/error-code.enum";

/**
 * P0-07-01 幂等拦截器单测
 *
 * 覆盖：首请求执行+缓存、重复回放+`Idempotency-Replayed` 头、并发同 key 409、
 * 指纹不符 409、无 key 跳过、required 缺失 400、TTL 参数生效、handler 失败不缓存。
 * Redis 用内存假实现（确定性、无外部依赖；真连 Redis 的 E2E 见 test/p0-07-01.e2e-spec.ts）。
 */

const ROUTE = "/api/v1/stores";

/** 内存 Redis 假实现：实现拦截器实际调用的 get/set/del/scopedKey/getClient(SET NX EX) */
class FakeRedis {
  store = new Map<string, string>();
  lastSetTtl: number | null = null;

  scopedKey(key: string): string {
    return key; // 单测无租户上下文，前缀改写由 RedisService 承担（此处直通）
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = this.store.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async set(key: string, value: unknown, ttl?: number): Promise<boolean> {
    this.store.set(key, JSON.stringify(value));
    this.lastSetTtl = ttl ?? null;
    return true;
  }

  async del(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  getClient() {
    const store = this.store;
    return {
      // 仅实现拦截器用到的 SET key val EX ttl NX
      set: async (key: string, val: string, ex: string, _ttl: number, nx: string) => {
        if (ex === "EX" && nx === "NX") {
          if (store.has(key)) return null;
          store.set(key, val);
          return "OK";
        }
        store.set(key, val);
        return "OK";
      },
    };
  }
}

interface Harness {
  interceptor: IdempotencyInterceptor;
  redis: FakeRedis;
  res: { statusCode: number; setHeader: jest.Mock };
  next: CallHandler & { handle: jest.Mock };
  context: ExecutionContext;
}

function buildHarness(body: unknown): Harness {
  const redis = new FakeRedis();
  const interceptor = new IdempotencyInterceptor(redis as never, new Reflector());
  const res = { statusCode: 201, setHeader: jest.fn() };
  const req = { method: "POST", path: ROUTE, body };
  const handler = decoratedHandler();
  const next = { handle: jest.fn(() => of("resp-body")) } as unknown as Harness["next"];
  const context = {
    getType: () => "http",
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
  return { interceptor, redis, res, next, context };
}

/** 默认 @Idempotent() handler（真实经 SetMetadata 写入元数据，验证 Reflector 链路） */
function decoratedHandler(): () => void {
  const fn = () => undefined;
  Idempotent()(fn);
  return fn;
}

/** 自定义配置 handler */
function customHandler(options: Parameters<typeof Idempotent>[0]): () => void {
  const fn = () => undefined;
  Idempotent(options)(fn);
  return fn;
}

describe("IdempotencyInterceptor（P0-07-01）", () => {
  it("首次请求：执行 handler → 缓存最终信封（默认 24h TTL）→ 返回原响应、不打回放头", async () => {
    await RequestContext.run(async () => {
      RequestContext.setIdempotencyKey("k-first");
      const h = buildHarness({ code: "SH-1" });

      const result = await firstValueFrom(h.interceptor.intercept(h.context, h.next));

      expect(result).toBe("resp-body");
      expect(h.next.handle).toHaveBeenCalledTimes(1);
      expect(h.res.setHeader).not.toHaveBeenCalled();

      const resultKey = `idem:POST:${ROUTE}:k-first`;
      const cached = await h.redis.get<{ fingerprint: string; statusCode: number; body: unknown }>(
        resultKey
      );
      expect(cached).not.toBeNull();
      expect(cached?.body).toBe("resp-body");
      expect(cached?.statusCode).toBe(201);
      expect(cached?.fingerprint).toEqual(expect.any(String));
      expect(h.redis.lastSetTtl).toBe(DEFAULT_IDEMPOTENCY_TTL_SECONDS);
      // 首请求完成后锁已释放
      expect(h.redis.store.has(`${resultKey}:lock`)).toBe(false);
    });
  });

  it("重复请求：命中缓存 → 不执行 handler → 回放首次结果 + Idempotency-Replayed 头", async () => {
    await RequestContext.run(async () => {
      RequestContext.setIdempotencyKey("k-replay");
      const h = buildHarness({ code: "SH-2" });

      // 首请求：写入缓存
      await firstValueFrom(h.interceptor.intercept(h.context, h.next));
      expect(h.next.handle).toHaveBeenCalledTimes(1);

      // 第二次：同 key + 同 body（同指纹）
      const replay = await firstValueFrom(h.interceptor.intercept(h.context, h.next));
      expect(replay).toBe("resp-body");
      expect(h.next.handle).toHaveBeenCalledTimes(1); // 未再次执行
      expect(h.res.setHeader).toHaveBeenCalledWith("Idempotency-Replayed", "true");
    });
  });

  it("并发同 key：未抢到锁且无结果 → 409（A0408 请求处理中）", async () => {
    await RequestContext.run(async () => {
      RequestContext.setIdempotencyKey("k-busy");
      const h = buildHarness({ code: "SH-3" });
      // 预置「处理中」占位锁，模拟首次请求仍在执行
      h.redis.store.set(`idem:POST:${ROUTE}:k-busy:lock`, "1");

      await expect(
        firstValueFrom(h.interceptor.intercept(h.context, h.next))
      ).rejects.toMatchObject({
        response: { code: ErrorCode.IDEMPOTENCY_REQUEST_IN_PROGRESS.code },
      });
      expect(h.next.handle).not.toHaveBeenCalled();
    });
  });

  it("指纹不符：同 key 不同请求体 → 409（A0409 幂等键已用于不同的请求）", async () => {
    await RequestContext.run(async () => {
      RequestContext.setIdempotencyKey("k-reuse");
      const h = buildHarness({ code: "SH-4" });
      // 预置一条「指纹不同」的缓存结果
      h.redis.store.set(
        `idem:POST:${ROUTE}:k-reuse`,
        JSON.stringify({ fingerprint: "DIFFERENT", statusCode: 200, body: { ok: true } })
      );

      await expect(
        firstValueFrom(h.interceptor.intercept(h.context, h.next))
      ).rejects.toMatchObject({ response: { code: ErrorCode.IDEMPOTENCY_KEY_REUSED.code } });
      expect(h.next.handle).not.toHaveBeenCalled();
    });
  });

  it("无 Idempotency-Key：跳过幂等，直通 handler、不写缓存", async () => {
    await RequestContext.run(async () => {
      RequestContext.setIdempotencyKey(null);
      const h = buildHarness({ code: "SH-5" });

      const result = await firstValueFrom(h.interceptor.intercept(h.context, h.next));
      expect(result).toBe("resp-body");
      expect(h.next.handle).toHaveBeenCalledTimes(1);
      expect(h.redis.store.size).toBe(0);
    });
  });

  it("required:true 且缺失 Idempotency-Key → 400（A0411 缺少幂等键）", async () => {
    await RequestContext.run(async () => {
      RequestContext.setIdempotencyKey(null);
      const redis = new FakeRedis();
      const interceptor = new IdempotencyInterceptor(redis as never, new Reflector());
      const res = { statusCode: 201, setHeader: jest.fn() };
      const req = { method: "POST", path: ROUTE, body: {} };
      const next = { handle: jest.fn(() => of("resp-body")) } as unknown as CallHandler;
      const context = {
        getType: () => "http",
        getHandler: () => customHandler({ required: true }),
        getClass: () => class {},
        switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
      } as unknown as ExecutionContext;

      expect(() => interceptor.intercept(context, next)).toThrow(BusinessException);
      try {
        interceptor.intercept(context, next);
      } catch (err) {
        expect((err as BusinessException).getResponse()).toMatchObject({
          code: ErrorCode.IDEMPOTENCY_KEY_REQUIRED.code,
        });
      }
      expect(next.handle).not.toHaveBeenCalled();
    });
  });

  it("TTL 参数生效：@Idempotent({ ttlSeconds: 300 }) → 缓存 TTL = 300", async () => {
    await RequestContext.run(async () => {
      RequestContext.setIdempotencyKey("k-ttl");
      const redis = new FakeRedis();
      const interceptor = new IdempotencyInterceptor(redis as never, new Reflector());
      const res = { statusCode: 200, setHeader: jest.fn() };
      const req = { method: "POST", path: ROUTE, body: {} };
      const next = { handle: jest.fn(() => of("resp-body")) } as unknown as CallHandler;
      const context = {
        getType: () => "http",
        getHandler: () => customHandler({ ttlSeconds: 300, lockTtlSeconds: 5 }),
        getClass: () => class {},
        switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
      } as unknown as ExecutionContext;

      await firstValueFrom(interceptor.intercept(context, next));
      expect(redis.lastSetTtl).toBe(300);
    });
  });

  it("锁 TTL 默认值：SET NX EX 使用默认锁 TTL（60s）", async () => {
    await RequestContext.run(async () => {
      RequestContext.setIdempotencyKey("k-lockttl");
      const redis = new FakeRedis();
      const seen: Array<{ key: string; ttl: number }> = [];
      const originalClient = redis.getClient();
      redis.getClient = () =>
        ({
          set: async (key: string, val: string, ex: string, ttl: number, nx: string) => {
            seen.push({ key, ttl });
            return originalClient.set(key, val, ex, ttl, nx);
          },
        }) as never;

      const interceptor = new IdempotencyInterceptor(redis as never, new Reflector());
      const res = { statusCode: 201, setHeader: jest.fn() };
      const req = { method: "POST", path: ROUTE, body: {} };
      const next = { handle: jest.fn(() => of("resp-body")) } as unknown as CallHandler;
      const context = {
        getType: () => "http",
        getHandler: () => decoratedHandler(),
        getClass: () => class {},
        switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
      } as unknown as ExecutionContext;

      await firstValueFrom(interceptor.intercept(context, next));
      expect(seen[0].ttl).toBe(DEFAULT_IDEMPOTENCY_LOCK_TTL_SECONDS);
    });
  });

  it("handler 抛错：不写缓存、释放锁（允许修正后重试）", async () => {
    await RequestContext.run(async () => {
      RequestContext.setIdempotencyKey("k-fail");
      const redis = new FakeRedis();
      const interceptor = new IdempotencyInterceptor(redis as never, new Reflector());
      const res = { statusCode: 201, setHeader: jest.fn() };
      const req = { method: "POST", path: ROUTE, body: {} };
      const next = {
        // 真实 Nest 中 next.handle() 经 defer 生成，handler 抛错以 Observable error 送达
        handle: jest.fn(() => throwError(() => new Error("boom"))),
      } as unknown as CallHandler;
      const context = {
        getType: () => "http",
        getHandler: () => decoratedHandler(),
        getClass: () => class {},
        switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
      } as unknown as ExecutionContext;

      await expect(firstValueFrom(interceptor.intercept(context, next))).rejects.toThrow("boom");
      // 无缓存键残留，锁已释放
      expect(redis.store.size).toBe(0);
    });
  });

  it("元数据键稳定：@Idempotent 写入 IDEMPOTENT_METADATA（供 Reflector.get 读取）", () => {
    const fn = customHandler({ ttlSeconds: 10, required: true });
    expect(Reflect.getMetadata(IDEMPOTENT_METADATA, fn)).toEqual({
      ttlSeconds: 10,
      lockTtlSeconds: DEFAULT_IDEMPOTENCY_LOCK_TTL_SECONDS,
      required: true,
    });
  });
});
