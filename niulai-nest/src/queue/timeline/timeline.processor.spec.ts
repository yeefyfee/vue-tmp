import "reflect-metadata";

import type { PrismaService } from "../../common/prisma/prisma.service";

import { processTimelineWriteJob } from "./timeline.processor";
import type { TimelineWriteJobData } from "./timeline.constants";

/**
 * 时间线异步写入消费器单测（P0-06-07）
 *
 * 覆盖：加载 job.data → RequestContext.run 恢复租户 → 统一 SDK 落库（事件类型按
 * 事件名回落）/ 载荷缺失守卫。
 */
describe("processTimelineWriteJob（P0-06-07 时间线异步写入消费器）", () => {
  const timelineDelegate = { create: jest.fn() };
  const prismaMock = {
    scoped: { timelineEvent: timelineDelegate },
  } as unknown as PrismaService;

  const PET_ID = "33333333-3333-4333-8333-333333333333";

  function jobOf(data: TimelineWriteJobData) {
    return { id: "job-1", data };
  }

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("恢复租户上下文并落库：事件类型按事件名回落（pet.created → 1）", async () => {
    timelineDelegate.create.mockResolvedValueOnce({
      id: BigInt("999"),
      tenantId: BigInt("1"),
      petId: PET_ID,
      eventType: 1,
      eventName: "pet.created",
      content: null,
      payload: null,
      refType: null,
      refId: null,
      actorType: 1,
      operatorId: null,
      eventTime: new Date("2026-10-07T10:00:00.000Z"),
      visibleToOwner: true,
    });

    const result = await processTimelineWriteJob(
      jobOf({ tenantId: "1", petId: PET_ID, eventName: "pet.created" }),
      prismaMock
    );

    const data = timelineDelegate.create.mock.calls[0][0].data;
    expect(data.tenantId).toBe(BigInt("1"));
    expect(data.petId).toBe(PET_ID);
    expect(data.eventType).toBe(1);
    expect(data.eventName).toBe("pet.created");

    expect(result).toEqual({ eventId: "999", tenantId: "1", eventName: "pet.created" });
  });

  it("未登记事件名回落 SYSTEM（8）", async () => {
    timelineDelegate.create.mockResolvedValueOnce({
      id: BigInt("1000"),
      tenantId: BigInt("2"),
      petId: PET_ID,
      eventType: 8,
      eventName: "nope.unknown",
      content: null,
      payload: null,
      refType: null,
      refId: null,
      actorType: 2,
      operatorId: null,
      eventTime: new Date("2026-10-07T10:00:00.000Z"),
      visibleToOwner: true,
    });

    await processTimelineWriteJob(
      jobOf({ tenantId: "2", petId: PET_ID, eventName: "nope.unknown" }),
      prismaMock
    );
    expect(timelineDelegate.create.mock.calls[0][0].data.eventType).toBe(8);
  });

  it("载荷缺失 petId → 抛错（不入库）", async () => {
    await expect(
      processTimelineWriteJob(
        jobOf({ tenantId: "1", petId: "", eventName: "pet.created" }),
        prismaMock
      )
    ).rejects.toThrow(/载荷缺失/);
    expect(timelineDelegate.create).not.toHaveBeenCalled();
  });
});
