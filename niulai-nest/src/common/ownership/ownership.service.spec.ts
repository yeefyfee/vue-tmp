import "reflect-metadata";

import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { RequestContext } from "../context/request-context";
import { BusinessException } from "../exceptions/business.exception";
import { PrismaService } from "../prisma/prisma.service";

import { OwnershipService } from "./ownership.service";
import { OwnershipGuard, resolveOwnershipPlan, type OwnershipRequestLike } from "./ownership.guard";
import { OWNERSHIP_METADATA_KEY, RequireOwnership } from "./ownership.decorator";
import { IS_PUBLIC_KEY } from "../decorators/auth.decorator";
import { OwnershipErrorCode } from "./ownership.error-codes";

/**
 * P0-07-03 归属链越权防护基座 单测
 *
 * 覆盖边界（全 mock prisma.scoped，经 RequestContext.run 提供 ALS 上下文）：
 *  - assertTenantScoped：命中 / 不存在（跨租户折叠）/ 非法 id / 未建模实体 / 调用参数；
 *  - resolvePetOwnership：命中 / 不存在 / 非法 id；
 *  - assertCustomerOwnsPet：归属一致 / 不匹配 / pet 缺失 / 存在他主关联（不一致）；
 *  - assertPetAccessibleByCustomer：主人 / 非主人有关联 / 非主人无关联 / pet 缺失；
 *  - resolveOwnershipChain：结构正确 + BigInt 字符串化 / 无关联 / 关联他主 / 客户缺失 / pet 缺失；
 *  - resolveOwnershipPlan（纯函数）：默认解析 / owner 模式 / 用户兜底 / 缺 id / 缺客户；
 *  - OwnershipGuard：无元数据放行 / Public 放行 / 三种模式委派对应断言。
 */

const PET_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const CUSTOMER_ID = "bbbbbbbb-2222-4222-8222-222222222222";
const OTHER_CUSTOMER_ID = "cccccccc-3333-4333-8333-333333333333";

describe("OwnershipService（P0-07-03 归属链越权防护）", () => {
  const petDelegate = { findFirst: jest.fn() };
  const customerDelegate = { findFirst: jest.fn() };
  const customerPetDelegate = { findFirst: jest.fn(), findMany: jest.fn() };

  const prismaMock = {
    scoped: {
      pet: petDelegate,
      customer: customerDelegate,
      customerPet: customerPetDelegate,
    },
  } as unknown as PrismaService;

  let service: OwnershipService;

  /** 在 ALS 上下文中执行（userId=1 / tenantId=1 / storeId=store-1），对齐真实请求链路 */
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
      RequestContext.setStoreId("store-1");
      return await fn();
    });
  }

  /** 构造宠物行（结构兼容 Prisma Pet 子集；tenantId 为 BigInt） */
  function petRow(over: Record<string, unknown> = {}) {
    return {
      id: PET_ID,
      name: "旺财",
      tenantId: 1n,
      storeId: null,
      ownerCustomerId: CUSTOMER_ID,
      ...over,
    };
  }

  /** 断言业务异常信封 code（域错误码） */
  async function expectBusinessError(promise: Promise<unknown>, code: string) {
    try {
      await promise;
      throw new Error(`应当抛出业务异常 ${code}，但成功返回了`);
    } catch (error) {
      expect(error).toBeInstanceOf(BusinessException);
      expect((error as BusinessException).getResponse()).toMatchObject({ code });
    }
  }

  beforeEach(() => {
    jest.resetAllMocks();
    service = new OwnershipService(prismaMock);
  });

  // ─────────────────────────────────────────────
  // assertTenantScoped
  // ─────────────────────────────────────────────
  describe("assertTenantScoped", () => {
    it("同租户命中：返回 ok + 操作者上下文快照（tenantId/userId/storeId）", async () => {
      petDelegate.findFirst.mockResolvedValue({ id: PET_ID });
      await withContext(async () => {
        const result = await service.assertTenantScoped("pet", PET_ID);
        expect(result.ok).toBe(true);
        expect(result.entityType).toBe("pet");
        expect(result.entityId).toBe(PET_ID);
        expect(result.ownerCustomerId).toBeNull();
        expect(result.actor).toEqual({ tenantId: "1", userId: "1", storeId: "store-1" });
      });
    });

    it("跨租户 / 不存在（scoped 返回 null）→ 抛 ENTITY_NOT_FOUND", async () => {
      petDelegate.findFirst.mockResolvedValue(null);
      await withContext(async () => {
        await expectBusinessError(
          service.assertTenantScoped("pet", PET_ID),
          OwnershipErrorCode.ENTITY_NOT_FOUND.code
        );
      });
    });

    it("空 id → 抛 ENTITY_ID_REQUIRED（且不触达数据库）", async () => {
      await withContext(async () => {
        await expectBusinessError(
          service.assertTenantScoped("pet", ""),
          OwnershipErrorCode.ENTITY_ID_REQUIRED.code
        );
      });
      expect(petDelegate.findFirst).not.toHaveBeenCalled();
    });

    it("未建模实体（order 尚未落地）→ 抛 ENTITY_TYPE_UNSUPPORTED", async () => {
      await withContext(async () => {
        await expectBusinessError(
          service.assertTenantScoped("order", "x"),
          OwnershipErrorCode.ENTITY_TYPE_UNSUPPORTED.code
        );
      });
    });

    it("未知实体类型（nonsense）→ 抛 ENTITY_TYPE_UNSUPPORTED", async () => {
      await withContext(async () => {
        await expectBusinessError(
          service.assertTenantScoped("nonsense", "x"),
          OwnershipErrorCode.ENTITY_TYPE_UNSUPPORTED.code
        );
      });
    });

    it("查询条件携带 deletedAt:null（软删不可见）与 select id", async () => {
      petDelegate.findFirst.mockResolvedValue({ id: PET_ID });
      await withContext(async () => {
        await service.assertTenantScoped("pet", PET_ID);
      });
      expect(petDelegate.findFirst).toHaveBeenCalledWith({
        where: { id: PET_ID, deletedAt: null },
        select: { id: true },
      });
    });
  });

  // ─────────────────────────────────────────────
  // resolvePetOwnership
  // ─────────────────────────────────────────────
  describe("resolvePetOwnership", () => {
    it("命中：返回 { pet, ownerCustomerId }", async () => {
      petDelegate.findFirst.mockResolvedValue(petRow());
      await withContext(async () => {
        const resolved = await service.resolvePetOwnership(PET_ID);
        expect(resolved.ownerCustomerId).toBe(CUSTOMER_ID);
        expect(resolved.pet.id).toBe(PET_ID);
      });
    });

    it("不存在 / 跨租户 → 抛 PET_NOT_FOUND", async () => {
      petDelegate.findFirst.mockResolvedValue(null);
      await withContext(async () => {
        await expectBusinessError(
          service.resolvePetOwnership(PET_ID),
          OwnershipErrorCode.PET_NOT_FOUND.code
        );
      });
    });

    it("空 id → 抛 ENTITY_ID_REQUIRED", async () => {
      await withContext(async () => {
        await expectBusinessError(
          service.resolvePetOwnership("   "),
          OwnershipErrorCode.ENTITY_ID_REQUIRED.code
        );
      });
    });
  });

  // ─────────────────────────────────────────────
  // assertCustomerOwnsPet
  // ─────────────────────────────────────────────
  describe("assertCustomerOwnsPet", () => {
    it("归属一致且无冲突关联 → ok，ownerCustomerId 回填", async () => {
      petDelegate.findFirst.mockResolvedValue(petRow());
      customerPetDelegate.findFirst.mockResolvedValue(null);
      await withContext(async () => {
        const result = await service.assertCustomerOwnsPet(CUSTOMER_ID, PET_ID);
        expect(result.ok).toBe(true);
        expect(result.ownerCustomerId).toBe(CUSTOMER_ID);
      });
      expect(customerPetDelegate.findFirst).toHaveBeenCalledWith({
        where: { petId: PET_ID, deletedAt: null, customerId: { not: CUSTOMER_ID } },
        select: { id: true },
      });
    });

    it("归属不匹配（客户非主人）→ 抛 CUSTOMER_PET_MISMATCH", async () => {
      petDelegate.findFirst.mockResolvedValue(petRow({ ownerCustomerId: OTHER_CUSTOMER_ID }));
      await withContext(async () => {
        await expectBusinessError(
          service.assertCustomerOwnsPet(CUSTOMER_ID, PET_ID),
          OwnershipErrorCode.CUSTOMER_PET_MISMATCH.code
        );
      });
      // 归属不符应短路，不再查关联
      expect(customerPetDelegate.findFirst).not.toHaveBeenCalled();
    });

    it("pet 不存在 → 抛 PET_NOT_FOUND", async () => {
      petDelegate.findFirst.mockResolvedValue(null);
      await withContext(async () => {
        await expectBusinessError(
          service.assertCustomerOwnsPet(CUSTOMER_ID, PET_ID),
          OwnershipErrorCode.PET_NOT_FOUND.code
        );
      });
    });

    it("归属一致但存在他主 active 关联 → 抛 CUSTOMER_PET_INCONSISTENT", async () => {
      petDelegate.findFirst.mockResolvedValue(petRow());
      customerPetDelegate.findFirst.mockResolvedValue({ id: "link-conflict" });
      await withContext(async () => {
        await expectBusinessError(
          service.assertCustomerOwnsPet(CUSTOMER_ID, PET_ID),
          OwnershipErrorCode.CUSTOMER_PET_INCONSISTENT.code
        );
      });
    });
  });

  // ─────────────────────────────────────────────
  // assertPetAccessibleByCustomer
  // ─────────────────────────────────────────────
  describe("assertPetAccessibleByCustomer", () => {
    it("客户是主人 → ok", async () => {
      petDelegate.findFirst.mockResolvedValue(petRow());
      await withContext(async () => {
        const result = await service.assertPetAccessibleByCustomer(CUSTOMER_ID, PET_ID);
        expect(result.ok).toBe(true);
      });
      // 主人命中应短路，不再查关联
      expect(customerPetDelegate.findFirst).not.toHaveBeenCalled();
    });

    it("非主人但存在 (customerId, petId) active 关联 → ok（可达）", async () => {
      petDelegate.findFirst.mockResolvedValue(petRow({ ownerCustomerId: OTHER_CUSTOMER_ID }));
      customerPetDelegate.findFirst.mockResolvedValue({ id: "link-1" });
      await withContext(async () => {
        const result = await service.assertPetAccessibleByCustomer(CUSTOMER_ID, PET_ID);
        expect(result.ok).toBe(true);
        expect(result.ownerCustomerId).toBe(OTHER_CUSTOMER_ID);
      });
    });

    it("非主人且无关联 → 抛 CUSTOMER_PET_MISMATCH", async () => {
      petDelegate.findFirst.mockResolvedValue(petRow({ ownerCustomerId: OTHER_CUSTOMER_ID }));
      customerPetDelegate.findFirst.mockResolvedValue(null);
      await withContext(async () => {
        await expectBusinessError(
          service.assertPetAccessibleByCustomer(CUSTOMER_ID, PET_ID),
          OwnershipErrorCode.CUSTOMER_PET_MISMATCH.code
        );
      });
    });

    it("pet 不存在 → 抛 PET_NOT_FOUND", async () => {
      petDelegate.findFirst.mockResolvedValue(null);
      await withContext(async () => {
        await expectBusinessError(
          service.assertPetAccessibleByCustomer(CUSTOMER_ID, PET_ID),
          OwnershipErrorCode.PET_NOT_FOUND.code
        );
      });
    });
  });

  // ─────────────────────────────────────────────
  // resolveOwnershipChain
  // ─────────────────────────────────────────────
  describe("resolveOwnershipChain", () => {
    it("结构正确：pet/customer 的 tenantId 字符串化，link 一致", async () => {
      petDelegate.findFirst.mockResolvedValue(petRow({ tenantId: 7n, storeId: "store-9" }));
      customerDelegate.findFirst.mockResolvedValue({
        id: CUSTOMER_ID,
        name: "张三",
        mobile: "13800138000",
        tenantId: 7n,
      });
      customerPetDelegate.findMany.mockResolvedValue([{ customerId: CUSTOMER_ID }]);

      await withContext(async () => {
        const chain = await service.resolveOwnershipChain(PET_ID);
        expect(chain.pet).toEqual({
          id: PET_ID,
          name: "旺财",
          tenantId: "7",
          storeId: "store-9",
          ownerCustomerId: CUSTOMER_ID,
        });
        expect(chain.customer).toEqual({
          id: CUSTOMER_ID,
          name: "张三",
          mobile: "13800138000",
          tenantId: "7",
        });
        expect(chain.link).toEqual({ exists: true, consistent: true });
        expect(typeof chain.pet.tenantId).toBe("string");
        expect(typeof chain.customer?.tenantId).toBe("string");
      });
    });

    it("无 active 关联 → link { exists:false, consistent:false }", async () => {
      petDelegate.findFirst.mockResolvedValue(petRow());
      customerDelegate.findFirst.mockResolvedValue({
        id: CUSTOMER_ID,
        name: "张三",
        mobile: "13800138000",
        tenantId: 1n,
      });
      customerPetDelegate.findMany.mockResolvedValue([]);
      await withContext(async () => {
        const chain = await service.resolveOwnershipChain(PET_ID);
        expect(chain.link).toEqual({ exists: false, consistent: false });
      });
    });

    it("关联指向他主 → link.consistent=false（链不一致但不抛错）", async () => {
      petDelegate.findFirst.mockResolvedValue(petRow());
      customerDelegate.findFirst.mockResolvedValue({
        id: CUSTOMER_ID,
        name: "张三",
        mobile: "13800138000",
        tenantId: 1n,
      });
      customerPetDelegate.findMany.mockResolvedValue([{ customerId: OTHER_CUSTOMER_ID }]);
      await withContext(async () => {
        const chain = await service.resolveOwnershipChain(PET_ID);
        expect(chain.link).toEqual({ exists: true, consistent: false });
      });
    });

    it("主人客户缺失（脏数据）→ customer 为 null，快照仍返回", async () => {
      petDelegate.findFirst.mockResolvedValue(petRow());
      customerDelegate.findFirst.mockResolvedValue(null);
      customerPetDelegate.findMany.mockResolvedValue([]);
      await withContext(async () => {
        const chain = await service.resolveOwnershipChain(PET_ID);
        expect(chain.customer).toBeNull();
        expect(chain.pet.ownerCustomerId).toBe(CUSTOMER_ID);
      });
    });

    it("pet 不存在 → 抛 PET_NOT_FOUND", async () => {
      petDelegate.findFirst.mockResolvedValue(null);
      await withContext(async () => {
        await expectBusinessError(
          service.resolveOwnershipChain(PET_ID),
          OwnershipErrorCode.PET_NOT_FOUND.code
        );
      });
    });
  });
});

describe("resolveOwnershipPlan（@RequireOwnership 元数据解析，纯函数）", () => {
  it("默认：params.id 作为 entityId，mode=tenant", () => {
    const plan = resolveOwnershipPlan({ entity: "pet" }, { params: { id: PET_ID } });
    expect(plan).toEqual({ entity: "pet", entityId: PET_ID, mode: "tenant", customerId: "" });
  });

  it("owner 模式：customerIdParam 指定的路由参数被读取", () => {
    const plan = resolveOwnershipPlan(
      { entity: "pet", idParam: "id", mode: "owner", customerIdParam: "customerId" },
      { params: { id: PET_ID, customerId: CUSTOMER_ID } }
    );
    expect(plan.mode).toBe("owner");
    expect(plan.customerId).toBe(CUSTOMER_ID);
  });

  it("owner 模式：参数缺客户时回退 request.user.customerId", () => {
    const request: OwnershipRequestLike = {
      params: { id: PET_ID },
      user: { customerId: CUSTOMER_ID },
    };
    const plan = resolveOwnershipPlan({ entity: "pet", mode: "owner" }, request);
    expect(plan.customerId).toBe(CUSTOMER_ID);
  });

  it("缺 entityId → 抛 ENTITY_ID_REQUIRED", () => {
    expect(() => resolveOwnershipPlan({ entity: "pet" }, { params: {} })).toThrow(
      BusinessException
    );
    try {
      resolveOwnershipPlan({ entity: "pet" }, { params: {} });
    } catch (error) {
      expect((error as BusinessException).getResponse()).toMatchObject({
        code: OwnershipErrorCode.ENTITY_ID_REQUIRED.code,
      });
    }
  });

  it("owner 模式缺客户上下文 → 抛 ACTOR_CUSTOMER_REQUIRED", () => {
    try {
      resolveOwnershipPlan({ entity: "pet", mode: "owner" }, { params: { id: PET_ID } });
      throw new Error("应当抛出 ACTOR_CUSTOMER_REQUIRED");
    } catch (error) {
      expect((error as BusinessException).getResponse()).toMatchObject({
        code: OwnershipErrorCode.ACTOR_CUSTOMER_REQUIRED.code,
      });
    }
  });

  it("paramSource=body：从请求体取 id", () => {
    const plan = resolveOwnershipPlan(
      { entity: "customer", idParam: "customerId", paramSource: "body" },
      { params: { id: "ignored" }, body: { customerId: CUSTOMER_ID } }
    );
    expect(plan.entityId).toBe(CUSTOMER_ID);
  });
});

describe("OwnershipGuard（声明式归属校验）", () => {
  const ownershipMock = {
    assertTenantScoped: jest.fn().mockResolvedValue({ ok: true }),
    assertCustomerOwnsPet: jest.fn().mockResolvedValue({ ok: true }),
    assertPetAccessibleByCustomer: jest.fn().mockResolvedValue({ ok: true }),
  } as unknown as OwnershipService;

  /** 构造 Reflector 桩：按 key 返回 Public / 归属元数据 */
  function makeReflector(opts: { isPublic?: boolean; metadata?: unknown }): Reflector {
    return {
      getAllAndOverride: jest.fn((key: string) => {
        if (key === IS_PUBLIC_KEY) return opts.isPublic ?? false;
        if (key === OWNERSHIP_METADATA_KEY) return opts.metadata;
        return undefined;
      }),
    } as unknown as Reflector;
  }

  function makeContext(request: OwnershipRequestLike): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => () => undefined,
      getClass: () => Object,
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("未声明 @RequireOwnership → 放行且不调用任何断言", async () => {
    const guard = new OwnershipGuard(makeReflector({ metadata: undefined }), ownershipMock);
    await expect(guard.canActivate(makeContext({ params: { id: PET_ID } }))).resolves.toBe(true);
    expect(ownershipMock.assertTenantScoped).not.toHaveBeenCalled();
  });

  it("@Public 接口 → 直接放行（即使声明了归属要求）", async () => {
    const guard = new OwnershipGuard(
      makeReflector({ isPublic: true, metadata: { entity: "pet" } }),
      ownershipMock
    );
    await expect(guard.canActivate(makeContext({ params: { id: PET_ID } }))).resolves.toBe(true);
    expect(ownershipMock.assertTenantScoped).not.toHaveBeenCalled();
  });

  it("tenant 模式 → 委派 assertTenantScoped(entity, entityId)", async () => {
    const guard = new OwnershipGuard(
      makeReflector({ metadata: { entity: "pet", idParam: "id" } }),
      ownershipMock
    );
    await expect(guard.canActivate(makeContext({ params: { id: PET_ID } }))).resolves.toBe(true);
    expect(ownershipMock.assertTenantScoped).toHaveBeenCalledWith("pet", PET_ID);
  });

  it("owner 模式 → 委派 assertCustomerOwnsPet(customerId, entityId)", async () => {
    const guard = new OwnershipGuard(
      makeReflector({
        metadata: { entity: "pet", idParam: "id", mode: "owner", customerIdParam: "customerId" },
      }),
      ownershipMock
    );
    await guard.canActivate(makeContext({ params: { id: PET_ID, customerId: CUSTOMER_ID } }));
    expect(ownershipMock.assertCustomerOwnsPet).toHaveBeenCalledWith(CUSTOMER_ID, PET_ID);
  });

  it("reachable 模式 → 委派 assertPetAccessibleByCustomer(customerId, entityId)", async () => {
    const guard = new OwnershipGuard(
      makeReflector({
        metadata: {
          entity: "pet",
          idParam: "id",
          mode: "reachable",
          customerIdParam: "customerId",
        },
      }),
      ownershipMock
    );
    await guard.canActivate(makeContext({ params: { id: PET_ID, customerId: CUSTOMER_ID } }));
    expect(ownershipMock.assertPetAccessibleByCustomer).toHaveBeenCalledWith(CUSTOMER_ID, PET_ID);
  });

  it("RequireOwnership 写入可被 Reflector 读取的元数据（装饰器冒烟）", () => {
    class DemoController {
      @RequireOwnership({ entity: "pet", idParam: "id", mode: "owner" })
      handler() {
        return undefined;
      }
    }
    const meta = Reflect.getMetadata(OWNERSHIP_METADATA_KEY, DemoController.prototype.handler);
    expect(meta).toMatchObject({ entity: "pet", idParam: "id", mode: "owner" });
  });
});
