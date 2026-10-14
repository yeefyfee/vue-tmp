import type { PrismaService } from "../common/prisma/prisma.service";
import { RequestContext } from "../common/context/request-context";
import { endOfDay, toDayString } from "../common/utils/date.util";
import { BusinessException } from "../common/exceptions/business.exception";

import { StoreService } from "./store.service";
import type { CreateStoreDto } from "./dto/create-store.dto";
import { UpdateStoreDto } from "./dto/update-store.dto";
import { QueryStoreDto } from "./dto/query-store.dto";

/**
 * 门店档案服务单测（P0-04-02）
 *
 * 覆盖：创建（上下文注入 + 伪造租户忽略 + code 重复）/ 分页（筛选与分页结构）/
 * 详情（存在与缺失）/ 更新（乐观锁成功、版本冲突、记录缺失）/ 软删（置位 + 软删后不可见）。
 * PrismaService 全 mock，经 `RequestContext.run` 提供 ALS 上下文（userId=1 / tenantId=1）。
 */
describe("StoreService（P0-04-02 门店档案）", () => {
  const storeDelegate = {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  };

  const prismaMock = { scoped: { store: storeDelegate } } as unknown as PrismaService;
  let service: StoreService;

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

  const baseCreateDto: CreateStoreDto = {
    code: "store-001",
    name: "旗舰店",
    type: 1,
    province: "广东省",
    city: "深圳市",
    district: "南山区",
    address: "科技园路 1 号",
    longitude: 113.943,
    latitude: 22.54,
    phone: "0755-1234567",
    status: 1,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new StoreService(prismaMock);
  });

  it("创建门店：注入 createdBy/updatedBy 与上下文 tenantId", async () => {
    storeDelegate.findFirst.mockResolvedValueOnce(null);
    const created = { id: "uuid-1", ...baseCreateDto, tenantId: BigInt("1") };
    storeDelegate.create.mockResolvedValueOnce(created);

    const result = await withContext(() => service.createStore(baseCreateDto));

    expect(result).toBe(created);
    expect(storeDelegate.create).toHaveBeenCalledTimes(1);
    const args = storeDelegate.create.mock.calls[0][0];
    expect(args.data.createdBy).toBe(BigInt("1"));
    expect(args.data.updatedBy).toBe(BigInt("1"));
    expect(args.data.tenantId).toBe(BigInt("1"));
    expect(args.data.code).toBe("store-001");
  });

  it("创建门店：请求参数伪造 tenant_id=999 被忽略，归属恒为上下文租户 1", async () => {
    storeDelegate.findFirst.mockResolvedValueOnce(null);
    storeDelegate.create.mockResolvedValueOnce({ id: "uuid-1" });

    // DTO 白名单不含 tenantId，即使恶意构造（模拟绕过 ValidationPipe 的直调）也只认 ALS 上下文
    const malicious = { ...baseCreateDto, tenantId: "999" } as unknown as CreateStoreDto;
    await withContext(() => service.createStore(malicious));

    const args = storeDelegate.create.mock.calls[0][0];
    expect(args.data.tenantId).toBe(BigInt("1"));
    expect(args.data.tenantId).not.toBe(BigInt("999"));
  });

  it("创建门店：code 租户内重复 → STORE_CODE_DUPLICATED（A0422）", async () => {
    storeDelegate.findFirst.mockResolvedValueOnce({ id: "uuid-existing" });

    await expectBusinessError(
      withContext(() => service.createStore(baseCreateDto)),
      "A0422"
    );
    expect(storeDelegate.create).not.toHaveBeenCalled();
  });

  it("分页：默认条件与分页结构 { data, page }（deletedAt=null 恒过滤）", async () => {
    const row = { id: "uuid-1", code: "store-001", tenantId: BigInt("1") };
    storeDelegate.findMany.mockResolvedValueOnce([row]);
    storeDelegate.count.mockResolvedValueOnce(1);

    const result = await withContext(() => service.getStorePage(new QueryStoreDto()));

    expect(result).toEqual({
      data: [row],
      page: { pageNum: 1, pageSize: 20, total: 1 },
    });
    const args = storeDelegate.findMany.mock.calls[0][0];
    expect(args.where.deletedAt).toBeNull();
    expect(args.skip).toBe(0);
    expect(args.take).toBe(20);
    expect(args.orderBy).toEqual({ createdAt: "desc" });
  });

  it("分页：code 前缀 / name 模糊 / status / createdAt 闭区间组合正确", async () => {
    storeDelegate.findMany.mockResolvedValueOnce([]);
    storeDelegate.count.mockResolvedValueOnce(0);

    const query = new QueryStoreDto();
    query.code = "e2e-store";
    query.name = "旗舰";
    query.status = 1;
    query.createdAtStart = "2026-01-01T00:00:00.000Z";
    query.createdAtEnd = "2026-01-02";
    query.pageNum = 2;
    query.pageSize = 10;
    query.sortBy = "code";
    query.order = "ASC";
    await withContext(() => service.getStorePage(query));

    const args = storeDelegate.findMany.mock.calls[0][0];
    expect(args.where.code).toEqual({ startsWith: "e2e-store" });
    expect(args.where.name).toEqual({ contains: "旗舰" });
    expect(args.where.status).toBe(1);
    // 带时区标记的 ISO 输入按其自身时区原生解析；纯日期止端走应用时区当日末尾（见下一用例）
    expect(args.where.createdAt).toEqual({
      gte: new Date("2026-01-01T00:00:00.000Z"),
      lte: endOfDay("2026-01-02"),
    });
    expect(args.skip).toBe(10);
    expect(args.take).toBe(10);
    expect(args.orderBy).toEqual({ code: "asc" });
  });

  it("分页：createdAtEnd 纯日期止端 = 应用时区当日 23:59:59.999（闭区间覆盖全天）", async () => {
    storeDelegate.findMany.mockResolvedValueOnce([]);
    storeDelegate.count.mockResolvedValueOnce(0);

    const query = new QueryStoreDto();
    query.createdAtEnd = "2026-01-02";
    await withContext(() => service.getStorePage(query));

    const args = storeDelegate.findMany.mock.calls[0][0];
    const lte = args.where.createdAt.lte as Date;
    // 固定值口径（测试进程未设 TIME_ZONE → Asia/Shanghai）：2026-01-02 23:59:59.999 +08:00
    expect(lte.toISOString()).toBe("2026-01-02T15:59:59.999Z");
    // 边界语义：lte 前后 1ms 分别落当日/次日，证明全天最后 1ms 被闭区间覆盖
    expect(toDayString(new Date(lte.getTime() - 1))).toBe("2026-01-02");
    expect(toDayString(new Date(lte.getTime() + 1))).toBe("2026-01-03");
  });

  it("分页：非法 createdAt 区间参数被忽略（不进 where 条件，不炸接口）", async () => {
    storeDelegate.findMany.mockResolvedValueOnce([]);
    storeDelegate.count.mockResolvedValueOnce(0);

    const query = new QueryStoreDto();
    query.createdAtStart = "not-a-date";
    query.createdAtEnd = "???";
    await withContext(() => service.getStorePage(query));

    const args = storeDelegate.findMany.mock.calls[0][0];
    expect(args.where.createdAt).toEqual({});
  });

  it("详情：存在则返回记录", async () => {
    const row = { id: "uuid-1", code: "store-001", tenantId: BigInt("1") };
    storeDelegate.findFirst.mockResolvedValueOnce(row);

    const result = await withContext(() => service.getStoreDetail("uuid-1"));

    expect(result).toBe(row);
    expect(storeDelegate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "uuid-1", deletedAt: null } })
    );
  });

  it("详情：不存在（或已软删）→ STORE_NOT_FOUND（A0424）", async () => {
    storeDelegate.findFirst.mockResolvedValueOnce(null);

    await expectBusinessError(
      withContext(() => service.getStoreDetail("uuid-missing")),
      "A0424"
    );
  });

  it("更新：乐观锁命中则 version 自增并注入 updatedBy", async () => {
    const dto = new UpdateStoreDto();
    dto.version = 0;
    dto.name = "旗舰店（装修后）";

    const updated = { id: "uuid-1", name: dto.name, version: 1 };
    storeDelegate.update.mockResolvedValueOnce(updated);

    const result = await withContext(() => service.updateStore("uuid-1", dto));

    expect(result).toBe(updated);
    const args = storeDelegate.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: "uuid-1", version: 0, deletedAt: null });
    expect(args.data.version).toEqual({ increment: 1 });
    expect(args.data.updatedBy).toBe(BigInt("1"));
    expect(args.data.name).toBe("旗舰店（装修后）");
  });

  it("更新：version 不匹配 → STORE_VERSION_CONFLICT（A0423）", async () => {
    const dto = new UpdateStoreDto();
    dto.version = 0;

    // Prisma P2025（Record to update not found）——但记录实际存在 → 版本冲突
    storeDelegate.update.mockRejectedValueOnce(
      Object.assign(new Error("Record to update not found."), { code: "P2025" })
    );
    storeDelegate.findFirst.mockResolvedValueOnce({ id: "uuid-1" });

    await expectBusinessError(
      withContext(() => service.updateStore("uuid-1", dto)),
      "A0423"
    );
  });

  it("更新：记录不存在（含已软删）→ STORE_NOT_FOUND（A0424），而非误报版本冲突", async () => {
    const dto = new UpdateStoreDto();
    dto.version = 3;

    storeDelegate.update.mockRejectedValueOnce(
      Object.assign(new Error("Record to update not found."), { code: "P2025" })
    );
    storeDelegate.findFirst.mockResolvedValueOnce(null);

    await expectBusinessError(
      withContext(() => service.updateStore("uuid-missing", dto)),
      "A0424"
    );
  });

  it("软删：deletedAt 置位为当前时间，软删后详情不可见（A0424）", async () => {
    storeDelegate.findFirst
      // 软删前的存在性检查
      .mockResolvedValueOnce({ id: "uuid-1" })
      // 软删后的详情查询：查不到（deletedAt: null 过滤生效）
      .mockResolvedValueOnce(null);
    storeDelegate.update.mockResolvedValueOnce({ id: "uuid-1", deletedAt: new Date() });

    await withContext(() => service.softDeleteStore("uuid-1"));

    const deleteArgs = storeDelegate.update.mock.calls[0][0];
    expect(deleteArgs.where).toEqual({ id: "uuid-1" });
    expect(deleteArgs.data.deletedAt).toBeInstanceOf(Date);
    expect(deleteArgs.data.updatedBy).toBe(BigInt("1"));

    await expectBusinessError(
      withContext(() => service.getStoreDetail("uuid-1")),
      "A0424"
    );
  });

  it("软删：记录不存在（或已软删）→ STORE_NOT_FOUND（A0424）", async () => {
    storeDelegate.findFirst.mockResolvedValueOnce(null);

    await expectBusinessError(
      withContext(() => service.softDeleteStore("uuid-missing")),
      "A0424"
    );
    expect(storeDelegate.update).not.toHaveBeenCalled();
  });

  it("分页：非法 sortBy 白名单回落 createdAt（防任意字段透传）", async () => {
    storeDelegate.findMany.mockResolvedValueOnce([]);
    storeDelegate.count.mockResolvedValueOnce(0);

    const query = new QueryStoreDto();
    query.sortBy = "tenantId; DROP TABLE store;--";
    await withContext(() => service.getStorePage(query));

    const args = storeDelegate.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual({ createdAt: "desc" });
  });
});
