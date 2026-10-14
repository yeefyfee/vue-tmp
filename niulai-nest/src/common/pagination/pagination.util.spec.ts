import "reflect-metadata";

import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import {
  ORDER_DIRECTIONS,
  PaginationQueryDto,
  buildFilterCondition,
  buildOrderBy,
  buildPrismaFindArgs,
  normalizePagination,
  resolveOrderDirection,
} from "./index";
import type { BuildFindArgsOptions, PageResult } from "./index";

/**
 * P0-07-02 统一分页 / 过滤 / 排序基座 单测
 *
 * 覆盖边界：
 *  - DTO：默认值、@Type 数字转换、page=0/负数、page_size=0/超上限、order 合法域
 *  - normalizePagination：缺省、非法回落、超上限截断、skip/take 推导、历史命名兼容
 *  - buildOrderBy：白名单命中 / 未命中回退 / 空白名单 / 方向归一 / 大小写宽容
 *  - buildPrismaFindArgs：输出结构、baseWhere 合并、等值 / 模糊过滤、空值跳过、
 *    transform 生效、白名单排序回退
 */

/** 便捷：对给定载荷跑一遍 DTO 校验，返回违反约束的属性名集合 */
async function invalidProps(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(PaginationQueryDto, payload);
  const errors = await validate(dto, { whitelist: false });
  return errors.map((e) => e.property);
}

describe("PaginationQueryDto（P0-07-02 分页 DTO）", () => {
  it("缺省：page=1、page_size=20，sort/order 未提供", () => {
    const dto = plainToInstance(PaginationQueryDto, {});
    expect(dto.page).toBe(1);
    expect(dto.page_size).toBe(20);
    expect(dto.sort).toBeUndefined();
    expect(dto.order).toBeUndefined();
  });

  it("@Type(() => Number)：query 字符串按数字转换", () => {
    const dto = plainToInstance(PaginationQueryDto, { page: "3", page_size: "50" });
    expect(dto.page).toBe(3);
    expect(dto.page_size).toBe(50);
  });

  it("边界：page=0 / 负数 校验失败（@Min(1)）", async () => {
    expect(await invalidProps({ page: 0 })).toContain("page");
    expect(await invalidProps({ page: -5 })).toContain("page");
  });

  it("边界：page_size=0 与超上限 101 校验失败（@Min/@Max）", async () => {
    expect(await invalidProps({ page_size: 0 })).toContain("page_size");
    expect(await invalidProps({ page_size: 101 })).toContain("page_size");
  });

  it("边界：page_size=100 恰好通过；非整数 page 校验失败（@IsInt）", async () => {
    expect(await invalidProps({ page_size: 100 })).not.toContain("page_size");
    expect(await invalidProps({ page: 1.5 })).toContain("page");
  });

  it("order 值域：asc/desc 通过，其他值失败（@IsIn）", async () => {
    expect(ORDER_DIRECTIONS).toEqual(["asc", "desc"]);
    expect(await invalidProps({ order: "asc" })).not.toContain("order");
    expect(await invalidProps({ order: "desc" })).not.toContain("order");
    expect(await invalidProps({ order: "random" })).toContain("order");
    expect(await invalidProps({ order: "ASC" })).toContain("order");
  });

  it("可被业务列表 DTO 继承扩展（追加自定义筛选字段）", () => {
    class QueryPetDto extends PaginationQueryDto {
      name?: string;
    }
    const dto = plainToInstance(QueryPetDto, { page: "2", page_size: "10", order: "asc" });
    expect(dto).toBeInstanceOf(QueryPetDto);
    expect(dto.page).toBe(2);
    expect(dto.page_size).toBe(10);
    expect(dto.order).toBe("asc");
  });
});

describe("normalizePagination（P0-07-02 分页归一）", () => {
  it("缺省回落默认 page=1 / page_size=20，skip=0 / take=20", () => {
    expect(normalizePagination()).toEqual({ page: 1, page_size: 20, skip: 0, take: 20 });
    expect(normalizePagination({})).toEqual({ page: 1, page_size: 20, skip: 0, take: 20 });
  });

  it("page=0 / 负数 防御性回落为 1（skip=0）", () => {
    expect(normalizePagination({ page: 0 }).page).toBe(1);
    expect(normalizePagination({ page: -3 }).page).toBe(1);
    expect(normalizePagination({ page: -3 }).skip).toBe(0);
  });

  it("page_size=0 / 负数 / 非数字 回落为 20", () => {
    expect(normalizePagination({ page_size: 0 }).take).toBe(20);
    expect(normalizePagination({ page_size: -5 }).take).toBe(20);
    expect(normalizePagination({ page_size: "abc" }).take).toBe(20);
  });

  it("page_size 超上限截断为 100", () => {
    expect(normalizePagination({ page_size: 999 }).take).toBe(100);
    expect(normalizePagination({ page_size: 101 }).page_size).toBe(100);
  });

  it("skip/take 推导正确：page=3 / page_size=50 → skip=100 / take=50", () => {
    expect(normalizePagination({ page: 3, page_size: 50 })).toEqual({
      page: 3,
      page_size: 50,
      skip: 100,
      take: 50,
    });
  });

  it("兼容历史命名 pageNum / pageSize", () => {
    const params = normalizePagination({ pageNum: 4, pageSize: 30 });
    expect(params).toEqual({ page: 4, page_size: 30, skip: 90, take: 30 });
  });
});

describe("resolveOrderDirection（方向归一）", () => {
  it("识别 asc / desc（大小写不敏感），其余回退默认 desc", () => {
    expect(resolveOrderDirection("asc")).toBe("asc");
    expect(resolveOrderDirection("DESC")).toBe("desc");
    expect(resolveOrderDirection("Asc")).toBe("asc");
    expect(resolveOrderDirection(undefined)).toBe("desc");
    expect(resolveOrderDirection("nope")).toBe("desc");
    expect(resolveOrderDirection(123)).toBe("desc");
  });

  it("显式默认方向生效（defaultOrder=asc）", () => {
    expect(resolveOrderDirection(undefined, "asc")).toBe("asc");
    expect(resolveOrderDirection("weird", "asc")).toBe("asc");
  });
});

describe("buildOrderBy（排序白名单）", () => {
  const allowed = ["createdAt", "name", "mobile"] as const;

  it("白名单命中：按入参 sort / order 构造", () => {
    expect(buildOrderBy("name", "asc", allowed)).toEqual({ name: "asc" });
    expect(buildOrderBy("mobile", "desc", allowed)).toEqual({ mobile: "desc" });
  });

  it("白名单未命中：回退 fallbackSort", () => {
    expect(buildOrderBy("evilField", "asc", allowed, "createdAt")).toEqual({
      createdAt: "asc",
    });
  });

  it("白名单未命中且无 fallback：回退白名单首项", () => {
    expect(buildOrderBy("evilField", "asc", allowed)).toEqual({ createdAt: "asc" });
  });

  it("order 缺失 → 默认 desc；非法 order → 默认 desc", () => {
    expect(buildOrderBy("name", undefined, allowed)).toEqual({ name: "desc" });
    expect(buildOrderBy("name", "sideways", allowed)).toEqual({ name: "desc" });
  });

  it("空白名单 → 返回 undefined（禁用排序）", () => {
    expect(buildOrderBy("name", "asc", [])).toBeUndefined();
    expect(buildOrderBy("name", "asc", undefined as unknown as string[])).toBeUndefined();
  });

  it("sort 非字符串（对象 / 数字）→ 回退，不透传", () => {
    expect(buildOrderBy({ evil: 1 } as unknown, "asc", allowed, "createdAt")).toEqual({
      createdAt: "asc",
    });
    expect(buildOrderBy(123 as unknown, "asc", allowed, "createdAt")).toEqual({
      createdAt: "asc",
    });
  });
});

describe("buildFilterCondition（过滤算子编译）", () => {
  it("equals → 原始标量", () => {
    expect(buildFilterCondition("equals", "138")).toBe("138");
  });

  it("contains / startsWith / endsWith → 对象片段，insensitive 附加 mode", () => {
    expect(buildFilterCondition("contains", "小萌")).toEqual({ contains: "小萌" });
    expect(buildFilterCondition("contains", "meng", "insensitive")).toEqual({
      contains: "meng",
      mode: "insensitive",
    });
    expect(buildFilterCondition("startsWith", "SD")).toEqual({ startsWith: "SD" });
    expect(buildFilterCondition("endsWith", "01")).toEqual({ endsWith: "01" });
  });

  it("in → 数组包裹；gte / lte → 区间片段", () => {
    expect(buildFilterCondition("in", [1, 2, 3])).toEqual({ in: [1, 2, 3] });
    expect(buildFilterCondition("in", 1)).toEqual({ in: [1] });
    expect(buildFilterCondition("gte", 10)).toEqual({ gte: 10 });
    expect(buildFilterCondition("lte", 20)).toEqual({ lte: 20 });
  });
});

describe("buildPrismaFindArgs（findMany 参数一条龙）", () => {
  const baseOptions: BuildFindArgsOptions = {
    allowedSortFields: ["createdAt", "name", "mobile"],
    fallbackSort: "createdAt",
    baseWhere: { deletedAt: null },
    filters: [
      { field: "mobile", op: "equals" },
      { field: "name", op: "contains" },
      { field: "storeId", op: "equals" },
    ],
  };

  it("输出结构：含 skip / take / orderBy / where 四键", () => {
    const args = buildPrismaFindArgs({}, baseOptions);
    expect(Object.keys(args).sort()).toEqual(["orderBy", "skip", "take", "where"]);
    expect(args.skip).toBe(0);
    expect(args.take).toBe(20);
    expect(args.orderBy).toEqual({ createdAt: "desc" });
    expect(args.where).toEqual({ deletedAt: null });
  });

  it("过滤：等值 + 模糊进 where，空值维度跳过，baseWhere 合并", () => {
    const args = buildPrismaFindArgs(
      { mobile: "13800138000", name: "小萌", page: 2, page_size: 10 },
      baseOptions
    );
    expect(args.where).toEqual({
      deletedAt: null,
      mobile: "13800138000",
      name: { contains: "小萌" },
    });
    expect(args.skip).toBe(10);
    expect(args.take).toBe(10);
  });

  it("过滤：undefined / null / 空串 不进入 where", () => {
    const args = buildPrismaFindArgs({ mobile: "", name: null, storeId: undefined }, baseOptions);
    expect(args.where).toEqual({ deletedAt: null });
  });

  it("过滤：transform 生效，转换后为空则跳过该维度", () => {
    const options: BuildFindArgsOptions = {
      allowedSortFields: ["createdAt"],
      baseWhere: { deletedAt: null },
      filters: [
        {
          field: "status",
          op: "equals",
          transform: (v) => (v === null || v === undefined ? null : Number(v)),
        },
      ],
    };
    expect(buildPrismaFindArgs({ status: "2" }, options).where).toEqual({
      deletedAt: null,
      status: 2,
    });
    // "abc" → Number 得 NaN（非 null）→ 仍进 where；显式返回 null 才跳过
    const skipped = buildPrismaFindArgs(
      { status: "x" },
      { ...options, filters: [{ field: "status", op: "equals", transform: () => null }] }
    );
    expect(skipped.where).toEqual({ deletedAt: null });
  });

  it("过滤：source 覆盖取值键（query 键名 ≠ 目标字段）", () => {
    const options: BuildFindArgsOptions = {
      allowedSortFields: ["createdAt"],
      filters: [{ field: "ownerCustomerId", source: "owner", op: "equals" }],
    };
    expect(buildPrismaFindArgs({ owner: "uuid-1" }, options).where).toEqual({
      ownerCustomerId: "uuid-1",
    });
  });

  it("过滤：in / gte / lte 算子与 insensitive 模糊", () => {
    const options: BuildFindArgsOptions = {
      allowedSortFields: ["createdAt"],
      filters: [
        { field: "status", op: "in", transform: (v) => String(v).split(",") },
        { field: "createdAt", op: "gte" },
        { field: "name", op: "contains", mode: "insensitive" },
      ],
    };
    const args = buildPrismaFindArgs(
      { status: "1,2,3", createdAt: "2026-10-01", name: "meng" },
      options
    );
    expect(args.where).toEqual({
      status: { in: ["1", "2", "3"] },
      createdAt: { gte: "2026-10-01" },
      name: { contains: "meng", mode: "insensitive" },
    });
  });

  it("排序：白名单外 sort 回退 fallbackSort，方向沿用入参", () => {
    const args = buildPrismaFindArgs(
      { sort: "evilField", order: "asc", page_size: 200 },
      baseOptions
    );
    expect(args.orderBy).toEqual({ createdAt: "asc" });
    expect(args.take).toBe(100);
  });

  it("排序：白名单命中 sort 覆盖 fallbackSort", () => {
    const args = buildPrismaFindArgs({ sort: "mobile", order: "asc" }, baseOptions);
    expect(args.orderBy).toEqual({ mobile: "asc" });
  });

  it("无 filters / 无 baseWhere 时 where 为空对象，orderBy 缺省 createdAt desc", () => {
    const args = buildPrismaFindArgs({}, { allowedSortFields: ["createdAt"] });
    expect(args.where).toEqual({});
    expect(args.orderBy).toEqual({ createdAt: "desc" });
  });

  it("defaultOrder=asc 时缺省方向为 asc", () => {
    const args = buildPrismaFindArgs({}, { allowedSortFields: ["createdAt"], defaultOrder: "asc" });
    expect(args.orderBy).toEqual({ createdAt: "asc" });
  });

  it("结果可直接组装为统一列表信封 { list, total, page, page_size }", () => {
    const args = buildPrismaFindArgs({ page: 2, page_size: 10 }, baseOptions);
    const result: PageResult<{ id: string }> = {
      list: [{ id: "uuid-1" }],
      total: 42,
      page: args.skip / args.take + 1,
      page_size: args.take,
    };
    expect(result).toEqual({ list: [{ id: "uuid-1" }], total: 42, page: 2, page_size: 10 });
  });
});
