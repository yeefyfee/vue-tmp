import "reflect-metadata";

import {
  RETRY_ATTEMPTS,
  RETRY_BACKOFF_STRATEGY,
  RETRY_BACKOFF_TYPE,
  RETRY_DELAYS_MS,
  QUEUE_KEY_PREFIX,
  buildRetryJobOptions,
} from "./queue.constants";

describe("queue.constants（CROSS-11 重试策略常量）", () => {
  it("attempts = 4（首次 + 3 次重试）", () => {
    expect(RETRY_ATTEMPTS).toBe(4);
  });

  it("重试延迟档位 = 5 / 15 / 30 分钟（毫秒）", () => {
    expect([...RETRY_DELAYS_MS]).toEqual([300_000, 900_000, 1_800_000]);
    // 与「5/15/30 分钟」口径逐档核对
    expect(RETRY_DELAYS_MS[0]).toBe(5 * 60 * 1000);
    expect(RETRY_DELAYS_MS[1]).toBe(15 * 60 * 1000);
    expect(RETRY_DELAYS_MS[2]).toBe(30 * 60 * 1000);
  });

  it("backoff 策略按 attemptsMade 查档：1→5min、2→15min、3→30min", () => {
    expect(typeof RETRY_BACKOFF_STRATEGY).toBe("function");
    expect(RETRY_BACKOFF_STRATEGY(1)).toBe(300_000);
    expect(RETRY_BACKOFF_STRATEGY(2)).toBe(900_000);
    expect(RETRY_BACKOFF_STRATEGY(3)).toBe(1_800_000);
  });

  it("策略越界（防御位）沿用最后一档，不产生 undefined", () => {
    expect(RETRY_BACKOFF_STRATEGY(4)).toBe(1_800_000);
    expect(RETRY_BACKOFF_STRATEGY(0)).toBe(300_000);
  });

  it("buildRetryJobOptions 产出 attempts + 命名 backoff（Redis 内只存策略名）", () => {
    const opts = buildRetryJobOptions();
    expect(opts.attempts).toBe(4);
    expect(opts.backoff).toEqual({ type: RETRY_BACKOFF_TYPE });
    // 非内置名（fixed/exponential 之外）才会命中 Worker 侧自定义策略
    expect(["fixed", "exponential"]).not.toContain(opts.backoff.type);
  });

  it("BullMQ 键前缀与业务缓存键空间隔离", () => {
    expect(QUEUE_KEY_PREFIX).toBe("peluvida:queue");
    expect(QUEUE_KEY_PREFIX).not.toBe("app:");
  });
});
