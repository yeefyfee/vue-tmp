import "reflect-metadata";

import type { PrismaService } from "../common/prisma/prisma.service";
import { RequestContext } from "../common/context/request-context";
import { BusinessException } from "../common/exceptions/business.exception";

import { BehaviorTagService } from "./behavior-tag.service";
import { BehaviorTagLinkageService } from "./behavior-tag-linkage.service";
import { BehaviorTagError, BehaviorTagStatus } from "./behavior-tag.constants";
import type { CreateBehaviorTagDto } from "./dto/create-behavior-tag.dto";
import type { UpdateBehaviorTagDto } from "./dto/update-behavior-tag.dto";
import type { QueryBehaviorTagDto } from "./dto/query-behavior-tag.dto";
import type { ReplacePetTagsDto } from "./dto/replace-pet-tags.dto";

/**
 * 行为标签服务单测（P0-06-05 · FR-4）
 *
 * 覆盖：标签库 CRUD（同名冲突 A0610 / 软删同名复活 / 创建字段注入 / 列表筛选与
 * 排序白名单 / 更新乐观锁 A0612 + 不存在 A0611 + 改名查重 A0610 / 软删清关联 +
 * 受影响宠物重算）、宠物打标签全量替换（A0601 / A0605 / 差分联动钩子 / 完整度重算）
 * 以及联动钩子最小实现的短路语义。
 *
 * PrismaService 与 BehaviorTagLinkageService 全 mock，经 `RequestContext.run`
 * 提供 ALS 上下文（userId=1 / tenantId=1）。
 */
describe("BehaviorTagService（P0-06-05 行为标签 FR-4）", () => {
  const behaviorTagDelegate = {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const petBehaviorTagDelegate = {
    findMany: jest.fn(),
    createMany: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn(),
  };
  const petDelegate = {
    findFirst: jest.fn(),
    findFirstOrThrow: jest.fn(),
    update: jest.fn(),
  };

  const prismaMock = {
    scoped: {
      behaviorTag: behaviorTagDelegate,
      petBehaviorTag: petBehaviorTagDelegate,
      pet: petDelegate,
    },
  } as unknown as PrismaService;

  const linkageMock = { onTagsChanged: jest.fn() };
  let service: BehaviorTagService;

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

  const TAG_ID = "22222222-2222-4222-8222-222222222222";
  const OLD_TAG_ID = "33333333-3333-4333-8333-333333333333";
  const PET_ID = "44444444-4444-4444-8444-444444444444";

  const petRow = {
    id: PET_ID,
    tenantId: BigInt("1"),
    name: "旺财",
    ownerCustomerId: "11111111-1111-4111-8111-111111111111",
    petType: 1,
    weightKg: null,
    birthday: null,
    photoUrl: null,
    photos: null,
    breed: null,
    sterilized: null,
    chipNo: null,
    coatColor: null,
    profileCompleteness: 0,
  };

  beforeEach(() => {
    jest.resetAllMocks();
    service = new BehaviorTagService(
      prismaMock,
      linkageMock as unknown as BehaviorTagLinkageService
    );
  });

  // ── 创建 ─────────────────────────────────────────────

  it("创建：存活同名标签 → A0610，不落库", async () => {
    behaviorTagDelegate.findFirst.mockResolvedValueOnce({ id: TAG_ID, deletedAt: null });

    await expectBusinessError(
      withContext(() => service.createBehaviorTag({ name: "咬人" } as CreateBehaviorTagDto)),
      BehaviorTagError.NAME_DUPLICATED.code
    );
    expect(behaviorTagDelegate.create).not.toHaveBeenCalled();
  });

  it("创建：软删同名标签 → 复活（复用 id，清 deletedAt，version 自增）", async () => {
    behaviorTagDelegate.findFirst.mockResolvedValueOnce({ id: TAG_ID, deletedAt: new Date() });
    behaviorTagDelegate.update.mockResolvedValueOnce({ id: TAG_ID, name: "咬人" });

    const result = await withContext(() =>
      service.createBehaviorTag({
        name: "咬人",
        sort: 3,
        status: BehaviorTagStatus.DISABLED,
      } as CreateBehaviorTagDto)
    );

    expect(result).toMatchObject({ id: TAG_ID });
    const args = behaviorTagDelegate.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: TAG_ID });
    expect(args.data.deletedAt).toBeNull();
    expect(args.data.sort).toBe(3);
    expect(args.data.status).toBe(0);
    expect(args.data.version).toEqual({ increment: 1 });
    expect(behaviorTagDelegate.create).not.toHaveBeenCalled();
  });

  it("创建：全新标签 → 注入 tenantId/createdBy/updatedBy，sort/status 取默认，name 去空格", async () => {
    behaviorTagDelegate.findFirst.mockResolvedValueOnce(null);
    behaviorTagDelegate.create.mockResolvedValueOnce({ id: TAG_ID });

    await withContext(() =>
      service.createBehaviorTag({ name: "  应激  " } as CreateBehaviorTagDto)
    );

    const args = behaviorTagDelegate.create.mock.calls[0][0];
    expect(args.data.tenantId).toBe(BigInt("1"));
    expect(args.data.createdBy).toBe(BigInt("1"));
    expect(args.data.updatedBy).toBe(BigInt("1"));
    expect(args.data.name).toBe("应激");
    expect(args.data.sort).toBe(0);
    expect(args.data.status).toBe(1);
  });

  it("创建：并发唯一键 P2002 兜底 → A0610", async () => {
    behaviorTagDelegate.findFirst.mockResolvedValueOnce(null);
    behaviorTagDelegate.create.mockRejectedValueOnce({ code: "P2002" });

    await expectBusinessError(
      withContext(() => service.createBehaviorTag({ name: "咬人" } as CreateBehaviorTagDto)),
      BehaviorTagError.NAME_DUPLICATED.code
    );
  });

  // ── 列表 ─────────────────────────────────────────────

  it("列表：name 模糊 + status 精确进入 where；未指定 sortBy 默认 sort 升序", async () => {
    behaviorTagDelegate.findMany.mockResolvedValueOnce([{ id: TAG_ID }]);
    behaviorTagDelegate.count.mockResolvedValueOnce(1);

    const result = await withContext(() =>
      service.getBehaviorTagPage({ name: "咬", status: 1 } as QueryBehaviorTagDto)
    );

    expect(result.page).toEqual({ pageNum: 1, pageSize: 20, total: 1 });
    const args = behaviorTagDelegate.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ deletedAt: null, name: { contains: "咬" }, status: 1 });
    expect(args.orderBy).toEqual({ sort: "asc" });
  });

  it("列表：排序白名单外字段回落默认（sort 升序），非法分页参数回落 1/20", async () => {
    behaviorTagDelegate.findMany.mockResolvedValueOnce([]);
    behaviorTagDelegate.count.mockResolvedValueOnce(0);

    await withContext(() =>
      service.getBehaviorTagPage({
        sortBy: "evil",
        pageNum: -1,
        pageSize: 0,
      } as unknown as QueryBehaviorTagDto)
    );

    const args = behaviorTagDelegate.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual({ sort: "asc" });
    expect(args.skip).toBe(0);
    expect(args.take).toBe(20);
  });

  it("列表：合法 sortBy=name desc 生效", async () => {
    behaviorTagDelegate.findMany.mockResolvedValueOnce([]);
    behaviorTagDelegate.count.mockResolvedValueOnce(0);

    await withContext(() =>
      service.getBehaviorTagPage({ sortBy: "name", order: "desc" } as QueryBehaviorTagDto)
    );

    expect(behaviorTagDelegate.findMany.mock.calls[0][0].orderBy).toEqual({ name: "desc" });
  });

  // ── 更新 ─────────────────────────────────────────────

  it("更新：version 乐观锁命中 → version 自增 + updatedBy 注入", async () => {
    behaviorTagDelegate.update.mockResolvedValueOnce({ id: TAG_ID, version: 1 });

    const result = await withContext(() =>
      service.updateBehaviorTag(TAG_ID, { version: 0, sort: 9 } as UpdateBehaviorTagDto)
    );

    expect(result).toEqual({ id: TAG_ID, version: 1 });
    const args = behaviorTagDelegate.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: TAG_ID, version: 0, deletedAt: null });
    expect(args.data.sort).toBe(9);
    expect(args.data.updatedBy).toBe(BigInt("1"));
    expect(args.data.version).toEqual({ increment: 1 });
  });

  it("更新：改名命中其他存活标签 → A0610（不落库）", async () => {
    behaviorTagDelegate.findFirst.mockResolvedValueOnce({ id: "other" });

    await expectBusinessError(
      withContext(() =>
        service.updateBehaviorTag(TAG_ID, { version: 0, name: "咬人" } as UpdateBehaviorTagDto)
      ),
      BehaviorTagError.NAME_DUPLICATED.code
    );
    expect(behaviorTagDelegate.update).not.toHaveBeenCalled();
  });

  it("更新：版本冲突（记录存在）→ A0612", async () => {
    behaviorTagDelegate.update.mockRejectedValueOnce({ code: "P2025" });
    behaviorTagDelegate.findFirst.mockResolvedValueOnce({ id: TAG_ID });

    await expectBusinessError(
      withContext(() =>
        service.updateBehaviorTag(TAG_ID, { version: 0, sort: 1 } as UpdateBehaviorTagDto)
      ),
      BehaviorTagError.VERSION_CONFLICT.code
    );
  });

  it("更新：记录不存在（含已软删）→ A0611", async () => {
    behaviorTagDelegate.update.mockRejectedValueOnce({ code: "P2025" });
    behaviorTagDelegate.findFirst.mockResolvedValueOnce(null);

    await expectBusinessError(
      withContext(() =>
        service.updateBehaviorTag(TAG_ID, { version: 0, sort: 1 } as UpdateBehaviorTagDto)
      ),
      BehaviorTagError.NOT_FOUND.code
    );
  });

  // ── 软删 ─────────────────────────────────────────────

  it("软删：不存在（含已软删）→ A0611，不置位", async () => {
    behaviorTagDelegate.findFirst.mockResolvedValueOnce(null);

    await expectBusinessError(
      withContext(() => service.softDeleteBehaviorTag(TAG_ID)),
      BehaviorTagError.NOT_FOUND.code
    );
    expect(behaviorTagDelegate.update).not.toHaveBeenCalled();
  });

  it("软删：置 deletedAt + 清该标签全部宠物关联 + 对受影响宠物重算完整度", async () => {
    behaviorTagDelegate.findFirst.mockResolvedValueOnce({ id: TAG_ID });
    // 受影响的关联行（含重复 petId → 去重后只重算一次）
    petBehaviorTagDelegate.findMany.mockResolvedValueOnce([{ petId: PET_ID }, { petId: PET_ID }]);
    petBehaviorTagDelegate.deleteMany.mockResolvedValueOnce({ count: 2 });
    behaviorTagDelegate.update.mockResolvedValueOnce({ id: TAG_ID, deletedAt: new Date() });
    // 重算：回读宠物 + 计数 + 回写
    petDelegate.findFirst.mockResolvedValueOnce(petRow);
    petBehaviorTagDelegate.count.mockResolvedValueOnce(0);
    petDelegate.update.mockResolvedValueOnce({});

    const result = await withContext(() => service.softDeleteBehaviorTag(TAG_ID));

    expect(result).toBe(true);
    expect(petBehaviorTagDelegate.deleteMany).toHaveBeenCalledWith({ where: { tagId: TAG_ID } });
    const tagUpdateArgs = behaviorTagDelegate.update.mock.calls[0][0];
    expect(tagUpdateArgs.data.deletedAt).toBeTruthy();
    expect(tagUpdateArgs.data.updatedBy).toBe(BigInt("1"));
    // 受影响宠物重算一次（去重）
    expect(petDelegate.update).toHaveBeenCalledTimes(1);
  });

  // ── 宠物打/取消标签（全量替换） ───────────────────────

  it("打标签：宠物不存在 → A0601", async () => {
    petDelegate.findFirst.mockResolvedValueOnce(null);

    await expectBusinessError(
      withContext(() =>
        service.setPetTags(PET_ID, { behaviorTagIds: [TAG_ID] } as ReplacePetTagsDto)
      ),
      "A0601"
    );
    expect(petBehaviorTagDelegate.createMany).not.toHaveBeenCalled();
  });

  it("打标签：标签不存在/跨租户 → A0605，不落库", async () => {
    petDelegate.findFirst.mockResolvedValueOnce(petRow);
    behaviorTagDelegate.findMany.mockResolvedValueOnce([]); // 一个都查不到

    await expectBusinessError(
      withContext(() =>
        service.setPetTags(PET_ID, { behaviorTagIds: [TAG_ID] } as ReplacePetTagsDto)
      ),
      "A0605"
    );
    expect(petBehaviorTagDelegate.createMany).not.toHaveBeenCalled();
  });

  it("打标签：全量替换（先清后建）+ 差分联动钩子 added/removed + 完整度重算", async () => {
    petDelegate.findFirst
      .mockResolvedValueOnce(petRow) // 存在性
      .mockResolvedValueOnce(petRow); // 重算回读
    behaviorTagDelegate.findMany
      .mockResolvedValueOnce([{ id: TAG_ID }]) // 校验
      .mockResolvedValueOnce([{ id: TAG_ID, name: "咬人" }]); // 附加标签摘要
    petBehaviorTagDelegate.findMany
      .mockResolvedValueOnce([{ tagId: OLD_TAG_ID }]) // 现状
      .mockResolvedValueOnce([{ tagId: TAG_ID }]); // 附加关联
    petBehaviorTagDelegate.deleteMany.mockResolvedValueOnce({ count: 1 });
    petBehaviorTagDelegate.createMany.mockResolvedValueOnce({ count: 1 });
    petBehaviorTagDelegate.count.mockResolvedValueOnce(1);
    petDelegate.update.mockResolvedValueOnce({});
    petDelegate.findFirstOrThrow.mockResolvedValueOnce(petRow);
    linkageMock.onTagsChanged.mockResolvedValueOnce(undefined);

    const result = await withContext(() =>
      service.setPetTags(PET_ID, { behaviorTagIds: [TAG_ID] } as ReplacePetTagsDto)
    );

    // 先清后建
    expect(petBehaviorTagDelegate.deleteMany).toHaveBeenCalledWith({ where: { petId: PET_ID } });
    const createArgs = petBehaviorTagDelegate.createMany.mock.calls[0][0];
    expect(createArgs.data).toEqual([
      expect.objectContaining({ tenantId: BigInt("1"), petId: PET_ID, tagId: TAG_ID }),
    ]);
    // 差分联动：新增 TAG_ID / 摘除 OLD_TAG_ID
    expect(linkageMock.onTagsChanged).toHaveBeenCalledWith(PET_ID, [TAG_ID], [OLD_TAG_ID]);
    // 完整度回写（标签权重计入：基础 40 + 标签 4 = 44）
    expect(petDelegate.update.mock.calls[0][0].data.profileCompleteness).toBe(44);
    // 返回值含标签摘要
    expect(result.behaviorTags).toEqual([{ id: TAG_ID, name: "咬人" }]);
  });

  it("打标签：空数组=清空（删除全部关联，不建新关联）", async () => {
    petDelegate.findFirst.mockResolvedValueOnce(petRow).mockResolvedValueOnce(petRow);
    petBehaviorTagDelegate.findMany
      .mockResolvedValueOnce([{ tagId: OLD_TAG_ID }]) // 现状
      .mockResolvedValueOnce([]); // 附加关联（空）
    petBehaviorTagDelegate.deleteMany.mockResolvedValueOnce({ count: 1 });
    petBehaviorTagDelegate.count.mockResolvedValueOnce(0);
    petDelegate.update.mockResolvedValueOnce({});
    petDelegate.findFirstOrThrow.mockResolvedValueOnce(petRow);
    linkageMock.onTagsChanged.mockResolvedValueOnce(undefined);

    await withContext(() =>
      service.setPetTags(PET_ID, { behaviorTagIds: [] } as ReplacePetTagsDto)
    );

    expect(petBehaviorTagDelegate.deleteMany).toHaveBeenCalledWith({ where: { petId: PET_ID } });
    expect(petBehaviorTagDelegate.createMany).not.toHaveBeenCalled();
    expect(linkageMock.onTagsChanged).toHaveBeenCalledWith(PET_ID, [], [OLD_TAG_ID]);
  });
});

/**
 * 联动钩子服务单测（P0-06-05 FR-4）
 *
 * 最小实现契约：差分皆空时短路；非空时安全返回（不引入对未建模块的硬依赖）。
 */
describe("BehaviorTagLinkageService（P0-06-05 联动钩子）", () => {
  it("差分皆空 → 短路返回（不抛错）", async () => {
    const linkage = new BehaviorTagLinkageService();
    await expect(linkage.onTagsChanged("pet-1", [], [])).resolves.toBeUndefined();
  });

  it("有新增/摘除标签 → 安全返回（本轮最小实现仅日志）", async () => {
    const linkage = new BehaviorTagLinkageService();
    await expect(linkage.onTagsChanged("pet-1", ["a"], ["b"])).resolves.toBeUndefined();
  });
});
