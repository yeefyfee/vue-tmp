import "reflect-metadata";

import type { PrismaService } from "../common/prisma/prisma.service";
import { RequestContext } from "../common/context/request-context";
import { BusinessException } from "../common/exceptions/business.exception";
import type { QueueRegistry } from "../queue/queue-registry";
import { TIMELINE_QUEUE } from "../queue/queue-registry";

import { TimelineWriteService } from "./timeline-write.service";

/**
 * 统一时间线写入 SDK 单测（P0-06-10 · P0-06-07）
 *
 * 覆盖：recordSync（租户解析 / 事件名→事件类型回落 / BigInt 字符串化 / 无上下文
 * fail-closed A0302）/ recordAsync（入队租户队列 + 载荷归一 + 无队列设施降级同步写）。
 */
describe("TimelineWriteService（P0-06-10 统一写入 SDK）", () => {
  const timelineDelegate = { create: jest.fn() };
  const prismaMock = {
    scoped: { timelineEvent: timelineDelegate },
  } as unknown as PrismaService;
  const registryMock = { enqueue: jest.fn() } as unknown as QueueRegistry;

  const PET_ID = "33333333-3333-4333-8333-333333333333";

  function withContext<T>(fn: () => Promise<T>): Promise<T> {
    return RequestContext.run(async () => {
      RequestContext.initUserContext({
        userId: "7",
        deptId: "1",
        deptTreePath: "0/1",
        dataScopes: [],
        roles: ["ROOT"],
        tenantId: "1",
      });
      return await fn();
    });
  }

  function createResolvedRow(overrides: Record<string, unknown> = {}) {
    return {
      id: BigInt("101"),
      tenantId: BigInt("1"),
      petId: PET_ID,
      eventType: 5,
      eventName: "health.record.created",
      content: "c",
      payload: null,
      refType: null,
      refId: null,
      actorType: 1,
      operatorId: BigInt("7"),
      eventTime: new Date("2026-10-07T10:00:00.000Z"),
      visibleToOwner: true,
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("recordSync：按事件名回落事件类型 + BigInt 字符串化 + 租户来自上下文", async () => {
    const service = new TimelineWriteService(prismaMock, registryMock);
    timelineDelegate.create.mockResolvedValueOnce(createResolvedRow());

    const view = await withContext(() =>
      service.recordSync({ petId: PET_ID, eventName: "health.record.created" })
    );

    const data = timelineDelegate.create.mock.calls[0][0].data;
    expect(data.tenantId).toBe(BigInt("1"));
    expect(data.eventType).toBe(5); // health.record.created → MEDICAL
    expect(data.actorType).toBe(1); // STAFF 默认
    expect(data.visibleToOwner).toBe(true);
    expect(data.operatorId).toBe(BigInt("7"));

    expect(view.id).toBe("101"); // BigInt 字符串化
    expect(view.tenantId).toBe("1");
    expect(view.operatorId).toBe("7");
  });

  it("recordSync：显式 eventType / visibleToOwner 覆盖事件名默认", async () => {
    const service = new TimelineWriteService(prismaMock, registryMock);
    timelineDelegate.create.mockResolvedValueOnce(
      createResolvedRow({ eventType: 7, visibleToOwner: false })
    );

    await withContext(() =>
      service.recordSync({
        petId: PET_ID,
        eventName: "health.record.created",
        eventType: 7,
        visibleToOwner: false,
        payload: { k: 1 },
      })
    );

    const data = timelineDelegate.create.mock.calls[0][0].data;
    expect(data.eventType).toBe(7);
    expect(data.visibleToOwner).toBe(false);
    expect(data.payload).toEqual({ k: 1 });
  });

  it("recordSync：未登记事件名回落 SYSTEM + 无租户上下文 fail-closed（A0302）", async () => {
    const service = new TimelineWriteService(prismaMock, registryMock);
    timelineDelegate.create.mockResolvedValueOnce(createResolvedRow({ eventType: 8 }));

    await withContext(() => service.recordSync({ petId: PET_ID, eventName: "nope.unknown" }));
    expect(timelineDelegate.create.mock.calls[0][0].data.eventType).toBe(8); // SYSTEM

    // 无上下文：RequestContext.run 内 tenantId 为 null
    await expect(
      RequestContext.run(() => service.recordSync({ petId: PET_ID, eventName: "pet.created" }))
    ).rejects.toBeInstanceOf(BusinessException);
  });

  it("recordAsync：入队租户队列 + 载荷归一（eventType/operatorId 字符串）", async () => {
    const service = new TimelineWriteService(prismaMock, registryMock);
    (registryMock.enqueue as jest.Mock).mockResolvedValueOnce({ id: "job-1" });

    const result = await withContext(() =>
      service.recordAsync({ petId: PET_ID, eventName: "weight.recorded" })
    );

    expect(result).toEqual({ enqueued: true, tenantId: "1" });
    const [queueName, payload, options] = (registryMock.enqueue as jest.Mock).mock.calls[0];
    expect(queueName).toBe(TIMELINE_QUEUE);
    expect(options).toEqual({ tenantId: "1" });
    expect(payload).toMatchObject({
      tenantId: "1",
      petId: PET_ID,
      eventName: "weight.recorded",
      eventType: 6, // WEIGHT
      actorType: 1,
      operatorId: "7",
      visibleToOwner: true,
    });
    // 未落库（异步通道）
    expect(timelineDelegate.create).not.toHaveBeenCalled();
  });

  it("recordAsync：未注入队列设施 → 降级同步写（enqueued=false，事件不丢）", async () => {
    const service = new TimelineWriteService(prismaMock); // 无 registry
    timelineDelegate.create.mockResolvedValueOnce(createResolvedRow());

    const result = await withContext(() =>
      service.recordAsync({ petId: PET_ID, eventName: "pet.created" })
    );

    expect(result).toEqual({ enqueued: false, tenantId: "1" });
    expect(timelineDelegate.create).toHaveBeenCalledTimes(1);
  });
});
