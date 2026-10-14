/**
 * 宠物健康到期提醒 · 扫描入队脚本（P0-06-03 · FR-2）
 *
 * 作用：一次性扫描「疫苗/驱虫（recordType 1/2）且 expireDate 落在 [今日, 今日+N]」
 * 的健康档案记录，经 Redis 幂等键去重后逐条入队 CROSS-11 队列
 * （`pet-health-reminder`），由独立 worker 进程消费推送。
 *
 * 运行（niulai-nest 下）：
 *   NODE_ENV=dev node ./node_modules/ts-node/dist/bin.js -r tsconfig-paths/register scripts/scan-health-expiry.ts
 * 或：npm run pet:scan-health-expiry
 *
 * **调度接入（生产）**：本脚本是「一次性扫描」入口，不内置调度器（@nestjs/schedule
 * 未安装，且不宜在 API 进程内挂后台定时任务）。生产调度由外部 cron / k8s CronJob
 * 周期调用本脚本，接入与编排归 CROSS-21。选择脚本而非 worker 内 BullMQ repeatable
 * job 的理由见报告（避免为扫描把 Prisma/Redis/租户模块重装进 worker 进程，保持 worker
 * 只做消费）。
 */
import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "../src/app.module";
import { enableBigIntJsonSerialization } from "../src/common/prisma/bigint-json";
import { HealthExpiryReminderService } from "../src/pet/health-reminder.service";
import { QUEUE_REGISTRY } from "../src/queue/queue.module";
import type { QueueRegistry } from "../src/queue/queue-registry";

async function bootstrap(): Promise<void> {
  const logger = new Logger("PetHealthExpiryScan");

  // BigInteger JSON 兼容（入队载荷含 tenantId 字符串；与 main.ts 同口径）
  enableBigIntJsonSerialization();

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn", "log"],
  });

  try {
    const service = app.get(HealthExpiryReminderService, { strict: false });
    const result = await service.scanAndEnqueue();
    logger.log(
      `扫描完成 asOf=${result.asOf} scanned=${result.scanned} enqueued=${result.enqueued} skipped=${result.skipped}`
    );
    // 供 QA / 脚本消费机读结果
    // eslint-disable-next-line no-console
    console.log(`[pet:scan-health-expiry] ${JSON.stringify(result)}`);
  } finally {
    // 队列连接持有 Redis 连接，未关闭会让进程无法退出（一次性脚本语义：跑完即退）
    const registry = app.get<QueueRegistry>(QUEUE_REGISTRY);
    await registry.closeAll().catch(() => {});
    await app.close();
  }
}

bootstrap()
  .then(() => process.exit(0))
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
