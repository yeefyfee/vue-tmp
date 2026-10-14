/**
 * 队列基础设施 · demo 示例任务（CROSS-11）
 *
 * **消费端租户上下文恢复模式（质量红线示例）**：队列任务的租户归属记录在
 * `job.data.tenantId`（入队时显式携带，见 queue-registry 的租户队列说明）。
 * processor 消费时必须以 `RequestContext.run` 包裹整个处理体并用
 * `RequestContext.setTenantId(data.tenantId)` 恢复上下文——此后处理体内访问
 * 租户数据（Prisma 扩展注入 / RedisService 键前缀）与 HTTP 请求链路行为一致。
 * 与 data-scope.guard 的差异：HTTP 侧租户来自 JWT（不可传参），队列侧租户来自
 * 入队时快照（job.data），两者都以 RequestContext 为唯一消费锚点。
 */
import type { Job } from "bullmq";

import { RequestContext } from "../../common/context/request-context";

/** demo 任务负载 */
export interface DemoJobData {
  /** 原样回显的载荷（验收断言用） */
  payload: unknown;
  /** 租户归属快照（可省略 = 平台级任务） */
  tenantId?: string;
  /** 置 true 时必失败——用于验收重试策略（首次失败 → 进入 delayed 排期重试） */
  shouldFail?: boolean;
}

/** demo 任务结果：echo 载荷 + 消费端恢复出的租户上下文 */
export interface DemoJobResult {
  echoed: unknown;
  /** 消费端 RequestContext 恢复结果（有租户任务时 = data.tenantId） */
  tenantId: string | null;
}

/**
 * demo 处理器（纯函数，Worker 经适配器接入，单测直接调用）：
 * - `shouldFail` 为真时抛错 → BullMQ 按 fixed-array 策略排期重试（5/15/30 分钟）；
 * - 否则回显 payload 并返回消费端租户上下文（验收断言锚点）。
 */
export async function processDemoJob(
  job: Pick<Job<DemoJobData>, "data" | "id">
): Promise<DemoJobResult> {
  const data = job.data ?? ({} as DemoJobData);

  if (data.shouldFail) {
    throw new Error(`[DemoProcessor] 主动失败任务（验证重试策略）jobId=${job.id ?? "?"}`);
  }

  // RequestContext.run：队列 worker 无 HTTP 中间件链，必须自行创建 ALS 上下文
  return RequestContext.run(() => {
    RequestContext.setTenantId(data.tenantId ?? null);
    return {
      echoed: data.payload,
      tenantId: RequestContext.getTenantId(),
    };
  });
}
