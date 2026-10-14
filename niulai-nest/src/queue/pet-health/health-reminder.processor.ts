/**
 * 宠物健康到期提醒 · 消费端处理器（P0-06-03 · FR-2）
 *
 * 与 CROSS-11 `demo.processor` 同范式：Worker 无 HTTP 中间件链，消费时必须以
 * `RequestContext.run` 包裹处理体并用 `RequestContext.setTenantId(data.tenantId)`
 * 恢复租户上下文（job.data 携带入队时的租户快照），保证消费端访问租户数据
 * （Prisma 扩展注入 / Redis 键前缀）与请求链路行为一致。
 *
 * **推送通道说明**：真推送通道（站内信 / 小程序订阅消息 / 短信）P0 未定，
 * 本期以「队列 job + 结构化日志」证明「到期记录 → 入队 → 消费」链路打通；
 * 真通道接入归后续任务（CROSS-21 生产调度一并收口）。
 */
import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";

import { RequestContext } from "../../common/context/request-context";

const logger = new Logger("PetHealthReminder");

/** 到期提醒任务载荷（由 HealthExpiryReminderService 入队） */
export interface HealthReminderJobData {
  /** 租户快照（消费端 RequestContext 恢复锚点） */
  tenantId: string;
  /** 宠物 id */
  petId: string;
  /** 健康档案记录 id */
  recordId: string;
  /** 记录类型：1疫苗 / 2驱虫 */
  recordType: number;
  /** 记录类型中文名（疫苗/驱虫） */
  recordName: string;
  /** 到期日（yyyy-MM-dd） */
  expireDate: string;
  /** 距到期天数（>=0） */
  daysLeft: number;
}

/** 到期提醒任务结果（验收断言锚点） */
export interface HealthReminderJobResult {
  recordId: string;
  tenantId: string;
  recordType: number;
  expireDate: string;
  daysLeft: number;
  message: string;
}

/**
 * 到期提醒处理器（纯函数，Worker 经适配器接入，单测直接调用）。
 * 返回消费端恢复出的租户上下文与提醒文案，供链路实证断言。
 */
export async function processHealthReminderJob(
  job: Pick<Job<HealthReminderJobData>, "data" | "id">
): Promise<HealthReminderJobResult> {
  const data = job.data;
  if (!data || !data.recordId) {
    throw new Error(`[PetHealthReminder] 载荷缺失 recordId（无法推送）jobId=${job.id ?? "?"}`);
  }

  return RequestContext.run(() => {
    RequestContext.setTenantId(data.tenantId ?? null);
    const tenantId = RequestContext.getTenantId() ?? "";
    const message =
      `[宠物健康到期提醒] 宠物 ${data.petId} 的${data.recordName}` +
      `（recordId=${data.recordId} recordType=${data.recordType}）` +
      `将于 ${data.expireDate} 到期（剩余 ${data.daysLeft} 天）`;
    logger.log(`tenant=${tenantId} ${message}`);
    return {
      recordId: data.recordId,
      tenantId,
      recordType: data.recordType,
      expireDate: data.expireDate,
      daysLeft: data.daysLeft,
      message,
    };
  });
}
