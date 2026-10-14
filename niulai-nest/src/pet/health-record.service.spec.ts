import "reflect-metadata";

import type { PrismaService } from "../common/prisma/prisma.service";
import { RequestContext } from "../common/context/request-context";
import { BusinessException } from "../common/exceptions/business.exception";
import { parseWallClock, toDayString } from "../common/utils/date.util";

import { HealthRecordService } from "./health-record.service";
import type { CreateHealthRecordDto } from "./dto/create-health-record.dto";
import type { UpdateHealthRecordDto } from "./dto/update-health-record.dto";
import type { QueryHealthRecordDto } from "./dto/query-health-record.dto";

/**
 * 健康档案服务单测（P0-06-03 · FR-2）
 *
 * 覆盖：建档（日期 DATE 口径转换 + 上下文注入 + 宠物归属 A0601 + 日期顺序 A0608）/
 * 列表（recordType/区间筛选 + 分页结构 + 排序）/ 更正（乐观锁 where + 冲突 A0609 +
 * 缺失 A0606）/ 软删（置位 + 缺失 A0606）/ 有效性判定（取最近记录 + 有效期内 Y/N +
 * 剩余天数）。PrismaService 全 mock，经 RequestContext.run 提供 ALS 上下文。
 */
describe("HealthRecordService（P0-06-03 健康档案）", () => {
  const healthRecordDelegate = {
    create: jest.fn(),
    findFirst: jest.fn(),
    findFirstOrThrow: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  };
  const petDelegate = { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() };
  const customerDelegate = { findMany: jest.fn() };
  const storeDelegate = { findMany: jest.fn() };

  const prismaMock = {
    scoped: {
      pet: petDelegate,
      healthRecord: healthRecordDelegate,
      customer: customerDelegate,
      store: storeDelegate,
    },
  } as unknown as PrismaService;

  let service: HealthRecordService;

  const PET_ID = "11111111-1111-4111-8111-111111111111";
  const RECORD_ID = "22222222-2222-4222-8222-222222222222";

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
    service = new HealthRecordService(prismaMock);
  });

  // ── 建档 ─────────────────────────────────────────────

  it("建档：注入 tenantId/createdBy/updatedBy，日期按 UTC 午夜瞬时承载", async () => {
    petDelegate.findFirst.mockResolvedValueOnce({ id: PET_ID });
    healthRecordDelegate.create.mockResolvedValueOnce({ id: RECORD_ID });

    await withContext(() =>
      service.createRecord(PET_ID, {
        recordType: 1,
        recordDate: "2025-01-10",
        expireDate: "2026-01-10",
        content: "狂犬疫苗",
      } as CreateHealthRecordDto)
    );

    const args = healthRecordDelegate.create.mock.calls[0][0];
    expect(args.data.tenantId).toBe(BigInt("1"));
    expect(args.data.petId).toBe(PET_ID);
    expect(args.data.recordType).toBe(1);
    expect(args.data.recordDate).toEqual(new Date("2025-01-10T00:00:00.000Z"));
    expect(args.data.expireDate).toEqual(new Date("2026-01-10T00:00:00.000Z"));
    expect(args.data.createdBy).toBe(BigInt("1"));
    expect(args.data.updatedBy).toBe(BigInt("1"));
    expect(args.data.operatorId).toBe(BigInt("1")); // 缺省取当前登录用户
  });

  it("建档：宠物不存在（含已软删/跨租户）→ A0601，不落库", async () => {
    petDelegate.findFirst.mockResolvedValueOnce(null);

    await expectBusinessError(
      withContext(() =>
        service.createRecord(PET_ID, {
          recordType: 1,
          recordDate: "2025-01-10",
        } as CreateHealthRecordDto)
      ),
      "A0601"
    );
    expect(healthRecordDelegate.create).not.toHaveBeenCalled();
  });

  it("建档：到期日早于记录日 → A0608", async () => {
    petDelegate.findFirst.mockResolvedValueOnce({ id: PET_ID });

    await expectBusinessError(
      withContext(() =>
        service.createRecord(PET_ID, {
          recordType: 2,
          recordDate: "2025-06-01",
          expireDate: "2025-05-01",
        } as CreateHealthRecordDto)
      ),
      "A0608"
    );
    expect(healthRecordDelegate.create).not.toHaveBeenCalled();
  });

  // ── 列表 ─────────────────────────────────────────────

  it("列表：recordType 精确 + recordDate 区间进入 where，返回 data+page，默认倒序", async () => {
    petDelegate.findFirst.mockResolvedValueOnce({ id: PET_ID });
    healthRecordDelegate.findMany.mockResolvedValueOnce([{ id: RECORD_ID }]);
    healthRecordDelegate.count.mockResolvedValueOnce(1);

    const result = await withContext(() =>
      service.listRecords(PET_ID, {
        recordType: 1,
        from: "2025-01-01",
        to: "2025-12-31",
        pageNum: 1,
        pageSize: 20,
      } as QueryHealthRecordDto)
    );

    expect(result.page).toEqual({ pageNum: 1, pageSize: 20, total: 1 });
    const args = healthRecordDelegate.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({
      petId: PET_ID,
      deletedAt: null,
      recordType: 1,
    });
    expect(args.where.recordDate).toEqual({
      gte: new Date("2025-01-01T00:00:00.000Z"),
      lte: new Date("2025-12-31T00:00:00.000Z"),
    });
    expect(args.orderBy).toEqual([{ recordDate: "desc" }, { createdAt: "desc" }]);
  });

  it("列表：petId 无归属 → A0601", async () => {
    petDelegate.findFirst.mockResolvedValueOnce(null);
    await expectBusinessError(
      withContext(() => service.listRecords(PET_ID, {} as QueryHealthRecordDto)),
      "A0601"
    );
    expect(healthRecordDelegate.findMany).not.toHaveBeenCalled();
  });

  // ── 更正 ─────────────────────────────────────────────

  it("更正：乐观锁 where 含 version，version 自增，updatedBy 注入", async () => {
    petDelegate.findFirst.mockResolvedValueOnce({ id: PET_ID });
    healthRecordDelegate.findFirst.mockResolvedValueOnce({
      id: RECORD_ID,
      recordDate: new Date("2025-01-10T00:00:00.000Z"),
      expireDate: new Date("2026-01-10T00:00:00.000Z"),
    });
    healthRecordDelegate.update.mockResolvedValueOnce({ id: RECORD_ID });
    healthRecordDelegate.findFirstOrThrow.mockResolvedValueOnce({ id: RECORD_ID });

    await withContext(() =>
      service.updateRecord(PET_ID, RECORD_ID, {
        version: 0,
        content: "更正批号",
      } as UpdateHealthRecordDto)
    );

    const args = healthRecordDelegate.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: RECORD_ID, petId: PET_ID, version: 0, deletedAt: null });
    expect(args.data.version).toEqual({ increment: 1 });
    expect(args.data.content).toBe("更正批号");
    expect(args.data.updatedBy).toBe(BigInt("1"));
  });

  it("更正：记录不存在（回读 null）→ A0606", async () => {
    petDelegate.findFirst.mockResolvedValueOnce({ id: PET_ID });
    healthRecordDelegate.findFirst.mockResolvedValueOnce(null);

    await expectBusinessError(
      withContext(() =>
        service.updateRecord(PET_ID, RECORD_ID, { version: 0 } as UpdateHealthRecordDto)
      ),
      "A0606"
    );
    expect(healthRecordDelegate.update).not.toHaveBeenCalled();
  });

  it("更正：版本冲突（P2025 且记录存在）→ A0609", async () => {
    petDelegate.findFirst.mockResolvedValueOnce({ id: PET_ID });
    healthRecordDelegate.findFirst
      .mockResolvedValueOnce({ id: RECORD_ID, recordDate: new Date(), expireDate: null }) // 回读现有
      .mockResolvedValueOnce({ id: RECORD_ID }); // P2025 后回查存在
    healthRecordDelegate.update.mockRejectedValueOnce({ code: "P2025" });

    await expectBusinessError(
      withContext(() =>
        service.updateRecord(PET_ID, RECORD_ID, { version: 5 } as UpdateHealthRecordDto)
      ),
      "A0609"
    );
  });

  // ── 软删 ─────────────────────────────────────────────

  it("软删：置 deletedAt + updatedBy，返回 true", async () => {
    petDelegate.findFirst.mockResolvedValueOnce({ id: PET_ID });
    healthRecordDelegate.findFirst.mockResolvedValueOnce({ id: RECORD_ID });
    healthRecordDelegate.update.mockResolvedValueOnce({ id: RECORD_ID });

    const result = await withContext(() => service.softDeleteRecord(PET_ID, RECORD_ID));

    expect(result).toBe(true);
    const args = healthRecordDelegate.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: RECORD_ID });
    expect(args.data.deletedAt).toBeTruthy();
  });

  it("软删：记录不存在 → A0606，不置位", async () => {
    petDelegate.findFirst.mockResolvedValueOnce({ id: PET_ID });
    healthRecordDelegate.findFirst.mockResolvedValueOnce(null);

    await expectBusinessError(
      withContext(() => service.softDeleteRecord(PET_ID, RECORD_ID)),
      "A0606"
    );
    expect(healthRecordDelegate.update).not.toHaveBeenCalled();
  });

  // ── 有效性判定 ───────────────────────────────────────

  it("有效性：取各类型最近记录，有效期内=Y 且算出剩余天数，过期=N", async () => {
    petDelegate.findFirst.mockResolvedValueOnce({ id: PET_ID });
    healthRecordDelegate.findMany.mockResolvedValueOnce([
      // 疫苗：最近一条到期日远未来 → 有效
      {
        id: "vac",
        recordType: 1,
        recordDate: new Date("2024-01-01T00:00:00.000Z"),
        expireDate: new Date("2999-01-01T00:00:00.000Z"),
      },
      // 疫苗：较早一条（应被忽略）
      {
        id: "vac-old",
        recordType: 1,
        recordDate: new Date("2020-01-01T00:00:00.000Z"),
        expireDate: new Date("2021-01-01T00:00:00.000Z"),
      },
      // 驱虫：到期日已过 → 无效
      {
        id: "dw",
        recordType: 2,
        recordDate: new Date("2020-01-01T00:00:00.000Z"),
        expireDate: new Date("2020-02-01T00:00:00.000Z"),
      },
    ]);

    const result = await withContext(() => service.getValidity(PET_ID));

    expect(result.asOf).toBeTruthy();
    const vaccine = result.items.find((i) => i.recordType === 1)!;
    const deworm = result.items.find((i) => i.recordType === 2)!;
    expect(vaccine.latestRecordId).toBe("vac");
    expect(vaccine.valid).toBe(true);
    expect(vaccine.daysLeft).toBeGreaterThan(0);
    expect(deworm.valid).toBe(false);
    expect(result.allValid).toBe(false);
    // 查询以 recordDate desc 排序，保证「最近记录」确定性
    const args = healthRecordDelegate.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual([{ recordDate: "desc" }, { createdAt: "desc" }]);
    expect(args.where.recordType).toEqual({ in: [1, 2] });
  });

  it("有效性：无任何疫苗/驱虫记录 → 各项 hasRecord=false / valid=false", async () => {
    petDelegate.findFirst.mockResolvedValueOnce({ id: PET_ID });
    healthRecordDelegate.findMany.mockResolvedValueOnce([]);

    const result = await withContext(() => service.getValidity(PET_ID));

    expect(result.items).toHaveLength(2);
    for (const item of result.items) {
      expect(item.hasRecord).toBe(false);
      expect(item.valid).toBe(false);
      expect(item.expireDate).toBeNull();
    }
  });

  // ── 跨宠物到期提醒（MVP-WEB-05-02）─────────────────────

  const CUST_ID = "33333333-3333-4333-8333-333333333333";
  const STORE_ID = "44444444-4444-4444-8444-444444444444";
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  /**
   * 与 service 完全同口径的「今日 UTC 午夜」基准（直接用同一 util，避免测试自身
   * 复刻 TZ 推导而引入偏差）。
   */
  function utcBaseline(): number {
    const today = toDayString(new Date());
    return parseWallClock(today!, "UTC")!.getTime();
  }
  /** 相对今日的第 n 天（UTC 午夜瞬时，@db.Date 列口径） */
  function day(n: number): Date {
    return new Date(utcBaseline() + n * MS_PER_DAY);
  }

  it("到期提醒：含已过期、三档计数、level 筛选不改 summary、分页与展示字段回查", async () => {
    // 该用例连续查询三次（全量 / level=urgent / level=soon）⇒ 用常驻 mock 而非 Once
    healthRecordDelegate.findMany.mockResolvedValue([
      { id: "r-exp", petId: PET_ID, recordType: 1, recordDate: day(-30), expireDate: day(-5) },
      { id: "r-urg3", petId: PET_ID, recordType: 2, recordDate: day(-90), expireDate: day(3) },
      { id: "r-urg14", petId: PET_ID, recordType: 1, recordDate: day(-90), expireDate: day(14) },
      { id: "r-soon15", petId: PET_ID, recordType: 1, recordDate: day(-90), expireDate: day(15) },
      { id: "r-soon30", petId: PET_ID, recordType: 2, recordDate: day(-90), expireDate: day(30) },
    ]);
    petDelegate.findMany.mockResolvedValue([
      { id: PET_ID, name: "旺财", petType: 1, ownerCustomerId: CUST_ID, storeId: STORE_ID },
    ]);
    customerDelegate.findMany.mockResolvedValue([
      { id: CUST_ID, name: "张小萌", mobile: "13800002001" },
    ]);
    storeDelegate.findMany.mockResolvedValue([{ id: STORE_ID, name: "PeluVida 演示总部店" }]);

    const all = await withContext(() => service.listExpiryReminders({}));

    expect(all.total).toBe(5);
    expect(all.summary).toEqual({ expired: 1, urgent: 2, soon: 2 });
    expect(all.urgentDays).toBe(14);
    expect(all.asOf).toBeTruthy();
    expect(all.items[0].level).toBe("expired");
    expect(all.items[0].daysLeft).toBe(-5);
    expect(all.items[0].recordName).toBe("疫苗");
    expect(all.items[0].petName).toBe("旺财");
    expect(all.items[0].petType).toBe(1);
    expect(all.items[0].ownerName).toBe("张小萌");
    expect(all.items[0].ownerMobile).toBe("13800002001");
    expect(all.items[0].storeName).toBe("PeluVida 演示总部店");

    const args = healthRecordDelegate.findMany.mock.calls[0][0];
    // 含已过期 ⇒ 只设上界（不设 gte）；到期日为空的行排除
    expect(args.where.expireDate).toEqual({ not: null, lte: day(30) });
    expect(args.where.expireDate.gte).toBeUndefined();
    expect(args.where.deletedAt).toBeNull();
    expect(args.where.recordType).toEqual({ in: [1, 2] });
    expect(args.orderBy).toEqual([{ expireDate: "asc" }, { id: "asc" }]);
    expect(args.take).toBe(500);

    // level 筛选只收敛 items/total，summary 恒为窗口内全貌（提醒条需要三档计数）
    const urgent = await withContext(() =>
      service.listExpiryReminders({ level: "urgent", pageNum: 1, pageSize: 1 })
    );
    expect(urgent.total).toBe(2);
    expect(urgent.items).toHaveLength(1);
    expect(urgent.items[0].recordId).toBe("r-urg3");
    expect(urgent.summary).toEqual({ expired: 1, urgent: 2, soon: 2 });

    const soon = await withContext(() => service.listExpiryReminders({ level: "soon" }));
    expect(soon.total).toBe(2);
    expect(soon.items.map((i) => i.recordId)).toEqual(["r-soon15", "r-soon30"]);
  });

  it("到期提醒：petId 与 recordType 透传进 where（按宠下钻 / 只看驱虫）", async () => {
    healthRecordDelegate.findMany.mockResolvedValueOnce([]);

    const result = await withContext(() =>
      service.listExpiryReminders({ petId: PET_ID, recordType: 2, windowDays: 7 })
    );

    const args = healthRecordDelegate.findMany.mock.calls[0][0];
    expect(args.where.petId).toBe(PET_ID);
    expect(args.where.recordType).toBe(2);
    expect(args.where.expireDate.lte).toEqual(day(7));
    expect(result.total).toBe(0);
    expect(result.summary).toEqual({ expired: 0, urgent: 0, soon: 0 });
    expect(result.windowDays).toBe(7);
    // 零结果时不发起关联回查（无 petId 集合）
    expect(petDelegate.findMany).not.toHaveBeenCalled();
  });

  it("到期提醒：宠物关联缺失 → 展示字段回退 null（不抛、不渲染裸 UUID）", async () => {
    healthRecordDelegate.findMany.mockResolvedValueOnce([
      { id: "r-1", petId: PET_ID, recordType: 1, recordDate: day(-10), expireDate: day(1) },
    ]);
    petDelegate.findMany.mockResolvedValueOnce([]);

    const result = await withContext(() => service.listExpiryReminders({}));

    expect(result.items[0].petName).toBeNull();
    expect(result.items[0].ownerName).toBeNull();
    expect(result.items[0].storeName).toBeNull();
    expect(customerDelegate.findMany).not.toHaveBeenCalled();
    expect(storeDelegate.findMany).not.toHaveBeenCalled();
  });

  it("紧急度分级边界：<0 已过期 / 0~14 紧急 / >14 窗口内", () => {
    expect(HealthRecordService.resolveExpiryLevel(-1)).toBe("expired");
    expect(HealthRecordService.resolveExpiryLevel(0)).toBe("urgent");
    expect(HealthRecordService.resolveExpiryLevel(14)).toBe("urgent");
    expect(HealthRecordService.resolveExpiryLevel(15)).toBe("soon");
    expect(HealthRecordService.resolveExpiryLevel(30)).toBe("soon");
  });
});
