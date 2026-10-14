import "reflect-metadata";

import { DEFAULT_STORE_CONFIG } from "@peluvida/shared";

import type { PrismaService } from "../common/prisma/prisma.service";
import { RequestContext } from "../common/context/request-context";
import { BusinessException } from "../common/exceptions/business.exception";

import { StoreConfigService } from "./store-config.service";
import { UpdateStoreConfigDto } from "./dto/update-store-config.dto";

/**
 * 门店配置服务单测（P0-04-05 · FR-4）
 *
 * 覆盖：GET（config NULL → 全默认 / 脏数据 fail-safe / 部分覆盖逐键合并）/
 * PATCH（浅 merge 回写 + version 自增 / 非法键 A0437 / 乐观锁冲突 A0423 /
 * 门店缺失 A0424）。PrismaService 全 mock，经 `RequestContext.run` 提供 ALS 上下文。
 */
describe("StoreConfigService（P0-04-05 门店配置）", () => {
  const storeDelegate = {
    findFirst: jest.fn(),
    update: jest.fn(),
  };

  const prismaMock = { scoped: { store: storeDelegate } } as unknown as PrismaService;
  let service: StoreConfigService;

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
    service = new StoreConfigService(prismaMock);
  });

  describe("getStoreConfig", () => {
    it("config 为 NULL → 平台默认值全量返回 + version（供后续 PATCH 乐观锁）", async () => {
      storeDelegate.findFirst.mockResolvedValueOnce({
        id: "uuid-1",
        config: null,
        version: 0,
      });

      const result = await withContext(() => service.getStoreConfig("uuid-1"));

      expect(result.storeId).toBe("uuid-1");
      expect(result.config).toEqual({ ...DEFAULT_STORE_CONFIG });
      expect(result.version).toBe(0);
    });

    it("config 脏数据（数组/字符串/非法值）→ fail-safe 回落默认", async () => {
      storeDelegate.findFirst.mockResolvedValueOnce({
        id: "uuid-1",
        config: { slotGranularityMin: 20, pushEnabled: "yes" }, // 两个键都非法
        version: 3,
      });

      const result = await withContext(() => service.getStoreConfig("uuid-1"));

      expect(result.config).toEqual({ ...DEFAULT_STORE_CONFIG });
      expect(result.version).toBe(3);
    });

    it("config 部分覆盖 → 逐键合并默认值（覆盖键生效，其余默认）", async () => {
      storeDelegate.findFirst.mockResolvedValueOnce({
        id: "uuid-1",
        config: { slotGranularityMin: 60, pushEnabled: false, evilKey: "x" },
        version: 1,
      });

      const result = await withContext(() => service.getStoreConfig("uuid-1"));

      expect(result.config).toEqual({
        ...DEFAULT_STORE_CONFIG,
        slotGranularityMin: 60,
        pushEnabled: false,
      });
      expect("evilKey" in result.config).toBe(false);
    });
  });

  describe("updateStoreConfig（浅 merge + 乐观锁）", () => {
    it("合法部分更新：merge 回写 config、version 自增、updatedBy 注入", async () => {
      storeDelegate.findFirst.mockResolvedValueOnce({
        id: "uuid-1",
        config: { slotGranularityMin: 15 },
        version: 0,
      });
      const updated = {
        id: "uuid-1",
        config: { slotGranularityMin: 15, pushEnabled: false },
        version: 1,
      };
      storeDelegate.update.mockResolvedValueOnce(updated);

      const dto = new UpdateStoreConfigDto();
      dto.version = 0;
      dto.pushEnabled = false;

      const result = await withContext(() => service.updateStoreConfig("uuid-1", dto));

      // 返回结构化信封（storeId/config/version），config 经 resolve 恒为完整六键
      expect(result.storeId).toBe("uuid-1");
      expect(result.version).toBe(1);
      expect(result.config).toEqual({
        ...DEFAULT_STORE_CONFIG,
        slotGranularityMin: 15,
        pushEnabled: false,
      });
      const args = storeDelegate.update.mock.calls[0][0];
      expect(args.where).toEqual({ id: "uuid-1", version: 0, deletedAt: null });
      expect(args.data.version).toEqual({ increment: 1 });
      expect(args.data.updatedBy).toBe(BigInt("1"));
      // 浅 merge：请求只改 pushEnabled，存量覆盖的 slotGranularityMin=15 保留，
      // 其余键由默认值打底 → 回写恒为完整六键
      expect(args.data.config).toEqual({
        ...DEFAULT_STORE_CONFIG,
        slotGranularityMin: 15,
        pushEnabled: false,
      });
    });

    it("config 为 NULL 的门店首次 PATCH：默认值打底 + 请求键覆盖", async () => {
      storeDelegate.findFirst.mockResolvedValueOnce({
        id: "uuid-1",
        config: null,
        version: 0,
      });
      storeDelegate.update.mockResolvedValueOnce({
        id: "uuid-1",
        config: { ...DEFAULT_STORE_CONFIG, bookingLeadHours: 48 },
        version: 1,
      });

      const dto = new UpdateStoreConfigDto();
      dto.version = 0;
      dto.bookingLeadHours = 48;

      await withContext(() => service.updateStoreConfig("uuid-1", dto));

      const args = storeDelegate.update.mock.calls[0][0];
      expect(args.data.config).toEqual({ ...DEFAULT_STORE_CONFIG, bookingLeadHours: 48 });
    });

    it("非法值（绕过 ValidationPipe 直调兜底）→ STORE_CONFIG_INVALID（A0437）", async () => {
      storeDelegate.findFirst.mockResolvedValueOnce({ id: "uuid-1", config: null, version: 0 });

      // slotGranularityMin=20 不在 15/30/60 枚举
      const dto = new UpdateStoreConfigDto();
      dto.version = 0;
      (dto as unknown as Record<string, unknown>).slotGranularityMin = 20;

      await expectBusinessError(
        withContext(() => service.updateStoreConfig("uuid-1", dto)),
        "A0437"
      );
      expect(storeDelegate.update).not.toHaveBeenCalled();
    });

    it("version 不匹配 → A0423；门店缺失 → A0424", async () => {
      const dto = new UpdateStoreConfigDto();
      dto.version = 0;
      dto.pushEnabled = false;

      // P2025 + 记录存在 → 版本冲突
      storeDelegate.findFirst
        .mockResolvedValueOnce({ id: "uuid-1", config: null, version: 0 })
        .mockResolvedValueOnce({ id: "uuid-1" });
      storeDelegate.update.mockRejectedValueOnce(
        Object.assign(new Error("Record to update not found."), { code: "P2025" })
      );

      await expectBusinessError(
        withContext(() => service.updateStoreConfig("uuid-1", dto)),
        "A0423"
      );

      // 门店不存在
      storeDelegate.findFirst.mockResolvedValueOnce(null);
      await expectBusinessError(
        withContext(() => service.updateStoreConfig("uuid-missing", dto)),
        "A0424"
      );
    });
  });
});
