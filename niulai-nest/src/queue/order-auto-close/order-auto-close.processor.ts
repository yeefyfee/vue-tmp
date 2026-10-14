/**
 * 订单超时未支付自动关闭 · 消费端处理器（MVP-WEB-07-06）
 *
 * 与 `pet-health` 消费器同范式：Worker 无 HTTP 中间件链，消费时必须以
 * `RequestContext.run` 包裹处理体并用 `RequestContext.setTenantId(data.tenantId)`
 * 恢复租户上下文（job.data 携带入队时的租户快照），保证消费端数据访问
 * （RLS GUC）与请求链路行为一致。
 *
 * 落库复用订单域**统一关闭口径** `closeOrderInTransaction`（与手动关闭
 * `PUT /orders/:id/close` 同一实现），避免「请求内关闭」与「队列消费关闭」
 * 两套口径漂移。
 *
 * 注：处理器是纯函数（依赖由 worker.ts 在注册时以闭包传入 PrismaService 与
 * AuditLogService），单测可直接 `processOrderAutoCloseJob(job, prismaMock, auditMock)`。
 */
import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";

import { ORDER_CLOSE_REASON } from "@peluvida/shared";

import { RequestContext } from "../../common/context/request-context";
import type { AuditLogService } from "../../common/audit/audit-log.service";
import type { PrismaService } from "../../common/prisma/prisma.service";
import { closeOrderInTransaction } from "../../order/order-close.util";

const logger = new Logger("OrderAutoClose");

/** 自动关单任务载荷（由 OrderAutoCloseService 入队） */
export interface OrderAutoCloseJobData {
  /** 租户快照（消费端 RequestContext 恢复锚点） */
  tenantId: string;
  /** 订单 id */
  orderId: string;
  /** 业务单号（日志可读性） */
  orderNo: string;
}

/** 自动关单任务结果（验收断言锚点） */
export interface OrderAutoCloseJobResult {
  orderId: string;
  tenantId: string;
  orderNo: string;
  /** 本次是否真正关闭（并发下状态已变 ⇒ false，静默跳过） */
  closed: boolean;
}

/**
 * 自动关单处理器：恢复租户上下文 → 统一关闭口径落库（原因 `payment_timeout`，操作人 SYSTEM）。
 * 返回是否真正关闭，供链路实证断言。
 */
export async function processOrderAutoCloseJob(
  job: Pick<Job<OrderAutoCloseJobData>, "data" | "id">,
  prisma: PrismaService,
  audit: AuditLogService
): Promise<OrderAutoCloseJobResult> {
  const data = job.data;
  if (!data || !data.orderId || !data.tenantId) {
    throw new Error(`[OrderAutoClose] 载荷缺失 orderId/tenantId（无法关闭）jobId=${job.id ?? "?"}`);
  }

  return RequestContext.run(async () => {
    RequestContext.setTenantId(data.tenantId);
    const closed = await prisma.withTenantContext(data.tenantId, async (tx) => {
      const row = await tx.order.findFirst({
        where: { id: data.orderId, deletedAt: null },
      });
      // 行已被软删（作废）/ 不存在 ⇒ 无需关闭，静默跳过
      if (!row) return false;
      return await closeOrderInTransaction(tx, audit, {
        tenantId: data.tenantId,
        order: row,
        reason: ORDER_CLOSE_REASON.PAYMENT_TIMEOUT,
        operatorId: null,
      });
    });

    logger.log(`自动关单 tenant=${data.tenantId} order=${data.orderNo} closed=${closed}`);
    return { orderId: data.orderId, tenantId: data.tenantId, orderNo: data.orderNo, closed };
  });
}
