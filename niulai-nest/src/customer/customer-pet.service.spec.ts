import "reflect-metadata";

import type { PrismaService } from "../common/prisma/prisma.service";
import { RequestContext } from "../common/context/request-context";
import { BusinessException } from "../common/exceptions/business.exception";

import { CustomerPetService } from "./customer-pet.service";

/**
 * 客户-宠物归属关系服务单测（P0-05-03 · FR-2）
 *
 * 覆盖：列表（join pet 摘要 + 客户缺失 A0510）/ 绑定（成功建关联、首宠置 isPrimary、
 * 幂等返回既有关联、宠物缺失 A0601、宠物属他主 A0514、脏关联冲突 A0514）/
 * 解绑（客户缺失 A0510、关联缺失 A0520、当前归属禁止解绑 A0519、脏关联软删）。
 * PrismaService 全 mock，经 `RequestContext.run` 提供 ALS 上下文（userId=1 / tenantId=1）。
 */
describe("CustomerPetService（P0-05-03 多宠物归属）", () => {
  const customerPetDelegate = {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const customerDelegate = { findFirst: jest.fn() };
  const petDelegate = { findFirst: jest.fn(), findMany: jest.fn() };

  const prismaMock = {
    scoped: {
      customerPet: customerPetDelegate,
      customer: customerDelegate,
      pet: petDelegate,
    },
  } as unknown as PrismaService;
  let service: CustomerPetService;

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

  async function expectBusinessError(promise: Promise<unknown>, code: string) {
    try {
      await promise;
      throw new Error(`应当抛出业务异常 ${code}，但成功返回了`);
    } catch (error) {
      expect(error).toBeInstanceOf(BusinessException);
      expect((error as BusinessException).getResponse()).toMatchObject({ code });
    }
  }

  const CUSTOMER_A = "11111111-1111-4111-8111-111111111111";
  const CUSTOMER_B = "22222222-2222-4222-8222-222222222222";
  const PET_ID = "33333333-3333-4333-8333-333333333333";

  beforeEach(() => {
    jest.resetAllMocks();
    service = new CustomerPetService(prismaMock);
  });

  // ── 列表 ─────────────────────────────────────────────

  it("列表：返回该客户全部 active 关联 + pet 摘要（name/petType/profileCompleteness）", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce({ id: CUSTOMER_A });
    customerPetDelegate.findMany.mockResolvedValueOnce([
      { id: "assoc-1", customerId: CUSTOMER_A, petId: PET_ID, isPrimary: true, petName: "旺财" },
    ]);
    petDelegate.findMany.mockResolvedValueOnce([
      { id: PET_ID, name: "旺财", petType: 1, profileCompleteness: 40 },
    ]);

    const result = await withContext(() => service.listCustomerPets(CUSTOMER_A));

    expect(result).toHaveLength(1);
    expect(result[0].pet).toEqual({
      id: PET_ID,
      name: "旺财",
      petType: 1,
      profileCompleteness: 40,
    });
    const args = customerPetDelegate.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ customerId: CUSTOMER_A, deletedAt: null });
  });

  it("列表：无关联时不查 pet，返回空数组", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce({ id: CUSTOMER_A });
    customerPetDelegate.findMany.mockResolvedValueOnce([]);

    const result = await withContext(() => service.listCustomerPets(CUSTOMER_A));

    expect(result).toEqual([]);
    expect(petDelegate.findMany).not.toHaveBeenCalled();
  });

  it("列表：客户不存在（含已软删）→ A0510", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce(null);

    await expectBusinessError(
      withContext(() => service.listCustomerPets(CUSTOMER_A)),
      "A0510"
    );
  });

  // ── 绑定 ─────────────────────────────────────────────

  it("绑定：宠物现行主人为本客户 → 建关联（首宠 isPrimary=true，快照 petName/petType）", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce({ id: CUSTOMER_A });
    petDelegate.findFirst.mockResolvedValueOnce({
      id: PET_ID,
      ownerCustomerId: CUSTOMER_A,
      name: "旺财",
      petType: 1,
    });
    customerPetDelegate.findFirst.mockResolvedValueOnce(null); // 无既有关联
    customerPetDelegate.findFirst.mockResolvedValueOnce(null); // 无他主脏关联
    customerPetDelegate.count.mockResolvedValueOnce(0);
    const created = { id: "assoc-new", customerId: CUSTOMER_A, petId: PET_ID, isPrimary: true };
    customerPetDelegate.create.mockResolvedValueOnce(created);

    const result = await withContext(() => service.bindPet(CUSTOMER_A, PET_ID));

    expect(result).toBe(created);
    const args = customerPetDelegate.create.mock.calls[0][0];
    expect(args.data).toMatchObject({
      tenantId: BigInt("1"),
      customerId: CUSTOMER_A,
      petId: PET_ID,
      petName: "旺财",
      petType: 1,
      isPrimary: true,
      createdBy: BigInt("1"),
    });
  });

  it("绑定：客户已有其他宠物 → 新关联 isPrimary=false", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce({ id: CUSTOMER_A });
    petDelegate.findFirst.mockResolvedValueOnce({
      id: PET_ID,
      ownerCustomerId: CUSTOMER_A,
      name: "喵",
      petType: 2,
    });
    customerPetDelegate.findFirst.mockResolvedValueOnce(null);
    customerPetDelegate.findFirst.mockResolvedValueOnce(null);
    customerPetDelegate.count.mockResolvedValueOnce(2);
    customerPetDelegate.create.mockResolvedValueOnce({ id: "assoc-new" });

    await withContext(() => service.bindPet(CUSTOMER_A, PET_ID));

    expect(customerPetDelegate.create.mock.calls[0][0].data.isPrimary).toBe(false);
  });

  it("绑定：已绑定同一客户 → 幂等返回既有关联，不再建库", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce({ id: CUSTOMER_A });
    petDelegate.findFirst.mockResolvedValueOnce({
      id: PET_ID,
      ownerCustomerId: CUSTOMER_A,
      name: "旺财",
      petType: 1,
    });
    const existing = { id: "assoc-1", customerId: CUSTOMER_A, petId: PET_ID };
    customerPetDelegate.findFirst.mockResolvedValueOnce(existing);

    const result = await withContext(() => service.bindPet(CUSTOMER_A, PET_ID));

    expect(result).toBe(existing);
    expect(customerPetDelegate.create).not.toHaveBeenCalled();
  });

  it("绑定：宠物不存在（跨租户在 RLS 下同码）→ A0601", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce({ id: CUSTOMER_A });
    petDelegate.findFirst.mockResolvedValueOnce(null);

    await expectBusinessError(
      withContext(() => service.bindPet(CUSTOMER_A, PET_ID)),
      "A0601"
    );
    expect(customerPetDelegate.create).not.toHaveBeenCalled();
  });

  it("绑定：宠物现行主人为他主 → A0514（引导走转移申请）", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce({ id: CUSTOMER_A });
    petDelegate.findFirst.mockResolvedValueOnce({
      id: PET_ID,
      ownerCustomerId: CUSTOMER_B,
      name: "旺财",
      petType: 1,
    });

    await expectBusinessError(
      withContext(() => service.bindPet(CUSTOMER_A, PET_ID)),
      "A0514"
    );
    expect(customerPetDelegate.create).not.toHaveBeenCalled();
  });

  it("绑定：宠物存在他主脏关联（owner 一致但有关联他主）→ A0514", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce({ id: CUSTOMER_A });
    petDelegate.findFirst.mockResolvedValueOnce({
      id: PET_ID,
      ownerCustomerId: CUSTOMER_A,
      name: "旺财",
      petType: 1,
    });
    customerPetDelegate.findFirst.mockResolvedValueOnce(null); // 本客户无关联
    customerPetDelegate.findFirst.mockResolvedValueOnce({ id: "assoc-other" }); // 他主脏关联

    await expectBusinessError(
      withContext(() => service.bindPet(CUSTOMER_A, PET_ID)),
      "A0514"
    );
  });

  // ── 解绑 ─────────────────────────────────────────────

  it("解绑：关联即宠物当前主人 → 禁止（A0519，引导走转移申请）", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce({ id: CUSTOMER_A });
    customerPetDelegate.findFirst.mockResolvedValueOnce({
      id: "assoc-1",
      customerId: CUSTOMER_A,
      petId: PET_ID,
    });
    petDelegate.findFirst.mockResolvedValueOnce({ ownerCustomerId: CUSTOMER_A });

    await expectBusinessError(
      withContext(() => service.unbindPet(CUSTOMER_A, PET_ID)),
      "A0519"
    );
    expect(customerPetDelegate.update).not.toHaveBeenCalled();
  });

  it("解绑：宠物现行主人非本客户（历史脏关联）→ 软删清理，返回 true", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce({ id: CUSTOMER_A });
    customerPetDelegate.findFirst.mockResolvedValueOnce({
      id: "assoc-1",
      customerId: CUSTOMER_A,
      petId: PET_ID,
    });
    petDelegate.findFirst.mockResolvedValueOnce({ ownerCustomerId: CUSTOMER_B });
    customerPetDelegate.update.mockResolvedValueOnce({ id: "assoc-1", deletedAt: new Date() });

    const result = await withContext(() => service.unbindPet(CUSTOMER_A, PET_ID));

    expect(result).toBe(true);
    const args = customerPetDelegate.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: "assoc-1" });
    expect(args.data.deletedAt).toBeTruthy();
  });

  it("解绑：关联不存在 → A0520", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce({ id: CUSTOMER_A });
    customerPetDelegate.findFirst.mockResolvedValueOnce(null);

    await expectBusinessError(
      withContext(() => service.unbindPet(CUSTOMER_A, PET_ID)),
      "A0520"
    );
  });

  it("解绑：客户不存在 → A0510", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce(null);

    await expectBusinessError(
      withContext(() => service.unbindPet(CUSTOMER_A, PET_ID)),
      "A0510"
    );
  });
});
