import "reflect-metadata";

import type { PrismaService } from "../common/prisma/prisma.service";
import { RequestContext } from "../common/context/request-context";
import { BusinessException } from "../common/exceptions/business.exception";

import { PetService } from "./pet.service";
import { calcProfileCompleteness, PET_COMPLETENESS_WEIGHTS } from "./pet-completeness";
import type { CreatePetDto } from "./dto/create-pet.dto";
import type { UpdatePetDto } from "./dto/update-pet.dto";
import type { QueryPetDto } from "./dto/query-pet.dto";

/**
 * 宠物档案服务单测（P0-06-02）
 *
 * 覆盖：完整度评分纯函数（多档位：空档 / 基础档 / 全满 100 / 逐字段权重）/
 * 创建（上下文注入 + 伪造租户忽略 + 主人客户校验 A0603 + 门店校验 A0604 +
 * 行为标签校验 A0605 + 关联落库 + 评分写入）/ 分页（筛选、排序白名单回落）/
 * 详情（命中与缺失 A0601）/ 更新（乐观锁、版本冲突 A0602、记录缺失 A0601、
 * 标签全量替换、评分重算）/ 软删（置位 + 清关联 + 不存在 A0601）。
 * PrismaService 全 mock，经 `RequestContext.run` 提供 ALS 上下文（userId=1 / tenantId=1）。
 */
describe("PetService（P0-06-02 宠物档案）", () => {
  const petDelegate = {
    create: jest.fn(),
    findFirst: jest.fn(),
    findFirstOrThrow: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  };
  const petBehaviorTagDelegate = {
    findMany: jest.fn(),
    createMany: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn(),
  };
  const behaviorTagDelegate = { findMany: jest.fn() };
  // 主人 / 门店：findFirst 用于归属校验（A0603/A0604），findMany 用于展示字段批量回查（05-01）
  const customerDelegate = { findFirst: jest.fn(), findMany: jest.fn() };
  const storeDelegate = { findFirst: jest.fn(), findMany: jest.fn() };

  const prismaMock = {
    scoped: {
      pet: petDelegate,
      petBehaviorTag: petBehaviorTagDelegate,
      behaviorTag: behaviorTagDelegate,
      customer: customerDelegate,
      store: storeDelegate,
    },
  } as unknown as PrismaService;
  let service: PetService;

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

  const OWNER_ID = "11111111-1111-4111-8111-111111111111";
  const TAG_ID = "22222222-2222-4222-8222-222222222222";
  const baseCreateDto: CreatePetDto = {
    name: "旺财",
    ownerCustomerId: OWNER_ID,
    petType: 1,
  };

  beforeEach(() => {
    // reset（而非 clear）：清掉 mockResolvedValueOnce 队列，杜绝跨用例泄漏
    jest.resetAllMocks();
    // 展示字段批量回查的默认空返回（避免 jest.fn() 返回 undefined 使 .map 抛错）
    customerDelegate.findMany.mockResolvedValue([]);
    storeDelegate.findMany.mockResolvedValue([]);
    service = new PetService(prismaMock);
  });

  // ── 完整度评分纯函数（多档位） ─────────────────────────

  describe("calcProfileCompleteness 评分档位", () => {
    it("空档（全空）= 0 分", () => {
      expect(calcProfileCompleteness({})).toBe(0);
    });

    it("基础档（name + owner + petType，create 必填集）= 40 分", () => {
      expect(calcProfileCompleteness({ name: "旺财", ownerCustomerId: OWNER_ID, petType: 1 })).toBe(
        PET_COMPLETENESS_WEIGHTS.name +
          PET_COMPLETENESS_WEIGHTS.ownerCustomerId +
          PET_COMPLETENESS_WEIGHTS.petType
      );
    });

    it("字段填充越多分越高（逐项递增单调性）", () => {
      const low = { name: "旺财", ownerCustomerId: OWNER_ID, petType: 1 };
      const mid = { ...low, birthday: new Date(), weightKg: "5.20" };
      const high = { ...mid, breed: "金毛", photoUrl: "https://x/y.jpg", sterilized: true };
      const top = { ...high, chipNo: "CHIP-001", coatColor: "金色", behaviorTagCount: 2 };
      const scores = [low, mid, high, top].map((p) => calcProfileCompleteness(p));
      expect(scores[1]).toBeGreaterThan(scores[0]);
      expect(scores[2]).toBeGreaterThan(scores[1]);
      expect(scores[3]).toBeGreaterThan(scores[2]);
    });

    it("全字段填充 = 100 分（权重表合计锚点）", () => {
      const total = Object.values(PET_COMPLETENESS_WEIGHTS).reduce((a, b) => a + b, 0);
      expect(total).toBe(100);
      expect(
        calcProfileCompleteness({
          name: "旺财",
          ownerCustomerId: OWNER_ID,
          petType: 1,
          birthday: new Date(),
          weightKg: "5.20",
          photoUrl: "https://x/y.jpg",
          photos: ["https://x/z.jpg"],
          breed: "金毛",
          sterilized: true,
          chipNo: "CHIP-001",
          coatColor: "金色",
          behaviorTagCount: 1,
        })
      ).toBe(100);
    });

    it("photos 非空数组等价 photoUrl 计分；photos 空数组不计分", () => {
      const withPhotos = calcProfileCompleteness({
        name: "旺财",
        ownerCustomerId: OWNER_ID,
        petType: 1,
        photos: ["a"],
      });
      const withUrl = calcProfileCompleteness({
        name: "旺财",
        ownerCustomerId: OWNER_ID,
        petType: 1,
        photoUrl: "a",
      });
      const emptyPhotos = calcProfileCompleteness({
        name: "旺财",
        ownerCustomerId: OWNER_ID,
        petType: 1,
        photos: [],
      });
      expect(withPhotos).toBe(withUrl);
      expect(withPhotos).toBeGreaterThan(emptyPhotos);
    });
  });

  // ── 创建 ─────────────────────────────────────────────

  it("创建宠物：注入 createdBy/updatedBy 与上下文 tenantId，birthday 转 DATE 瞬时，评分按创建字段计算", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce({ id: OWNER_ID });
    const created = {
      id: "uuid-1",
      name: "旺财",
      ownerCustomerId: OWNER_ID,
      petType: 1,
      tenantId: BigInt("1"),
      profileCompleteness: 40,
    };
    petDelegate.create.mockResolvedValueOnce(created);
    petBehaviorTagDelegate.findMany.mockResolvedValueOnce([]);
    behaviorTagDelegate.findMany.mockResolvedValueOnce([]);

    const result = await withContext(() => service.createPet(baseCreateDto));

    expect(result).toMatchObject({ id: "uuid-1", behaviorTags: [] });
    const args = petDelegate.create.mock.calls[0][0];
    expect(args.data.createdBy).toBe(BigInt("1"));
    expect(args.data.updatedBy).toBe(BigInt("1"));
    expect(args.data.tenantId).toBe(BigInt("1"));
    expect(args.data.ownerCustomerId).toBe(OWNER_ID);
    expect(args.data.profileCompleteness).toBe(40); // name20+owner10+type10
  });

  it("创建宠物：请求参数伪造 tenantId=999 被忽略，归属恒为上下文租户 1", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce({ id: OWNER_ID });
    petDelegate.create.mockResolvedValueOnce({ id: "uuid-1" });
    petBehaviorTagDelegate.findMany.mockResolvedValueOnce([]);
    behaviorTagDelegate.findMany.mockResolvedValueOnce([]);

    await withContext(() =>
      service.createPet({ ...baseCreateDto, ...({ tenantId: "999" } as object) })
    );

    const args = petDelegate.create.mock.calls[0][0];
    expect(args.data.tenantId).toBe(BigInt("1"));
    expect(args.data.tenantId).not.toBe(BigInt("999"));
  });

  it("创建宠物：主人客户不存在/跨租户 → A0603，不落库", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce(null);

    await expectBusinessError(
      withContext(() => service.createPet(baseCreateDto)),
      "A0603"
    );
    expect(petDelegate.create).not.toHaveBeenCalled();
  });

  it("创建宠物：storeId 指向不存在/已软删门店 → A0604", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce({ id: OWNER_ID });
    storeDelegate.findFirst.mockResolvedValueOnce(null);

    await expectBusinessError(
      withContext(() =>
        service.createPet({ ...baseCreateDto, storeId: "00000000-0000-4000-8000-000000000000" })
      ),
      "A0604"
    );
  });

  it("创建宠物：behaviorTagIds 含跨租户/不存在的标签 → A0605", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce({ id: OWNER_ID });
    behaviorTagDelegate.findMany.mockResolvedValueOnce([]); // 一个都查不到

    await expectBusinessError(
      withContext(() => service.createPet({ ...baseCreateDto, behaviorTagIds: [TAG_ID] })),
      "A0605"
    );
    expect(petDelegate.create).not.toHaveBeenCalled();
  });

  it("创建宠物：带合法行为标签 → 关联落库 + 评分计入标签权重", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce({ id: OWNER_ID });
    behaviorTagDelegate.findMany.mockResolvedValueOnce([{ id: TAG_ID }]);
    petDelegate.create.mockResolvedValueOnce({ id: "uuid-1", name: "旺财" });
    petBehaviorTagDelegate.createMany.mockResolvedValueOnce({ count: 1 });
    petBehaviorTagDelegate.findMany.mockResolvedValueOnce([{ tagId: TAG_ID }]);
    behaviorTagDelegate.findMany.mockResolvedValueOnce([{ id: TAG_ID, name: "咬人" }]);

    const result = await withContext(() =>
      service.createPet({ ...baseCreateDto, behaviorTagIds: [TAG_ID] })
    );

    const createArgs = petDelegate.create.mock.calls[0][0];
    expect(createArgs.data.profileCompleteness).toBe(44); // 40 + 标签4
    expect(petBehaviorTagDelegate.createMany).toHaveBeenCalledTimes(1);
    expect(result.behaviorTags).toEqual([{ id: TAG_ID, name: "咬人" }]);
  });

  // ── 分页 ─────────────────────────────────────────────

  it("分页：petType/ownerCustomerId 精确 + name 模糊筛选进入 where，返回 data+page 结构", async () => {
    petDelegate.findMany.mockResolvedValueOnce([{ id: "uuid-1" }]);
    petDelegate.count.mockResolvedValueOnce(1);

    const result = await withContext(() =>
      service.getPetPage({ petType: 1, ownerCustomerId: OWNER_ID, name: "旺" } as QueryPetDto)
    );

    expect(result.page).toEqual({ pageNum: 1, pageSize: 20, total: 1 });
    // 列表行为「pet 行 + 跨域展示字段」（主人/门店名批量回查，缺关联回退 null）
    expect(result.data).toMatchObject([
      { id: "uuid-1", ownerName: null, ownerMobile: null, storeName: null },
    ]);
    const args = petDelegate.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      deletedAt: null,
      petType: 1,
      ownerCustomerId: OWNER_ID,
      name: { contains: "旺" },
    });
  });

  it("分页/详情：批量回查主人与门店展示名（两表各一次 in，非 N+1；缺关联回退 null）", async () => {
    const petA = {
      id: "uuid-a",
      ownerCustomerId: OWNER_ID,
      storeId: "33333333-3333-4333-8333-333333333333",
    };
    const petB = { id: "uuid-b", ownerCustomerId: "no-such-customer", storeId: null };
    petDelegate.findMany.mockResolvedValueOnce([petA, petB]);
    petDelegate.count.mockResolvedValueOnce(2);
    customerDelegate.findMany.mockResolvedValueOnce([
      { id: OWNER_ID, name: "张小萌", mobile: "13800000001" },
    ]);
    storeDelegate.findMany.mockResolvedValueOnce([
      { id: "33333333-3333-4333-8333-333333333333", name: "总部旗舰店" },
    ]);

    const result = await withContext(() => service.getPetPage({} as QueryPetDto));

    expect(customerDelegate.findMany).toHaveBeenCalledTimes(1);
    expect(storeDelegate.findMany).toHaveBeenCalledTimes(1);
    // 不过滤 deletedAt：主人可能已被合并归档，仍应展示名称
    expect(customerDelegate.findMany.mock.calls[0][0]).toEqual({
      where: { id: { in: [OWNER_ID, "no-such-customer"] } },
      select: { id: true, name: true, mobile: true },
    });
    // storeId 为空的行不参与门店回查（in 集合已剔除）
    expect(storeDelegate.findMany.mock.calls[0][0]).toEqual({
      where: { id: { in: ["33333333-3333-4333-8333-333333333333"] } },
      select: { id: true, name: true },
    });
    expect(result.data[0]).toMatchObject({
      id: "uuid-a",
      ownerName: "张小萌",
      ownerMobile: "13800000001",
      storeName: "总部旗舰店",
    });
    expect(result.data[1]).toMatchObject({
      id: "uuid-b",
      ownerName: null,
      ownerMobile: null,
      storeName: null,
    });
  });

  it("详情：返回行为标签 + 主人 / 门店展示字段", async () => {
    const row = { id: "uuid-1", name: "旺财", ownerCustomerId: OWNER_ID, storeId: null };
    petDelegate.findFirst.mockResolvedValueOnce(row);
    petBehaviorTagDelegate.findMany.mockResolvedValueOnce([{ tagId: TAG_ID }]);
    behaviorTagDelegate.findMany.mockResolvedValueOnce([{ id: TAG_ID, name: "咬人" }]);
    customerDelegate.findMany.mockResolvedValueOnce([
      { id: OWNER_ID, name: "李阿福", mobile: "13900000002" },
    ]);

    const result = await withContext(() => service.getPetDetail("uuid-1"));

    expect(result).toMatchObject({
      id: "uuid-1",
      behaviorTags: [{ id: TAG_ID, name: "咬人" }],
      ownerName: "李阿福",
      ownerMobile: "13900000002",
      storeName: null,
    });
    // storeId 为空（租户级档案）⇒ 不产生门店查询
    expect(storeDelegate.findMany).not.toHaveBeenCalled();
  });

  it("分页：排序白名单外字段回落 createdAt（方向沿用入参 asc），非法分页参数回落 1/20", async () => {
    petDelegate.findMany.mockResolvedValueOnce([]);
    petDelegate.count.mockResolvedValueOnce(0);

    await withContext(() =>
      service.getPetPage({
        sortBy: "evilField",
        order: "asc",
        pageNum: -3,
        pageSize: 0,
      } as unknown as QueryPetDto)
    );

    const args = petDelegate.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual({ createdAt: "asc" });
    expect(args.skip).toBe(0);
    expect(args.take).toBe(20);
  });

  // ── 详情 ─────────────────────────────────────────────

  it("详情：命中返回记录并附加行为标签", async () => {
    const row = { id: "uuid-1", name: "旺财" };
    petDelegate.findFirst.mockResolvedValueOnce(row);
    petBehaviorTagDelegate.findMany.mockResolvedValueOnce([{ tagId: TAG_ID }]);
    behaviorTagDelegate.findMany.mockResolvedValueOnce([{ id: TAG_ID, name: "应激" }]);

    const result = await withContext(() => service.getPetDetail("uuid-1"));

    expect(result).toMatchObject({ id: "uuid-1", behaviorTags: [{ id: TAG_ID, name: "应激" }] });
    expect(petDelegate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "uuid-1", deletedAt: null } })
    );
  });

  it("详情：不存在（含已软删）→ A0601", async () => {
    petDelegate.findFirst.mockResolvedValueOnce(null);

    await expectBusinessError(
      withContext(() => service.getPetDetail("uuid-missing")),
      "A0601"
    );
  });

  // ── 更新 ─────────────────────────────────────────────

  it("更新：version 乐观锁命中 → version 自增 + updatedBy 注入 + 评分重算", async () => {
    const updated = {
      id: "uuid-1",
      name: "旺财",
      ownerCustomerId: OWNER_ID,
      petType: 1,
      birthday: new Date("2020-01-01T00:00:00.000Z"),
      weightKg: null,
      photoUrl: null,
      photos: null,
      breed: null,
      sterilized: null,
      chipNo: null,
      coatColor: null,
      version: 1,
    };
    petDelegate.update
      .mockResolvedValueOnce(updated) // 主更新
      .mockResolvedValueOnce(updated); // 评分回写
    petDelegate.findFirstOrThrow
      .mockResolvedValueOnce(updated) // 更新后回读
      .mockResolvedValueOnce(updated); // 最终返回
    petBehaviorTagDelegate.count.mockResolvedValueOnce(0);
    petBehaviorTagDelegate.findMany.mockResolvedValueOnce([]);
    behaviorTagDelegate.findMany.mockResolvedValueOnce([]);

    const result = await withContext(() =>
      service.updatePet("uuid-1", { version: 0, birthday: "2020-01-01" } as UpdatePetDto)
    );

    expect(result.id).toBe("uuid-1");
    const mainArgs = petDelegate.update.mock.calls[0][0];
    expect(mainArgs.where).toEqual({ id: "uuid-1", version: 0, deletedAt: null });
    expect(mainArgs.data.version).toEqual({ increment: 1 });
    expect(mainArgs.data.updatedBy).toBe(BigInt("1"));
    expect(mainArgs.data.birthday).toEqual(new Date("2020-01-01T00:00:00.000Z"));
    // 评分回写：40（基础）+ birthday 10 = 50
    const scoreArgs = petDelegate.update.mock.calls[1][0];
    expect(scoreArgs.data.profileCompleteness).toBe(50);
  });

  it("更新：版本冲突（记录存在）→ A0602", async () => {
    petDelegate.update.mockRejectedValueOnce({ code: "P2025" });
    petDelegate.findFirst.mockResolvedValueOnce({ id: "uuid-1" }); // 回查存在

    await expectBusinessError(
      withContext(() => service.updatePet("uuid-1", { version: 0, name: "并发覆盖" })),
      "A0602"
    );
  });

  it("更新：记录不存在（含已软删）→ A0601", async () => {
    petDelegate.update.mockRejectedValueOnce({ code: "P2025" });
    petDelegate.findFirst.mockResolvedValueOnce(null); // 回查不存在

    await expectBusinessError(
      withContext(() => service.updatePet("uuid-missing", { version: 0, name: "x" })),
      "A0601"
    );
  });

  it("更新：ownerCustomerId 变更为不存在客户 → A0603（不落库）", async () => {
    customerDelegate.findFirst.mockResolvedValueOnce(null);

    await expectBusinessError(
      withContext(() => service.updatePet("uuid-1", { version: 0, ownerCustomerId: OWNER_ID })),
      "A0603"
    );
    expect(petDelegate.update).not.toHaveBeenCalled();
  });

  it("更新：behaviorTagIds 全量替换（空数组=清空）", async () => {
    const updated = { id: "uuid-1", name: "旺财", ownerCustomerId: OWNER_ID, petType: 1 };
    petDelegate.update.mockResolvedValueOnce(updated).mockResolvedValueOnce(updated);
    petDelegate.findFirstOrThrow.mockResolvedValueOnce(updated).mockResolvedValueOnce(updated);
    petBehaviorTagDelegate.deleteMany.mockResolvedValueOnce({ count: 2 });
    petBehaviorTagDelegate.count.mockResolvedValueOnce(0);
    petBehaviorTagDelegate.findMany.mockResolvedValueOnce([]);
    behaviorTagDelegate.findMany.mockResolvedValueOnce([]);

    await withContext(() =>
      service.updatePet("uuid-1", { version: 0, behaviorTagIds: [] } as UpdatePetDto)
    );

    expect(petBehaviorTagDelegate.deleteMany).toHaveBeenCalledWith({ where: { petId: "uuid-1" } });
    expect(petBehaviorTagDelegate.createMany).not.toHaveBeenCalled();
  });

  // ── 软删 ─────────────────────────────────────────────

  it("软删：置 deletedAt + updatedBy + 清行为标签关联，成功返回 true", async () => {
    petDelegate.findFirst.mockResolvedValueOnce({ id: "uuid-1" });
    petDelegate.update.mockResolvedValueOnce({ id: "uuid-1", deletedAt: new Date() });
    petBehaviorTagDelegate.deleteMany.mockResolvedValueOnce({ count: 1 });

    const result = await withContext(() => service.softDeletePet("uuid-1"));

    expect(result).toBe(true);
    const args = petDelegate.update.mock.calls[0][0];
    expect(args.data.deletedAt).toBeTruthy();
    expect(args.data.updatedBy).toBe(BigInt("1"));
    expect(petBehaviorTagDelegate.deleteMany).toHaveBeenCalledWith({ where: { petId: "uuid-1" } });
  });

  it("软删：不存在（含已软删）→ A0601，不重复置位", async () => {
    petDelegate.findFirst.mockResolvedValueOnce(null);

    await expectBusinessError(
      withContext(() => service.softDeletePet("uuid-missing")),
      "A0601"
    );
    expect(petDelegate.update).not.toHaveBeenCalled();
  });
});
