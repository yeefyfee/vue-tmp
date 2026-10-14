import "reflect-metadata";

import type { PrismaService } from "../common/prisma/prisma.service";
import type { RedisService } from "../common/redis/redis.service";
import type { QueueRegistry } from "../queue/queue-registry";

import { HealthExpiryReminderService, buildHealthReminderKey } from "./health-reminder.service";

/**
 * 到期提醒扫描服务单测（P0-06-03 · FR-2）
 *
 * 覆盖：扫描筛选（recordType in [1,2] + expireDate 区间 + 未软删）进入查询条件 /
 * 幂等键 `SET NX EX`（首次入队、重复跳过）/ 键格式与 TTL / 无命中零计数 /
 * manifest 载荷（tenantId/petId/recordId/recordType/expireDate/daysLeft）。
 * Prisma / Redis / QueueRegistry 全 mock；注入固定 now 保证确定性。
 */
describe("HealthExpiryReminderService（P0-06-03 到期提醒扫描）", () => {
  const healthRecordDelegate = { findMany: jest.fn() };
  const setMock = jest.fn();
  const redisMock = {
    getClient: jest.fn(() => ({ set: setMock })),
  } as unknown as RedisService;
  const registryMock = {
    enqueue: jest.fn(),
  } as unknown as QueueRegistry;
  const prismaMock = {
    healthRecord: healthRecordDelegate,
  } as unknown as PrismaService;

  let service: HealthExpiryReminderService;

  const RECORD_ID = "55555555-5555-4555-8555-555555555555";
  const NOW = new Date("2025-05-20T00:00:00.000Z");

  beforeEach(() => {
    jest.resetAllMocks();
    service = new HealthExpiryReminderService(prismaMock, redisMock, registryMock);
    (redisMock.getClient as jest.Mock).mockReturnValue({ set: setMock });
  });

  it("幂等键格式：pet:health:remind:<tenantId>:<recordId>:<expireDate>", () => {
    expect(buildHealthReminderKey("1", RECORD_ID, "2025-06-01")).toBe(
      `pet:health:remind:1:${RECORD_ID}:2025-06-01`
    );
  });

  it("扫描：命中记录 → SET NX EX 幂等键 + 入队平台队列（含租户快照与剩余天数）", async () => {
    healthRecordDelegate.findMany.mockResolvedValueOnce([
      {
        id: RECORD_ID,
        tenantId: BigInt("1"),
        petId: "pet-1",
        recordType: 1,
        expireDate: new Date("2025-06-01T00:00:00.000Z"),
      },
    ]);
    setMock.mockResolvedValueOnce("OK");

    const result = await service.scanAndEnqueue(NOW);

    // 查询条件：recordType in [1,2] + 未软删 + expireDate 区间
    const where = healthRecordDelegate.findMany.mock.calls[0][0].where;
    expect(where.deletedAt).toBeNull();
    expect(where.recordType).toEqual({ in: [1, 2] });
    expect(where.expireDate.gte).toEqual(new Date("2025-05-20T00:00:00.000Z"));
    expect(where.expireDate.lte).toEqual(new Date("2025-06-19T00:00:00.000Z"));

    // 幂等键：显式完整键 + EX TTL + NX
    expect(setMock).toHaveBeenCalledTimes(1);
    const [key, value, ex, ttl, nx] = setMock.mock.calls[0];
    expect(key).toBe(`pet:health:remind:1:${RECORD_ID}:2025-06-01`);
    expect(value).toBe("1");
    expect(ex).toBe("EX");
    expect(typeof ttl).toBe("number");
    expect(ttl).toBeGreaterThan(0);
    expect(nx).toBe("NX");

    // 入队载荷
    expect(registryMock.enqueue).toHaveBeenCalledTimes(1);
    const [, payload] = (registryMock.enqueue as jest.Mock).mock.calls[0];
    expect(payload).toMatchObject({
      tenantId: "1",
      petId: "pet-1",
      recordId: RECORD_ID,
      recordType: 1,
      recordName: "疫苗",
      expireDate: "2025-06-01",
      daysLeft: 12,
    });

    expect(result).toMatchObject({ scanned: 1, enqueued: 1, skipped: 0, asOf: "2025-05-20" });
  });

  it("扫描：幂等键已存在（SET 返回 null）→ 跳过入队（重复扫描不推送）", async () => {
    healthRecordDelegate.findMany.mockResolvedValueOnce([
      {
        id: RECORD_ID,
        tenantId: BigInt("1"),
        petId: "pet-1",
        recordType: 2,
        expireDate: new Date("2025-06-01T00:00:00.000Z"),
      },
    ]);
    setMock.mockResolvedValueOnce(null); // NX 未写入（键已存在）

    const result = await service.scanAndEnqueue(NOW);

    expect(registryMock.enqueue).not.toHaveBeenCalled();
    expect(result).toMatchObject({ scanned: 1, enqueued: 0, skipped: 1 });
  });

  it("扫描：无命中记录 → 零计数（不写键、不入队）", async () => {
    healthRecordDelegate.findMany.mockResolvedValueOnce([]);

    const result = await service.scanAndEnqueue(NOW);

    expect(setMock).not.toHaveBeenCalled();
    expect(registryMock.enqueue).not.toHaveBeenCalled();
    expect(result).toMatchObject({ scanned: 0, enqueued: 0, skipped: 0 });
  });

  it("扫描：多条记录逐条幂等（仅首次入队）", async () => {
    healthRecordDelegate.findMany.mockResolvedValueOnce([
      {
        id: "r1",
        tenantId: BigInt("1"),
        petId: "p1",
        recordType: 1,
        expireDate: new Date("2025-06-01T00:00:00.000Z"),
      },
      {
        id: "r2",
        tenantId: BigInt("2"),
        petId: "p2",
        recordType: 2,
        expireDate: new Date("2025-06-02T00:00:00.000Z"),
      },
    ]);
    setMock.mockResolvedValueOnce("OK").mockResolvedValueOnce("OK");

    const result = await service.scanAndEnqueue(NOW);

    expect(setMock).toHaveBeenCalledTimes(2);
    expect(registryMock.enqueue).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ scanned: 2, enqueued: 2, skipped: 0 });
  });
});
