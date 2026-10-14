import {
  APP_TIME_ZONE,
  addDays,
  endOfDay,
  enumerateDays,
  formatDateTimeInZone,
  getAppTimeZone,
  parseWallClock,
  startOfDay,
  toDayString,
} from "./date.util";

/**
 * 这些用例全部显式传入时区，因此**不依赖运行机器的进程时区**，
 * 在 UTC 机器与东八区机器上结果一致。
 */
describe("date.util（时区感知日期工具）", () => {
  describe("parseWallClock", () => {
    it("把日期字符串按指定时区解释为瞬时", () => {
      expect(parseWallClock("2025-01-01", "Asia/Shanghai")?.toISOString()).toBe(
        "2024-12-31T16:00:00.000Z"
      );
      expect(parseWallClock("2025-01-01", "UTC")?.toISOString()).toBe("2025-01-01T00:00:00.000Z");
    });

    it("把日期时间字符串按指定时区解释为瞬时", () => {
      expect(parseWallClock("2025-01-01 12:00:00", "Asia/Shanghai")?.toISOString()).toBe(
        "2025-01-01T04:00:00.000Z"
      );
      expect(parseWallClock("2025-01-01 12:00:00", "UTC")?.toISOString()).toBe(
        "2025-01-01T12:00:00.000Z"
      );
      // 同时接受 ISO 的 T 分隔写法
      expect(parseWallClock("2025-01-01T12:00:00", "Asia/Shanghai")?.toISOString()).toBe(
        "2025-01-01T04:00:00.000Z"
      );
    });

    it("正确处理夏令时地区（纽约冬令时 -05:00 / 夏令时 -04:00）", () => {
      expect(parseWallClock("2025-01-15 12:00:00", "America/New_York")?.toISOString()).toBe(
        "2025-01-15T17:00:00.000Z"
      );
      expect(parseWallClock("2025-07-15 12:00:00", "America/New_York")?.toISOString()).toBe(
        "2025-07-15T16:00:00.000Z"
      );
    });

    it("已带时区标记的字符串不受 timeZone 参数影响", () => {
      const withOffset = parseWallClock("2025-01-01T12:00:00+08:00", "UTC");
      const withZ = parseWallClock("2025-01-01T04:00:00Z", "Asia/Shanghai");
      expect(withOffset?.toISOString()).toBe("2025-01-01T04:00:00.000Z");
      expect(withZ?.toISOString()).toBe("2025-01-01T04:00:00.000Z");
    });

    it("Date 实例原样返回，非法输入返回 null", () => {
      const date = new Date("2025-01-01T00:00:00.000Z");
      expect(parseWallClock(date)).toBe(date);
      expect(parseWallClock(new Date("invalid"))).toBeNull();
      expect(parseWallClock("")).toBeNull();
      expect(parseWallClock(null)).toBeNull();
      expect(parseWallClock(undefined)).toBeNull();
      expect(parseWallClock("不是日期")).toBeNull();
    });
  });

  describe("startOfDay / endOfDay", () => {
    it("取北京自然日的首尾瞬时", () => {
      expect(startOfDay("2025-01-01", "Asia/Shanghai")?.toISOString()).toBe(
        "2024-12-31T16:00:00.000Z"
      );
      expect(endOfDay("2025-01-01", "Asia/Shanghai")?.toISOString()).toBe(
        "2025-01-01T15:59:59.999Z"
      );
    });

    it("传入带时间的值时，仍归到该自然日的首尾", () => {
      expect(startOfDay("2025-01-01 18:30:00", "Asia/Shanghai")?.toISOString()).toBe(
        "2024-12-31T16:00:00.000Z"
      );
      expect(endOfDay("2025-01-01 18:30:00", "Asia/Shanghai")?.toISOString()).toBe(
        "2025-01-01T15:59:59.999Z"
      );
    });

    it("非法输入返回 null", () => {
      expect(startOfDay("", "Asia/Shanghai")).toBeNull();
      expect(endOfDay("不是日期", "Asia/Shanghai")).toBeNull();
    });
  });

  describe("toDayString（日界归属）", () => {
    it("同一瞬时在不同时区归属不同自然日", () => {
      // UTC 2024-12-31 20:00 = 北京 2025-01-01 04:00
      const instant = new Date("2024-12-31T20:00:00.000Z");
      expect(toDayString(instant, "Asia/Shanghai")).toBe("2025-01-01");
      expect(toDayString(instant, "UTC")).toBe("2024-12-31");
    });

    it("北京时间 07:00 不会被误归到前一天（日界陷阱样本）", () => {
      // 北京 2025-01-01 07:00 = UTC 2024-12-31 23:00
      const instant = new Date("2025-01-01T07:00:00+08:00");
      expect(instant.toISOString()).toBe("2024-12-31T23:00:00.000Z");
      expect(toDayString(instant, "Asia/Shanghai")).toBe("2025-01-01");
    });
  });

  describe("addDays / enumerateDays", () => {
    it("按日历天推进，正确处理跨月与闰年", () => {
      expect(addDays("2025-01-31", 1)).toBe("2025-02-01");
      expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
      expect(addDays("2023-02-28", 1)).toBe("2023-03-01");
      expect(addDays("2025-01-01", -1)).toBe("2024-12-31");
      expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
    });

    it("生成闭区间日期序列", () => {
      expect(enumerateDays("2025-01-01", "2025-01-03")).toEqual([
        "2025-01-01",
        "2025-01-02",
        "2025-01-03",
      ]);
      expect(enumerateDays("2025-01-01", "2025-01-01")).toEqual(["2025-01-01"]);
      expect(enumerateDays("2025-01-03", "2025-01-01")).toEqual([]);
    });

    it("超过 maxDays 保护上限时停止，避免非法区间把服务拖死", () => {
      expect(enumerateDays("2025-01-01", "2030-01-01", 10)).toHaveLength(10);
    });
  });

  describe("formatDateTimeInZone", () => {
    it("按指定时区格式化，空值返回 null", () => {
      const instant = new Date("2025-01-01T04:00:00.000Z");
      expect(formatDateTimeInZone(instant, "Asia/Shanghai")).toBe("2025-01-01 12:00:00");
      expect(formatDateTimeInZone(instant, "UTC")).toBe("2025-01-01 04:00:00");
      expect(formatDateTimeInZone(null)).toBeNull();
      expect(formatDateTimeInZone(undefined)).toBeNull();
    });
  });

  describe("getAppTimeZone", () => {
    const original = process.env.TIME_ZONE;

    afterEach(() => {
      if (original === undefined) delete process.env.TIME_ZONE;
      else process.env.TIME_ZONE = original;
    });

    it("默认返回北京时间", () => {
      delete process.env.TIME_ZONE;
      expect(getAppTimeZone()).toBe(APP_TIME_ZONE);
      expect(getAppTimeZone()).toBe("Asia/Shanghai");
    });

    it("可被环境变量覆盖，且忽略空白值", () => {
      process.env.TIME_ZONE = "UTC";
      expect(getAppTimeZone()).toBe("UTC");
      process.env.TIME_ZONE = "   ";
      expect(getAppTimeZone()).toBe(APP_TIME_ZONE);
    });
  });
});
