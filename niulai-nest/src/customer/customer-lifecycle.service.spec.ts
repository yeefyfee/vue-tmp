import "reflect-metadata";

import type { PrismaService } from "../common/prisma/prisma.service";
import { RequestContext } from "../common/context/request-context";

import { CustomerService } from "./customer.service";
import type { QueryCustomerDto } from "./dto/query-customer.dto";
import type { UpdateCustomerDto } from "./dto/update-customer.dto";

/**
 * 客户来源枚举 + 生命周期分层单测（P0-05-06 · FR-5 / FR-6 增量）
 *
 * 覆盖：GET /customers/source-options 选项表 / 分页 lifecycle 筛选进 where /
 * 更新 lifecycle 写入 data / GET /customers/lifecycle-stats 分层分布聚合与补零。
 * PrismaService 全 mock。
 * （既有 customer.service.spec.ts 保持不动，本文件仅覆盖本轮新增行为。）
 */
describe("CustomerService（P0-05-06 来源 + 生命周期）", () => {
  const customerDelegate = {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
    update: jest.fn(),
  };
  const prismaMock = {
    scoped: { customer: customerDelegate },
  } as unknown as PrismaService;
  let service: CustomerService;

  function withContext<T>(fn: () => Promise<T>): Promise<T> {
    return RequestContext.run(async () => {
      RequestContext.initUserContext({
        userId: "1",
        deptId: "1",
        deptTreePath: "0/1",
        dataScopes: [],
        roles: ["ROOT"],
        tenantId: "1",
      });
      return await fn();
    });
  }

  beforeEach(() => {
    jest.resetAllMocks();
    service = new CustomerService(prismaMock);
  });

  it("来源选项：返回 5 项 {value,label}，覆盖 1/2/3/4/9", async () => {
    const options = service.getSourceOptions();
    expect(options).toHaveLength(5);
    expect(options.map((o) => o.value).sort()).toEqual([1, 2, 3, 4, 9]);
    for (const opt of options) {
      expect(typeof opt.label).toBe("string");
      expect(opt.label.length).toBeGreaterThan(0);
    }
  });

  it("分页：lifecycle 精确筛选进入 where", async () => {
    customerDelegate.findMany.mockResolvedValueOnce([]);
    customerDelegate.count.mockResolvedValueOnce(0);

    await withContext(() => service.getCustomerPage({ lifecycle: 3 } as QueryCustomerDto));

    const args = customerDelegate.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ deletedAt: null, lifecycle: 3 });
  });

  it("更新：lifecycle 写入 data（乐观锁 version 命中）", async () => {
    customerDelegate.update.mockResolvedValueOnce({ id: "uuid-1", lifecycle: 4, version: 1 });

    const result = await withContext(() =>
      service.updateCustomer("uuid-1", { version: 0, lifecycle: 4 } as UpdateCustomerDto)
    );

    expect(result.lifecycle).toBe(4);
    const args = customerDelegate.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: "uuid-1", version: 0, deletedAt: null });
    expect(args.data.lifecycle).toBe(4);
  });

  it("分布：groupBy 按 lifecycle 聚合（未软删口径）+ 4 层补零 + total 为各层之和", async () => {
    // 后端只返回「有数据」的分层（沉睡层缺省）——用于验证补零分支
    customerDelegate.groupBy.mockResolvedValueOnce([
      { lifecycle: 1, _count: { _all: 5 } },
      { lifecycle: 2, _count: { _all: 3 } },
      { lifecycle: 4, _count: { _all: 2 } },
    ]);

    const stats = await withContext(() => service.getLifecycleStats());

    // 聚合参数：按 lifecycle 分组、仅统计未软删（全量租户口径，不叠加列表筛选）
    const args = customerDelegate.groupBy.mock.calls[0][0];
    expect(args.by).toEqual(["lifecycle"]);
    expect(args.where).toEqual({ deletedAt: null });

    // 4 层全量返回且顺序稳定（值域来自 @peluvida/shared CustomerLifecycle）
    expect(stats.items.map((i) => i.lifecycle)).toEqual([1, 2, 3, 4]);
    expect(stats.items.map((i) => i.count)).toEqual([5, 3, 0, 2]);
    expect(stats.total).toBe(10);
  });

  it("分布：空租户 → 4 层全 0、total 为 0（不抛错、不省略分层）", async () => {
    customerDelegate.groupBy.mockResolvedValueOnce([]);

    const stats = await withContext(() => service.getLifecycleStats());

    expect(stats.items).toHaveLength(4);
    expect(stats.items.every((i) => i.count === 0)).toBe(true);
    expect(stats.total).toBe(0);
  });
});
