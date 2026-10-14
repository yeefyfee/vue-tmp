/**
 * 队列基础设施 · 注册表（CROSS-11）
 *
 * **单一注册点**：业务队列（逻辑名）只在本文件 `QUEUE_DEFINITIONS` 登记；
 * Queue / Worker 实例创建必须经本注册表（`createQueue` / `createWorker` / `enqueue`），
 * 统一注入 BullMQ 连接参数、键前缀与重试策略，禁止业务侧散落 new Queue / new Worker。
 *
 * **租户前缀策略（决策 A2 语义对齐，与 RedisService.resolveKey 一致）**：
 * 项目 Redis 键规范为 `tenant:<租户ID>:<key>`（`TENANT_REDIS_PREFIX`，PEL-11）——
 * 有租户上下文的键带前缀，平台级键保持原样。队列沿用同一语义：
 * - **平台级队列**（默认）：物理键 = `peluvida:queue:<逻辑名>:*`；
 * - **租户队列**（入队/消费时显式传 `tenantId`）：物理键 =
 *   `peluvida:queue:tenant:<id>:<逻辑名>:*`，键形态与缓存键的 `tenant:` 前缀一致；
 * - **实现方式**：租户段加在 BullMQ 的 `prefix` 选项（`peluvida:queue:tenant:<id>`）
 *   而非队列名——BullMQ v6 禁止队列名含冒号（`Queue name cannot contain :`），
 *   prefix 层级是官方键空间划分机制，队列名保持纯逻辑名；
 * - **为什么不按租户拆连接级 keyPrefix**：BullMQ 的延迟重试依赖全局 keyspace 事件
 *   与 delayed zset，每租户独立连接会导致 Redis 连接数随租户数线性增长、事件重复
 *   订阅；任务本身的租户归属由 `job.data.tenantId` 承载，消费端经
 *   `RequestContext.run` 恢复上下文（见 demo.processor），数据访问层的租户隔离
 *   语义不受影响。实例按需创建并在进程内缓存，连接数只随「逻辑队列数」增长。
 *
 * 无租户上下文的系统任务允许直接用平台级队列，不强制前缀。
 */
import {
  Queue,
  Worker,
  type ConnectionOptions,
  type Job,
  type JobsOptions,
  type Processor,
} from "bullmq";

import {
  QUEUE_KEY_PREFIX,
  RETRY_ATTEMPTS,
  RETRY_BACKOFF_STRATEGY,
  RETRY_BACKOFF_TYPE,
  buildRetryJobOptions,
} from "./queue.constants";
import { TENANT_REDIS_PREFIX } from "../tenant/tenant.constants";

/** BullMQ 连接参数（不含 keyPrefix——BullMQ 用独立 `prefix` 选项管理键空间） */
export interface QueueConnectionOptions {
  host: string;
  port: number;
  /** 本机容器场景常为空（如 .env.dev REDIS_PASSWORD=），可选 */
  password?: string;
  db?: number;
}

/** 队列注册表条目：新业务队列只在此数组登记 */
export interface QueueDefinition {
  /** 逻辑队列名（`[a-z0-9._-]`，BullMQ v6 禁止含冒号） */
  name: string;
  description: string;
}

/** demo 示例队列（验收消费者，echo payload） */
export const DEMO_QUEUE = "demo";

/**
 * 宠物健康到期提醒队列（P0-06-03 · FR-2）
 *
 * 平台级队列（系统任务）：扫描（跨租户）在带租户上下文的脚本/服务侧完成，
 * 逐条提醒任务以**平台级队列**入队，租户归属由 `job.data.tenantId` 承载，
 * 消费端经 `RequestContext.run` 恢复（与 demo.processor 同范式）。
 */
export const HEALTH_REMINDER_QUEUE = "pet-health-reminder";

/**
 * 宠物时间线异步写入队列（P0-06-07 · FR-5）
 *
 * 租户队列：入队时显式传 tenantId，物理键 = `peluvida:queue:tenant:<id>:pet-timeline:*`；
 * 租户归属亦随 `job.data.tenantId` 承载，消费端经 `RequestContext.run` 恢复
 * （与 demo.processor / pet-health 消费器同范式）。
 */
export const TIMELINE_QUEUE = "pet-timeline";

/**
 * 订单超时未支付自动关闭队列（MVP-WEB-07-06）
 *
 * 平台级队列（系统任务）：扫描（跨租户枚举租户后逐租户）在带租户上下文的脚本/服务侧
 * 完成，逐条关单任务以**平台级队列**入队，租户归属由 `job.data.tenantId` 承载，
 * 消费端经 `RequestContext.run` 恢复（与 pet-health 同范式）。
 */
export const ORDER_AUTO_CLOSE_QUEUE = "order-auto-close";

/** 队列注册表（单一注册点）：新增队列 = 在数组追加一行 */
export const QUEUE_DEFINITIONS: readonly QueueDefinition[] = [
  { name: DEMO_QUEUE, description: "CROSS-11 示例任务：echo payload，用于验收消费与重试策略" },
  {
    name: HEALTH_REMINDER_QUEUE,
    description: "P0-06-03 宠物健康到期提醒：疫苗/驱虫到期（含幂等键）逐条推送",
  },
  {
    name: TIMELINE_QUEUE,
    description: "P0-06-07 宠物时间线异步写入：统一事件模型异步落库（租户队列）",
  },
  {
    name: ORDER_AUTO_CLOSE_QUEUE,
    description: "MVP-WEB-07-06 订单超时未支付自动关闭：待支付超阈值逐条关闭（含幂等键）",
  },
];

/** 断言逻辑队列名已登记，防止未注册队列散建 */
export function assertRegisteredQueue(name: string): void {
  if (!QUEUE_DEFINITIONS.some((d) => d.name === name)) {
    throw new Error(
      `[QueueRegistry] 队列「${name}」未在 QUEUE_DEFINITIONS 登记（src/queue/queue-registry.ts）`
    );
  }
}

/** 入队选项：tenantId 决定键前缀层级；其余透传 BullMQ JobsOptions */
export interface EnqueueOptions {
  tenantId?: string;
  jobId?: string;
  delay?: number;
  [key: string]: unknown;
}

/** Worker 侧 BullMQ settings：自定义 backoff 策略注册点（Queue 侧无需注册） */
export const QUEUE_SETTINGS = {
  backoffStrategy: RETRY_BACKOFF_STRATEGY,
} as const;

/**
 * 队列注册表：队列/Worker 实例的唯一创建入口（进程内按物理键空间缓存实例）。
 * 不依赖 Nest DI——QueueModule 以 useFactory 注入配置后实例化，脚本/单测可独立 new。
 */
export class QueueRegistry {
  private readonly connection: ConnectionOptions;
  private readonly queues = new Map<string, Queue>();
  private readonly workers = new Set<Worker>();

  constructor(connection: QueueConnectionOptions) {
    this.connection = connection;
  }

  /**
   * BullMQ `prefix` 解析：平台级 = `peluvida:queue`；
   * 带租户 = `peluvida:queue:tenant:<id>`（复用 TENANT_REDIS_PREFIX，键形态
   * 与缓存键规范 `tenant:<id>:<key>` 语义一致）。空/空白租户ID 归一化为平台级。
   */
  resolvePrefix(tenantId?: string): string {
    const tid = tenantId && String(tenantId).trim() !== "" ? String(tenantId) : null;
    return tid ? `${QUEUE_KEY_PREFIX}:${TENANT_REDIS_PREFIX}${tid}` : QUEUE_KEY_PREFIX;
  }

  /** 创建（或取缓存）Queue 实例：统一注入 prefix / connection / 重试默认值 */
  createQueue(logicalName: string, tenantId?: string): Queue {
    assertRegisteredQueue(logicalName);
    const prefix = this.resolvePrefix(tenantId);
    const cacheKey = `${prefix}:${logicalName}`;
    const cached = this.queues.get(cacheKey);
    if (cached) return cached;
    const queue = new Queue(logicalName, {
      connection: this.connection,
      prefix,
      defaultJobOptions: buildRetryJobOptions(),
    });
    this.queues.set(cacheKey, queue);
    return queue;
  }

  /** 入队：统一入口（键空间按 tenantId 解析；重试默认值已由 defaultJobOptions 兜底） */
  async enqueue<T = unknown>(
    logicalName: string,
    data: T,
    options: EnqueueOptions = {}
  ): Promise<Job> {
    const { tenantId, ...jobOptions } = options;
    const queue = this.createQueue(logicalName, tenantId);
    return queue.add(logicalName, data, jobOptions as JobsOptions);
  }

  /** 创建 Worker：键空间解析与策略注入与 Queue 侧同源；worker 记入集合供统一关闭 */
  createWorker(
    logicalName: string,
    processor: Processor,
    options: { concurrency?: number; tenantId?: string } = {}
  ): Worker {
    const prefix = this.resolvePrefix(options.tenantId);
    const worker = new Worker(logicalName, processor, {
      connection: this.connection,
      prefix,
      concurrency: options.concurrency ?? 1,
      settings: { ...QUEUE_SETTINGS },
    });
    worker.on("failed", (job, err) => {
      // 重试排期由 BullMQ 按 settings.backoffStrategy 计算；这里只做可观测性日志
      console.error(
        `[QueueRegistry] job 失败 queue=${prefix}:${logicalName} id=${job?.id ?? "?"} attemptsMade=${job?.attemptsMade ?? "?"}: ${err.message}`
      );
    });
    this.workers.add(worker);
    return worker;
  }

  /** 优雅关闭全部实例（worker 先停收新任务，再关队列连接） */
  async closeAll(): Promise<void> {
    for (const w of this.workers) await w.close().catch(() => {});
    for (const q of this.queues.values()) await q.close().catch(() => {});
    this.workers.clear();
    this.queues.clear();
  }
}

export { RETRY_ATTEMPTS, RETRY_BACKOFF_TYPE };
