import "reflect-metadata";

import type { PrismaService } from "../common/prisma/prisma.service";
import { RequestContext } from "../common/context/request-context";
import { BusinessException } from "../common/exceptions/business.exception";

import { PetTransferService, PetTransferStatus } from "./pet-transfer.service";
import type { CreateTransferDto } from "./dto/create-transfer.dto";
import type { QueryTransferDto } from "./dto/query-transfer.dto";

/**
 * 宠物转移申请服务单测（P0-05-03 · FR-2）
 *
 * 覆盖：发起（成功落待审批且**不改归属**、宠物缺失 A0601、转给自己 A0518、
 * 目标客户无效 A0517、在途申请 A0515、并发 P2002→A0515、无租户上下文 A0302）/
 * 审批（事务内改归属 + 关联迁移、申请缺失 A0513、非待审批 A0516、归属快照不符 A0516、
 * 并发双批 P2025→A0516）/ 拒绝（1→3、非待审批 A0516）/ 撤销（1→4、非待审批 A0516、
 * 非申请人非 ROOT → A0300）/ 分页（status/petId 筛选 + 结构）。
 * PrismaService 全 mock，$transaction 以 scoped 自身作为 tx 客户端。
 */
describe("PetTransferService（P0-05-03 宠物转移申请）", () => {
  const transferDelegate = {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const petDelegate = { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() };
  const customerDelegate = { findFirst: jest.fn(), findMany: jest.fn() };
  const customerPetDelegate = {
    findFirst: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
  };

  const scopedMock = {
    petTransferRequest: transferDelegate,
    pet: petDelegate,
    customer: customerDelegate,
    customerPet: customerPetDelegate,
    $transaction: jest.fn(),
  };
  const prismaMock = { scoped: scopedMock } as unknown as PrismaService;
  let service: PetTransferService;

  function withContext<T>(
    fn: () => Promise<T>,
    roles: string[] = ["ROOT"],
    userId = "1"
  ): Promise<T> {
    return RequestContext.run(async () => {
      RequestContext.initUserContext({
        userId,
        deptId: "1",
        deptTreePath: "0/1",
        dataScopes: [],
        roles,
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
  const REQ_ID = "44444444-4444-4444-8444-444444444444";

  beforeEach(() => {
    jest.resetAllMocks();
    // $transaction 直接以 scoped 自身作为事务客户端执行回调（对齐扩展客户端语义）
    scopedMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(scopedMock)
    );
    service = new PetTransferService(prismaMock);
  });

  // ── 发起 ─────────────────────────────────────────────

  it("发起：生成待审批（status=1，fromCustomerId 快照），声明不改动归属", async () => {
    petDelegate.findFirst.mockResolvedValueOnce({ id: PET_ID, ownerCustomerId: CUSTOMER_A });
    customerDelegate.findFirst.mockResolvedValueOnce({ id: CUSTOMER_B });
    transferDelegate.findFirst.mockResolvedValueOnce(null); // 无在途申请
    const created = { id: REQ_ID, petId: PET_ID, fromCustomerId: CUSTOMER_A, status: 1 };
    transferDelegate.create.mockResolvedValueOnce(created);

    const result = await withContext(() =>
      service.createTransfer(PET_ID, {
        toCustomerId: CUSTOMER_B,
        reason: "搬家",
      } as CreateTransferDto)
    );

    expect(result).toBe(created);
    const args = transferDelegate.create.mock.calls[0][0];
    expect(args.data).toMatchObject({
      tenantId: BigInt("1"),
      petId: PET_ID,
      fromCustomerId: CUSTOMER_A,
      toCustomerId: CUSTOMER_B,
      status: PetTransferStatus.PENDING,
      reason: "搬家",
      appliedBy: BigInt("1"),
    });
    // 未审批：不得改动宠物归属
    expect(petDelegate.update).not.toHaveBeenCalled();
  });

  it("发起：宠物不存在 → A0601", async () => {
    petDelegate.findFirst.mockResolvedValueOnce(null);

    await expectBusinessError(
      withContext(() =>
        service.createTransfer(PET_ID, { toCustomerId: CUSTOMER_B } as CreateTransferDto)
      ),
      "A0601"
    );
    expect(transferDelegate.create).not.toHaveBeenCalled();
  });

  it("发起：转移给当前主人自己 → A0518", async () => {
    petDelegate.findFirst.mockResolvedValueOnce({ id: PET_ID, ownerCustomerId: CUSTOMER_A });

    await expectBusinessError(
      withContext(() =>
        service.createTransfer(PET_ID, { toCustomerId: CUSTOMER_A } as CreateTransferDto)
      ),
      "A0518"
    );
  });

  it("发起：目标客户不存在 / 跨租户 → A0517", async () => {
    petDelegate.findFirst.mockResolvedValueOnce({ id: PET_ID, ownerCustomerId: CUSTOMER_A });
    customerDelegate.findFirst.mockResolvedValueOnce(null);

    await expectBusinessError(
      withContext(() =>
        service.createTransfer(PET_ID, { toCustomerId: CUSTOMER_B } as CreateTransferDto)
      ),
      "A0517"
    );
  });

  it("发起：该宠物已有在途申请（应用层查重）→ A0515", async () => {
    petDelegate.findFirst.mockResolvedValueOnce({ id: PET_ID, ownerCustomerId: CUSTOMER_A });
    customerDelegate.findFirst.mockResolvedValueOnce({ id: CUSTOMER_B });
    transferDelegate.findFirst.mockResolvedValueOnce({ id: "req-existing" });

    await expectBusinessError(
      withContext(() =>
        service.createTransfer(PET_ID, { toCustomerId: CUSTOMER_B } as CreateTransferDto)
      ),
      "A0515"
    );
    expect(transferDelegate.create).not.toHaveBeenCalled();
  });

  it("发起：并发撞部分唯一索引（P2002）→ 兜底转 A0515", async () => {
    petDelegate.findFirst.mockResolvedValueOnce({ id: PET_ID, ownerCustomerId: CUSTOMER_A });
    customerDelegate.findFirst.mockResolvedValueOnce({ id: CUSTOMER_B });
    transferDelegate.findFirst.mockResolvedValueOnce(null);
    transferDelegate.create.mockRejectedValueOnce({ code: "P2002" });

    await expectBusinessError(
      withContext(() =>
        service.createTransfer(PET_ID, { toCustomerId: CUSTOMER_B } as CreateTransferDto)
      ),
      "A0515"
    );
  });

  it("发起：无租户上下文 → fail-closed A0302", async () => {
    await expectBusinessError(
      service.createTransfer(PET_ID, { toCustomerId: CUSTOMER_B } as CreateTransferDto),
      "A0302"
    );
    expect(transferDelegate.create).not.toHaveBeenCalled();
  });

  // ── 审批 ─────────────────────────────────────────────

  it("审批通过：事务内推进 1→2 + 改 pet.ownerCustomerId + 关联迁移（旧软删 + 新建）", async () => {
    transferDelegate.findFirst.mockResolvedValueOnce({
      id: REQ_ID,
      petId: PET_ID,
      fromCustomerId: CUSTOMER_A,
      toCustomerId: CUSTOMER_B,
      status: PetTransferStatus.PENDING,
      version: 0,
    });
    petDelegate.findFirst.mockResolvedValueOnce({
      id: PET_ID,
      name: "旺财",
      petType: 1,
      ownerCustomerId: CUSTOMER_A,
    });
    const approved = { id: REQ_ID, status: PetTransferStatus.APPROVED };
    transferDelegate.update.mockResolvedValueOnce(approved);
    petDelegate.update.mockResolvedValueOnce({ id: PET_ID, ownerCustomerId: CUSTOMER_B });
    customerPetDelegate.updateMany.mockResolvedValueOnce({ count: 1 });
    customerPetDelegate.findFirst.mockResolvedValueOnce(null); // 目标客户无既有关联
    customerPetDelegate.count.mockResolvedValueOnce(0);
    customerPetDelegate.create.mockResolvedValueOnce({ id: "assoc-new" });

    const result = await withContext(() => service.approveTransfer(REQ_ID));

    expect(result).toBe(approved);
    // 申请推进：乐观锁 where（version + status=pending）
    expect(transferDelegate.update.mock.calls[0][0].where).toEqual({
      id: REQ_ID,
      version: 0,
      status: PetTransferStatus.PENDING,
    });
    expect(transferDelegate.update.mock.calls[0][0].data.status).toBe(PetTransferStatus.APPROVED);
    // 归属变更：ownerCustomerId 由 A 改为 B（带 fromCustomerId 一致性守卫）
    const petUpdateArgs = petDelegate.update.mock.calls[0][0];
    expect(petUpdateArgs.where).toEqual({
      id: PET_ID,
      ownerCustomerId: CUSTOMER_A,
      deletedAt: null,
    });
    expect(petUpdateArgs.data.ownerCustomerId).toBe(CUSTOMER_B);
    // 关联迁移：旧客户关联软删
    expect(customerPetDelegate.updateMany.mock.calls[0][0].where).toEqual({
      customerId: CUSTOMER_A,
      petId: PET_ID,
      deletedAt: null,
    });
    expect(customerPetDelegate.create.mock.calls[0][0].data).toMatchObject({
      customerId: CUSTOMER_B,
      petId: PET_ID,
      petName: "旺财",
      isPrimary: true,
    });
  });

  it("审批：申请不存在 → A0513", async () => {
    transferDelegate.findFirst.mockResolvedValueOnce(null);

    await expectBusinessError(
      withContext(() => service.approveTransfer(REQ_ID)),
      "A0513"
    );
  });

  it("审批：非待审批状态（已通过）→ A0516", async () => {
    transferDelegate.findFirst.mockResolvedValueOnce({
      id: REQ_ID,
      status: PetTransferStatus.APPROVED,
    });

    await expectBusinessError(
      withContext(() => service.approveTransfer(REQ_ID)),
      "A0516"
    );
    expect(transferDelegate.update).not.toHaveBeenCalled();
  });

  it("审批：宠物现行主人已非发起快照（归属被改动）→ A0516", async () => {
    transferDelegate.findFirst.mockResolvedValueOnce({
      id: REQ_ID,
      petId: PET_ID,
      fromCustomerId: CUSTOMER_A,
      toCustomerId: CUSTOMER_B,
      status: PetTransferStatus.PENDING,
      version: 0,
    });
    petDelegate.findFirst.mockResolvedValueOnce({ id: PET_ID, ownerCustomerId: CUSTOMER_B });

    await expectBusinessError(
      withContext(() => service.approveTransfer(REQ_ID)),
      "A0516"
    );
    expect(petDelegate.update).not.toHaveBeenCalled();
  });

  it("审批：并发双批（乐观锁 P2025）→ A0516", async () => {
    transferDelegate.findFirst.mockResolvedValueOnce({
      id: REQ_ID,
      petId: PET_ID,
      fromCustomerId: CUSTOMER_A,
      toCustomerId: CUSTOMER_B,
      status: PetTransferStatus.PENDING,
      version: 0,
    });
    petDelegate.findFirst.mockResolvedValueOnce({ id: PET_ID, ownerCustomerId: CUSTOMER_A });
    transferDelegate.update.mockRejectedValueOnce({ code: "P2025" });

    await expectBusinessError(
      withContext(() => service.approveTransfer(REQ_ID)),
      "A0516"
    );
  });

  // ── 拒绝 / 撤销 ──────────────────────────────────────

  it("拒绝：1→3 记录拒绝理由", async () => {
    transferDelegate.findFirst.mockResolvedValueOnce({
      id: REQ_ID,
      status: PetTransferStatus.PENDING,
      version: 0,
    });
    const rejected = { id: REQ_ID, status: PetTransferStatus.REJECTED };
    transferDelegate.update.mockResolvedValueOnce(rejected);

    const result = await withContext(() =>
      service.rejectTransfer(REQ_ID, { rejectReason: "资料不全" })
    );

    expect(result).toBe(rejected);
    const args = transferDelegate.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: REQ_ID, version: 0, status: PetTransferStatus.PENDING });
    expect(args.data).toMatchObject({
      status: PetTransferStatus.REJECTED,
      rejectReason: "资料不全",
    });
  });

  it("拒绝：非待审批状态 → A0516", async () => {
    transferDelegate.findFirst.mockResolvedValueOnce({
      id: REQ_ID,
      status: PetTransferStatus.REJECTED,
    });

    await expectBusinessError(
      withContext(() => service.rejectTransfer(REQ_ID, { rejectReason: "x" })),
      "A0516"
    );
  });

  it("撤销：1→4（申请人本人）", async () => {
    transferDelegate.findFirst.mockResolvedValueOnce({
      id: REQ_ID,
      status: PetTransferStatus.PENDING,
      version: 0,
      appliedBy: BigInt("1"),
    });
    const cancelled = { id: REQ_ID, status: PetTransferStatus.CANCELLED };
    transferDelegate.update.mockResolvedValueOnce(cancelled);

    const result = await withContext(() => service.cancelTransfer(REQ_ID));

    expect(result).toBe(cancelled);
    expect(transferDelegate.update.mock.calls[0][0].data.status).toBe(PetTransferStatus.CANCELLED);
  });

  it("撤销：非申请人本人且非 ROOT → A0300", async () => {
    transferDelegate.findFirst.mockResolvedValueOnce({
      id: REQ_ID,
      status: PetTransferStatus.PENDING,
      version: 0,
      appliedBy: BigInt("99"),
    });

    await expectBusinessError(
      withContext(() => service.cancelTransfer(REQ_ID), [], "1"),
      "A0300"
    );
    expect(transferDelegate.update).not.toHaveBeenCalled();
  });

  it("撤销：非待审批状态 → A0516", async () => {
    transferDelegate.findFirst.mockResolvedValueOnce({
      id: REQ_ID,
      status: PetTransferStatus.CANCELLED,
    });

    await expectBusinessError(
      withContext(() => service.cancelTransfer(REQ_ID)),
      "A0516"
    );
  });

  // ── 分页 ─────────────────────────────────────────────

  it("分页：status / petId 进 where，返回 data+page 结构", async () => {
    transferDelegate.findMany.mockResolvedValueOnce([
      { id: REQ_ID, petId: PET_ID, fromCustomerId: "c-from", toCustomerId: "c-to" },
    ]);
    transferDelegate.count.mockResolvedValueOnce(1);
    petDelegate.findMany.mockResolvedValueOnce([{ id: PET_ID, name: "豆豆", petType: 1 }]);
    customerDelegate.findMany.mockResolvedValueOnce([
      { id: "c-from", name: "张先生" },
      { id: "c-to", name: "李女士" },
    ]);

    const result = await withContext(() =>
      service.getTransferPage({ status: 1, petId: PET_ID } as QueryTransferDto)
    );

    expect(result.page).toEqual({ pageNum: 1, pageSize: 20, total: 1 });
    const args = transferDelegate.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ deletedAt: null, status: 1, petId: PET_ID });
    expect(args.orderBy).toEqual({ createdAt: "desc" });
  });

  it("分页：批量补齐宠物名/类型与转出·转入客户名（两次 in 回查，非 N+1）", async () => {
    transferDelegate.findMany.mockResolvedValueOnce([
      { id: REQ_ID, petId: PET_ID, fromCustomerId: "c-from", toCustomerId: "c-to" },
      { id: "req-2", petId: "pet-2", fromCustomerId: "c-to", toCustomerId: "c-from" },
    ]);
    transferDelegate.count.mockResolvedValueOnce(2);
    petDelegate.findMany.mockResolvedValueOnce([
      { id: PET_ID, name: "豆豆", petType: 1 },
      { id: "pet-2", name: "七喜", petType: 2 },
    ]);
    customerDelegate.findMany.mockResolvedValueOnce([
      { id: "c-from", name: "张先生" },
      { id: "c-to", name: "李女士" },
    ]);

    const result = await withContext(() => service.getTransferPage({} as QueryTransferDto));

    expect(petDelegate.findMany).toHaveBeenCalledTimes(1);
    expect(customerDelegate.findMany).toHaveBeenCalledTimes(1);
    expect(petDelegate.findMany.mock.calls[0][0].where.id.in).toEqual([PET_ID, "pet-2"]);
    expect(customerDelegate.findMany.mock.calls[0][0].where.id.in).toEqual(["c-from", "c-to"]);
    expect(result.data[0]).toMatchObject({
      petName: "豆豆",
      petType: 1,
      fromCustomerName: "张先生",
      toCustomerName: "李女士",
    });
    expect(result.data[1]).toMatchObject({
      petName: "七喜",
      petType: 2,
      fromCustomerName: "李女士",
      toCustomerName: "张先生",
    });
  });

  it("分页：关联实体缺失时展示字段回退 null（不抛错）", async () => {
    transferDelegate.findMany.mockResolvedValueOnce([
      { id: REQ_ID, petId: PET_ID, fromCustomerId: "c-gone", toCustomerId: "c-to" },
    ]);
    transferDelegate.count.mockResolvedValueOnce(1);
    petDelegate.findMany.mockResolvedValueOnce([]);
    customerDelegate.findMany.mockResolvedValueOnce([{ id: "c-to", name: "李女士" }]);

    const result = await withContext(() => service.getTransferPage({} as QueryTransferDto));

    expect(result.data[0]).toMatchObject({
      petName: null,
      petType: null,
      fromCustomerName: null,
      toCustomerName: "李女士",
    });
  });

  it("分页：排序白名单外字段回落 createdAt", async () => {
    transferDelegate.findMany.mockResolvedValueOnce([]);
    transferDelegate.count.mockResolvedValueOnce(0);

    await withContext(() =>
      service.getTransferPage({ sortBy: "evil", order: "asc" } as unknown as QueryTransferDto)
    );

    expect(transferDelegate.findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: "asc" });
  });
});
