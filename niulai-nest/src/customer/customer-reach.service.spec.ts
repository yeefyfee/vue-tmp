import "reflect-metadata";

import type { PrismaService } from "../common/prisma/prisma.service";
import { RequestContext } from "../common/context/request-context";
import { BusinessException } from "../common/exceptions/business.exception";
import { ReachResult } from "@peluvida/shared";

import { CustomerReachService } from "./customer-reach.service";
import type { BlacklistService } from "./blacklist.service";
import type { CreateReachLogDto } from "./dto/create-reach-log.dto";
import type { QueryReachLogDto } from "./dto/query-reach-log.dto";

/**
 * 触达域服务单测（P0-05-04 · FR-3）
 *
 * 覆盖：记录触达（成功落库 / 黑名单硬拦截 A0522 / 偏好拒收渠道 A0527 / 白名单外
 * A0527 / reachedAt 走 date.util / 客户缺失 A0510 / 无租户上下文 A0302）/
 * 触达历史分页（channel + 时间闭区间进 where / 结构）/ 偏好（读兜底默认 /
 * 写整存整取归一）/ 免打扰时段判定。
 * PrismaService 与 BlacklistService 全 mock。
 */
describe("CustomerReachService（P0-05-04 触达渠道与偏好）", () => {
  const reachLogDelegate = {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  };
  const customerDelegate = { findFirst: jest.fn(), update: jest.fn() };

  const prismaMock = {
    scoped: { reachLog: reachLogDelegate, customer: customerDelegate },
  } as unknown as PrismaService;

  const blacklistMock = { checkBlocked: jest.fn() } as unknown as BlacklistService & {
    checkBlocked: jest.Mock;
  };

  let service: CustomerReachService;

  const CUSTOMER = "11111111-1111-4111-8111-111111111111";

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
    blacklistMock.checkBlocked.mockResolvedValue(undefined);
    service = new CustomerReachService(prismaMock, blacklistMock);
  });

  // ── 记录触达 ─────────────────────────────────────────

  it("记录触达：默认偏好放行，落库注入 tenantId/operatorId，reachedAt 缺省取当前", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce({ id: CUSTOMER, reachPreferences: {} });
    reachLogDelegate.create.mockResolvedValueOnce({ id: "reach-1", channel: 1 });

    const result = await withContext(() =>
      service.createReachLog(CUSTOMER, { channel: 1, content: "欢迎到店" } as CreateReachLogDto)
    );

    expect(result).toMatchObject({ id: "reach-1" });
    expect(blacklistMock.checkBlocked).toHaveBeenCalledWith(CUSTOMER, undefined);
    const args = reachLogDelegate.create.mock.calls[0][0];
    expect(args.data).toMatchObject({
      tenantId: BigInt("1"),
      customerId: CUSTOMER,
      channel: 1,
      content: "欢迎到店",
      operatorId: BigInt("1"),
    });
    expect(args.data.reachedAt).toBeInstanceOf(Date);
  });

  it("记录触达：黑名单命中 → 硬拦截 A0522，且不落库", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce({ id: CUSTOMER, reachPreferences: {} });
    blacklistMock.checkBlocked.mockRejectedValueOnce(
      new BusinessException({ code: "A0522", msg: "客户已被列入黑名单" })
    );

    await expectBusinessError(
      withContext(() => service.createReachLog(CUSTOMER, { channel: 1 } as CreateReachLogDto)),
      "A0522"
    );
    expect(reachLogDelegate.create).not.toHaveBeenCalled();
  });

  it("记录触达：渠道被偏好明确拒收（blockedChannels）→ A0527", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce({
      id: CUSTOMER,
      reachPreferences: { blockedChannels: [4] },
    });

    await expectBusinessError(
      withContext(() => service.createReachLog(CUSTOMER, { channel: 4 } as CreateReachLogDto)),
      "A0527"
    );
    expect(reachLogDelegate.create).not.toHaveBeenCalled();
  });

  it("记录触达：渠道不在允许白名单内 → A0527；命中白名单 → 放行", async () => {
    customerDelegate.findFirst
      .mockResolvedValueOnce({ id: CUSTOMER, reachPreferences: { allowedChannels: [1] } }) // 越界渠道
      .mockResolvedValueOnce({ id: CUSTOMER, reachPreferences: { allowedChannels: [1] } }); // 白名单内
    reachLogDelegate.create.mockResolvedValueOnce({ id: "reach-2", channel: 1 });

    await expectBusinessError(
      withContext(() => service.createReachLog(CUSTOMER, { channel: 2 } as CreateReachLogDto)),
      "A0527"
    );

    const ok = await withContext(() =>
      service.createReachLog(CUSTOMER, { channel: 1 } as CreateReachLogDto)
    );
    expect(ok).toMatchObject({ id: "reach-2" });
  });

  it("记录触达：提供 reachedAt 时按 date.util 解析为瞬时", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce({ id: CUSTOMER, reachPreferences: {} });
    reachLogDelegate.create.mockResolvedValueOnce({ id: "reach-3" });

    await withContext(() =>
      service.createReachLog(CUSTOMER, {
        channel: 2,
        result: ReachResult.SUCCESS,
        reachedAt: "2026-10-01 09:30:00",
      } as CreateReachLogDto)
    );

    const args = reachLogDelegate.create.mock.calls[0][0];
    expect(args.data.reachedAt).toBeInstanceOf(Date);
    expect(args.data.result).toBe(ReachResult.SUCCESS);
  });

  it("记录触达：客户不存在 → A0510，且不触发黑名单/落库", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce(null);

    await expectBusinessError(
      withContext(() => service.createReachLog(CUSTOMER, { channel: 1 } as CreateReachLogDto)),
      "A0510"
    );
    expect(blacklistMock.checkBlocked).not.toHaveBeenCalled();
    expect(reachLogDelegate.create).not.toHaveBeenCalled();
  });

  it("记录触达：无租户上下文 → fail-closed A0302", async () => {
    await expectBusinessError(
      service.createReachLog(CUSTOMER, { channel: 1 } as CreateReachLogDto),
      "A0302"
    );
    expect(reachLogDelegate.create).not.toHaveBeenCalled();
  });

  // ── 触达历史 ─────────────────────────────────────────

  it("触达历史：channel 精确 + reachedAt 时间闭区间进 where，返回 data+page 结构", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce({ id: CUSTOMER });
    reachLogDelegate.findMany.mockResolvedValueOnce([{ id: "reach-1" }]);
    reachLogDelegate.count.mockResolvedValueOnce(1);

    const result = await withContext(() =>
      service.listReachLogs(CUSTOMER, {
        channel: 1,
        reachedAtStart: "2026-10-01",
        reachedAtEnd: "2026-10-07",
      } as QueryReachLogDto)
    );

    expect(result.page).toEqual({ pageNum: 1, pageSize: 20, total: 1 });
    const args = reachLogDelegate.findMany.mock.calls[0][0];
    expect(args.where.channel).toBe(1);
    expect(args.where.reachedAt.gte).toBeTruthy();
    expect(args.where.reachedAt.lte).toBeTruthy();
    expect(args.orderBy).toEqual({ reachedAt: "desc" });
  });

  // ── 偏好 ─────────────────────────────────────────────

  it("读偏好：DB 空值兜底默认（不设白名单 / 无拒收 / 不免打扰）", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce({ id: CUSTOMER, reachPreferences: {} });

    const pref = await withContext(() => service.getReachPreference(CUSTOMER));

    expect(pref.allowedChannels).toBeNull();
    expect(pref.blockedChannels).toEqual([]);
    expect(pref.doNotDisturb.enabled).toBe(false);
  });

  it("写偏好：整存整取归一（空数组白名单归一为 null，渠道去重升序）后落库", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce({ id: CUSTOMER });
    customerDelegate.update.mockResolvedValueOnce({ id: CUSTOMER });

    const pref = await withContext(() =>
      service.updateReachPreference(CUSTOMER, {
        allowedChannels: [],
        blockedChannels: [4, 4, 2],
        doNotDisturb: { enabled: true, start: "22:00", end: "08:00" },
      })
    );

    expect(pref.allowedChannels).toBeNull();
    expect(pref.blockedChannels).toEqual([2, 4]);
    const args = customerDelegate.update.mock.calls[0][0];
    expect(args.data.reachPreferences).toMatchObject({ blockedChannels: [2, 4] });
  });

  it("免打扰判定：未启用 → false；起止相同（全天）→ true", async () => {
    const base = {
      allowedChannels: null,
      blockedChannels: [],
      doNotDisturb: { enabled: false, start: "22:00", end: "08:00" },
    };
    expect(service.isWithinDoNotDisturb(base)).toBe(false);
    expect(
      service.isWithinDoNotDisturb({
        ...base,
        doNotDisturb: { enabled: true, start: "00:00", end: "00:00" },
      })
    ).toBe(true);
  });
});
