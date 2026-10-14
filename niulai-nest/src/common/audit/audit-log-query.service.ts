import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { buildPageResult, normalizePageQuery, type PageResult } from "@peluvida/shared";

import { PrismaService } from "../prisma/prisma.service";
import { requireBigInt } from "../prisma/prisma-ids";
import { TenantContextService } from "../../tenant/tenant-context.service";
import { endOfDay, parseWallClock } from "../utils/date.util";
import { QueryAuditLogDto } from "./dto/query-audit-log.dto";

/**
 * 审计日志行（BigInt 主键 → string 的 API 形态）
 *
 * 结构化口径（子任务 4）：id / tenantId / operatorId 一律 `.toString()`；
 * storeId 本就是 uuid 字符串；before / after JSON 原样透传（写入侧已脱敏）；
 * operatorName / ip / traceId / idempotencyKey 透传；createdAt 保留 Date，
 * 由全局 ResponseInterceptor 统一格式化（与业务域列表同口径）。
 */
export interface AuditLogItem {
  id: string;
  tenantId: string;
  storeId: string | null;
  entityType: string;
  entityId: string;
  action: number;
  before: unknown;
  after: unknown;
  operatorId: string | null;
  operatorType: number;
  operatorName: string | null;
  ip: string | null;
  traceId: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
}

/**
 * 审计日志查询服务（P0-02-08 子任务 4 · 租户内查询）
 *
 * ── 租户隔离契约（不依赖 RLS 单层兜底）──
 * AuditLog **不在 TENANT_SCOPED_MODELS 名单内**（写入轨 fail-closed 语义会误拦
 * 平台级 / 系统任务写入，见 audit-log.service.ts 决策注释），因此 `prisma.scoped.auditLog`
 * 对该模型是纯透传。隔离的**应用层唯一保证**在本服务：
 *   where 必带 `tenantId = BigInt(requireTenantId())`（无上下文抛 A0302，fail-closed）；
 * DB 层 audit_log FORCE RLS（tenant_isolation 策略）作为第二道兜底。
 * **绝不从请求参数读取 tenantId**——租户锚点只来自 JWT payload（ALS）。
 *
 * ── 查询形态 ──
 *  - 仅列表（复合主键 (id, created_at) 不做单查）；
 *  - 排序固定 createdAt desc, id desc（时间倒序 + 同毫秒稳定序）；
 *  - 筛选条件与 idx_audit_entity / idx_audit_operator / idx_audit_tenant_time 对齐；
 *  - 分页信封用 shared `buildPageResult`（list / total / page / page_size，A4），
 *    service 内直接产出终态信封（不走 ResponseInterceptor 的 {data, page} 改写分支）。
 */
@Injectable()
export class AuditLogQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService
  ) {}

  /**
   * 分页查询当前租户的审计日志。
   *
   * @param query 筛选与分页参数（DTO 已做格式校验；operatorId / 时间端点在
   *        本方法再做语义级解析——非法 operatorId 抛 400，非法时间端点静默忽略该端点）
   */
  async findPage(query: QueryAuditLogDto): Promise<PageResult<AuditLogItem>> {
    // fail-closed：无租户上下文（平台 admin / 未登录）直接 A0302，绝不返回兜底数据
    const tenantId = this.tenantContext.requireTenantId();

    const where: Prisma.AuditLogWhereInput = {
      // 隔离锚点：只认上下文租户（BigInt 口径），请求参数无权参与
      tenantId: BigInt(tenantId),
    };

    if (query.entityType) {
      where.entityType = query.entityType;
    }
    if (query.entityId) {
      where.entityId = query.entityId;
    }
    if (query.operatorId) {
      // DTO 已保证纯数字；requireBigInt 再做 BigInt 化与 >0 语义校验（非法抛 400）
      where.operatorId = requireBigInt(query.operatorId, "操作人ID");
    }
    if (query.action !== undefined && query.action !== null) {
      where.action = query.action;
    }

    // 时间区间（含边界）：startDate 取解析瞬时（含），endDate 取当天末尾（含）。
    // 时间处理铁律 4：区间端点一律走 date.util 按应用时区解析；非法输入返回
    // null → 该端点不进 where（不炸接口，与门店列表同口径）。
    const gte = query.startDate ? parseWallClock(query.startDate) : null;
    const lte = query.endDate ? endOfDay(query.endDate) : null;
    if (gte || lte) {
      where.createdAt = {
        ...(gte ? { gte } : {}),
        ...(lte ? { lte } : {}),
      };
    }

    const pageQuery = normalizePageQuery({
      page: query.page,
      page_size: query.page_size,
    });

    const orderBy: Prisma.AuditLogOrderByWithRelationInput[] = [
      { createdAt: "desc" },
      { id: "desc" },
    ];

    const [rows, total] = await Promise.all([
      this.prisma.scoped.auditLog.findMany({
        where,
        orderBy,
        skip: (pageQuery.page - 1) * pageQuery.page_size,
        take: pageQuery.page_size,
      }),
      this.prisma.scoped.auditLog.count({ where }),
    ]);

    return buildPageResult(rows.map(serializeAuditRow), total, pageQuery);
  }
}

/** 行序列化：BigInt → string（.toString() 口径，PEL-10c 主键字符串形态契约） */
function serializeAuditRow(row: {
  id: string;
  tenantId: bigint;
  storeId: string | null;
  entityType: string;
  entityId: string;
  action: number;
  before: unknown;
  after: unknown;
  operatorId: bigint | null;
  operatorType: number;
  operatorName: string | null;
  ip: string | null;
  traceId: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
}): AuditLogItem {
  return {
    id: row.id,
    tenantId: row.tenantId.toString(),
    storeId: row.storeId,
    entityType: row.entityType,
    entityId: row.entityId,
    action: row.action,
    before: row.before,
    after: row.after,
    operatorId: row.operatorId !== null ? row.operatorId.toString() : null,
    operatorType: row.operatorType,
    operatorName: row.operatorName,
    ip: row.ip,
    traceId: row.traceId,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt,
  };
}
