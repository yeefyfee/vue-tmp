import "reflect-metadata";

import type { PrismaService } from "../common/prisma/prisma.service";
import { RequestContext } from "../common/context/request-context";
import { BusinessException } from "../common/exceptions/business.exception";
import type { AuditLogService } from "../common/audit/audit-log.service";

import { CustomerMergeService } from "./customer-merge.service";
import type { MergeCustomerDto } from "./dto/merge-customer.dto";

/**
 * 客户合并服务单测（P0-05-07 · FR-7）
 *
 * 覆盖：正常合并（宠物归属迁移 + 关联迁移 + 触达迁移 + 源客户归档含备注追加 +
 * 审计同事务写 + 返回体）/ 关联去重（target 已有同宠物关联 → 软删源关联）/ 自我合并
 * 拒绝 A0529 / 源客户缺失 A0530 / 目标客户缺失（含已归档）A0531 / 在途转移护栏 A0528 /
 * 乐观锁版本冲突 A0511 / 无租户上下文 fail-closed A0302。
 * PrismaService 全 mock，$transaction 以 scoped 自身作为 tx 客户端。
 */
describe("CustomerMergeService（P0-05-07 客户合并）", () => {
  const customerDelegate = { findFirst: jest.fn(), update: jest.fn() };
  const petDelegate = { updateMany: jest.fn() };
  const customerPetDelegate = { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() };
  const transferDelegate = { findFirst: jest.fn() };
  const reachLogDelegate = { updateMany: jest.fn() };

  const scopedMock = {
    customer: customerDelegate,
    pet: petDelegate,
    customerPet: customerPetDelegate,
    petTransferRequest: transferDelegate,
    reachLog: reachLogDelegate,
    $transaction: jest.fn(),
  };
  const prismaMock = { scoped: scopedMock } as unknown as PrismaService;
  const auditMock = { record: jest.fn() } as unknown as AuditLogService;
  let service: CustomerMergeService;

  function withContext<T>(fn: () => Promise<T>, tenantId: string | null = "1"): Promise<T> {
    return RequestContext.run(async () => {
      RequestContext.initUserContext({
        userId: "1",
        deptId: "1",
        deptTreePath: "0/1",
        dataScopes: [],
        roles: ["ROOT"],
        tenantId,
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

  const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
  const TARGET_ID = "22222222-2222-4222-8222-222222222222";
  const PET_ID = "33333333-3333-4333-8333-333333333333";
  const ASSOC_ID = "44444444-4444-4444-8444-444444444444";

  beforeEach(() => {
    jest.resetAllMocks();
    // $transaction 以 scoped 自身作为事务客户端执行回调（对齐扩展客户端语义）
    scopedMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(scopedMock)
    );
    service = new CustomerMergeService(prismaMock, auditMock);
  });

  /** 装配「正常合并」所需的基础 mock（source/target 存在、无在途申请） */
  function primeHappyPath() {
    customerDelegate.findFirst
      .mockResolvedValueOnce({ id: SOURCE_ID, name: "源客户", remark: "老备注", version: 2 })
      .mockResolvedValueOnce({ id: TARGET_ID, name: "目标客户" });
    transferDelegate.findFirst.mockResolvedValueOnce(null);
  }

  it("正常合并：迁移宠物归属/关联/触达 + 源客户归档（备注追加）+ 同事务审计", async () => {
    primeHappyPath();
    petDelegate.updateMany.mockResolvedValueOnce({ count: 1 });
    customerPetDelegate.findMany.mockResolvedValueOnce([{ id: ASSOC_ID, petId: PET_ID }]);
    customerPetDelegate.findFirst.mockResolvedValueOnce(null); // target 无同宠物关联
    customerPetDelegate.update.mockResolvedValueOnce({ id: ASSOC_ID });
    reachLogDelegate.updateMany.mockResolvedValueOnce({ count: 2 });
    customerDelegate.update.mockResolvedValueOnce({ id: SOURCE_ID });

    const dto: MergeCustomerDto = { sourceId: SOURCE_ID, targetId: TARGET_ID };
    const result = await withContext(() => service.mergeCustomers(dto));

    expect(result).toEqual({
      targetId: TARGET_ID,
      movedPets: 1,
      movedReachLogs: 2,
      mergedSourceId: SOURCE_ID,
    });

    // 宠物归属迁移（权威字段 ownerCustomerId → target）
    expect(petDelegate.updateMany.mock.calls[0][0]).toMatchObject({
      where: { ownerCustomerId: SOURCE_ID, deletedAt: null },
      data: { ownerCustomerId: TARGET_ID, updatedBy: BigInt("1") },
    });

    // 关联迁移：改挂 target
    expect(customerPetDelegate.update.mock.calls[0][0].where).toEqual({ id: ASSOC_ID });
    expect(customerPetDelegate.update.mock.calls[0][0].data).toMatchObject({
      customerId: TARGET_ID,
    });

    // 触达迁移
    expect(reachLogDelegate.updateMany.mock.calls[0][0]).toMatchObject({
      where: { customerId: SOURCE_ID },
      data: { customerId: TARGET_ID },
    });

    // 源客户归档：软删 + 备注追加 + version 自增；未传 version ⇒ where 不含 version
    const archiveArgs = customerDelegate.update.mock.calls[0][0];
    expect(archiveArgs.where).toEqual({ id: SOURCE_ID, deletedAt: null });
    expect(archiveArgs.data.deletedAt).toBeInstanceOf(Date);
    expect(archiveArgs.data.remark).toBe(`老备注 已合并至 目标客户(${TARGET_ID})`);
    expect(archiveArgs.data.version).toEqual({ increment: 1 });

    // 审计：同事务（tx = scoped），action merge(8)，diff={sourceId,targetId,movedPets,movedReachLogs}
    expect(auditMock.record).toHaveBeenCalledTimes(1);
    const auditArgs = (auditMock.record as jest.Mock).mock.calls[0];
    expect(auditArgs[0]).toMatchObject({
      entityType: "customer",
      entityId: SOURCE_ID,
      action: 8,
      after: { sourceId: SOURCE_ID, targetId: TARGET_ID, movedPets: 1, movedReachLogs: 2 },
    });
    expect(auditArgs[1]).toBe(scopedMock);
  });

  it("关联去重：target 已有同一宠物关联 → 软删源关联（不重复改挂）", async () => {
    primeHappyPath();
    petDelegate.updateMany.mockResolvedValueOnce({ count: 1 });
    customerPetDelegate.findMany.mockResolvedValueOnce([{ id: ASSOC_ID, petId: PET_ID }]);
    customerPetDelegate.findFirst.mockResolvedValueOnce({ id: "assoc-existing" }); // target 已有
    customerPetDelegate.update.mockResolvedValueOnce({ id: ASSOC_ID });
    reachLogDelegate.updateMany.mockResolvedValueOnce({ count: 0 });
    customerDelegate.update.mockResolvedValueOnce({ id: SOURCE_ID });

    await withContext(() => service.mergeCustomers({ sourceId: SOURCE_ID, targetId: TARGET_ID }));

    // 软删源关联（deletedAt 置位），而非改挂 customerId
    const args = customerPetDelegate.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: ASSOC_ID });
    expect(args.data.deletedAt).toBeInstanceOf(Date);
    expect(args.data.customerId).toBeUndefined();
  });

  it("自我合并：sourceId===targetId → A0529（不进入事务）", async () => {
    await expectBusinessError(
      withContext(() => service.mergeCustomers({ sourceId: SOURCE_ID, targetId: SOURCE_ID })),
      "A0529"
    );
    expect(scopedMock.$transaction).not.toHaveBeenCalled();
  });

  it("源客户不存在 / 已归档 → A0530", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce(null);

    await expectBusinessError(
      withContext(() => service.mergeCustomers({ sourceId: SOURCE_ID, targetId: TARGET_ID })),
      "A0530"
    );
    expect(customerDelegate.update).not.toHaveBeenCalled();
  });

  it("目标客户不存在 / 已归档 → A0531", async () => {
    customerDelegate.findFirst
      .mockResolvedValueOnce({ id: SOURCE_ID, name: "源客户", remark: null, version: 0 })
      .mockResolvedValueOnce(null);

    await expectBusinessError(
      withContext(() => service.mergeCustomers({ sourceId: SOURCE_ID, targetId: TARGET_ID })),
      "A0531"
    );
    expect(petDelegate.updateMany).not.toHaveBeenCalled();
  });

  it("在途转移护栏：source 存在在途转移申请 → A0528", async () => {
    customerDelegate.findFirst
      .mockResolvedValueOnce({ id: SOURCE_ID, name: "源客户", remark: null, version: 0 })
      .mockResolvedValueOnce({ id: TARGET_ID, name: "目标客户" });
    transferDelegate.findFirst.mockResolvedValueOnce({ id: "pending-1" });

    await expectBusinessError(
      withContext(() => service.mergeCustomers({ sourceId: SOURCE_ID, targetId: TARGET_ID })),
      "A0528"
    );
    expect(petDelegate.updateMany).not.toHaveBeenCalled();
    expect(customerDelegate.update).not.toHaveBeenCalled();
  });

  it("乐观锁：传 version 且归档 update P2025 → A0511", async () => {
    primeHappyPath();
    petDelegate.updateMany.mockResolvedValueOnce({ count: 0 });
    customerPetDelegate.findMany.mockResolvedValueOnce([]);
    reachLogDelegate.updateMany.mockResolvedValueOnce({ count: 0 });
    customerDelegate.update.mockRejectedValueOnce({ code: "P2025" });

    await expectBusinessError(
      withContext(() =>
        service.mergeCustomers({ sourceId: SOURCE_ID, targetId: TARGET_ID, version: 5 })
      ),
      "A0511"
    );
  });

  it("无租户上下文 → fail-closed A0302", async () => {
    await expectBusinessError(
      withContext(() => service.mergeCustomers({ sourceId: SOURCE_ID, targetId: TARGET_ID }), null),
      "A0302"
    );
    expect(scopedMock.$transaction).not.toHaveBeenCalled();
  });
});
