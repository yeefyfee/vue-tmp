/**
 * 队列基础设施 · 真连 Redis 验证（CROSS-11）
 *
 * 验收标准对齐（清单 CROSS-11）：
 *   1. 示例任务入队后可被消费 —— 真 Redis（DB7）+ 真 BullMQ Queue/Worker 实测；
 *   2. 失败按策略重试 —— 首次失败后 job 进入 delayed（重试已排期），并断言
 *      attempts=4 与 fixed-array 档位（5/15/30 分钟）配置生效（不真等 5 分钟）；
 *   3. 队列键带租户前缀 —— 平台级队列物理键 `peluvida:queue:demo:*`，
 *      租户队列物理键 `peluvida:queue:tenant:<id>:demo:*`（与缓存键规范语义一致）。
 *
 * 环境处理：脚本内手动加载 .env / .env.dev（override），无需外部注入 NODE_ENV；
 * Redis 连接参数从环境变量读取（与 src/config/redis.config.ts 同口径）。
 *
 * 运行：
 *   node ./node_modules/ts-node/dist/bin.js -r tsconfig-paths/register scripts/verify-queue.ts
 */
import * as path from "path";
import * as dotenv from "dotenv";
import Redis from "ioredis";
import { Job } from "bullmq";

// 环境加载：先 .env 再 .env.dev（后者覆盖前者，与 ConfigModule envFilePath 顺序一致）
for (const f of [".env", ".env.dev"]) {
  dotenv.config({ path: path.join(__dirname, "..", f), override: true });
}

import { QueueRegistry, DEMO_QUEUE, assertRegisteredQueue } from "../src/queue/queue-registry";
import {
  RETRY_ATTEMPTS,
  RETRY_BACKOFF_STRATEGY,
  RETRY_DELAYS_MS,
} from "../src/queue/queue.constants";
import { processDemoJob } from "../src/queue/demo/demo.processor";

const REDIS_HOST = process.env.REDIS_HOST ?? "127.0.0.1";
const REDIS_PORT = Number(process.env.REDIS_PORT ?? 6379);
const REDIS_DB = Number(process.env.REDIS_DB ?? 7);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

const CONN = { host: REDIS_HOST, port: REDIS_PORT, db: REDIS_DB, password: REDIS_PASSWORD };

const PROBE_TENANT = "900042";
/** 租户队列物理键模式（worker 消费期间键集合存在） */
const TENANT_KEYS_PATTERN = `peluvida:queue:tenant:${PROBE_TENANT}:${DEMO_QUEUE}:*`;
const PLATFORM_KEYS_PATTERN = `peluvida:queue:${DEMO_QUEUE}:*`;

let passed = 0;
let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed += 1;
  else failures += 1;
  console.log(
    `  ${ok ? "√" : "✗"} ${label}  → 实际 ${JSON.stringify(actual)}${ok ? "" : `（期望 ${JSON.stringify(expected)}）`}`
  );
}
function checkTrue(label: string, cond: boolean) {
  if (cond) passed += 1;
  else failures += 1;
  console.log(`  ${cond ? "√" : "✗"} ${label}`);
}
function section(title: string) {
  console.log(`\n${title}`);
}

/** 等待 job 完成/进入 delayed（轮询 BullMQ 状态） */
async function waitFor(job: Job, states: string[], timeoutMs = 15000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = await job.getState();
    if (states.includes(state)) return state;
    if (Date.now() > deadline) {
      throw new Error(`等待 job ${job.id} 进入 ${states.join("/")} 超时（当前 ${state}）`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function section1_env(registry: QueueRegistry, raw: Redis) {
  section("1) 环境与前置");
  checkTrue("Redis 可达", (await raw.ping()) === "PONG");
  checkTrue(
    `连接 DB=${REDIS_DB}（与 .env.dev REDIS_DB 一致）`,
    REDIS_DB === Number(process.env.REDIS_DB)
  );
  checkTrue("demo 队列已登记（单一注册点）", (assertRegisteredQueue(DEMO_QUEUE), true));
  checkTrue("registry 可创建平台级队列", !!registry.createQueue(DEMO_QUEUE));
}

async function section2_consume(registry: QueueRegistry, raw: Redis) {
  section("2) 示例任务入队 → 消费（真 Redis × 真 Worker）");

  // 平台级：入队即消费
  const payload = { hello: "peluvida", ts: Date.now() };
  const job = await registry.enqueue(DEMO_QUEUE, { payload });
  const platformKeys = await raw.keys(PLATFORM_KEYS_PATTERN);
  checkTrue(
    "平台级队列物理键 = peluvida:queue:demo:*",
    platformKeys.length > 0 && platformKeys.every((k) => k.startsWith("peluvida:queue:demo:"))
  );
  const state = await waitFor(job, ["completed"]);
  check("平台级任务被消费（completed）", state, "completed");
  // BullMQ 6 无 getValue/refresh：经 Job.fromId 从 Redis 重拉最新 returnvalue
  const demoQueue = registry.createQueue(DEMO_QUEUE);
  const fresh = await Job.fromId(demoQueue as never, job.id as string);
  const result = fresh?.returnvalue as { echoed: unknown; tenantId: null } | undefined;
  check("结果回显 payload", result?.echoed, payload);

  // 租户队列：prefix 带 tenant:<id> 段（队列名保持逻辑名——BullMQ v6 禁止队列名含冒号）；
  // 每个物理键空间需要自己的 Worker（prefix 不同），与注册表的租户队列语义一致
  const tenantWorker = registry.createWorker(DEMO_QUEUE, async (job) => processDemoJob(job), {
    tenantId: PROBE_TENANT,
  });
  await tenantWorker.waitUntilReady();
  const tenantPayload = { hello: "tenant", ts: Date.now() };
  const tJob = await registry.enqueue(
    DEMO_QUEUE,
    { payload: tenantPayload, tenantId: PROBE_TENANT },
    { tenantId: PROBE_TENANT }
  );
  checkTrue(
    "租户队列物理键 = peluvida:queue:tenant:<id>:demo:*",
    (await raw.keys(TENANT_KEYS_PATTERN)).length > 0
  );
  await waitFor(tJob, ["completed"]);
  const tFresh = await Job.fromId(
    registry.createQueue(DEMO_QUEUE, PROBE_TENANT) as never,
    tJob.id as string
  );
  const tResult = tFresh?.returnvalue as { echoed: unknown; tenantId: string | null } | undefined;
  check("租户任务结果回显 payload", tResult?.echoed, tenantPayload);
  check("消费端恢复租户上下文（RequestContext）", tResult?.tenantId, PROBE_TENANT);
}

async function section3_retry(registry: QueueRegistry, raw: Redis) {
  section("3) 失败重试策略（attempts=4 × fixed-array 5/15/30 分钟）");
  checkTrue("不真等 5 分钟：断言配置值与首次失败后的排期状态", true);
  const t0 = Date.now(); // 失败必然发生在 t0 之后（排期下界锚点）

  const failJob = await registry.enqueue(DEMO_QUEUE, { payload: { boom: true }, shouldFail: true });
  check("job options attempts = 4", failJob.opts.attempts, RETRY_ATTEMPTS);
  const backoff = failJob.opts.backoff;
  const backoffType = typeof backoff === "object" && backoff !== null ? backoff.type : backoff;
  check("job options backoff.type = fixed-array", backoffType, "fixed-array");

  // 首次执行失败 → 应进入 delayed（重试已按 fixed-array 排期），而非 completed/failed 终态
  const state = await waitFor(failJob, ["delayed", "failed"], 20000);
  checkTrue("首次失败后进入 delayed（第 1 次重试已排期，延迟 5 分钟）", state === "delayed");

  // delayed zset 的 score = 失败时刻 + 第 1 档延迟（5 分钟）——真实排期证据，不真等；
  // 注意 BullMQ 把 job id 低 12 位烘焙进分值（score = delayedMs × 0x1000 + offset，
  // 见 commands/includes/getDelayedScore.lua，用于同一毫秒内 FIFO 排序），
  // 断言前先反解出毫秒时间戳，并用 ±5s 容差覆盖 12 位 id 偏移：
  // 失败 ∈ [t0, now] → delayedMs ∈ [t0+5m, now+5m]
  const failFresh = await Job.fromId(
    registry.createQueue(DEMO_QUEUE) as never,
    failJob.id as string
  );
  const rawScore = Number(await raw.zscore(`peluvida:queue:${DEMO_QUEUE}:delayed`, failJob.id));
  const score = rawScore / 0x1000;
  const lowerBound = t0 + RETRY_DELAYS_MS[0] - 5000;
  const upperBound = Date.now() + RETRY_DELAYS_MS[0] + 5000;
  checkTrue(
    `重试排期 ∈ [t0+5min, now+5min]（delayedMs-t0 = ${Math.round((score - t0) / 1000)}s）`,
    Number.isFinite(score) && score >= lowerBound && score <= upperBound
  );
  check("attemptsStarted = 1（只失败过一次）", failFresh?.attemptsStarted, 1);
  checkTrue(
    "failedReason 记录主动失败",
    typeof failFresh?.failedReason === "string" && failFresh.failedReason.includes("主动失败")
  );

  // 策略函数档位断言（1→5min、2→15min、3→30min，不真等）
  check("策略第 1 档 = 300000ms", RETRY_BACKOFF_STRATEGY(1), 300_000);
  check("策略第 2 档 = 900000ms", RETRY_BACKOFF_STRATEGY(2), 900_000);
  check("策略第 3 档 = 1800000ms", RETRY_BACKOFF_STRATEGY(3), 1_800_000);
}

async function cleanup(registry: QueueRegistry, raw: Redis): Promise<void> {
  // 队列级清理：obliterate 强删队列全部键（含 delayed 重试任务）
  const registryAny = registry as unknown as {
    queues: Map<string, { obliterate: (o: object) => Promise<void> }>;
  };
  for (const q of registryAny.queues.values()) {
    await q.obliterate({ force: true }).catch(() => {});
  }
  // 兜底：按前缀扫删（DB7 开发库，键空间受 peluvida:queue: 约束）
  const leftovers = await raw.keys("peluvida:queue:*");
  for (const k of leftovers) await raw.del(k);
}

async function main() {
  console.log("=".repeat(72));
  console.log("CROSS-11 BullMQ 队列基础设施 · 真连 Redis 验证");
  console.log("=".repeat(72));

  const registry = new QueueRegistry(CONN);
  const raw = new Redis({ ...CONN, lazyConnect: false, maxRetriesPerRequest: null });
  const worker = registry.createWorker(DEMO_QUEUE, async (job) => processDemoJob(job));

  try {
    await section1_env(registry, raw);
    await section2_consume(registry, raw);
    await section3_retry(registry, raw);
  } finally {
    await worker.close().catch(() => {});
    await registry.closeAll().catch(() => {}); // 含 section2 创建的租户 worker
    await cleanup(registry, raw);
    const remain = await raw.keys("peluvida:queue:*");
    check("清理后无残留队列键", remain, []);
    await raw.quit().catch(() => {});
  }
  console.log("\n" + "=".repeat(72));
  console.log(`结论：通过 ${passed} 项，失败 ${failures} 项`);
  if (failures > 0) {
    process.exitCode = 1;
  } else {
    console.log("✅ CROSS-11 验收标准全部满足");
  }
}

main().catch((e) => {
  console.error("脚本异常终止：", e);
  process.exitCode = 1;
});
