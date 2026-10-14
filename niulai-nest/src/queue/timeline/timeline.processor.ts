/**
 * 宠物时间线异步写入 · 消费端处理器（P0-06-07）
 *
 * 与 CROSS-11 `pet-health` 消费器同范式：Worker 无 HTTP 中间件链，消费时必须以
 * `RequestContext.run` 包裹处理体并用 `RequestContext.setTenantId(data.tenantId)`
 * 恢复租户上下文（job.data 携带入队时的租户快照），保证消费端数据访问
 * （Prisma 扩展注入 / RLS GUC / Redis 键前缀）与请求链路行为一致。
 *
 * 落库复用**统一写入 SDK** 的 `writeTimelineEventSync`（同一套事件名回落逻辑），
 * 避免「请求内直写」与「队列消费写」两套口径漂移。
 *
 * 注：处理器是纯函数（依赖注入由 worker.ts 在注册时以闭包传入 PrismaService），
 * 单测可直接 `processTimelineWriteJob(job, prismaMock)`。
 */
import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";

import { RequestContext } from "../../common/context/request-context";
import type { PrismaService } from "../../common/prisma/prisma.service";
import { writeTimelineEventSync } from "../../pet/timeline-write.service";
import type { TimelineWriteJobData } from "./timeline.constants";

const logger = new Logger("PetTimeline");

/** 消费结果（验收断言锚点） */
export interface TimelineWriteJobResult {
  eventId: string;
  tenantId: string;
  eventName: string;
}

/**
 * 时间线异步写入处理器：恢复租户上下文 → 统一 SDK 落库。
 * 返回落库事件 id（字符串）与租户，供链路实证断言。
 */
export async function processTimelineWriteJob(
  job: Pick<Job<TimelineWriteJobData>, "data" | "id">,
  prisma: PrismaService
): Promise<TimelineWriteJobResult> {
  const data = job.data;
  if (!data || !data.petId || !data.eventName) {
    throw new Error(`[PetTimeline] 载荷缺失 petId/eventName（无法落库）jobId=${job.id ?? "?"}`);
  }

  return RequestContext.run(async () => {
    RequestContext.setTenantId(data.tenantId ?? null);
    const view = await writeTimelineEventSync(prisma, {
      tenantId: data.tenantId,
      petId: data.petId,
      eventName: data.eventName,
      eventType: data.eventType ?? undefined,
      content: data.content ?? null,
      payload: data.payload ?? null,
      refType: data.refType ?? null,
      refId: data.refId ?? null,
      actorType: data.actorType ?? undefined,
      operatorId: data.operatorId ?? null,
      visibleToOwner: data.visibleToOwner ?? undefined,
      eventTime: data.eventTime ?? null,
    });
    logger.log(
      `时间线异步落库 tenant=${view.tenantId} pet=${view.petId} event=${data.eventName} id=${view.id}`
    );
    return { eventId: view.id, tenantId: view.tenantId, eventName: data.eventName };
  });
}
