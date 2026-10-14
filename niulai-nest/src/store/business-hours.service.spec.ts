import "reflect-metadata";

import type { PrismaService } from "../common/prisma/prisma.service";
import { RequestContext } from "../common/context/request-context";
import { BusinessException } from "../common/exceptions/business.exception";

import { BusinessHoursService } from "./business-hours.service";
import { SaveBusinessHoursDto } from "./dto/save-business-hours.dto";

/**
 * 每周营业时段服务单测（P0-04-04 · FR-3）
 *
 * 覆盖：GET（门店缺失 A0424 / 空配置回模板 / 脏数据键回落空数组）/
 * PUT（合法整存 + version 自增 / 7 天键缺失 A0436 / 段格式 A0436 /
 * close ≤ open A0436 / 每天超 3 段 A0436 / 乐观锁冲突 A0423 / 门店缺失 A0424）。
 * PrismaService 全 mock，经 `RequestContext.run` 提供 ALS 上下文。
 */
describe("BusinessHoursService（P0-04-04 每周营业时段）", () => {
  const storeDelegate = {
    findFirst: jest.fn(),
    update: jest.fn(),
  };

  const prismaMock = { scoped: { store: storeDelegate } } as unknown as PrismaService;
  let service: BusinessHoursService;

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

  /** 合法 7 天整包时段 */
  const validWeekly = {
    mon: [["09:00", "18:00"]],
    tue: [
      ["09:00", "12:00"],
      ["13:00", "18:00"],
    ],
    wed: [],
    thu: [["09:00", "18:00"]],
    fri: [["09:00", "21:00"]],
    sat: [["08:00", "20:00"]],
    sun: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BusinessHoursService(prismaMock);
  });

  describe("getBusinessHours", () => {
    it("门店不存在（或已软删）→ STORE_NOT_FOUND（A0424）", async () => {
      storeDelegate.findFirst.mockResolvedValueOnce(null);

      await expectBusinessError(
        withContext(() => service.getBusinessHours("uuid-missing")),
        "A0424"
      );
    });

    it("从未配置（business_hours = {}）→ 返回 7 天键齐全的空模板 + version", async () => {
      storeDelegate.findFirst.mockResolvedValueOnce({
        id: "uuid-1",
        businessHours: {},
        version: 0,
      });

      const result = await withContext(() => service.getBusinessHours("uuid-1"));

      expect(result.storeId).toBe("uuid-1");
      expect(Object.keys(result.businessHours).sort()).toEqual(
        ["fri", "mon", "sat", "sun", "thu", "tue", "wed"].sort()
      );
      expect(result.businessHours.mon).toEqual([]);
      expect(result.version).toBe(0);
    });

    it("已配置 → 规整回显；缺失键补空数组（部分配置兼容）", async () => {
      storeDelegate.findFirst.mockResolvedValueOnce({
        id: "uuid-1",
        businessHours: { mon: [["09:00", "18:00"]] }, // 其余 6 天缺失
        version: 2,
      });

      const result = await withContext(() => service.getBusinessHours("uuid-1"));

      expect(result.businessHours.mon).toEqual([["09:00", "18:00"]]);
      expect(result.businessHours.sun).toEqual([]);
      expect(result.version).toBe(2);
    });
  });

  describe("saveBusinessHours（整存整取）", () => {
    it("合法 7 天包：写回 businessHours、注入 updatedBy、version 自增", async () => {
      const updated = { id: "uuid-1", businessHours: validWeekly, version: 1 };
      storeDelegate.update.mockResolvedValueOnce(updated);

      const dto = new SaveBusinessHoursDto();
      dto.version = 0;
      dto.businessHours = validWeekly;

      const result = await withContext(() => service.saveBusinessHours("uuid-1", dto));

      expect(result.version).toBe(1);
      expect(result.businessHours.mon).toEqual([["09:00", "18:00"]]);
      const args = storeDelegate.update.mock.calls[0][0];
      expect(args.where).toEqual({ id: "uuid-1", version: 0, deletedAt: null });
      expect(args.data.version).toEqual({ increment: 1 });
      expect(args.data.updatedBy).toBe(BigInt("1"));
    });

    it("非法：缺少任一天键 → A0436（整包校验，7 天键缺一不可）", async () => {
      const missing = { ...validWeekly } as Record<string, unknown>;
      delete missing.sun;

      const dto = new SaveBusinessHoursDto();
      dto.version = 0;
      dto.businessHours = missing;

      await expectBusinessError(
        withContext(() => service.saveBusinessHours("uuid-1", dto)),
        "A0436"
      );
      expect(storeDelegate.update).not.toHaveBeenCalled();
    });

    it("非法：多余键 / 段格式 / close ≤ open / 超 3 段 → A0436", async () => {
      // 多余键
      await expectBusinessError(
        withContext(() =>
          service.saveBusinessHours("uuid-1", {
            version: 0,
            businessHours: { ...validWeekly, extra: [] },
          })
        ),
        "A0436"
      );

      // 段不是二元组
      await expectBusinessError(
        withContext(() =>
          service.saveBusinessHours("uuid-1", {
            version: 0,
            businessHours: { ...validWeekly, mon: [["09:00"]] },
          })
        ),
        "A0436"
      );

      // HH:mm 格式
      await expectBusinessError(
        withContext(() =>
          service.saveBusinessHours("uuid-1", {
            version: 0,
            businessHours: { ...validWeekly, mon: [["9:00", "18:00"]] },
          })
        ),
        "A0436"
      );

      // close == open
      await expectBusinessError(
        withContext(() =>
          service.saveBusinessHours("uuid-1", {
            version: 0,
            businessHours: { ...validWeekly, mon: [["09:00", "09:00"]] },
          })
        ),
        "A0436"
      );

      // close < open
      await expectBusinessError(
        withContext(() =>
          service.saveBusinessHours("uuid-1", {
            version: 0,
            businessHours: { ...validWeekly, mon: [["18:00", "09:00"]] },
          })
        ),
        "A0436"
      );

      // 超 3 段
      await expectBusinessError(
        withContext(() =>
          service.saveBusinessHours("uuid-1", {
            version: 0,
            businessHours: {
              ...validWeekly,
              mon: [
                ["09:00", "10:00"],
                ["11:00", "12:00"],
                ["13:00", "14:00"],
                ["15:00", "16:00"],
              ],
            },
          })
        ),
        "A0436"
      );

      expect(storeDelegate.update).not.toHaveBeenCalled();
    });

    it("version 不匹配 → STORE_VERSION_CONFLICT（A0423）；记录缺失 → A0424", async () => {
      const dto = new SaveBusinessHoursDto();
      dto.version = 0;
      dto.businessHours = validWeekly;

      // P2025 + 记录存在 → 版本冲突
      storeDelegate.update.mockRejectedValueOnce(
        Object.assign(new Error("Record to update not found."), { code: "P2025" })
      );
      storeDelegate.findFirst.mockResolvedValueOnce({ id: "uuid-1" });

      await expectBusinessError(
        withContext(() => service.saveBusinessHours("uuid-1", dto)),
        "A0423"
      );

      // P2025 + 记录不存在 → A0424
      storeDelegate.update.mockRejectedValueOnce(
        Object.assign(new Error("Record to update not found."), { code: "P2025" })
      );
      storeDelegate.findFirst.mockResolvedValueOnce(null);

      await expectBusinessError(
        withContext(() => service.saveBusinessHours("uuid-1", dto)),
        "A0424"
      );
    });
  });
});
