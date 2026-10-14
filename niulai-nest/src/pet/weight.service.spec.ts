import "reflect-metadata";

import type { PrismaService } from "../common/prisma/prisma.service";
import { RequestContext } from "../common/context/request-context";
import { BusinessException } from "../common/exceptions/business.exception";

import { WeightService } from "./weight.service";
import type { CreateWeightDto } from "./dto/create-weight.dto";
import type { QueryWeightCurveDto } from "./dto/query-weight-curve.dto";

/**
 * 体重曲线服务单测（P0-06-04 · FR-3）
 *
 * 覆盖：记录体重（落库 + pet.weightKg 快照同步为「最新称重」+ 时间线事件 + A0601）/
 * 曲线排序（weighedAt 时间序列 asc 默认、desc 可选、limit 收敛、pet 快照回显）/
 * 软删（重算快照 + A0607）/ 时间线写入失败不阻断主流程。
 */
describe("WeightService（P0-06-04 体重曲线）", () => {
  const weightDelegate = {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  };
  const petDelegate = { findFirst: jest.fn(), update: jest.fn() };
  const timelineDelegate = { create: jest.fn() };

  const prismaMock = {
    scoped: { pet: petDelegate, weight: weightDelegate, timelineEvent: timelineDelegate },
  } as unknown as PrismaService;

  let service: WeightService;

  const PET_ID = "33333333-3333-4333-8333-333333333333";
  const RECORD_ID = "44444444-4444-4444-8444-444444444444";

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
    service = new WeightService(prismaMock);
  });

  // ── 记录体重 ─────────────────────────────────────────

  it("记录体重：落库 + pet 快照同步为最新称重 + 写时间线事件(eventType 6)", async () => {
    petDelegate.findFirst.mockResolvedValueOnce({ id: PET_ID });
    weightDelegate.create.mockResolvedValueOnce({
      id: RECORD_ID,
      weightKg: "12.50",
      weighedAt: new Date("2025-03-01T00:00:00.000Z"),
      createdAt: new Date("2025-03-01T00:00:00.000Z"),
    });
    weightDelegate.findFirst
      .mockResolvedValueOnce(null) // BR-4 上次记录（本次为首条）
      .mockResolvedValueOnce({ id: RECORD_ID, weightKg: "12.50" }); // 最新称重快照
    petDelegate.update.mockResolvedValueOnce({ id: PET_ID });
    timelineDelegate.create.mockResolvedValueOnce({});

    const result = await withContext(() =>
      service.createWeight(PET_ID, {
        weighedAt: "2025-03-01",
        weightKg: "12.50",
      } as CreateWeightDto)
    );

    // 体重行：tenantId / weighedAt DATE / weightKg 字符串透传
    const createArgs = weightDelegate.create.mock.calls[0][0];
    expect(createArgs.data.tenantId).toBe(BigInt("1"));
    expect(createArgs.data.petId).toBe(PET_ID);
    expect(createArgs.data.weighedAt).toEqual(new Date("2025-03-01T00:00:00.000Z"));
    expect(createArgs.data.weightKg).toBe("12.50");

    // pet 快照回写为最新称重
    const petArgs = petDelegate.update.mock.calls[0][0];
    expect(petArgs.where).toEqual({ id: PET_ID });
    expect(petArgs.data.weightKg).toBe("12.50");

    // 时间线事件：eventType 6，带 tenantId
    const tlArgs = timelineDelegate.create.mock.calls[0][0];
    expect(tlArgs.data.eventType).toBe(6);
    expect(tlArgs.data.tenantId).toBe(BigInt("1"));

    expect(result.petWeightKg).toBe("12.50");
    // 首条记录无上次基准 ⇒ 无环比、不预警
    expect(result.previousWeightKg).toBeNull();
    expect(result.deltaPercent).toBeNull();
    expect(result.deltaAlert).toBe(false);
  });

  it("记录体重：BR-4 环比 —— 上次 10.00 → 本次 12.50（+25%）触发预警", async () => {
    petDelegate.findFirst.mockResolvedValueOnce({ id: PET_ID });
    weightDelegate.create.mockResolvedValueOnce({
      id: RECORD_ID,
      weightKg: "12.50",
      weighedAt: new Date("2025-03-01T00:00:00.000Z"),
      createdAt: new Date("2025-03-01T00:00:00.000Z"),
    });
    weightDelegate.findFirst
      .mockResolvedValueOnce({ weightKg: "10.00" }) // 上次记录
      .mockResolvedValueOnce({ id: RECORD_ID, weightKg: "12.50" }); // 最新称重快照
    petDelegate.update.mockResolvedValueOnce({ id: PET_ID });
    timelineDelegate.create.mockResolvedValueOnce({});

    const result = await withContext(() =>
      service.createWeight(PET_ID, {
        weighedAt: "2025-03-01",
        weightKg: "12.50",
      } as CreateWeightDto)
    );

    // 「上次记录」查询：称重日严格早于本次（同日再以 createdAt 兜底）
    const prevArgs = weightDelegate.findFirst.mock.calls[0][0];
    expect(prevArgs.where.petId).toBe(PET_ID);
    expect(prevArgs.where.deletedAt).toBeNull();
    expect(prevArgs.where.OR).toEqual([
      { weighedAt: { lt: new Date("2025-03-01T00:00:00.000Z") } },
      {
        weighedAt: new Date("2025-03-01T00:00:00.000Z"),
        createdAt: { lt: new Date("2025-03-01T00:00:00.000Z") },
      },
    ]);
    expect(prevArgs.orderBy).toEqual([{ weighedAt: "desc" }, { createdAt: "desc" }]);

    expect(result.previousWeightKg).toBe("10.00");
    expect(result.deltaPercent).toBe(25);
    expect(result.deltaAlert).toBe(true);
  });

  it("记录体重：BR-4 环比恰为 +15% ⇒ 不触发（严格大于阈值）", async () => {
    petDelegate.findFirst.mockResolvedValueOnce({ id: PET_ID });
    weightDelegate.create.mockResolvedValueOnce({
      id: RECORD_ID,
      weightKg: "11.50",
      weighedAt: new Date("2025-03-01T00:00:00.000Z"),
      createdAt: new Date("2025-03-01T00:00:00.000Z"),
    });
    weightDelegate.findFirst
      .mockResolvedValueOnce({ weightKg: "10.00" })
      .mockResolvedValueOnce({ id: RECORD_ID, weightKg: "11.50" });
    petDelegate.update.mockResolvedValueOnce({ id: PET_ID });
    timelineDelegate.create.mockResolvedValueOnce({});

    const result = await withContext(() =>
      service.createWeight(PET_ID, {
        weighedAt: "2025-03-01",
        weightKg: "11.50",
      } as CreateWeightDto)
    );

    expect(result.deltaPercent).toBe(15);
    expect(result.deltaAlert).toBe(false);
  });

  it("记录体重：补录历史体重时快照取「最新称重」而非最后插入", async () => {
    petDelegate.findFirst.mockResolvedValueOnce({ id: PET_ID });
    weightDelegate.create.mockResolvedValueOnce({
      id: RECORD_ID,
      weightKg: "5.00",
      weighedAt: new Date("2024-01-01T00:00:00.000Z"),
      createdAt: new Date("2025-06-01T00:00:00.000Z"),
    });
    weightDelegate.findFirst
      .mockResolvedValueOnce(null) // 补录的更早一条之前没有记录
      .mockResolvedValueOnce({ id: "newest", weightKg: "9.90" }); // 最新称重仍是 9.90
    petDelegate.update.mockResolvedValueOnce({ id: PET_ID });
    timelineDelegate.create.mockResolvedValueOnce({});

    const result = await withContext(() =>
      service.createWeight(PET_ID, { weighedAt: "2024-01-01", weightKg: "5.00" } as CreateWeightDto)
    );

    expect(petDelegate.update.mock.calls[0][0].data.weightKg).toBe("9.90");
    expect(result.petWeightKg).toBe("9.90");
  });

  it("记录体重：宠物不存在 → A0601，不落库", async () => {
    petDelegate.findFirst.mockResolvedValueOnce(null);

    await expectBusinessError(
      withContext(() =>
        service.createWeight(PET_ID, {
          weighedAt: "2025-03-01",
          weightKg: "1.00",
        } as CreateWeightDto)
      ),
      "A0601"
    );
    expect(weightDelegate.create).not.toHaveBeenCalled();
  });

  it("记录体重：时间线写入失败不阻断主流程（体重已落库）", async () => {
    petDelegate.findFirst.mockResolvedValueOnce({ id: PET_ID });
    weightDelegate.create.mockResolvedValueOnce({
      id: RECORD_ID,
      weightKg: "7.00",
      weighedAt: new Date("2025-03-01T00:00:00.000Z"),
      createdAt: new Date("2025-03-01T00:00:00.000Z"),
    });
    weightDelegate.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: RECORD_ID, weightKg: "7.00" });
    petDelegate.update.mockResolvedValueOnce({ id: PET_ID });
    timelineDelegate.create.mockRejectedValueOnce(new Error("分区缺失"));

    const result = await withContext(() =>
      service.createWeight(PET_ID, { weighedAt: "2025-03-01", weightKg: "7.00" } as CreateWeightDto)
    );

    expect(result.petWeightKg).toBe("7.00");
  });

  // ── 曲线 ─────────────────────────────────────────────

  it("曲线：默认按 weighedAt asc 排序，返回 pet 快照", async () => {
    petDelegate.findFirst.mockResolvedValueOnce({ id: PET_ID, weightKg: "12.50" });
    weightDelegate.findMany.mockResolvedValueOnce([
      { id: "a", weighedAt: new Date("2025-01-01T00:00:00.000Z"), weightKg: "10.00" },
      { id: "b", weighedAt: new Date("2025-02-01T00:00:00.000Z"), weightKg: "11.00" },
      { id: "c", weighedAt: new Date("2025-03-01T00:00:00.000Z"), weightKg: "12.50" },
    ]);

    const result = await withContext(() =>
      service.getWeightCurve(PET_ID, {} as QueryWeightCurveDto)
    );

    expect(result.order).toBe("asc");
    expect(result.weightKg).toBe("12.50");
    expect(result.points.map((p) => p.id)).toEqual(["a", "b", "c"]);
    const args = weightDelegate.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual([{ weighedAt: "asc" }, { createdAt: "asc" }]);
    expect(args.where).toEqual({ petId: PET_ID, deletedAt: null });
  });

  it("曲线：order=desc 反转方向；limit 超上限收敛；区间端点进入 where", async () => {
    petDelegate.findFirst.mockResolvedValueOnce({ id: PET_ID, weightKg: null });
    weightDelegate.findMany.mockResolvedValueOnce([]);

    await withContext(() =>
      service.getWeightCurve(PET_ID, {
        order: "DESC",
        limit: 9999,
        from: "2025-01-01",
        to: "2025-12-31",
      } as QueryWeightCurveDto)
    );

    const args = weightDelegate.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual([{ weighedAt: "desc" }, { createdAt: "desc" }]);
    expect(args.take).toBe(500);
    expect(args.where.weighedAt).toEqual({
      gte: new Date("2025-01-01T00:00:00.000Z"),
      lte: new Date("2025-12-31T00:00:00.000Z"),
    });
  });

  it("曲线：宠物不存在 → A0601", async () => {
    petDelegate.findFirst.mockResolvedValueOnce(null);
    await expectBusinessError(
      withContext(() => service.getWeightCurve(PET_ID, {} as QueryWeightCurveDto)),
      "A0601"
    );
    expect(weightDelegate.findMany).not.toHaveBeenCalled();
  });

  it("曲线：逐点环比 —— 升序序列 |环比| > 15% 的点标记 deltaAlert，alertCount 计数", async () => {
    petDelegate.findFirst.mockResolvedValueOnce({ id: PET_ID, weightKg: "17.00" });
    const day = (d: string, t: string) => ({
      weighedAt: new Date(`${d}T00:00:00.000Z`),
      createdAt: new Date(`${t}T00:00:00.000Z`),
    });
    weightDelegate.findMany.mockResolvedValueOnce([
      { id: "a", weightKg: "10.00", ...day("2025-01-01", "2025-01-01") },
      { id: "b", weightKg: "12.00", ...day("2025-02-01", "2025-02-01") }, // +20.0% → 预警
      { id: "c", weightKg: "11.00", ...day("2025-03-01", "2025-03-01") }, // -8.3%  → 不预警
      { id: "d", weightKg: "17.00", ...day("2025-04-01", "2025-04-01") }, // +54.5% → 预警
    ]);

    const result = await withContext(() =>
      service.getWeightCurve(PET_ID, {} as QueryWeightCurveDto)
    );

    expect(result.points.map((p) => [p.id, p.deltaPercent, p.deltaAlert])).toEqual([
      ["a", null, false],
      ["b", 20, true],
      ["c", -8.3, false],
      ["d", 54.5, true],
    ]);
    expect(result.alertCount).toBe(2);
    expect(result.total).toBe(4);
  });

  it("曲线：order=desc 时环比仍按升序语义计算（不因反向而符号颠倒）", async () => {
    petDelegate.findFirst.mockResolvedValueOnce({ id: PET_ID, weightKg: "17.00" });
    const day = (d: string, t: string) => ({
      weighedAt: new Date(`${d}T00:00:00.000Z`),
      createdAt: new Date(`${t}T00:00:00.000Z`),
    });
    // DB 按 desc 返回：最新在前
    weightDelegate.findMany.mockResolvedValueOnce([
      { id: "d", weightKg: "17.00", ...day("2025-04-01", "2025-04-01") },
      { id: "c", weightKg: "11.00", ...day("2025-03-01", "2025-03-01") },
      { id: "b", weightKg: "12.00", ...day("2025-02-01", "2025-02-01") },
      { id: "a", weightKg: "10.00", ...day("2025-01-01", "2025-01-01") },
    ]);

    const result = await withContext(() =>
      service.getWeightCurve(PET_ID, { order: "desc" } as QueryWeightCurveDto)
    );

    expect(result.order).toBe("desc");
    // 输出顺序 = 请求顺序（desc），但每点环比 = 「相对其时间上前一条」
    expect(result.points.map((p) => [p.id, p.deltaPercent])).toEqual([
      ["d", 54.5],
      ["c", -8.3],
      ["b", 20],
      ["a", null],
    ]);
    expect(result.alertCount).toBe(2);
  });

  it("曲线：空序列 ⇒ 空 points / alertCount=0", async () => {
    petDelegate.findFirst.mockResolvedValueOnce({ id: PET_ID, weightKg: null });
    weightDelegate.findMany.mockResolvedValueOnce([]);

    const result = await withContext(() =>
      service.getWeightCurve(PET_ID, {} as QueryWeightCurveDto)
    );

    expect(result.points).toEqual([]);
    expect(result.alertCount).toBe(0);
    expect(result.total).toBe(0);
  });

  // ── BR-4 纯函数边界 ──────────────────────────────────

  it("computeWeightDeltaPercent：null/0/非法基准 → null；正常值四舍五入 1 位小数", () => {
    expect(WeightService.computeWeightDeltaPercent(null, "10.00")).toBeNull();
    expect(WeightService.computeWeightDeltaPercent("0", "10.00")).toBeNull();
    expect(WeightService.computeWeightDeltaPercent("abc", "10.00")).toBeNull();
    expect(WeightService.computeWeightDeltaPercent("10.00", "abc")).toBeNull();
    expect(WeightService.computeWeightDeltaPercent("10.00", "12.50")).toBe(25);
    expect(WeightService.computeWeightDeltaPercent("11.00", "10.00")).toBe(-9.1);
    expect(WeightService.computeWeightDeltaPercent("3.00", "10.00")).toBe(233.3);
  });

  it("isWeightDeltaAlert：严格大于 15%（恰好 15 与 null 均不预警，± 对称）", () => {
    expect(WeightService.isWeightDeltaAlert(null)).toBe(false);
    expect(WeightService.isWeightDeltaAlert(15)).toBe(false);
    expect(WeightService.isWeightDeltaAlert(-15)).toBe(false);
    expect(WeightService.isWeightDeltaAlert(15.1)).toBe(true);
    expect(WeightService.isWeightDeltaAlert(-15.1)).toBe(true);
  });

  // ── 软删 ─────────────────────────────────────────────

  it("软删：置 deletedAt 并重算 pet 快照；返回 true", async () => {
    petDelegate.findFirst.mockResolvedValueOnce({ id: PET_ID });
    weightDelegate.findFirst
      .mockResolvedValueOnce({ id: RECORD_ID }) // 存在校验
      .mockResolvedValueOnce({ id: "prev", weightKg: "11.00" }); // 重算后的最新称重
    weightDelegate.update.mockResolvedValueOnce({ id: RECORD_ID });
    petDelegate.update.mockResolvedValueOnce({ id: PET_ID });

    const result = await withContext(() => service.deleteWeight(PET_ID, RECORD_ID));

    expect(result).toBe(true);
    expect(weightDelegate.update.mock.calls[0][0].data.deletedAt).toBeTruthy();
    expect(petDelegate.update.mock.calls[0][0].data.weightKg).toBe("11.00");
  });

  it("软删：记录不存在 → A0607", async () => {
    petDelegate.findFirst.mockResolvedValueOnce({ id: PET_ID });
    weightDelegate.findFirst.mockResolvedValueOnce(null);

    await expectBusinessError(
      withContext(() => service.deleteWeight(PET_ID, RECORD_ID)),
      "A0607"
    );
    expect(weightDelegate.update).not.toHaveBeenCalled();
  });
});
