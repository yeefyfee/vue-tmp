/**
 * 队列基础设施 · 独立 Worker 进程入口（CROSS-11）
 *
 * **进程模型**：worker 是独立入口（本文件），与 API 进程（src/main.ts）互不占用端口；
 * API 进程只当生产者（AppModule 已注入 QueueModule），消费在本进程进行。
 * 逻辑上仍属同一 monorepo 工程，物理 server/worker 拆分部署归 A3。
 *
 * 启动（niulai-nest 下）：
 *   NODE_ENV=dev node ./node_modules/ts-node/dist/bin.js -r tsconfig-paths/register src/worker.ts
 */
import "reflect-metadata";
import { Logger, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ConfigModule, ConfigService } from "@nestjs/config";

import { enableBigIntJsonSerialization } from "./common/prisma/bigint-json";
import { AuditLogService } from "./common/audit/audit-log.service";
import { PrismaModule } from "./common/prisma/prisma.module";
import { PrismaService } from "./common/prisma/prisma.service";
import { QueueModule, QUEUE_REGISTRY } from "./queue/queue.module";
import {
  QueueRegistry,
  DEMO_QUEUE,
  HEALTH_REMINDER_QUEUE,
  ORDER_AUTO_CLOSE_QUEUE,
  TIMELINE_QUEUE,
} from "./queue/queue-registry";
import { processDemoJob } from "./queue/demo/demo.processor";
import { processHealthReminderJob } from "./queue/pet-health/health-reminder.processor";
import { processOrderAutoCloseJob } from "./queue/order-auto-close/order-auto-close.processor";
import { processTimelineWriteJob } from "./queue/timeline/timeline.processor";
import { validateEnv } from "./config/env.validation";
import databaseConfig from "./config/database.config";
import redisConfig from "./config/redis.config";

const envPath = `.env.${process.env.NODE_ENV || "dev"}`;

/**
 * Worker 组装模块：只挂 ConfigModule（env 校验与 main.ts 同口径）+ PrismaModule +
 * QueueModule，不引入 HTTP / 守卫 / 审计等 API 进程专属设施；消费器注册在
 * bootstrap 完成后进行。
 *
 * P0-06-07：时间线异步写入消费器需访问数据库，故 Worker 亦装配 PrismaModule
 * （@Global，提供 PrismaService）并加载 databaseConfig（PrismaService 读取
 * `database.url`）。
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env", envPath],
      load: [databaseConfig, redisConfig],
      validate: validateEnv,
    }),
    PrismaModule,
    QueueModule.forRootAsync(),
  ],
})
class WorkerModule {}

async function bootstrap(): Promise<void> {
  const logger = new Logger("WorkerBootstrap");

  enableBigIntJsonSerialization();

  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ["error", "warn", "log"],
  });
  const registry = app.get<QueueRegistry>(QUEUE_REGISTRY);

  // 登记消费器：demo 队列 → demo 处理器（processDemoJob 纯函数直接作为 processor）
  const worker = registry.createWorker(DEMO_QUEUE, async (job) => processDemoJob(job));
  worker.on("completed", (job, result) => {
    logger.log(`job 完成 queue=${DEMO_QUEUE} id=${job.id} result=${JSON.stringify(result)}`);
  });

  // 登记消费器：宠物健康到期提醒队列（P0-06-03 FR-2）→ 到期提醒处理器
  // 入队侧：scripts/scan-health-expiry.ts（pet:scan-health-expiry）扫描并逐条入队；
  // 消费侧：恢复 job.data.tenantId 上下文后推送（真通道 P0 未定，先落结构化日志）。
  const healthWorker = registry.createWorker(HEALTH_REMINDER_QUEUE, async (job) =>
    processHealthReminderJob(job)
  );
  healthWorker.on("completed", (job, result) => {
    logger.log(
      `到期提醒已推送 queue=${HEALTH_REMINDER_QUEUE} id=${job.id} result=${JSON.stringify(result)}`
    );
  });

  // 登记消费器：宠物时间线异步写入队列（P0-06-07 FR-5）→ 统一写入 SDK 落库。
  // 入队侧：TimelineWriteService.recordAsync（请求/系统任务内）；
  // 消费侧：恢复 job.data.tenantId 上下文后经 writeTimelineEventSync 落库。
  const prisma = app.get(PrismaService);
  const timelineWorker = registry.createWorker(TIMELINE_QUEUE, async (job) =>
    processTimelineWriteJob(job, prisma)
  );
  timelineWorker.on("completed", (job, result) => {
    logger.log(
      `时间线事件已落库 queue=${TIMELINE_QUEUE} id=${job.id} result=${JSON.stringify(result)}`
    );
  });

  // 登记消费器：订单超时未支付自动关闭队列（MVP-WEB-07-06）→ 统一关闭口径落库。
  // 入队侧：scripts/scan-order-auto-close.ts（order:scan-auto-close）枚举租户后扫描入队；
  // 消费侧：恢复 job.data.tenantId 上下文后经 closeOrderInTransaction 关闭（原因 payment_timeout）。
  // AuditLogService 为纯构造依赖（仅 PrismaService），此处按 worker 装配方式显式实例化。
  const auditLogService = new AuditLogService(prisma);
  const orderAutoCloseWorker = registry.createWorker(ORDER_AUTO_CLOSE_QUEUE, async (job) =>
    processOrderAutoCloseJob(job, prisma, auditLogService)
  );
  orderAutoCloseWorker.on("completed", (job, result) => {
    logger.log(
      `订单超时自动关闭 queue=${ORDER_AUTO_CLOSE_QUEUE} id=${job.id} result=${JSON.stringify(result)}`
    );
  });

  app.enableShutdownHooks();
  // ⚠️ 必须用类引用取 ConfigService（isGlobal 注册的 token 是类本身），
  // 字符串 "ConfigService" 走 InstanceLinksHost 查不到 → UnknownElementException
  const config = app.get(ConfigService, { strict: false });
  logger.log(
    `Worker 已启动（无 HTTP 端口）：redis=${config.get("redis.host")}:${config.get("redis.port")} db=${config.get("redis.db")}，消费队列：${DEMO_QUEUE}、${HEALTH_REMINDER_QUEUE}、${TIMELINE_QUEUE}、${ORDER_AUTO_CLOSE_QUEUE}`
  );
}

void bootstrap();
