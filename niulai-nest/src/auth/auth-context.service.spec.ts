import { AuthContextService } from "./auth-context.service";
import { BusinessException } from "../common/exceptions/business.exception";

/**
 * 门店上下文切换校验 单元测试（P0-02-06）
 *
 * 全依赖 mock，不触碰真实数据库：
 *  - 归属校验：prisma.scoped.store（租户扩展注入 tenantId 条件）查不到 → A0212；
 *  - 停用店拒绝：status !== 1 → A0212；
 *  - 合法门店：复用 AuthService 签发并回传 { accessToken, activeStore }；
 *  - 可切换列表：仅启用 + 未软删（where 条件断言）。
 */
describe("AuthContextService - 门店上下文切换校验（P0-02-06）", () => {
  const prisma = {
    scoped: {
      store: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
    },
  };
  const authService = { issueSwitchedAccessToken: jest.fn() };

  let service: AuthContextService;

  /** 模拟 JwtStrategy 标准化后的 request.user（租户账号） */
  const currentUser = {
    userId: "91",
    username: "tenant_admin",
    deptId: "61",
    deptTreePath: "0",
    dataScopes: [],
    roles: ["ROOT"],
    tenantId: "1",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    authService.issueSwitchedAccessToken.mockResolvedValue({ accessToken: "new-token" });
    service = new AuthContextService(prisma as any, authService as any);
  });

  it("归属校验：目标门店查不到（跨租户 / 不存在，scoped 注入租户条件）→ 403 A0212", async () => {
    prisma.scoped.store.findFirst.mockResolvedValue(null);

    await expect(
      service.switchStoreContext(currentUser as any, "00000000-0000-4000-8000-000000000000")
    ).rejects.toMatchObject({ response: { code: "A0212" } } as any);

    // where 条件必须过滤软删（scoped 扩展负责租户条件，应用层负责软删过滤）
    expect(prisma.scoped.store.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
    // 校验失败不触发签发
    expect(authService.issueSwitchedAccessToken).not.toHaveBeenCalled();
  });

  it("停用店拒绝：status=0 → 403 A0212（与不存在同口径，防门店枚举探测）", async () => {
    prisma.scoped.store.findFirst.mockResolvedValue({
      id: "store-uuid-2",
      name: "停用门店",
      status: 0,
    });

    const err = await service
      .switchStoreContext(currentUser as any, "store-uuid-2")
      .catch((e) => e);
    expect(err).toBeInstanceOf(BusinessException);
    expect((err as BusinessException).getResponse()).toMatchObject({ code: "A0212" });
    expect(authService.issueSwitchedAccessToken).not.toHaveBeenCalled();
  });

  it("合法门店：复用 AuthService 签发新 token，回传 { accessToken, activeStore:{id,name} }", async () => {
    prisma.scoped.store.findFirst.mockResolvedValue({
      id: "store-uuid-1",
      name: "E2E 门店A",
      status: 1,
    });

    const result = await service.switchStoreContext(currentUser as any, "store-uuid-1");

    expect(authService.issueSwitchedAccessToken).toHaveBeenCalledTimes(1);
    expect(authService.issueSwitchedAccessToken).toHaveBeenCalledWith(currentUser, "store-uuid-1");
    expect(result).toEqual({
      accessToken: "new-token",
      activeStore: { id: "store-uuid-1", name: "E2E 门店A" },
    });
  });

  it("可切换门店列表：仅启用（status=1）且未软删，返回 id/name/code/status", async () => {
    const rows = [
      { id: "a", name: "门店A", code: "S001", status: 1 },
      { id: "b", name: "门店B", code: "S002", status: 1 },
    ];
    prisma.scoped.store.findMany.mockResolvedValue(rows);

    const list = await service.listSwitchableStores();

    expect(list).toEqual(rows);
    expect(prisma.scoped.store.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deletedAt: null, status: 1 },
        select: { id: true, name: true, code: true, status: true },
      })
    );
  });
});
