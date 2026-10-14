import "reflect-metadata";

import { DEFAULT_STORE_CONFIG } from "@peluvida/shared";

import type { PrismaService } from "../common/prisma/prisma.service";
import { RequestContext } from "../common/context/request-context";
import { BusinessException } from "../common/exceptions/business.exception";

import { StoreHqService } from "./store-hq.service";

/**
 * 总部-门店两级管理服务单测（P0-04-06 · FR-5 骨架）
 *
 * 覆盖：批量下发「部分成功」主路径（成功/版本冲突/门店缺失逐店收集、
 * 不整体回滚）/ 请求级拒绝（空 storeIds、空 config → A0440；非法配置键、
 * 非法值 → A0437）/ 总览聚合（配置摘要 fail-safe 合并 + 日历例外双口径计数）。
 * PrismaService 全 mock，经 `RequestContext.run` 提供 ALS 上下文。
 */
describe("StoreHqService（P0-04-06 总部-门店两级骨架）", () => {
  const storeDelegate = {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  };

  const calendarDelegate = {
    findMany: jest.fn(),
  };

  const prismaMock = {
    scoped: { store: storeDelegate, storeCalendar: calendarDelegate },
  } as unknown as PrismaService;
  let service: StoreHqService;

  /** 在 ALS 上下文中执行（userId=1 / tenantId=1），对齐真实请求链路 */
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
    jest.clearAllMocks();
    service = new StoreHqService(prismaMock);
  });

  describe("batchDispatchConfig（批量下发 · 部分成功语义）", () => {
    it("部分成功主路径：第一店成功、第二店版本冲突进 failed（不中断、不整体回滚）", async () => {
      storeDelegate.findFirst
        .mockResolvedValueOnce({ id: "uuid-1", config: null, version: 0 })
        .mockResolvedValueOnce({ id: "uuid-2", config: { pushEnabled: true }, version: 5 })
        // 第二店 P2025 后的存在性回查
        .mockResolvedValueOnce({ id: "uuid-2" });
      storeDelegate.update
        .mockResolvedValueOnce({ id: "uuid-1", version: 1 })
        .mockRejectedValueOnce(
          Object.assign(new Error("Record to update not found."), { code: "P2025" })
        );

      const result = await withContext(() =>
        service.batchDispatchConfig({
          storeIds: ["uuid-1", "uuid-2"],
          config: { pushEnabled: false },
        })
      );

      expect(result.total).toBe(2);
      expect(result.succeeded).toEqual([{ storeId: "uuid-1", version: 1 }]);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]).toMatchObject({ storeId: "uuid-2", code: "A0423" });

      // 第一店：读当前 version(0) → CAS 写，合并结果为完整六键
      const firstUpdateArgs = storeDelegate.update.mock.calls[0][0];
      expect(firstUpdateArgs.where).toEqual({ id: "uuid-1", version: 0, deletedAt: null });
      expect(firstUpdateArgs.data.config).toEqual({
        ...DEFAULT_STORE_CONFIG,
        pushEnabled: false,
      });
      expect(firstUpdateArgs.data.version).toEqual({ increment: 1 });

      // 第二店：CAS 用其当前 version(5)
      const secondUpdateArgs = storeDelegate.update.mock.calls[1][0];
      expect(secondUpdateArgs.where).toEqual({ id: "uuid-2", version: 5, deletedAt: null });
    });

    it("门店不存在 → 进 failed（A0424），后续门店继续下发", async () => {
      storeDelegate.findFirst
        .mockResolvedValueOnce(null) // uuid-missing 不存在
        .mockResolvedValueOnce({ id: "uuid-2", config: null, version: 0 });
      storeDelegate.update.mockResolvedValueOnce({ id: "uuid-2", version: 1 });

      const result = await withContext(() =>
        service.batchDispatchConfig({
          storeIds: ["00000000-0000-4000-8000-000000000000", "uuid-2"],
          config: { pushEnabled: false },
        })
      );

      expect(result.succeeded).toEqual([{ storeId: "uuid-2", version: 1 }]);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]).toMatchObject({
        storeId: "00000000-0000-4000-8000-000000000000",
        code: "A0424",
      });
    });

    it("请求级拒绝：空 storeIds → A0440（不产生任何门店读写）", async () => {
      await expectBusinessError(
        withContext(() =>
          service.batchDispatchConfig({ storeIds: [], config: { pushEnabled: false } })
        ),
        "A0440"
      );
      expect(storeDelegate.findFirst).not.toHaveBeenCalled();
      expect(storeDelegate.update).not.toHaveBeenCalled();
    });

    it("请求级拒绝：config 无任何键 → A0440", async () => {
      await expectBusinessError(
        withContext(() => service.batchDispatchConfig({ storeIds: ["uuid-1"], config: {} })),
        "A0440"
      );
    });

    it("请求级拒绝：非法配置键（白名单外）→ A0437", async () => {
      await expectBusinessError(
        withContext(() =>
          service.batchDispatchConfig({ storeIds: ["uuid-1"], config: { evilKey: 1 } })
        ),
        "A0437"
      );
      expect(storeDelegate.findFirst).not.toHaveBeenCalled();
    });

    it("请求级拒绝：合法键但非法值（slotGranularityMin=20）→ A0437", async () => {
      await expectBusinessError(
        withContext(() =>
          service.batchDispatchConfig({ storeIds: ["uuid-1"], config: { slotGranularityMin: 20 } })
        ),
        "A0437"
      );
      expect(storeDelegate.update).not.toHaveBeenCalled();
    });
  });

  describe("getTenantOverview（总部视角总览）", () => {
    it("全门店摘要 + 配置 fail-safe 合并 + 日历例外双口径计数", async () => {
      storeDelegate.findMany.mockResolvedValueOnce([
        { id: "uuid-1", code: "S1", name: "一店", status: 1, config: { pushEnabled: false } },
        { id: "uuid-2", code: "S2", name: "二店", status: 2, config: { evilKey: "x" } },
      ]);
      calendarDelegate.findMany.mockResolvedValueOnce([
        { storeId: "uuid-1", date: new Date(Date.UTC(2099, 0, 10)) }, // 未来 → upcoming
        { storeId: "uuid-1", date: new Date(Date.UTC(2020, 0, 10)) }, // 过去 → 仅全量
      ]);

      const result = await withContext(() => service.getTenantOverview());

      expect(result.total).toBe(2);
      expect(result.items[0]).toMatchObject({
        id: "uuid-1",
        code: "S1",
        calendarExceptionCount: 2,
        upcomingCalendarExceptionCount: 1,
      });
      // 配置摘要：存量合法覆盖键生效
      expect(result.items[0].config).toEqual({ ...DEFAULT_STORE_CONFIG, pushEnabled: false });
      // 配置摘要：脏数据 fail-safe 回落全默认
      expect(result.items[1].config).toEqual({ ...DEFAULT_STORE_CONFIG });
      expect(result.items[1].calendarExceptionCount).toBe(0);
      expect(result.items[1].upcomingCalendarExceptionCount).toBe(0);
    });
  });
});
