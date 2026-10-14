/**
 * 宠物健康到期提醒 · 真库实证脚本（P0-06-03 · FR-2）
 *
 * 目的：在**真库 + 真 Redis + 真队列**上实证「到期记录生成提醒」链路与幂等语义：
 *  1. 受控插入一条到期日在扫描窗口内（今日 + 5 天）的疫苗记录；
 *  2. 运行扫描 → 断言该记录被入队（enqueued >= 1）且幂等键已写入 Redis（EXISTS=1）；
 *  3. 再次扫描 → 断言同一记录被幂等键拦截（enqueued === 0，不重复推送）；
 *  4. 清理受控数据（物理删记录 + Redis 键）。
 *
 * 运行（niulai-nest 下）：
 *   NODE_ENV=dev node ./node_modules/ts-node/dist/bin.js -r tsconfig-paths/register scripts/verify-pet-health-reminder.ts
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "../src/app.module";
import { enableBigIntJsonSerialization } from "../src/common/prisma/bigint-json";
import { PrismaService } from "../src/common/prisma/prisma.service";
import { RedisService } from "../src/common/redis/redis.service";
import { addDays, parseWallClock, toDayString } from "../src/common/utils/date.util";
import {
  HealthExpiryReminderService,
  buildHealthReminderKey,
} from "../src/pet/health-reminder.service";
import { QUEUE_REGISTRY } from "../src/queue/queue.module";
import type { QueueRegistry } from "../src/queue/queue-registry";

const TENANT_ID = "1";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`断言失败：${message}`);
}

async function main(): Promise<void> {
  const logger = new Logger("VerifyPetHealthReminder");
  enableBigIntJsonSerialization();

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });

  const prisma = app.get(PrismaService);
  const redis = app.get(RedisService);
  const service = app.get(HealthExpiryReminderService, { strict: false });

  // 受控数据：宠物 id 尽量取租户 1 的真实宠物（health_record 无 FK，缺失则用随机 UUID）
  const pet = await prisma.pet.findFirst({
    where: { tenantId: BigInt(TENANT_ID) },
    select: { id: true },
  });
  const petId = pet?.id ?? randomUUID();

  const today = toDayString(new Date());
  if (!today) throw new Error("无法计算今日日期");
  const recordDay = today;
  const expireDay = addDays(today, 5);

  let recordId = "";
  const redisKey = () => buildHealthReminderKey(TENANT_ID, recordId, expireDay);

  try {
    const record = await prisma.healthRecord.create({
      data: {
        tenantId: BigInt(TENANT_ID),
        petId,
        recordType: 1, // 疫苗
        recordDate: parseWallClock(recordDay, "UTC") as Date,
        expireDate: parseWallClock(expireDay, "UTC") as Date,
        content: "verify-pet-health-reminder 受控记录",
      },
    });
    recordId = record.id;
    logger.log(`受控记录已插入 id=${recordId} petId=${petId} expireDate=${expireDay}`);

    // 清掉该记录的幂等键，确保「首次扫描」必为新写入
    await redis.getClient().del(redisKey());

    // 第一次扫描：应入队 + 写幂等键
    const first = await service.scanAndEnqueue();
    const keyExistsAfterFirst = await redis.getClient().exists(redisKey());
    logger.log(
      `第一次扫描 scanned=${first.scanned} enqueued=${first.enqueued} skipped=${first.skipped} keyExists=${keyExistsAfterFirst}`
    );
    assert(first.scanned >= 1, "第一次扫描应命中受控记录（scanned >= 1）");
    assert(first.enqueued >= 1, "第一次扫描应至少入队 1 条（含受控记录）");
    assert(keyExistsAfterFirst === 1, "第一次扫描后幂等键应存在于 Redis");

    // 第二次扫描：同一记录被幂等键拦截（不重复入队）
    const second = await service.scanAndEnqueue();
    logger.log(
      `第二次扫描 scanned=${second.scanned} enqueued=${second.enqueued} skipped=${second.skipped}`
    );
    assert(second.scanned >= 1, "第二次扫描仍应命中窗口内记录");
    assert(second.enqueued === 0, "第二次扫描应被幂等键全部拦截（enqueued === 0）");

    logger.log("✅ 到期提醒链路实证通过：到期记录生成提醒 + 幂等键防重复");
    // eslint-disable-next-line no-console
    console.log(`[verify-pet-health-reminder] PASS ${JSON.stringify({ first, second })}`);
    process.exitCode = 0;
  } finally {
    // 清理：物理删受控记录 + Redis 幂等键
    if (recordId) {
      await redis
        .getClient()
        .del(redisKey())
        .catch(() => {});
      await prisma.healthRecord.deleteMany({ where: { id: recordId } }).catch(() => {});
    }
    const registry = app.get<QueueRegistry>(QUEUE_REGISTRY);
    await registry.closeAll().catch(() => {});
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
