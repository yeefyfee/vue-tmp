import type { Prisma } from "@prisma/client";
import { AuditLogService, type AuditEntryInput } from "./audit-log.service";
import { RequestContext } from "../context/request-context";
import type { PrismaService } from "../prisma/prisma.service";
import {
  AUDIT_TENANT_ID_PLATFORM,
  AuditOperatorType,
  AuditEntityType,
  AuditAction,
} from "@peluvida/shared";

/** PrismaService 最小 mock：只暴露 $transaction（record 不传 tx 时的路径） */
function makePrismaMock() {
  return { $transaction: jest.fn() } as unknown as PrismaService;
}

/** TransactionClient 最小 mock：auditLog.create + $executeRaw（GUC 写入） */
function makeTxMock() {
  return {
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $executeRaw: jest.fn().mockResolvedValue(0),
  } as unknown as Prisma.TransactionClient;
}

/** 在 ALS 上下文内执行（tenantId/userId 等锚点按需注入） */
function withContext<T>(
  ctx: {
    tenantId?: string;
    userId?: string;
    username?: string;
    traceId?: string;
    idempotencyKey?: string;
    storeId?: string;
  },
  fn: () => T
): T {
  return RequestContext.run(() => {
    if (ctx.userId) {
      RequestContext.initUserContext({
        userId: ctx.userId,
        deptId: "0",
        deptTreePath: "0",
        dataScopes: [],
        roles: [],
        username: ctx.username,
        tenantId: ctx.tenantId ?? null,
      });
    }
    if (ctx.tenantId) RequestContext.setTenantId(ctx.tenantId);
    if (ctx.traceId) RequestContext.setTraceId(ctx.traceId);
    if (ctx.storeId) RequestContext.setStoreId(ctx.storeId);
    if (ctx.idempotencyKey) RequestContext.setIdempotencyKey(ctx.idempotencyKey);
    return fn();
  });
}

const baseEntry: AuditEntryInput = {
  entityType: AuditEntityType.ROLE,
  entityId: "42",
  action: AuditAction.UPDATE,
};

describe("AuditLogService（P0-02-08 双轨写入）", () => {
  let service: AuditLogService;

  beforeEach(() => {
    service = new AuditLogService(makePrismaMock());
  });

  describe("显式轨（传入 tx，同事务语义）", () => {
    it("传入 tx 时用 tx 写入，不另开事务", async () => {
      const tx = makeTxMock();
      await service.record(baseEntry, tx);
      expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
      expect((service as any).prisma.$transaction).not.toHaveBeenCalled();
    });

    it("审计失败 = 业务失败：tx 写入抛出时 record 原样上抛（随业务事务回滚）", async () => {
      const tx = makeTxMock();
      (tx.auditLog.create as jest.Mock).mockRejectedValue(new Error("P2002 unique"));
      await expect(service.record(baseEntry, tx)).rejects.toThrow("P2002 unique");
    });

    it("显式轨不做 GUC 写入（GUC 由调用方的 withTenantContext 事务负责）", async () => {
      const tx = makeTxMock();
      await service.record(baseEntry, tx);
      expect(tx.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe("自动轨（不传 tx，自管事务）", () => {
    it("自管事务内先 set_config GUC 再 create（RLS WITH CHECK 契约）", async () => {
      const prisma = makePrismaMock();
      const calls: string[] = [];
      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
        const trx = {
          $executeRaw: jest.fn(async () => {
            calls.push("guc");
            return 0;
          }),
          auditLog: {
            create: jest.fn(async () => {
              calls.push("create");
              return {};
            }),
          },
        } as unknown as Prisma.TransactionClient;
        return fn(trx);
      });
      const svc = new AuditLogService(prisma);
      await withContext({ tenantId: "7" }, () => svc.record(baseEntry));
      expect(calls).toEqual(["guc", "create"]);
    });

    it("GUC 写入的租户值与落库 tenantId 一致（自动轨事务级，连接归还自动清空）", async () => {
      const prisma = makePrismaMock();
      let gucValue: unknown;
      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
        const trx = {
          $executeRaw: jest.fn(async (sql: Prisma.Sql) => {
            gucValue = sql.values[0];
            return 0;
          }),
          auditLog: { create: jest.fn().mockResolvedValue({}) },
        } as unknown as Prisma.TransactionClient;
        return fn(trx);
      });
      const svc = new AuditLogService(prisma);
      await withContext({ tenantId: "7" }, () => svc.record(baseEntry));
      expect(gucValue).toBe("7");
    });
  });

  describe("锚点解析（entry > ALS > 哨兵，逐项断言）", () => {
    let tx: Prisma.TransactionClient;
    beforeEach(() => {
      tx = makeTxMock();
    });

    function createdRow(): Record<string, any> {
      return (tx.auditLog.create as jest.Mock).mock.calls[0][0].data;
    }

    it("tenantId：entry 显式传入优先于 ALS（Q6：记被操作数据所属租户）", async () => {
      await withContext({ tenantId: "7" }, () =>
        service.record({ ...baseEntry, tenantId: "9" }, tx)
      );
      expect(createdRow().tenantId).toBe(9n);
    });

    it("tenantId：无 entry 无 ALS → 平台哨兵 0n（平台级对象）", async () => {
      await service.record(baseEntry, tx);
      expect(createdRow().tenantId).toBe(AUDIT_TENANT_ID_PLATFORM);
    });

    it("operatorId：ALS 当前用户注入，operatorType 自动判定为 USER", async () => {
      await withContext({ userId: "9001", username: "admin" }, () => service.record(baseEntry, tx));
      expect(createdRow().operatorId).toBe(9001n);
      expect(createdRow().operatorType).toBe(AuditOperatorType.USER);
      expect(createdRow().operatorName).toBe("admin");
    });

    it("无用户无 entry → operator_id 为 null 且 operatorType=SYSTEM（Q4）", async () => {
      await service.record(baseEntry, tx);
      expect(createdRow().operatorId).toBeNull();
      expect(createdRow().operatorType).toBe(AuditOperatorType.SYSTEM);
    });

    it("entry.operatorType 显式传 SYSTEM 时即使有用户也按 SYSTEM（显式覆盖优先）", async () => {
      await withContext({ userId: "9001" }, () =>
        service.record({ ...baseEntry, operatorType: AuditOperatorType.SYSTEM }, tx)
      );
      expect(createdRow().operatorType).toBe(AuditOperatorType.SYSTEM);
      expect(createdRow().operatorId).toBe(9001n);
    });

    it("traceId / idempotencyKey / storeId 从 ALS 读取", async () => {
      await withContext(
        { traceId: "trace-abc", idempotencyKey: "idem-1", storeId: "3f2c..." },
        () => service.record(baseEntry, tx)
      );
      expect(createdRow().traceId).toBe("trace-abc");
      expect(createdRow().idempotencyKey).toBe("idem-1");
      expect(createdRow().storeId).toBe("3f2c...");
    });

    it("ip：entry 显式传入（拦截器轨从请求提取）", async () => {
      await service.record({ ...baseEntry, ip: "203.0.113.9" }, tx);
      expect(createdRow().ip).toBe("203.0.113.9");
    });
  });

  describe("diff 与脱敏（Q5）", () => {
    let tx: Prisma.TransactionClient;
    beforeEach(() => {
      tx = makeTxMock();
    });

    function createdRow(): Record<string, any> {
      return (tx.auditLog.create as jest.Mock).mock.calls[0][0].data;
    }

    it("update 语义：diff 只含变更字段，未变更键不留痕", async () => {
      await service.record(
        {
          ...baseEntry,
          before: { name: "A", status: 1, remark: "same" },
          after: { name: "B", status: 1, remark: "same" },
        },
        tx
      );
      expect(createdRow().before).toEqual({ name: "A" });
      expect(createdRow().after).toEqual({ name: "B" });
    });

    it("create 语义：before=null，after 保留全量（已脱敏）", async () => {
      await service.record(
        {
          ...baseEntry,
          action: AuditAction.CREATE,
          before: null,
          after: { name: "A", password: "x" },
        },
        tx
      );
      expect(createdRow().before).toBeNull();
      expect(createdRow().after).toEqual({ name: "A", password: "***" });
    });

    it("脱敏：password / secret / token / authorization 四类键名（含变体与嵌套）→ '***'", async () => {
      await service.record(
        {
          ...baseEntry,
          after: {
            password: "p1",
            accessToken: "t1",
            refresh_token: "t2",
            client_secret: "s1",
            authorization: "Bearer x",
            PASSWORD_HASH: "h1",
            nested: { secretKey: "sk", plain: "ok" },
            keepMe: 1,
          },
        },
        tx
      );
      const after = createdRow().after;
      expect(after).toEqual({
        password: "***",
        accessToken: "***",
        refresh_token: "***",
        client_secret: "***",
        authorization: "***",
        PASSWORD_HASH: "***",
        nested: { secretKey: "***", plain: "ok" },
        keepMe: 1,
      });
    });

    it("JSONB 归一化：BigInt → string（金额分）、Date → ISO（jsonb 不可序列化类型）", async () => {
      await service.record(
        {
          ...baseEntry,
          before: { balance: 100n, at: new Date("2026-10-05T00:00:00.000Z") },
          after: { balance: 200n, at: new Date("2026-10-05T00:00:00.000Z") },
        },
        tx
      );
      expect(createdRow().before).toEqual({ balance: "100" });
      expect(createdRow().after).toEqual({ balance: "200" });
    });

    it("before/after 均未传（自动轨形态）→ 两侧 null", async () => {
      await service.record(baseEntry, tx);
      expect(createdRow().before).toBeNull();
      expect(createdRow().after).toBeNull();
    });
  });
});
