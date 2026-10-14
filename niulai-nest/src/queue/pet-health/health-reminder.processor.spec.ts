import "reflect-metadata";

import type { Job } from "bullmq";
import {
  processHealthReminderJob,
  type HealthReminderJobData,
  type HealthReminderJobResult,
} from "./health-reminder.processor";
import { RequestContext } from "../../common/context/request-context";

/** 构造最小 job 形状（不真连 Redis） */
function fakeJob(
  data: HealthReminderJobData,
  id = "job-1"
): Pick<Job<HealthReminderJobData>, "data" | "id"> {
  return { data, id };
}

const baseData: HealthReminderJobData = {
  tenantId: "1",
  petId: "pet-1",
  recordId: "rec-1",
  recordType: 1,
  recordName: "疫苗",
  expireDate: "2025-06-01",
  daysLeft: 12,
};

describe("health-reminder.processor（P0-06-03 到期提醒消费）", () => {
  it("消费：恢复 tenantId 上下文并返回结构化提醒结果", async () => {
    const result = await processHealthReminderJob(fakeJob(baseData, "job-9"));

    expect(result.recordId).toBe("rec-1");
    expect(result.tenantId).toBe("1");
    expect(result.recordType).toBe(1);
    expect(result.expireDate).toBe("2025-06-01");
    expect(result.daysLeft).toBe(12);
    expect(result.message).toContain("疫苗");
    expect(result.message).toContain("2025-06-01");
  });

  it("消费：租户上下文不跨任务泄漏（ALS 边界）", async () => {
    const a = await processHealthReminderJob(fakeJob({ ...baseData, tenantId: "900042" }));
    expect(a.tenantId).toBe("900042");
    // run 作用域之外无租户上下文
    expect(RequestContext.getTenantId()).toBeNull();
  });

  it("消费：载荷缺失 recordId → 抛错（进入重试排期）", async () => {
    await expect(processHealthReminderJob(fakeJob({ ...baseData, recordId: "" }))).rejects.toThrow(
      /recordId/
    );
  });

  it("结果结构符合 HealthReminderJobResult 契约", async () => {
    const result: HealthReminderJobResult = await processHealthReminderJob(fakeJob(baseData));
    expect(Object.keys(result).sort()).toEqual(
      ["recordId", "tenantId", "recordType", "expireDate", "daysLeft", "message"].sort()
    );
  });
});
