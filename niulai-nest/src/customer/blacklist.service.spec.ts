import "reflect-metadata";

import type { PrismaService } from "../common/prisma/prisma.service";
import { RequestContext } from "../common/context/request-context";
import { BusinessException } from "../common/exceptions/business.exception";
import { BlacklistStatus } from "@peluvida/shared";

import { BlacklistService } from "./blacklist.service";
import type { CreateBlacklistDto } from "./dto/create-blacklist.dto";
import type { QueryBlacklistDto } from "./dto/query-blacklist.dto";

/**
 * 黑名单服务单测（P0-05-05 · FR-4）
 *
 * 覆盖：拉黑（租户级 storeId=null / 门店级须有效门店 A0524 / 重复 A0525 /
 * 无租户上下文 A0302）/ 解除（1→0 且落 `releaseReason` / 缺失 A0523 / 已解除幂等
 * 且不覆盖首次原因）/ 分页（scope 映射 / 排序白名单回落）/ **硬拦截 checkBlocked**
 * （命中抛 A0522、未命中放行、storeId 分支语义）。PrismaService 全 mock。
 */
describe("BlacklistService（P0-05-05 黑名单）", () => {
  const blacklistDelegate = {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const customerDelegate = { findFirst: jest.fn() };
  const storeDelegate = { findFirst: jest.fn() };

  const prismaMock = {
    scoped: {
      blacklist: blacklistDelegate,
      customer: customerDelegate,
      store: storeDelegate,
    },
  } as unknown as PrismaService;
  let service: BlacklistService;

  const CUSTOMER = "11111111-1111-4111-8111-111111111111";
  const STORE = "22222222-2222-4222-8222-222222222222";
  const BLACKLIST_ID = "33333333-3333-4333-8333-333333333333";

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

  beforeEach(() => {
    jest.resetAllMocks();
    service = new BlacklistService(prismaMock);
  });

  // ── 拉黑 ─────────────────────────────────────────────

  it("拉黑：租户级（storeId=null）落生效记录，注入 operatorId/tenantId", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce({ id: CUSTOMER });
    blacklistDelegate.findFirst.mockResolvedValueOnce(null);
    blacklistDelegate.create.mockResolvedValueOnce({ id: BLACKLIST_ID, status: 1 });

    const result = await withContext(() =>
      service.addToBlacklist(CUSTOMER, {
        scope: "tenant",
        reason: "恶意骚扰",
      } as CreateBlacklistDto)
    );

    expect(result).toMatchObject({ id: BLACKLIST_ID, status: 1 });
    const args = blacklistDelegate.create.mock.calls[0][0];
    expect(args.data).toMatchObject({
      tenantId: BigInt("1"),
      customerId: CUSTOMER,
      storeId: null,
      status: BlacklistStatus.ACTIVE,
      operatorId: BigInt("1"),
    });
    // 门店级校验不应触发
    expect(storeDelegate.findFirst).not.toHaveBeenCalled();
  });

  it("拉黑：门店级缺 storeId → A0524", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce({ id: CUSTOMER });

    await expectBusinessError(
      withContext(() =>
        service.addToBlacklist(CUSTOMER, { scope: "store", reason: "x" } as CreateBlacklistDto)
      ),
      "A0524"
    );
    expect(blacklistDelegate.create).not.toHaveBeenCalled();
  });

  it("拉黑：门店级指定无效门店 → A0524", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce({ id: CUSTOMER });
    storeDelegate.findFirst.mockResolvedValueOnce(null);

    await expectBusinessError(
      withContext(() =>
        service.addToBlacklist(CUSTOMER, {
          scope: "store",
          storeId: STORE,
          reason: "x",
        } as CreateBlacklistDto)
      ),
      "A0524"
    );
  });

  it("拉黑：同范围已在生效 → A0525", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce({ id: CUSTOMER });
    blacklistDelegate.findFirst.mockResolvedValueOnce({ id: "existing" });

    await expectBusinessError(
      withContext(() =>
        service.addToBlacklist(CUSTOMER, { scope: "tenant", reason: "x" } as CreateBlacklistDto)
      ),
      "A0525"
    );
    expect(blacklistDelegate.create).not.toHaveBeenCalled();
  });

  it("拉黑：scope=tenant 忽略传入 storeId（落 NULL，门店校验不触发）", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce({ id: CUSTOMER });
    blacklistDelegate.findFirst.mockResolvedValueOnce(null);
    blacklistDelegate.create.mockResolvedValueOnce({ id: BLACKLIST_ID, status: 1 });

    await withContext(() =>
      service.addToBlacklist(CUSTOMER, {
        scope: "tenant",
        storeId: STORE,
        reason: "x",
      } as CreateBlacklistDto)
    );

    // 租户级语义：store 归属恒为 NULL（否则会被误判为「仅该门店生效」）
    expect(blacklistDelegate.create.mock.calls[0][0].data.storeId).toBeNull();
    expect(storeDelegate.findFirst).not.toHaveBeenCalled();
  });

  it("拉黑：无租户上下文 → fail-closed A0302", async () => {
    await expectBusinessError(
      service.addToBlacklist(CUSTOMER, { scope: "tenant", reason: "x" } as CreateBlacklistDto),
      "A0302"
    );
  });

  // ── 解除 ─────────────────────────────────────────────

  it("解除：status 1→0，落解除原因 release_reason（不物理删）", async () => {
    blacklistDelegate.findFirst.mockResolvedValueOnce({
      id: BLACKLIST_ID,
      status: BlacklistStatus.ACTIVE,
    });
    blacklistDelegate.update.mockResolvedValueOnce({
      id: BLACKLIST_ID,
      status: BlacklistStatus.RELEASED,
    });

    const result = await withContext(() =>
      service.releaseBlacklist(CUSTOMER, BLACKLIST_ID, "误操作，已与客户核实")
    );

    expect(result).toMatchObject({ status: BlacklistStatus.RELEASED });
    const args = blacklistDelegate.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: BLACKLIST_ID });
    expect(args.data.status).toBe(BlacklistStatus.RELEASED);
    // PRD《客户管理》BR-2「移出黑名单必须填写原因」：原因随解除一并落库
    expect(args.data.releaseReason).toBe("误操作，已与客户核实");
    expect(args.data.updatedBy).toEqual(BigInt("1"));
    expect(args.data.version).toEqual({ increment: 1 });
  });

  it("解除：记录不存在 → A0523", async () => {
    blacklistDelegate.findFirst.mockResolvedValueOnce(null);

    await expectBusinessError(
      withContext(() => service.releaseBlacklist(CUSTOMER, BLACKLIST_ID, "误操作")),
      "A0523"
    );
    expect(blacklistDelegate.update).not.toHaveBeenCalled();
  });

  it("解除：已解除（status=0）幂等返回，不重复更新、不覆盖首次解除原因", async () => {
    blacklistDelegate.findFirst.mockResolvedValueOnce({
      id: BLACKLIST_ID,
      status: BlacklistStatus.RELEASED,
      releaseReason: "首次解除原因",
    });

    const result = await withContext(() =>
      service.releaseBlacklist(CUSTOMER, BLACKLIST_ID, "再次提交的原因")
    );

    expect(result).toMatchObject({
      status: BlacklistStatus.RELEASED,
      releaseReason: "首次解除原因",
    });
    expect(blacklistDelegate.update).not.toHaveBeenCalled();
  });

  // ── 分页 ─────────────────────────────────────────────

  it("分页：scope=tenant 映射 storeId IS NULL，返回 data+page 结构", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce({ id: CUSTOMER });
    blacklistDelegate.findMany.mockResolvedValueOnce([{ id: BLACKLIST_ID }]);
    blacklistDelegate.count.mockResolvedValueOnce(1);

    const result = await withContext(() =>
      service.getBlacklistPage(CUSTOMER, { scope: "tenant" } as QueryBlacklistDto)
    );

    expect(result.page).toEqual({ pageNum: 1, pageSize: 20, total: 1 });
    const args = blacklistDelegate.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ customerId: CUSTOMER, deletedAt: null, storeId: null });
    expect(args.orderBy).toEqual({ createdAt: "desc" });
  });

  it("分页：scope=store 映射 storeId NOT NULL；排序白名单外回落 createdAt", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce({ id: CUSTOMER });
    blacklistDelegate.findMany.mockResolvedValueOnce([]);
    blacklistDelegate.count.mockResolvedValueOnce(0);

    await withContext(() =>
      service.getBlacklistPage(CUSTOMER, {
        scope: "store",
        status: 1,
        sortBy: "evil",
        order: "asc",
      } as unknown as QueryBlacklistDto)
    );

    const args = blacklistDelegate.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      customerId: CUSTOMER,
      deletedAt: null,
      storeId: { not: null },
      status: 1,
    });
    expect(args.orderBy).toEqual({ createdAt: "asc" });
  });

  it("分页：status=0（已解除）作为独立筛选透传，不与 scope 互斥", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce({ id: CUSTOMER });
    blacklistDelegate.findMany.mockResolvedValueOnce([]);
    blacklistDelegate.count.mockResolvedValueOnce(0);

    await withContext(() =>
      service.getBlacklistPage(CUSTOMER, { status: 0 } as unknown as QueryBlacklistDto)
    );

    const args = blacklistDelegate.findMany.mock.calls[0][0];
    // 未传 scope ⇒ 不注入 storeId 分支，仅透传 status
    expect(args.where).toEqual({ customerId: CUSTOMER, deletedAt: null, status: 0 });
  });

  // ── 硬拦截 ───────────────────────────────────────────
  it("checkBlocked：命中生效黑名单 → 抛 A0522", async () => {
    blacklistDelegate.findFirst.mockResolvedValueOnce({ id: BLACKLIST_ID });

    await expectBusinessError(
      withContext(() => service.checkBlocked(CUSTOMER)),
      "A0522"
    );

    const args = blacklistDelegate.findFirst.mock.calls[0][0];
    expect(args.where).toMatchObject({
      customerId: CUSTOMER,
      status: BlacklistStatus.ACTIVE,
      deletedAt: null,
      OR: [{ storeId: null }], // 未传 storeId：仅租户级生效分支
    });
  });

  it("checkBlocked：未命中（findFirst 返回 null）→ 放行（不抛）", async () => {
    blacklistDelegate.findFirst.mockResolvedValueOnce(null);

    await expect(withContext(() => service.checkBlocked(CUSTOMER))).resolves.toBeUndefined();
  });

  it("checkBlocked：传 storeId → OR 含「租户级 OR 该门店级」两分支", async () => {
    blacklistDelegate.findFirst.mockResolvedValueOnce(null);

    await withContext(() => service.checkBlocked(CUSTOMER, STORE));

    const args = blacklistDelegate.findFirst.mock.calls[0][0];
    expect(args.where.OR).toEqual([{ storeId: null }, { storeId: STORE }]);
  });
});
