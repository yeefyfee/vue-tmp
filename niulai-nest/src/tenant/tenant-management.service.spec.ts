import { RequestContext } from "../common/context/request-context";
import { TenantManagementService } from "./tenant-management.service";
import { TENANT_PLAN_PRESETS, TenantCapability, TenantPlan } from "@peluvida/shared";

/**
 * 租户管理服务 单元测试（P0-03-04）
 *
 * 全依赖 mock（PrismaService），重点验证：
 *  - plan → feature_flags 同步（无显式覆盖 = 套餐预设；显式 featureFlags 覆盖预设）；
 *  - 分页筛选 where 构造与排序白名单；
 *  - fail-closed（不存在 / 停用 → A0303；非法能力键 → A0402）。
 */
describe("TenantManagementService", () => {
  let service: TenantManagementService;

  const prisma = {
    tenant: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TenantManagementService(prisma as any);
  });

  describe("updateTenant · plan → feature_flags 同步", () => {
    const existing = { id: 1n };

    it("带 plan 不带 featureFlags → flags 整体覆写为该套餐预设（business 6 键全开）", async () => {
      prisma.tenant.findFirst.mockResolvedValue(existing);
      prisma.tenant.update.mockResolvedValue({
        id: 1n,
        plan: TenantPlan.BUSINESS,
        featureFlags: TENANT_PLAN_PRESETS[TenantPlan.BUSINESS],
        version: 1,
      });

      await service.updateTenant("1", { plan: TenantPlan.BUSINESS });

      const arg = prisma.tenant.update.mock.calls[0][0];
      expect(arg.where).toEqual({ id: 1n });
      expect(arg.data.plan).toBe(TenantPlan.BUSINESS);
      expect(arg.data.featureFlags).toEqual(TENANT_PLAN_PRESETS[TenantPlan.BUSINESS]);
      expect(arg.data.featureFlags[TenantCapability.OPEN_API]).toBe(true);
      expect(arg.data.featureFlags[TenantCapability.MULTI_STORE]).toBe(true);
    });

    it("降级到 starter → flags 清空为预设空对象（防高阶能力残留越权）", async () => {
      prisma.tenant.findFirst.mockResolvedValue(existing);
      prisma.tenant.update.mockResolvedValue({ id: 1n, featureFlags: {}, version: 2 });

      await service.updateTenant("1", { plan: TenantPlan.STARTER });

      expect(prisma.tenant.update.mock.calls[0][0].data.featureFlags).toEqual({});
    });

    it("带 plan 且显式带 featureFlags → 以请求值覆盖预设（平台定制）", async () => {
      prisma.tenant.findFirst.mockResolvedValue(existing);
      prisma.tenant.update.mockResolvedValue({ id: 1n, version: 3 });

      await service.updateTenant("1", {
        plan: TenantPlan.PROFESSIONAL,
        featureFlags: { [TenantCapability.FOSTER]: true },
      });

      expect(prisma.tenant.update.mock.calls[0][0].data.featureFlags).toEqual({
        [TenantCapability.FOSTER]: true,
      });
    });

    it("只带 featureFlags 不带 plan → 精修开关，plan 不动", async () => {
      prisma.tenant.findFirst.mockResolvedValue(existing);
      prisma.tenant.update.mockResolvedValue({ id: 1n, version: 4 });

      await service.updateTenant("1", { featureFlags: { [TenantCapability.MEMBER]: false } });

      const data = prisma.tenant.update.mock.calls[0][0].data;
      expect(data.featureFlags).toEqual({ [TenantCapability.MEMBER]: false });
      expect(data.plan).toBeUndefined();
    });

    it("非法能力键 → 抛 A0402（INVALID_USER_INPUT），不落库", async () => {
      prisma.tenant.findFirst.mockResolvedValue(existing);

      await expect(
        service.updateTenant("1", { featureFlags: { evil_key: true } })
      ).rejects.toMatchObject({ response: { code: "A0402" } });
      expect(prisma.tenant.update).not.toHaveBeenCalled();
    });

    it("非布尔值 → 抛 A0402（fail-closed，与 tenantHasCapability 口径一致）", async () => {
      prisma.tenant.findFirst.mockResolvedValue(existing);

      await expect(
        service.updateTenant("1", { featureFlags: { [TenantCapability.FOSTER]: "yes" } })
      ).rejects.toMatchObject({ response: { code: "A0402" } });
    });

    it("租户不存在 / 已逻辑删除 → 抛 A0303", async () => {
      prisma.tenant.findFirst.mockResolvedValue(null);

      await expect(service.updateTenant("404", { name: "x" })).rejects.toMatchObject({
        response: { code: "A0303" },
      });
    });

    it("非数字主键（uuid 误传）→ 抛 A0402，不透传数据库", async () => {
      await expect(
        service.updateTenant("00000000-0000-0000-0000-000000000000", { name: "x" })
      ).rejects.toMatchObject({ response: { code: "A0402" } });
      expect(prisma.tenant.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("getCurrentTenant · fail-closed 与能力上抛", () => {
    it("在业租户 → 档案 + 逐键布尔能力清单（professional 预设口径）", async () => {
      prisma.tenant.findFirst.mockResolvedValue({
        id: 1n,
        name: "演示租户",
        code: "demo",
        status: 1,
        plan: TenantPlan.PROFESSIONAL,
        featureFlags: TENANT_PLAN_PRESETS[TenantPlan.PROFESSIONAL],
      });

      const result = await service.getCurrentTenant("1");

      expect(result.code).toBe("demo");
      expect(result.capabilities[TenantCapability.FOSTER]).toBe(true);
      expect(result.capabilities[TenantCapability.MEMBER]).toBe(true);
      expect(result.capabilities[TenantCapability.OPEN_API]).toBe(false);
      // 全部 6 个能力键齐全（前端门控渲染逐键取值）
      expect(Object.keys(result.capabilities).sort()).toEqual(
        [...Object.values(TenantCapability)].sort()
      );
    });

    it("租户停用（status=0）→ 抛 A0303（不回抛任何能力）", async () => {
      prisma.tenant.findFirst.mockResolvedValue({ id: 1n, status: 0, featureFlags: {} });

      await expect(service.getCurrentTenant("1")).rejects.toMatchObject({
        response: { code: "A0303" },
      });
    });

    it("租户不存在 → 抛 A0303", async () => {
      prisma.tenant.findFirst.mockResolvedValue(null);

      await expect(service.getCurrentTenant("404")).rejects.toMatchObject({
        response: { code: "A0303" },
      });
    });
  });

  describe("getTenantPage · 分页筛选", () => {
    it("筛选条件 → where 构造（code 前缀 / name 模糊 / status / plan），返回分页载荷", async () => {
      prisma.tenant.findMany.mockResolvedValue([{ id: 1n }]);
      prisma.tenant.count.mockResolvedValue(1);

      const result = await service.getTenantPage({
        pageNum: 2,
        pageSize: 10,
        code: "demo",
        name: "演示",
        status: 1,
        plan: TenantPlan.PROFESSIONAL,
      } as any);

      const arg = prisma.tenant.findMany.mock.calls[0][0];
      expect(arg.where).toEqual({
        deletedAt: null,
        code: { startsWith: "demo" },
        name: { contains: "演示" },
        status: 1,
        plan: TenantPlan.PROFESSIONAL,
      });
      expect(arg.skip).toBe(10); // (2-1)*10
      expect(arg.take).toBe(10);
      expect(arg.orderBy).toEqual({ createdAt: "desc" });
      expect(result).toEqual({ data: [{ id: 1n }], page: { pageNum: 2, pageSize: 10, total: 1 } });
    });

    it("非法 sortBy → 回落 createdAt（防注入白名单）", async () => {
      prisma.tenant.findMany.mockResolvedValue([]);
      prisma.tenant.count.mockResolvedValue(0);

      await service.getTenantPage({ sortBy: "featureFlags; drop table", order: "ASC" } as any);

      expect(prisma.tenant.findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: "asc" });
    });

    it("plan 筛选非法值会在 DTO 层拦截，service 不额外校验；空筛选 → 仅 deletedAt 条件", async () => {
      prisma.tenant.findMany.mockResolvedValue([]);
      prisma.tenant.count.mockResolvedValue(0);

      await service.getTenantPage({} as any);

      expect(prisma.tenant.findMany.mock.calls[0][0].where).toEqual({ deletedAt: null });
    });
  });
});

/** PlatformOnlyGuard 行为在 guards/platform-only.guard.spec.ts 单测覆盖 */
describe("RequestContext 在租户管理链路的契约", () => {
  it("RequestContext.run 隔离上下文：默认 tenantId 为 null（平台账号口径）", () => {
    RequestContext.run(() => {
      expect(RequestContext.getTenantId()).toBeNull();
    });
  });
});
