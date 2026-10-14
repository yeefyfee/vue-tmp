/**
 * 订单关闭公共落库实现（MVP-WEB-07-06 订单关闭 / 超时未支付自动关闭）
 *
 * 手动关闭（`PUT /orders/:id/close`，OrderService）与超时自动关闭（扫描脚本入队 →
 * worker 消费）两条路径的**唯一落库口径**：状态 CAS（`pending_payment → closed`）
 * + 关闭原因 / 关闭时刻落列 + 同事务审计（显式轨，防抵赖优先）。
 *
 * 抽为纯函数（依赖由调用方传入 tx / 审计服务）而非服务方法：worker 消费端无
 * OrderService 依赖，且两条路径的租户上下文恢复方式不同（请求链路 vs `RequestContext.run`），
 * 此处只收敛「事务内怎么写」，上下文由调用方各自负责。
 */
import { AuditAction, AuditEntityType, OrderStatus, type OrderCloseReason } from "@peluvida/shared";
import type { Order } from "@prisma/client";
import type { Prisma } from "@prisma/client";

import type { AuditLogService } from "../common/audit/audit-log.service";

/** 关闭落库入参（订单快照 + 原因 + 操作人） */
export interface CloseOrderInTxParams {
  /** 租户 id（bigint 形态字符串；CAS 与审计锚点共用） */
  tenantId: string;
  /** 待关闭的订单快照（CAS 以其 id / 状态为判据） */
  order: Order;
  /** 关闭原因（值域 @peluvida/shared ORDER_CLOSE_REASON） */
  reason: OrderCloseReason;
  /** 操作人（sys_user.id；系统动作传 null ⇒ 审计落 SYSTEM） */
  operatorId: bigint | null;
  /** 乐观锁基准版本（手动关闭传入做 version CAS；自动关闭扫描无该值则省略） */
  version?: number;
}

/**
 * 事务内关闭订单（状态 CAS + 原因 / 时刻落列 + 同事务审计）。
 *
 * 返回 `true` = 本次 CAS 命中并已关闭；`false` = 并发下状态已非 `pending_payment`
 * （行被他人先行流转 / 关闭）⇒ 调用方据此裁决（手动关闭返 A0912，自动关闭静默跳过）。
 *
 * ⚠️ 调用方须已在 `withTenantContext` 事务内（RLS GUC 一致），且已确认订单未软删。
 */
export async function closeOrderInTransaction(
  tx: Prisma.TransactionClient,
  audit: AuditLogService,
  params: CloseOrderInTxParams
): Promise<boolean> {
  const cas = await tx.order.updateMany({
    where: {
      id: params.order.id,
      tenantId: BigInt(params.tenantId),
      deletedAt: null,
      status: OrderStatus.PENDING_PAYMENT,
      ...(params.version === undefined ? {} : { version: params.version }),
    },
    data: {
      status: OrderStatus.CLOSED,
      closeReason: params.reason,
      closedAt: new Date(),
      updatedBy: params.operatorId,
      version: { increment: 1 },
    },
  });
  if (cas.count === 0) return false;

  await audit.record(
    {
      tenantId: params.tenantId,
      entityType: AuditEntityType.ORDER,
      entityId: params.order.id,
      action: AuditAction.UPDATE,
      before: { status: OrderStatus.PENDING_PAYMENT },
      after: { status: OrderStatus.CLOSED, closeReason: params.reason },
      operatorId: params.operatorId,
    },
    tx
  );
  return true;
}
