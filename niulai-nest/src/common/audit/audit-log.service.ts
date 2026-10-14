import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  AUDIT_TENANT_ID_PLATFORM,
  AuditOperatorType,
  type AuditAction,
  type AuditEntityType,
} from "@peluvida/shared";
import { PrismaService } from "../prisma/prisma.service";
import { toBigInt } from "../prisma/prisma-ids";
import { RequestContext } from "../context/request-context";
import { buildAuditDiff } from "./audit-diff.util";

/**
 * 审计日志写入服务（P0-02-08 · 双轨）
 *
 * ── TENANT_SCOPED_MODELS 决策：**AuditLog 不进名单**（结论依据
 * `tenant-scope.extension.ts` 的实际语义）──
 * 扩展对名单内模型：读/改/删注入租户 where、写注入 data（上下文值恒定覆盖），
 * 且**任何操作在无租户上下文时 fail-closed 拒绝**。而审计写入天然要覆盖两类
 * 无租户上下文场景：① 平台 admin（JWT tenantId=null）操作平台级对象
 * （sys_role / sys_menu / sys_config，Q6）；② 系统定时任务（无请求 ALS，
 * operatorType=SYSTEM，Q4）。进名单 ⇒ 这两类写入走 scoped 客户端即被拒绝。
 * 因此：
 *  - 写侧：tenant_id 的正确性由本服务显式解析链保证（entry.tenantId >
 *    RequestContext.getTenantId() > 平台哨兵 0），DB 侧 RLS WITH CHECK
 *    （写入值必须等于事务内 GUC）再兜一层，不依赖扩展注入；
 *  - 读侧：由 RLS SELECT 策略 fail-closed 兜底（GUC 未设 ⇒ 任何行不可见）；
 *    子任务 4 的查询接口若走 scoped 客户端，届时再评估登记进名单
 *    （读侧 fail-closed 语义恰好匹配查询场景，登记无副作用）。
 *
 * ── 双轨失败策略（评估报告 3.4，有意设计）──
 *  - 显式轨（传入 tx，业务事务内调用）：审计失败 = 业务失败——卡转让 / 代打卡
 *    等「资金 / 责任」场景，审计缺席宁可业务回滚（防抵赖优先）；
 *  - 自动轨（不传 tx，拦截器调用）：自管事务写入，失败仅告警不阻断——系统域
 *    操作本身在 sys_log 有双份留痕，不丢线索。
 *
 * ── 写侧 RLS 契约 ──
 * audit_log 启用 FORCE RLS，策略 tenant_isolation 要求 tenant_id = GUC
 * app.tenant_id（迁移 20261005170000 注释）。本服务保证二者一致：
 *  - 自动轨：自管事务内 set_config 后写入（GUC 事务级，连接归还自动清空）；
 *  - 显式轨：调用方须用标准姿势开启业务事务（PrismaService.withTenantContext，
 *    其内部已 set_config）再传入 tx；未设 GUC 的事务写入会被 WITH CHECK 拒绝
 *    ⇒ 表现为业务失败，与显式轨失败语义一致（fail-closed）。
 */
@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 写入一条审计记录。
   *
   * @param entry 审计内容（before/after 传入变更前后的业务对象即可，diff 与
   *        脱敏在本服务内完成——只存变更字段，敏感键名替换为 "***"）
   * @param tx 可选业务事务客户端：传入 = 显式轨（同事务，失败抛出随业务回滚）；
   *        不传 = 自动轨（自管事务，GUC 一致性由本服务保证）
   */
  async record(entry: AuditEntryInput, tx?: Prisma.TransactionClient): Promise<void> {
    const data = this.buildRow(entry);
    if (tx) {
      // 显式轨：同事务写入，create 失败直接抛出（审计失败 = 业务失败，不吞）
      await tx.auditLog.create({ data });
      return;
    }
    // 自动轨 / 无事务场景：自管事务，事务内把 GUC 设为与写入值一致（RLS WITH CHECK 契约）。
    // set_config(..., is_local := true) 等价 SET LOCAL（与 PrismaService.withTenantContext 同法）
    await this.prisma.$transaction(async (trx) => {
      await trx.$executeRaw(
        Prisma.sql`SELECT set_config('app.tenant_id', ${String(data.tenantId)}, true)`
      );
      await trx.auditLog.create({ data });
    });
  }

  /**
   * 组装落库行（含 diff / 脱敏 / 锚点解析）。
   * 解析优先级即 Q6 口径：显式传入（被操作数据所属租户 / 指定操作人）优先，
   * 缺省回退请求上下文（操作者视角），租户最终回退平台哨兵 0。
   */
  private buildRow(entry: AuditEntryInput): Prisma.AuditLogUncheckedCreateInput {
    const tenantId =
      toBigInt(entry.tenantId) ??
      toBigInt(RequestContext.getTenantId()) ??
      AUDIT_TENANT_ID_PLATFORM;

    // 操作人：显式传入 > ALS 当前用户；两者皆无 = 系统动作（operator_id NULL + SYSTEM）
    const operatorId = toBigInt(entry.operatorId) ?? toBigInt(RequestContext.getUserId());

    const { before, after } = buildAuditDiff(entry.before, entry.after);

    return {
      tenantId,
      storeId: entry.storeId ?? RequestContext.getStoreId(),
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      // diff 结构与 Prisma InputJsonValue 运行时同形（纯 JSON 值），
      // TS 递归类型差异以受控断言收敛（Record<string, unknown> → JSON 输入）
      before: before as Prisma.InputJsonValue | null,
      after: after as Prisma.InputJsonValue | null,
      operatorId,
      operatorType:
        entry.operatorType ??
        (operatorId === null ? AuditOperatorType.SYSTEM : AuditOperatorType.USER),
      operatorName: entry.operatorName ?? RequestContext.getCurrentUser()?.username ?? null,
      ip: entry.ip ?? null,
      traceId: RequestContext.getTraceId(),
      idempotencyKey: RequestContext.getIdempotencyKey(),
    };
  }
}

/** 审计写入入参（锚点字段可缺省，由请求上下文 / 哨兵回退） */
export interface AuditEntryInput {
  /** 被操作数据所属租户（Q6）；缺省取请求上下文；平台级对象传 0（shared 哨兵） */
  tenantId?: string | number | bigint | null;
  /** 门店 id（store.uuid；缺省取 X-Store-Id 上下文；平台级操作 NULL） */
  storeId?: string | null;
  /** 审计对象类型（@peluvida/shared AuditEntityType） */
  entityType: AuditEntityType | string;
  /** 审计对象 ID（业务表主键字符串形态，兼容 BigInt / uuid） */
  entityId: string;
  /** 审计动作（@peluvida/shared AuditAction） */
  action: AuditAction | number;
  /** 变更前业务对象（create 传 null；delete 传全量快照；update 传变更前状态） */
  before?: Record<string, unknown> | null;
  /** 变更后业务对象（delete 传 null；create 传全量；update 传变更后状态） */
  after?: Record<string, unknown> | null;
  /** 操作人（sys_user.id；缺省取 ALS 当前用户；系统动作留空） */
  operatorId?: string | number | bigint | null;
  /** 操作人类型（缺省按 operatorId 是否存在自动判定） */
  operatorType?: AuditOperatorType | number;
  /** 操作人姓名快照（缺省取 ALS username；冗余存储防改名/删除后不可读） */
  operatorName?: string | null;
  /** 客户端 IP（缺省 NULL；拦截器轨从请求提取后显式传入） */
  ip?: string | null;
}
