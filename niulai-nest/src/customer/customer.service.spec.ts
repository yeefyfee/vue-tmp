import "reflect-metadata";

import type { PrismaService } from "../common/prisma/prisma.service";
import { RequestContext } from "../common/context/request-context";
import { BusinessException } from "../common/exceptions/business.exception";

import { CustomerService } from "./customer.service";
import type { CreateCustomerDto } from "./dto/create-customer.dto";
import type { UpdateCustomerDto } from "./dto/update-customer.dto";
import type { QueryCustomerDto } from "./dto/query-customer.dto";

/**
 * 萌主档案服务单测（P0-05-02）
 *
 * 覆盖：创建（上下文注入 + 伪造租户忽略 + 手机号重复 A0501 + P2002 并发兜底 +
 * 归属门店校验 A0512 + birthday DATE 转换）/ 分页（筛选、分页结构、排序白名单回落）/
 * 详情（存在与缺失 A0510）/ 更新（乐观锁成功、mobile 变更查重排除自身、版本冲突
 * A0511、记录缺失 A0510）/ 软删（置位 + 软删后不可见）。
 * PrismaService 全 mock，经 `RequestContext.run` 提供 ALS 上下文（userId=1 / tenantId=1）。
 */
describe("CustomerService（P0-05-02 萌主档案）", () => {
  const customerDelegate = {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  };
  const storeDelegate = { findFirst: jest.fn() };

  const prismaMock = {
    scoped: { customer: customerDelegate, store: storeDelegate },
  } as unknown as PrismaService;
  let service: CustomerService;

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

  const baseCreateDto: CreateCustomerDto = {
    name: "张小萌",
    mobile: "13800138000",
    gender: 2,
    birthday: "1995-06-15",
    source: 1,
    remark: "E2E 前置客户",
  };

  beforeEach(() => {
    // reset（而非 clear）：清掉 mockResolvedValueOnce 队列，杜绝跨用例泄漏
    jest.resetAllMocks();
    service = new CustomerService(prismaMock);
  });

  // ── 创建 ─────────────────────────────────────────────

  it("创建客户：注入 createdBy/updatedBy 与上下文 tenantId，birthday 转 DATE 瞬时，默认值生效", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce(null);
    const created = { id: "uuid-1", ...baseCreateDto, tenantId: BigInt("1") };
    customerDelegate.create.mockResolvedValueOnce(created);

    const result = await withContext(() => service.createCustomer(baseCreateDto));

    expect(result).toBe(created);
    const args = customerDelegate.create.mock.calls[0][0];
    expect(args.data.createdBy).toBe(BigInt("1"));
    expect(args.data.updatedBy).toBe(BigInt("1"));
    expect(args.data.tenantId).toBe(BigInt("1"));
    expect(args.data.mobile).toBe("13800138000");
    expect(args.data.gender).toBe(2);
    expect(args.data.source).toBe(1);
    expect(args.data.storeId).toBeNull();
    expect(args.data.birthday).toEqual(new Date("1995-06-15T00:00:00.000Z"));
  });

  it("创建客户：请求参数伪造 tenantId=999 被忽略，归属恒为上下文租户 1", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce(null);
    customerDelegate.create.mockResolvedValueOnce({ id: "uuid-1" });

    await withContext(() =>
      service.createCustomer({ ...baseCreateDto, ...({ tenantId: "999" } as object) })
    );

    const args = customerDelegate.create.mock.calls[0][0];
    expect(args.data.tenantId).toBe(BigInt("1"));
    expect(args.data.tenantId).not.toBe(BigInt("999"));
  });

  it("创建客户：手机号租户内已存在（未软删）→ A0501", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce({ id: "uuid-exist" });

    await expectBusinessError(
      withContext(() => service.createCustomer(baseCreateDto)),
      "A0501"
    );
    // 撞重路径不应落库
    expect(customerDelegate.create).not.toHaveBeenCalled();
  });

  it("创建客户：应用层查重通过但并发撞部分唯一索引（P2002）→ 兜底转 A0501", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce(null);
    customerDelegate.create.mockRejectedValueOnce({ code: "P2002" });

    await expectBusinessError(
      withContext(() => service.createCustomer(baseCreateDto)),
      "A0501"
    );
  });

  it("创建客户：storeId 指向不存在/已软删门店 → A0512", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce(null);
    storeDelegate.findFirst.mockResolvedValueOnce(null);

    await expectBusinessError(
      withContext(() =>
        service.createCustomer({
          ...baseCreateDto,
          storeId: "00000000-0000-4000-8000-000000000000",
        })
      ),
      "A0512"
    );
  });

  it("创建客户：上下文缺失（无租户）→ fail-closed A0302，不落库", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce(null);

    await expectBusinessError(service.createCustomer(baseCreateDto), "A0302");
    expect(customerDelegate.create).not.toHaveBeenCalled();
  });

  // ── 分页 ─────────────────────────────────────────────

  it("分页：mobile 精确 + name 模糊筛选进入 where，返回 data+page 结构", async () => {
    customerDelegate.findMany.mockResolvedValueOnce([{ id: "uuid-1" }]);
    customerDelegate.count.mockResolvedValueOnce(1);

    const result = await withContext(() =>
      service.getCustomerPage({ mobile: "13800138000", name: "小萌" } as QueryCustomerDto)
    );

    expect(result.page).toEqual({ pageNum: 1, pageSize: 20, total: 1 });
    expect(result.data).toEqual([{ id: "uuid-1" }]);
    const args = customerDelegate.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      deletedAt: null,
      mobile: "13800138000",
      name: { contains: "小萌" },
    });
  });

  it("分页：keyword 同时模糊姓名与手机号（OR 语义，PRD 验收要点）", async () => {
    customerDelegate.findMany.mockResolvedValueOnce([]);
    customerDelegate.count.mockResolvedValueOnce(0);

    await withContext(() => service.getCustomerPage({ keyword: "138" } as QueryCustomerDto));

    const args = customerDelegate.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      deletedAt: null,
      OR: [{ name: { contains: "138" } }, { mobile: { contains: "138" } }],
    });
  });

  it("分页：keyword 与 name / storeId 并存时 keyword 以 AND 挂在 where.OR（不覆盖独立筛选）", async () => {
    customerDelegate.findMany.mockResolvedValueOnce([]);
    customerDelegate.count.mockResolvedValueOnce(0);

    await withContext(() =>
      service.getCustomerPage({
        keyword: "小萌",
        name: "萌",
        storeId: "11111111-1111-1111-1111-111111111111",
      } as QueryCustomerDto)
    );

    const args = customerDelegate.findMany.mock.calls[0][0];
    expect(args.where.OR).toEqual([
      { name: { contains: "小萌" } },
      { mobile: { contains: "小萌" } },
    ]);
    expect(args.where.name).toEqual({ contains: "萌" });
    expect(args.where.storeId).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("分页：排序白名单外字段回落 createdAt（方向沿用入参 asc），非法分页参数回落 1/20", async () => {
    customerDelegate.findMany.mockResolvedValueOnce([]);
    customerDelegate.count.mockResolvedValueOnce(0);

    await withContext(() =>
      service.getCustomerPage({
        sortBy: "evilField",
        order: "asc",
        pageNum: -3,
        pageSize: 0,
      } as unknown as QueryCustomerDto)
    );

    const args = customerDelegate.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual({ createdAt: "asc" });
    expect(args.skip).toBe(0);
    expect(args.take).toBe(20);
  });

  it("分页：createdAt 区间端点进 where（合法日期）", async () => {
    customerDelegate.findMany.mockResolvedValueOnce([]);
    customerDelegate.count.mockResolvedValueOnce(0);

    await withContext(() =>
      service.getCustomerPage({
        createdAtStart: "2026-10-01",
        createdAtEnd: "2026-10-07",
      } as QueryCustomerDto)
    );

    const args = customerDelegate.findMany.mock.calls[0][0];
    expect(args.where.deletedAt).toBeNull();
    expect(args.where.createdAt.gte).toBeTruthy();
    expect(args.where.createdAt.lte).toBeTruthy();
  });

  // ── 详情 ─────────────────────────────────────────────

  it("详情：命中返回记录", async () => {
    const row = { id: "uuid-1", name: "张小萌" };
    customerDelegate.findFirst.mockResolvedValueOnce(row);

    const result = await withContext(() => service.getCustomerDetail("uuid-1"));

    expect(result).toBe(row);
    expect(customerDelegate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "uuid-1", deletedAt: null } })
    );
  });

  it("详情：不存在（含已软删）→ A0510", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce(null);

    await expectBusinessError(
      withContext(() => service.getCustomerDetail("uuid-missing")),
      "A0510"
    );
  });

  // ── 更新 ─────────────────────────────────────────────

  it("更新：version 乐观锁命中 → version 自增 + updatedBy 注入", async () => {
    const updated = { id: "uuid-1", name: "改名", version: 1 };
    customerDelegate.update.mockResolvedValueOnce(updated);

    const result = await withContext(() =>
      service.updateCustomer("uuid-1", { version: 0, name: "改名" } as UpdateCustomerDto)
    );

    expect(result).toBe(updated);
    const args = customerDelegate.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: "uuid-1", version: 0, deletedAt: null });
    expect(args.data.version).toEqual({ increment: 1 });
    expect(args.data.updatedBy).toBe(BigInt("1"));
    expect(args.data.name).toBe("改名");
  });

  it("更新：mobile 变更撞其他客户 → A0501（不落库）", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce({ id: "uuid-other" });

    await expectBusinessError(
      withContext(() => service.updateCustomer("uuid-1", { version: 0, mobile: "13900139000" })),
      "A0501"
    );
    expect(customerDelegate.update).not.toHaveBeenCalled();
  });

  it("更新：mobile 变更查重命中自身 → 放行（排除自身 not: id）", async () => {
    customerDelegate.findFirst.mockImplementation((args: { where: { id?: unknown } }) => {
      // 更新查重（带 not: id）返回 null；后续回查（仅 id）返回存在
      if (args.where.id && typeof args.where.id === "object" && "not" in args.where.id) {
        return Promise.resolve(null);
      }
      return Promise.resolve({ id: "uuid-1" });
    });
    customerDelegate.update.mockResolvedValueOnce({
      id: "uuid-1",
      mobile: "13900139000",
      version: 1,
    });

    const result = await withContext(() =>
      service.updateCustomer("uuid-1", { version: 0, mobile: "13900139000" })
    );

    expect(result.mobile).toBe("13900139000");
    const dupArgs = customerDelegate.findFirst.mock.calls[0][0];
    expect(dupArgs.where.id).toEqual({ not: "uuid-1" });
  });

  it("更新：版本冲突（记录存在）→ A0511", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce({ id: "uuid-1" });
    customerDelegate.update.mockRejectedValueOnce({ code: "P2025" });

    await expectBusinessError(
      withContext(() => service.updateCustomer("uuid-1", { version: 0, name: "并发覆盖" })),
      "A0511"
    );
  });

  it("更新：记录不存在（含已软删）→ A0510", async () => {
    customerDelegate.findFirst
      .mockResolvedValueOnce(null) // P2025 后回查
      .mockResolvedValueOnce(null);
    customerDelegate.update.mockRejectedValueOnce({ code: "P2025" });

    await expectBusinessError(
      withContext(() => service.updateCustomer("uuid-missing", { version: 0, name: "x" })),
      "A0510"
    );
  });

  it("更新：并发撞部分唯一索引（P2002）→ 兜底转 A0501", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce(null); // mobile 查重通过
    customerDelegate.update.mockRejectedValueOnce({ code: "P2002" });

    await expectBusinessError(
      withContext(() => service.updateCustomer("uuid-1", { version: 0, mobile: "13900139001" })),
      "A0501"
    );
  });

  // ── 软删 ─────────────────────────────────────────────

  it("软删：置 deletedAt + updatedBy，成功返回 true", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce({ id: "uuid-1" });
    customerDelegate.update.mockResolvedValueOnce({ id: "uuid-1", deletedAt: new Date() });

    const result = await withContext(() => service.softDeleteCustomer("uuid-1"));

    expect(result).toBe(true);
    const args = customerDelegate.update.mock.calls[0][0];
    expect(args.data.deletedAt).toBeTruthy();
    expect(args.data.updatedBy).toBe(BigInt("1"));
  });

  it("软删：不存在（含已软删）→ A0510，不重复置位", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce(null);

    await expectBusinessError(
      withContext(() => service.softDeleteCustomer("uuid-missing")),
      "A0510"
    );
    expect(customerDelegate.update).not.toHaveBeenCalled();
  });
});
