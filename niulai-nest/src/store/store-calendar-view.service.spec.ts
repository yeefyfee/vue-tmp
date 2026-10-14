import "reflect-metadata";

import type { PrismaService } from "../common/prisma/prisma.service";
import { RequestContext } from "../common/context/request-context";
import { BusinessException } from "../common/exceptions/business.exception";

import {
  buildCalendarViewDays,
  formatUtcDate,
  StoreCalendarViewService,
} from "./store-calendar-view.service";
import { parseCalendarMonthRange } from "./store-calendar.service";

/**
 * 门店日历视图服务单测（P0-04-07 · FR-6）
 *
 * 覆盖：聚合纯函数（例外日优先 type1/2 闭店、type3 特殊时段、无例外回落
 * 周时段、周一/周六键位映射、月末天数、type3 脏时刻 fail-safe 闭店）+
 * service 错误路径（门店缺失 A0424 / 非法月份 A0400）。
 */
describe("buildCalendarViewDays（聚合纯函数）", () => {
  /** 2026-10：31 天；10-01 为周四 */
  const range = parseCalendarMonthRange("2026-10")!;
  const weekly = {
    mon: [["09:00", "18:00"]],
    tue: [],
    wed: [
      ["09:00", "12:00"],
      ["13:00", "18:00"],
    ],
    thu: [],
    fri: [["09:00", "21:00"]],
    sat: [["08:00", "20:00"]],
    sun: [],
  };

  it("例外日优先：type=3 特殊营业覆盖周时段（openTime/closeTime 生效）", () => {
    const days = buildCalendarViewDays(range, weekly, [
      { date: new Date(Date.UTC(2026, 9, 1)), type: 3, openTime: "10:00", closeTime: "16:00" },
    ]);
    expect(days).toHaveLength(31);
    // 10-01（周四，周时段本为闭店）→ 例外日特殊营业
    expect(days[0]).toEqual({
      date: "2026-10-01",
      open: true,
      source: "calendar",
      periods: [["10:00", "16:00"]],
      calendarType: 3,
    });
  });

  it("例外日优先：type=1 节假日闭店 + type=2 临时闭店（open=false，calendarType 透传）", () => {
    const days = buildCalendarViewDays(range, weekly, [
      { date: new Date(Date.UTC(2026, 9, 5)), type: 1, openTime: null, closeTime: null }, // 周一
      { date: new Date(Date.UTC(2026, 9, 6)), type: 2, openTime: null, closeTime: null }, // 周二
    ]);
    // 10-05 本是周一（周时段营业）→ 例外日闭店优先
    expect(days[4]).toEqual({
      date: "2026-10-05",
      open: false,
      source: "calendar",
      periods: [],
      calendarType: 1,
    });
    expect(days[5]).toEqual({
      date: "2026-10-06",
      open: false,
      source: "calendar",
      periods: [],
      calendarType: 2,
    });
  });

  it("无例外日回落周时段：周一营业 / 周二闭店 / 周六营业（getUTCDay 键位映射）", () => {
    const days = buildCalendarViewDays(range, weekly, []);
    // 2026-10-05（周一）、10-06（周二）、10-03（周六）
    expect(days[4]).toEqual({
      date: "2026-10-05",
      open: true,
      source: "weekly",
      periods: [["09:00", "18:00"]],
    });
    expect(days[5]).toEqual({
      date: "2026-10-06",
      open: false,
      source: "weekly",
      periods: [],
    });
    expect(days[2]).toEqual({
      date: "2026-10-03",
      open: true,
      source: "weekly",
      periods: [["08:00", "20:00"]],
    });
    // 多段周时段原样透传（10-07 周三）
    expect(days[6]).toEqual({
      date: "2026-10-07",
      open: true,
      source: "weekly",
      periods: [
        ["09:00", "12:00"],
        ["13:00", "18:00"],
      ],
    });
  });

  it("type=3 时刻脏数据（缺失/逆序）→ fail-safe 闭店，不透传非法时段", () => {
    const days = buildCalendarViewDays(range, weekly, [
      { date: new Date(Date.UTC(2026, 9, 10)), type: 3, openTime: null, closeTime: null },
      { date: new Date(Date.UTC(2026, 9, 11)), type: 3, openTime: "18:00", closeTime: "09:00" },
    ]);
    expect(days[9]).toMatchObject({ date: "2026-10-10", open: false, calendarType: 3 });
    expect(days[10]).toMatchObject({ date: "2026-10-11", open: false, calendarType: 3 });
  });

  it("周时段脏数据（时刻非法）→ 段级丢弃（fail-safe 读取口径）", () => {
    const dirtyWeekly = {
      mon: [
        ["25:00", "26:00"],
        ["09:00", "18:00"],
      ], // 首段非法，丢弃
      tue: [],
      wed: [],
      thu: [],
      fri: [],
      sat: [],
      sun: [],
    };
    const days = buildCalendarViewDays(range, dirtyWeekly, []);
    // 10-05 周一：非法段被丢弃后仍有合法段 → 营业
    expect(days[4]).toMatchObject({ open: true, periods: [["09:00", "18:00"]] });
    // 全天段均非法 → 闭店（10-12 周一，mon 只剩合法段已验证；改验全非法日）
    const allDirty = { ...dirtyWeekly, mon: [["abc", "def"]] };
    const days2 = buildCalendarViewDays(range, allDirty, []);
    expect(days2[4]).toMatchObject({ date: "2026-10-05", open: false, periods: [] });
  });

  it("formatUtcDate：UTC 分量逐字段格式化（不受进程时区影响）", () => {
    expect(formatUtcDate(new Date(Date.UTC(2026, 9, 1)))).toBe("2026-10-01");
    expect(formatUtcDate(new Date(Date.UTC(2026, 0, 5)))).toBe("2026-01-05");
  });
});

describe("StoreCalendarViewService（P0-04-07 日历视图）", () => {
  const storeDelegate = { findFirst: jest.fn() };

  const calendarDelegate = { findMany: jest.fn() };

  const prismaMock = {
    scoped: { store: storeDelegate, storeCalendar: calendarDelegate },
  } as unknown as PrismaService;
  let service: StoreCalendarViewService;

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
    jest.clearAllMocks();
    service = new StoreCalendarViewService(prismaMock);
  });

  it("正常聚合：读门店 businessHours + 按月例外日，days 逐日齐全", async () => {
    storeDelegate.findFirst.mockResolvedValueOnce({
      id: "uuid-1",
      businessHours: { mon: [["09:00", "18:00"]] },
    });
    calendarDelegate.findMany.mockResolvedValueOnce([
      { date: new Date(Date.UTC(2026, 9, 15)), type: 1, openTime: null, closeTime: null },
    ]);

    const result = await withContext(() => service.getCalendarView("uuid-1", "2026-10"));

    expect(result.storeId).toBe("uuid-1");
    expect(result.month).toBe("2026-10");
    expect(result.days).toHaveLength(31);
    // 例外日优先
    expect(result.days[14]).toMatchObject({
      date: "2026-10-15",
      open: false,
      source: "calendar",
      calendarType: 1,
    });
    // 查询区间：UTC 午夜闭开 [2026-10-01, 2026-11-01)
    const args = calendarDelegate.findMany.mock.calls[0][0];
    expect(args.where.date).toEqual({
      gte: new Date(Date.UTC(2026, 9, 1)),
      lt: new Date(Date.UTC(2026, 10, 1)),
    });
  });

  it("门店不存在（含他租户/已软删）→ A0424", async () => {
    storeDelegate.findFirst.mockResolvedValueOnce(null);
    await expectBusinessError(
      withContext(() => service.getCalendarView("00000000-0000-4000-8000-000000000000", "2026-10")),
      "A0424"
    );
    expect(calendarDelegate.findMany).not.toHaveBeenCalled();
  });

  it("非法月份（绕过 ValidationPipe 直调兜底）→ A0400", async () => {
    storeDelegate.findFirst.mockResolvedValueOnce({ id: "uuid-1", businessHours: {} });
    await expectBusinessError(
      withContext(() => service.getCalendarView("uuid-1", "2026-13")),
      "A0400"
    );
    expect(calendarDelegate.findMany).not.toHaveBeenCalled();
  });
});
