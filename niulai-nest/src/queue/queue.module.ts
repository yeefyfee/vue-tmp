/**
 * 队列基础设施 · 模块（CROSS-11）
 *
 * producer 侧动态模块：复用项目 Redis 配置（`redis.*`，来自 src/config/redis.config.ts
 * 与 REDIS_* 环境变量，不硬编码连接参数），把 {@link QueueRegistry} 注入 DI 容器。
 *
 * **连接复用说明**：BullMQ 的连接参数与缓存用同一组 REDIS_* 环境变量（host/port/
 * password/db），但**不复用缓存客户端实例**——BullMQ 对连接有 bclient/事件流等
 * 多连接要求，且键空间由 `QUEUE_KEY_PREFIX`（peluvida:queue:）与缓存隔离。
 *
 * **worker 侧**：不注册在本模块——API 进程只做生产者；Worker 在独立入口
 * src/worker.ts 组装（物理 server/worker 进程拆分归 A3，本任务先落独立启动入口）。
 */
import { DynamicModule, Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { QueueRegistry, type QueueConnectionOptions } from "./queue-registry";

export const QUEUE_REGISTRY = "QUEUE_REGISTRY";

/**
 * 队列模块（producer 侧）：
 * ```ts
 * @Module({ imports: [QueueModule.forRootAsync()] })
 * export class SomeModule {
 *   constructor(@Inject(QUEUE_REGISTRY) private readonly registry: QueueRegistry) {}
 * }
 * ```
 */
@Global()
@Module({})
export class QueueModule {
  static forRootAsync(): DynamicModule {
    return {
      module: QueueModule,
      global: true,
      imports: [],
      providers: [
        {
          provide: QUEUE_REGISTRY,
          inject: [ConfigService],
          useFactory: (config: ConfigService): QueueRegistry =>
            new QueueRegistry({
              host: config.getOrThrow<string>("redis.host"),
              port: config.getOrThrow<number>("redis.port"),
              db: config.get<number>("redis.db") || 0,
              password: config.get<string>("redis.password"),
            } satisfies QueueConnectionOptions),
        },
      ],
      exports: [QUEUE_REGISTRY],
    };
  }
}
