/**
 * 队列基础设施 · 常量（CROSS-11）
 *
 * **重试策略（决策口径）**：失败重试 3 次 = `attempts: 4`（首次执行 + 3 次重试），
 * 延迟固定递增 5 / 15 / 30 分钟。
 *
 * **实现方式**：BullMQ 6.x 内置 `fixed` backoff 只接受单一数值 delay，内置
 * `exponential` 是连续曲线而非固定档位，均无法表达「5/15/30 分钟逐次递增」。
 * 采用 BullMQ 官方扩展点：Worker 侧 `settings.backoffStrategy` 注入自定义策略
 * 函数（签名见 BackoffStrategy），job 的 `backoff.type` 存策略名字符串
 * `fixed-array`（可序列化）；BullMQ 在 Worker 内计算延迟时，非内置 type 一律
 * 走该自定义函数（backoffs.js lookupStrategy 语义），按 `attemptsMade`
 * （第 N 次失败 → 第 N 档）查 {@link RETRY_DELAYS_MS} 表。Queue 侧无需注册——
 * 延迟数值只在消费失败后的 Worker 进程内计算。
 * 超出数组的重试（防御位）沿用最后一档，避免 undefined delay 导致立即重试。
 */
import type { BackoffStrategy } from "bullmq";

/** BullMQ 物理键命名空间（`peluvida:queue:<队列名>:*`） */
export const QUEUE_KEY_PREFIX = "peluvida:queue";

/** 总尝试次数 = 首次执行 1 次 + 失败重试 3 次 */
export const RETRY_ATTEMPTS = 4;

/** 递增重试延迟档位（毫秒）：第 1/2/3 次重试分别延迟 5 / 15 / 30 分钟 */
export const RETRY_DELAYS_MS: readonly number[] = [5 * 60 * 1000, 15 * 60 * 1000, 30 * 60 * 1000];

/** 自定义 backoff 策略名（Redis 内 job 只存该名字符串，非内置名即命中自定义策略） */
export const RETRY_BACKOFF_TYPE = "fixed-array";

/**
 * 固定档位递增策略：第 N 次失败后的重试延迟 = 第 N 档（1 → 5min，2 → 15min，3 → 30min）；
 * 超出档位沿用最后一档（防御：实际不会发生，attempts=4 最多重试 3 次）。
 * 注入位置：Worker `settings.backoffStrategy`（见 queue-registry.QUEUE_SETTINGS）。
 */
export const RETRY_BACKOFF_STRATEGY: BackoffStrategy = (attemptsMade: number): number => {
  const index = Math.max(0, Math.min(attemptsMade - 1, RETRY_DELAYS_MS.length - 1));
  return RETRY_DELAYS_MS[index];
};

/**
 * 生成入队任务的默认重试 job options。
 * 各业务入队时展开到 `queue.add(data, options)`；局部覆盖 attempts/backoff 需
 * 显式声明理由（统一口径，禁止各自为政）。
 */
export function buildRetryJobOptions(): {
  attempts: number;
  backoff: { type: string };
} {
  return {
    attempts: RETRY_ATTEMPTS,
    backoff: { type: RETRY_BACKOFF_TYPE },
  };
}
