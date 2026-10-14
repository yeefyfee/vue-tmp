import "reflect-metadata";

import type { Job } from "bullmq";
import { processDemoJob, type DemoJobData, type DemoJobResult } from "./demo.processor";
import { RequestContext } from "../../common/context/request-context";

/** 构造最小 job 形状（不真连 Redis） */
function fakeJob(data: DemoJobData, id = "job-1"): Pick<Job<DemoJobData>, "data" | "id"> {
  return { data, id };
}

describe("demo.processor（CROSS-11 示例任务）", () => {
  it("echo payload：结果回显入队载荷", async () => {
    const payload = { hello: "world", ts: 12345 };
    const result = await processDemoJob(fakeJob({ payload }));
    expect(result.echoed).toEqual(payload);
  });

  it("租户任务：消费端恢复 RequestContext 租户上下文", async () => {
    const result = await processDemoJob(fakeJob({ payload: "x", tenantId: "900042" }));
    expect(result.tenantId).toBe("900042");
  });

  it("平台级任务：tenantId 为 null（无强制前缀）", async () => {
    const result = await processDemoJob(fakeJob({ payload: "y" }));
    expect(result.tenantId).toBeNull();
  });

  it("租户上下文不跨任务泄漏（ALS 边界）", async () => {
    const a = await processDemoJob(fakeJob({ payload: "a", tenantId: "900042" }));
    const b = await processDemoJob(fakeJob({ payload: "b" }));
    expect(a.tenantId).toBe("900042");
    expect(b.tenantId).toBeNull();
  });

  it("shouldFail 任务抛错（触发 BullMQ fixed-array 重试排期）", async () => {
    await expect(processDemoJob(fakeJob({ payload: "z", shouldFail: true }))).rejects.toThrow(
      /主动失败/
    );
  });

  it("data 缺失防御：按空负载处理不抛错", async () => {
    const result = await processDemoJob(fakeJob(undefined as unknown as DemoJobData));
    expect(result.echoed).toBeUndefined();
    expect(result.tenantId).toBeNull();
  });

  it("处理体内上下文在 run 作用域外不可见（请求间隔离语义）", async () => {
    await processDemoJob(fakeJob({ payload: "a", tenantId: "900042" }));
    // run 之外（worker 顶层）无租户上下文
    expect(RequestContext.getTenantId()).toBeNull();
  });

  it("结果结构符合 DemoJobResult 契约", async () => {
    const result: DemoJobResult = await processDemoJob(
      fakeJob({ payload: { k: 1 }, tenantId: "1" })
    );
    expect(Object.keys(result).sort()).toEqual(["echoed", "tenantId"].sort());
  });
});
