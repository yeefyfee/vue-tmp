/**
 * 订单超时未支付自动关闭 · 扫描入队脚本（MVP-WEB-07-06）
 *
 * 作用：枚举租户 → 逐租户扫描「`pending_payment` 且创建时刻早于超时阈值
 * （`ORDER_AUTO_CLOSE_TIMEOUT_MINUTES`）」的未软删订单，经 Redis 幂等键去重后
 * 逐条入队 `order-auto-close` 队列，由独立 worker 进程消费关闭
 * （原因 `payment_timeout`）。
 *
 * 运行（niulai-nest 下）：
 *   NODE_ENV=dev node ./node_modules/ts-node/dist/bin.js -r tsconfig-paths/register scripts/scan-order-auto-close.ts
 * 或：npm run order:scan-auto-close
 *
 * **调度接入（生产）**：本脚本是「一次性扫描」入口，不内置调度器。生产调度由外部
 * cron / k8s CronJob 周期调用本脚本，接入与编排归 CROSS-21；扫描周期须小于
 * `ORDER_AUTO_CLOSE_TIMEOUT_MINUTES`，避免漏扫。选择脚本而非 worker 内 BullMQ
 * repeatable job 的理由与 pet-health 扫描一致（worker 只做消费）。
 */
import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "../src/app.module";
import { enableBigIntJsonSerialization } from "../src/common/prisma/bigint-json";
import { OrderAutoCloseService } from "../src/order/order-auto-close.service";
import { QUEUE_REGISTRY } from "../src/queue/queue.module";
import type { QueueRegistry } from "../src/queue/queue-registry";

async function bootstrap(): Promise<void> {
  const logger = new Logger("OrderAutoCloseScan");

  // BigInteger JSON 兼容（入队载荷含 tenantId 字符串；与 main.ts 同口径）
  enableBigIntJsonSerialization();

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn", "log"],
  });

  try {
    const service = app.get(OrderAutoCloseService, { strict: false });
    const result = await service.scanAndEnqueue();
    logger.log(
      `扫描完成 asOf=${result.asOf} timeout=${result.timeoutMinutes}min scanned=${result.scanned} enqueued=${result.enqueued} skipped=${result.skipped}`
    );
    // 供 QA / 脚本消费机读结果
    // eslint-disable-next-line no-console
    console.log(`[order:scan-auto-close] ${JSON.stringify(result)}`);
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
