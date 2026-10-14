import "reflect-metadata";

import { BadRequestException } from "@nestjs/common";
import { AuditLogQueryService, type AuditLogItem } from "./audit-log-query.service";
import { QueryAuditLogDto } from "./dto/query-audit-log.dto";
import type { TenantContextService } from "../../tenant/tenant-context.service";
import { BusinessException } from "../../common/exceptions/business.exception";
import { ErrorCode } from "../../common/enums/error-code.enum";
import type { PrismaService } from "../../common/prisma/prisma.service";

/**
 * 审计日志查询服务单测（P0-02-08 子任务 4）
 *
 * 覆盖：
 *  1. tenantId 必带（无上下文抛 A0302，fail-closed）；
 *  2. 筛选条件拼装（entityType / entityId / operatorId / action / 时间区间）；
 *  3. 排序固定 createdAt desc, id desc + 标准 skip/take 分页；
 *  4. 分页信封对齐 A4（list / total / page / page_size）与 BigInt → string 序列化。
 */

/** scoped.auditLog 最小 mock（findMany + count） */
function makePrismaMock(rows: Array<Record<string, unknown>> = [], total = rows.length) {
  return {
    scoped: {
      auditLog: {
        findMany: jest.fn().mockResolvedValue(rows),
        count: jest.fn().mockResolvedValue(total),
      },
    },
  } as unknown as PrismaService;
}

/** TenantContextService 最小 mock：requireTenantId 可编程 */
function makeTenantContextMock(tenantId: string | null): TenantContextService {
  return {
    requireTenantId: () => {
      if (!tenantId) {
        throw new BusinessException(ErrorCode.TENANT_CONTEXT_MISSING);
      }
      return tenantId;
    },
  } as unknown as TenantContextService;
}

/** 审计行 DB 形态样例（BigInt 侧） */
function sampleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "0b6c2f6e-1111-4222-8333-444455556666",
    tenantId: 1n,
    storeId: "3f2c0000-0000-4000-8000-000000000001",
    entityType: "store",
    entityId: "42",
    action: 1,
    before: null,
    after: { name: "门店A" },
    operatorId: 9001n,
    operatorType: 1,
    operatorName: "tenant_admin",
    ip: "203.0.113.9",
    traceId: "trace-abc",
    idempotencyKey: "idem-1",
    createdAt: new Date("2026-10-05T12:00:00.000Z"),
    ...overrides,
  };
}

function makeService(
  rows: Array<Record<string, unknown>> = [],
  total?: number,
  tenantId: string | null = "1"
): AuditLogQueryService {
  return new AuditLogQueryService(
    makePrismaMock(rows, total ?? rows.length),
    makeTenantContextMock(tenantId)
  );
}

function findManyMock(service: AuditLogQueryService): jest.Mock {
  return (service as unknown as { prisma: { scoped: { auditLog: { findMany: jest.Mock } } } })
    .prisma.scoped.auditLog.findMany;
}

function countMock(service: AuditLogQueryService): jest.Mock {
  return (service as unknown as { prisma: { scoped: { auditLog: { count: jest.Mock } } } }).prisma
    .scoped.auditLog.count;
}

describe("AuditLogQueryService（P0-02-08 子任务 4 · 租户内查询）", () => {
  describe("租户锚点（fail-closed）", () => {
    it("无租户上下文 → requireTenantId 抛 A0302，绝不发查询", async () => {
      const service = makeService([sampleRow()], 1, null);
      const error: unknown = await service.findPage(new QueryAuditLogDto()).catch((e) => e);
      expect(error).toBeInstanceOf(BusinessException);
      expect((error as BusinessException).getResponse()).toMatchObject({ code: "A0302" });
      expect(findManyMock(service)).not.toHaveBeenCalled();
      expect(countMock(service)).not.toHaveBeenCalled();
    });

    it("查询 where 必带显式 tenantId（BigInt 化上下文租户，隔离锚点不来自请求参数）", async () => {
      const service = makeService([], 0, "7");
      await service.findPage({ page: 1, page_size: 20 } as QueryAuditLogDto);
      const where = findManyMock(service).mock.calls[0][0].where;
      expect(where.tenantId).toBe(7n);
      const countWhere = countMock(service).mock.calls[0][0].where;
      expect(countWhere.tenantId).toBe(7n);
    });
  });

  describe("筛选条件拼装（与索引对齐）", () => {
    it("全量筛选：entityType / entityId / operatorId / action 逐项进 where", async () => {
      const service = makeService([], 0);
      await service.findPage({
        page: 1,
        page_size: 20,
        entityType: "store",
        entityId: "42",
        operatorId: "9001",
        action: 1,
      } as QueryAuditLogDto);

      const where = findManyMock(service).mock.calls[0][0].where;
      expect(where).toMatchObject({
        tenantId: 1n,
        entityType: "store",
        entityId: "42",
        operatorId: 9001n,
        action: 1,
      });
    });

    it("不传筛选 → where 仅含 tenantId", async () => {
      const service = makeService([], 0);
      await service.findPage(new QueryAuditLogDto());
      const where = findManyMock(service).mock.calls[0][0].where;
      expect(where).toEqual({ tenantId: 1n });
    });

    it("非法 operatorId（非正数）→ 400，不发查询", async () => {
      const service = makeService([], 0);
      await expect(
        service.findPage({ page: 1, page_size: 20, operatorId: "0" } as QueryAuditLogDto)
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(findManyMock(service)).not.toHaveBeenCalled();
    });

    it("时间区间（含边界）：startDate 走 parseWallClock，endDate 取当天末尾 lte", async () => {
      const service = makeService([], 0);
      await service.findPage({
        page: 1,
        page_size: 20,
        startDate: "2026-10-01 08:00:00",
        endDate: "2026-10-03",
      } as QueryAuditLogDto);

      const where = findManyMock(service).mock.calls[0][0].where;
      const createdAt = where.createdAt as { gte: Date; lte: Date };
      // 东八区 2026-10-01 08:00 → UTC 00:00
      expect(createdAt.gte.toISOString()).toBe("2026-10-01T00:00:00.000Z");
      // endOfDay：2026-10-03 当天末尾（23:59:59.999 东八区）
      expect(createdAt.lte.toISOString()).toBe("2026-10-03T15:59:59.999Z");
    });

    it("非法时间端点 → 该端点不进 where（不炸接口），合法端点保留", async () => {
      const service = makeService([], 0);
      await service.findPage({
        page: 1,
        page_size: 20,
        startDate: "not-a-date",
        endDate: "2026-10-03",
      } as QueryAuditLogDto);

      const where = findManyMock(service).mock.calls[0][0].where;
      const createdAt = where.createdAt as { gte?: Date; lte: Date };
      expect(createdAt.gte).toBeUndefined();
      expect(createdAt.lte).toBeInstanceOf(Date);
    });
  });

  describe("分页与排序", () => {
    it("排序固定 createdAt desc, id desc；skip/take 按页推导", async () => {
      const service = makeService([], 0);
      await service.findPage({ page: 3, page_size: 25 } as QueryAuditLogDto);

      const args = findManyMock(service).mock.calls[0][0];
      expect(args.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
      expect(args.skip).toBe(50);
      expect(args.take).toBe(25);
    });

    it("page_size 超上限 100 由 normalizePageQuery 截断", async () => {
      const service = makeService([], 0);
      // DTO 校验上限 100；service 直调场景（防绕过）由 shared normalize 兜底截断
      await service.findPage({ page: 1, page_size: 500 } as unknown as QueryAuditLogDto);
      expect(findManyMock(service).mock.calls[0][0].take).toBe(100);
    });
  });

  describe("响应结构化（BigInt → string）与 A4 分页信封", () => {
    it("行序列化：id/tenantId/operatorId → string，before/after 原样，其余透传", async () => {
      const service = makeService([sampleRow()], 1);
      const result = await service.findPage(new QueryAuditLogDto());

      const row = result.list[0] as AuditLogItem;
      expect(row.id).toBe("0b6c2f6e-1111-4222-8333-444455556666");
      expect(row.tenantId).toBe("1");
      expect(row.operatorId).toBe("9001");
      expect(row.storeId).toBe("3f2c0000-0000-4000-8000-000000000001");
      expect(row.entityType).toBe("store");
      expect(row.entityId).toBe("42");
      expect(row.action).toBe(1);
      expect(row.before).toBeNull();
      expect(row.after).toEqual({ name: "门店A" });
      expect(row.operatorName).toBe("tenant_admin");
      expect(row.ip).toBe("203.0.113.9");
      expect(row.traceId).toBe("trace-abc");
    });

    it("operatorId 为 null（系统动作）→ 序列化为 null 而非字符串", async () => {
      const service = makeService([sampleRow({ operatorId: null, operatorType: 0 })], 1);
      const result = await service.findPage(new QueryAuditLogDto());
      expect(result.list[0].operatorId).toBeNull();
    });

    it("分页信封：{ list, total, page, page_size }（A4）", async () => {
      const service = makeService([sampleRow(), sampleRow()], 57);
      const result = await service.findPage({ page: 2, page_size: 2 } as QueryAuditLogDto);
      expect(Object.keys(result).sort()).toEqual(["list", "page", "page_size", "total"]);
      expect(result.total).toBe(57);
      expect(result.page).toBe(2);
      expect(result.page_size).toBe(2);
      expect(result.list).toHaveLength(2);
    });
  });
});
