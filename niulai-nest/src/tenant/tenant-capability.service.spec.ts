import { BusinessException } from "../common/exceptions/business.exception";

import { TenantCapabilityService } from "./tenant-capability.service";
import { TenantCapability } from "@peluvida/shared";

/**
 * 租户能力服务 单元测试（P0-03-01，Q10）
 *
 * 全依赖 mock（PrismaService），验证 fail-closed 口径：
 * 租户不存在 / 停用 / flags 异常一律视为不具备能力。
 */
describe("TenantCapabilityService", () => {
  let service: TenantCapabilityService;

  const prisma = {
    tenant: {
      findFirst: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TenantCapabilityService(prisma as any);
  });

  it("findActiveById：where 收敛到 status=1 + deletedAt=null，id 转 BigInt", async () => {
    prisma.tenant.findFirst.mockResolvedValue({ id: 1n, featureFlags: {} });

    await service.findActiveById("123");

    const arg = prisma.tenant.findFirst.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 123n, status: 1, deletedAt: null });
    expect(typeof arg.where.id).toBe("bigint");
  });

  it("hasCapability：flags 含该能力（布尔 true）→ true", async () => {
    prisma.tenant.findFirst.mockResolvedValue({
      id: 1n,
      featureFlags: { [TenantCapability.FOSTER]: true },
    });

    await expect(service.hasCapability(1n, TenantCapability.FOSTER)).resolves.toBe(true);
  });

  it("hasCapability：flags 缺键 / 值非 true → false", async () => {
    prisma.tenant.findFirst.mockResolvedValue({
      id: 1n,
      featureFlags: { [TenantCapability.FOSTER]: false, [TenantCapability.MEMBER]: "yes" },
    });

    await expect(service.hasCapability(1n, TenantCapability.FOSTER)).resolves.toBe(false);
    await expect(service.hasCapability(1n, TenantCapability.MEMBER)).resolves.toBe(false);
    await expect(service.hasCapability(1n, TenantCapability.OPEN_API)).resolves.toBe(false);
  });

  it("hasCapability：租户不存在 / 停用（查询返回 null）→ false 不抛错", async () => {
    prisma.tenant.findFirst.mockResolvedValue(null);

    await expect(service.hasCapability(404n, TenantCapability.FOSTER)).resolves.toBe(false);
  });

  it("hasCapability：查询异常（如非法 tenantId）→ fail-closed 返回 false", async () => {
    prisma.tenant.findFirst.mockRejectedValue(new Error("db down"));

    await expect(service.hasCapability(1n, TenantCapability.FOSTER)).resolves.toBe(false);
  });

  it("requireCapability：具备 → 通过；不具备 → 抛 A0304", async () => {
    prisma.tenant.findFirst.mockResolvedValue({
      id: 1n,
      featureFlags: { [TenantCapability.MULTI_STORE]: true },
    });

    await expect(
      service.requireCapability(1n, TenantCapability.MULTI_STORE)
    ).resolves.toBeUndefined();

    await expect(service.requireCapability(1n, TenantCapability.OPEN_API)).rejects.toMatchObject({
      response: { code: "A0304" },
    });
  });
});
