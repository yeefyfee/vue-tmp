import "reflect-metadata";

jest.mock("bullmq", () => ({
  Queue: jest.fn(),
  Worker: jest.fn(),
}));

import { Queue, Worker } from "bullmq";

import {
  DEMO_QUEUE,
  QUEUE_DEFINITIONS,
  QUEUE_SETTINGS,
  QueueRegistry,
  assertRegisteredQueue,
} from "./queue-registry";
import {
  QUEUE_KEY_PREFIX,
  RETRY_ATTEMPTS,
  RETRY_BACKOFF_TYPE,
  RETRY_DELAYS_MS,
} from "./queue.constants";
import { TENANT_REDIS_PREFIX } from "../tenant/tenant.constants";

const QueueMock = Queue as unknown as jest.Mock;
const WorkerMock = Worker as unknown as jest.Mock;

const CONN = { host: "127.0.0.1", port: 6379, db: 7 };

function lastQueueArgs(): [string, Record<string, unknown>] {
  return QueueMock.mock.calls[QueueMock.mock.calls.length - 1];
}

describe("queue-registry（CROSS-11 队列注册表）", () => {
  beforeEach(() => {
    QueueMock.mockClear();
    WorkerMock.mockClear();
    QueueMock.mockImplementation(function (this: unknown, name: string) {
      return { name, add: jest.fn() };
    });
    WorkerMock.mockImplementation(function (this: unknown, name: string, processor: unknown) {
      return { name, processor, on: jest.fn() };
    });
  });

  describe("注册表（单一注册点）", () => {
    it("demo 队列已登记", () => {
      expect(QUEUE_DEFINITIONS.map((d) => d.name)).toContain(DEMO_QUEUE);
    });

    it("未登记队列抛错（防散建）", () => {
      expect(() => assertRegisteredQueue("not-registered")).toThrow(/QUEUE_DEFINITIONS/);
      expect(() => assertRegisteredQueue(DEMO_QUEUE)).not.toThrow();
    });
  });

  describe("租户前缀（与 Redis 键规范语义一致，加在 prefix 层级）", () => {
    it("平台级：prefix = peluvida:queue", () => {
      const registry = new QueueRegistry(CONN);
      expect(registry.resolvePrefix()).toBe(QUEUE_KEY_PREFIX);
      expect(QUEUE_KEY_PREFIX).toBe("peluvida:queue");
    });

    it("租户：prefix = peluvida:queue:tenant:<id>（复用 TENANT_REDIS_PREFIX）", () => {
      const registry = new QueueRegistry(CONN);
      expect(registry.resolvePrefix("900042")).toBe(`peluvida:queue:tenant:900042`);
      expect(TENANT_REDIS_PREFIX).toBe("tenant:");
    });

    it("空租户ID 归一化为平台级", () => {
      const registry = new QueueRegistry(CONN);
      expect(registry.resolvePrefix("   ")).toBe(QUEUE_KEY_PREFIX);
      expect(registry.resolvePrefix("")).toBe(QUEUE_KEY_PREFIX);
      expect(registry.resolvePrefix(undefined)).toBe(QUEUE_KEY_PREFIX);
    });
  });

  describe("Queue 创建", () => {
    it("统一注入 prefix / connection / defaultJobOptions（队列名保持逻辑名）", () => {
      const registry = new QueueRegistry(CONN);
      registry.createQueue(DEMO_QUEUE);
      expect(QueueMock).toHaveBeenCalledTimes(1);
      const [name, opts] = lastQueueArgs();
      expect(name).toBe(DEMO_QUEUE); // BullMQ v6 禁止队列名含冒号 → 队列名不变
      expect(opts.prefix).toBe(QUEUE_KEY_PREFIX);
      expect(opts.connection).toEqual(CONN);
      expect(opts.defaultJobOptions).toEqual({
        attempts: RETRY_ATTEMPTS,
        backoff: { type: RETRY_BACKOFF_TYPE },
      });
    });

    it("同物理键空间实例缓存复用，不重复建连接", () => {
      const registry = new QueueRegistry(CONN);
      const a = registry.createQueue(DEMO_QUEUE);
      const b = registry.createQueue(DEMO_QUEUE);
      expect(a).toBe(b);
      expect(QueueMock).toHaveBeenCalledTimes(1);
      // 不同租户 = 不同 prefix = 不同实例
      const t1 = registry.createQueue(DEMO_QUEUE, "900042");
      const t2 = registry.createQueue(DEMO_QUEUE, "900042");
      expect(t1).toBe(t2);
      expect(QueueMock).toHaveBeenCalledTimes(2);
      const [name, opts] = lastQueueArgs();
      expect(name).toBe(DEMO_QUEUE);
      expect(opts.prefix).toBe(`peluvida:queue:tenant:900042`);
    });
  });

  describe("Worker 创建", () => {
    it("Worker 与 Queue 同源注入（prefix / settings / 策略）", () => {
      const registry = new QueueRegistry(CONN);
      const processor = async () => {};
      registry.createWorker(DEMO_QUEUE, processor, { tenantId: "900042" });
      expect(WorkerMock).toHaveBeenCalledTimes(1);
      expect(WorkerMock.mock.calls[0][0]).toBe(DEMO_QUEUE);
      expect(WorkerMock.mock.calls[0][1]).toBe(processor);
      const opts = WorkerMock.mock.calls[0][2] ?? {};
      expect(opts.prefix).toBe(`peluvida:queue:tenant:900042`);
      expect(opts.settings).toEqual(QUEUE_SETTINGS);
      expect(opts.concurrency).toBe(1);
    });
  });

  describe("backoff 策略注册（fixed-array）", () => {
    it("Worker settings.backoffStrategy 注入自定义策略且延迟档位正确", () => {
      expect(QUEUE_SETTINGS.backoffStrategy(1)).toBe(RETRY_DELAYS_MS[0]);
      expect(QUEUE_SETTINGS.backoffStrategy(2)).toBe(RETRY_DELAYS_MS[1]);
      expect(QUEUE_SETTINGS.backoffStrategy(3)).toBe(RETRY_DELAYS_MS[2]);
    });
  });
});
