import "reflect-metadata";

import type { PrismaService } from "../common/prisma/prisma.service";
import { RequestContext } from "../common/context/request-context";
import { BusinessException } from "../common/exceptions/business.exception";

import {
  parseCalendarDate,
  parseCalendarMonthRange,
  StoreCalendarService,
} from "./store-calendar.service";
import { CreateCalendarEntryDto } from "./dto/create-calendar-entry.dto";

/**
 * 门店日历服务单测（P0-04-04 · FR-3 日期级例外）
 *
 * 覆盖：create（上下文注入 + 门店缺失 A0424 / type=3 时刻校验 A0400 /
 * 非法日期 A0400 / 同日重复 A0438 / P2002 并发兜底 A0438）/
 * list（月份区间 where + 门店缺失 A0424 + 非法 month A0400）/
 * delete（软删 + 记录缺失 A0439）/ 纯日期算术函数边界（2 月 30 日、时区无关）。
 * PrismaService 全 mock，经 `RequestContext.run` 提供 ALS 上下文。
 */
describe("StoreCalendarService（P0-04-04 门店日历）", () => {
  const storeDelegate = { findFirst: jest.fn() };

  const calendarDelegate = {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  };

  const prismaMock = {
    scoped: { store: storeDelegate, storeCalendar: calendarDelegate },
  } as unknown as PrismaService;
  let service: StoreCalendarService;

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

  const baseDto = (): CreateCalendarEntryDto => {
    const dto = new CreateCalendarEntryDto();
    dto.date = "2026-10-01";
    dto.type = 1;
    return dto;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new StoreCalendarService(prismaMock);
  });

  describe("parseCalendarDate / parseCalendarMonthRange（纯日期算术）", () => {
    it("yyyy-MM-dd → UTC 午夜瞬时（时区无关，DATE 列无时间语义）", () => {
      const parsed = parseCalendarDate("2026-10-01");
      expect(parsed).not.toBeNull();
      expect(parsed!.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    });

    it("非真实日历日 / 非法形态 → null（2026-02-30 会被 Date.UTC 滚动进 3 月，必须回读复核）", () => {
      expect(parseCalendarDate("2026-02-30")).toBeNull();
      expect(parseCalendarDate("2026-13-01")).toBeNull();
      expect(parseCalendarDate("2026-10")).toBeNull();
      expect(parseCalendarDate("not-a-date")).toBeNull();
      expect(parseCalendarDate("")).toBeNull();
    });

    it("yyyy-MM → 月首/次月初 UTC 午夜闭开区间", () => {
      const range = parseCalendarMonthRange("2026-10");
      expect(range!.gte.toISOString()).toBe("2026-10-01T00:00:00.000Z");
      expect(range!.lt.toISOString()).toBe("2026-11-01T00:00:00.000Z");
      expect(parseCalendarMonthRange("2026-13")).toBeNull();
      expect(parseCalendarMonthRange("2026-00")).toBeNull();
      expect(parseCalendarMonthRange("2026-10-01")).toBeNull();
    });
  });

  describe("createCalendarEntry", () => {
    it("创建节假日闭店：注入租户 1 与 createdBy/updatedBy，时刻列置 NULL", async () => {
      storeDelegate.findFirst.mockResolvedValueOnce({ id: "store-1" });
      calendarDelegate.findFirst.mockResolvedValueOnce(null);
      const created = { id: "entry-1", type: 1 };
      calendarDelegate.create.mockResolvedValueOnce(created);

      const result = await withContext(() => service.createCalendarEntry("store-1", baseDto()));

      expect(result).toBe(created);
      const args = calendarDelegate.create.mock.calls[0][0];
      expect(args.data.tenantId).toBe(BigInt("1"));
      expect(args.data.createdBy).toBe(BigInt("1"));
      expect(args.data.updatedBy).toBe(BigInt("1"));
      expect(args.data.storeId).toBe("store-1");
      expect(args.data.date.toISOString()).toBe("2026-10-01T00:00:00.000Z");
      expect(args.data.openTime).toBeNull();
      expect(args.data.closeTime).toBeNull();
    });

    it("创建特殊营业（type=3）：时刻成对落库", async () => {
      storeDelegate.findFirst.mockResolvedValueOnce({ id: "store-1" });
      calendarDelegate.findFirst.mockResolvedValueOnce(null);
      calendarDelegate.create.mockResolvedValueOnce({ id: "entry-2" });

      const dto = baseDto();
      dto.type = 3;
      dto.openTime = "10:00";
      dto.closeTime = "16:00";
      dto.remark = "国庆半日营业";

      await withContext(() => service.createCalendarEntry("store-1", dto));

      const args = calendarDelegate.create.mock.calls[0][0];
      expect(args.data.openTime).toBe("10:00");
      expect(args.data.closeTime).toBe("16:00");
      expect(args.data.remark).toBe("国庆半日营业");
    });

    it("type=3 时刻缺失 / close ≤ open / 格式非法 → A0400", async () => {
      storeDelegate.findFirst.mockResolvedValue({ id: "store-1" });

      // 缺时刻（type=3 未提供 openTime/closeTime）
      const missingTimes = baseDto();
      missingTimes.type = 3;
      await expectBusinessError(
        withContext(() => service.createCalendarEntry("store-1", missingTimes)),
        "A0400"
      );

      // close == open
      const equal = baseDto();
      equal.type = 3;
      equal.openTime = "10:00";
      equal.closeTime = "10:00";
      await expectBusinessError(
        withContext(() => service.createCalendarEntry("store-1", equal)),
        "A0400"
      );

      // 格式非法（绕过 ValidationPipe 的直调场景兜底）
      const bad = baseDto();
      bad.type = 3;
      bad.openTime = "9:00";
      bad.closeTime = "16:00";
      await expectBusinessError(
        withContext(() => service.createCalendarEntry("store-1", bad)),
        "A0400"
      );

      expect(calendarDelegate.create).not.toHaveBeenCalled();
    });

    it("门店不存在（非本租户/已软删）→ STORE_NOT_FOUND（A0424）", async () => {
      storeDelegate.findFirst.mockResolvedValueOnce(null);

      await expectBusinessError(
        withContext(() => service.createCalendarEntry("store-other", baseDto())),
        "A0424"
      );
      expect(calendarDelegate.create).not.toHaveBeenCalled();
    });

    it("非法日期（2 月 30 日）→ A0400", async () => {
      storeDelegate.findFirst.mockResolvedValueOnce({ id: "store-1" });

      const dto = baseDto();
      dto.date = "2026-02-30";
      await expectBusinessError(
        withContext(() => service.createCalendarEntry("store-1", dto)),
        "A0400"
      );
    });

    it("同日同店重复 → STORE_CALENDAR_DATE_DUPLICATED（A0438）；P2002 并发兜底 → A0438", async () => {
      // 应用层先行查重
      storeDelegate.findFirst.mockResolvedValueOnce({ id: "store-1" });
      calendarDelegate.findFirst.mockResolvedValueOnce({ id: "entry-existing" });

      await expectBusinessError(
        withContext(() => service.createCalendarEntry("store-1", baseDto())),
        "A0438"
      );

      // 唯一索引并发兜底
      storeDelegate.findFirst.mockResolvedValueOnce({ id: "store-1" });
      calendarDelegate.findFirst.mockResolvedValueOnce(null);
      calendarDelegate.create.mockRejectedValueOnce(
        Object.assign(new Error("Unique constraint failed"), { code: "P2002" })
      );

      await expectBusinessError(
        withContext(() => service.createCalendarEntry("store-1", baseDto())),
        "A0438"
      );
    });
  });

  describe("listCalendarEntries", () => {
    it("按月查询：DATE 闭开区间 where + date 升序", async () => {
      storeDelegate.findFirst.mockResolvedValueOnce({ id: "store-1" });
      const rows = [{ id: "entry-1" }];
      calendarDelegate.findMany.mockResolvedValueOnce(rows);

      const result = await withContext(() => service.listCalendarEntries("store-1", "2026-10"));

      expect(result).toEqual({ storeId: "store-1", month: "2026-10", items: rows });
      const args = calendarDelegate.findMany.mock.calls[0][0];
      expect(args.where.storeId).toBe("store-1");
      expect(args.where.deletedAt).toBeNull();
      expect(args.where.date.gte.toISOString()).toBe("2026-10-01T00:00:00.000Z");
      expect(args.where.date.lt.toISOString()).toBe("2026-11-01T00:00:00.000Z");
      expect(args.orderBy).toEqual([{ date: "asc" }]);
    });

    it("门店缺失 → A0424；非法 month → A0400", async () => {
      storeDelegate.findFirst.mockResolvedValueOnce(null);
      await expectBusinessError(
        withContext(() => service.listCalendarEntries("store-other", "2026-10")),
        "A0424"
      );

      storeDelegate.findFirst.mockResolvedValueOnce({ id: "store-1" });
      await expectBusinessError(
        withContext(() => service.listCalendarEntries("store-1", "2026-13")),
        "A0400"
      );
    });
  });

  describe("deleteCalendarEntry", () => {
    it("软删：deletedAt 置位 + updatedBy 注入", async () => {
      storeDelegate.findFirst.mockResolvedValueOnce({ id: "store-1" });
      calendarDelegate.findFirst.mockResolvedValueOnce({ id: "entry-1" });
      calendarDelegate.update.mockResolvedValueOnce({ id: "entry-1", deletedAt: new Date() });

      await withContext(() => service.deleteCalendarEntry("store-1", "entry-1"));

      const args = calendarDelegate.update.mock.calls[0][0];
      expect(args.where).toEqual({ id: "entry-1" });
      expect(args.data.deletedAt).toBeInstanceOf(Date);
      expect(args.data.updatedBy).toBe(BigInt("1"));
    });

    it("记录不存在 / 不属于该门店 → STORE_CALENDAR_NOT_FOUND（A0439）", async () => {
      storeDelegate.findFirst.mockResolvedValue({ id: "store-1" });
      calendarDelegate.findFirst.mockResolvedValueOnce(null);

      await expectBusinessError(
        withContext(() => service.deleteCalendarEntry("store-1", "entry-missing")),
        "A0439"
      );
      expect(calendarDelegate.update).not.toHaveBeenCalled();
    });

    it("门店缺失 → A0424", async () => {
      storeDelegate.findFirst.mockResolvedValueOnce(null);

      await expectBusinessError(
        withContext(() => service.deleteCalendarEntry("store-other", "entry-1")),
        "A0424"
      );
    });
  });
});
