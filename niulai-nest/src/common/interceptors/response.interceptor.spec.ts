import type { Observable } from "rxjs";
import { of, lastValueFrom } from "rxjs";
import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { isPageResult } from "@peluvida/shared";
import { ResponseInterceptor } from "./response.interceptor";

/**
 * 响应拦截器单测 —— 覆盖 PEL-08「分页信封增量改造」
 *
 * 验收口径：
 * 1. 分页载荷返回 `list / total / page / page_size`；
 * 2. 外层保持 `code / msg / data` 不变；
 * 3. 存量前端读取 `data.list` / `data.total` 不回归；
 * 4. `page / page_size` 支持业务层 pageNum/pageSize、请求 query、默认值三级回落。
 */
describe("ResponseInterceptor（PEL-08 分页信封）", () => {
  function createInterceptor(skip = false): ResponseInterceptor<unknown> {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(skip) } as any;
    return new ResponseInterceptor<unknown>(reflector);
  }

  function createContext(query: Record<string, unknown> = {}): ExecutionContext {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ query }) }),
    } as any;
  }

  function callHandler(payload: unknown): CallHandler {
    return { handle: () => of(payload) } as CallHandler;
  }

  async function run(
    interceptor: ResponseInterceptor<unknown>,
    ctx: ExecutionContext,
    payload: unknown
  ): Promise<any> {
    return lastValueFrom(interceptor.intercept(ctx, callHandler(payload)) as Observable<any>);
  }

  it("分页载荷：输出 list / total / page / page_size", async () => {
    const res = await run(createInterceptor(), createContext(), {
      data: [{ id: 1 }, { id: 2 }],
      page: { pageNum: 2, pageSize: 20, total: 42 },
    });

    expect(res.code).toBe("00000");
    expect(res.msg).toBe("成功");
    expect(res.data.list).toEqual([{ id: 1 }, { id: 2 }]);
    expect(res.data.total).toBe(42);
    expect(res.data.page).toBe(2);
    expect(res.data.page_size).toBe(20);
  });

  it("外层结构保持 code / msg / data（存量前端零回归）", async () => {
    const res = await run(createInterceptor(), createContext(), {
      data: [],
      page: { pageNum: 1, pageSize: 10, total: 0 },
    });

    expect(Object.keys(res).sort()).toEqual(["code", "data", "msg"]);
    expect(res.data).toHaveProperty("list");
    expect(res.data).toHaveProperty("total");
  });

  it("page_size 超过上限 100 时截断", async () => {
    const res = await run(createInterceptor(), createContext(), {
      data: [],
      page: { pageNum: 1, pageSize: 999, total: 0 },
    });

    expect(res.data.page_size).toBe(100);
  });

  it("业务层未返回页码时回落到请求 query", async () => {
    const res = await run(createInterceptor(), createContext({ page: "3", page_size: "5" }), {
      data: [],
      page: { total: 8 },
    });

    expect(res.data.page).toBe(3);
    expect(res.data.page_size).toBe(5);
    expect(res.data.total).toBe(8);
  });

  it("业务层与 query 均缺失时使用默认值 1 / 20", async () => {
    const res = await run(createInterceptor(), createContext(), {
      data: [],
      page: { total: 3 },
    });

    expect(res.data.page).toBe(1);
    expect(res.data.page_size).toBe(20);
  });

  it("兼容 page.page / page.page_size 命名", async () => {
    const res = await run(createInterceptor(), createContext(), {
      data: [],
      page: { page: 4, page_size: 15, total: 60 },
    });

    expect(res.data.page).toBe(4);
    expect(res.data.page_size).toBe(15);
  });

  it("total 非数字时归零；list 非数组时归空数组", async () => {
    const res = await run(createInterceptor(), createContext(), {
      data: null,
      page: { pageNum: 1, pageSize: 20, total: undefined },
    });

    expect(res.data.list).toEqual([]);
    expect(res.data.total).toBe(0);
  });

  it("输出字段与 @peluvida/shared 的 PageResult 契约一致", async () => {
    const res = await run(createInterceptor(), createContext(), {
      data: [{ id: 1 }],
      page: { pageNum: 1, pageSize: 20, total: 1 },
    });

    // 直接复用共享包的类型守卫，避免契约与实现各写一份口径
    expect(isPageResult(res.data)).toBe(true);
    expect(Object.keys(res.data).sort()).toEqual(["list", "page", "page_size", "total"]);
  });

  it("普通对象含 data + page 但 page 非分页元信息时，不得被误判为分页", async () => {
    const payload = { data: { realPayload: 1 }, page: { theme: "dark" } };
    const res = await run(createInterceptor(), createContext(), payload);

    expect(res.data).toEqual(payload);
    expect(res.data).not.toHaveProperty("list");
    expect(res.data).not.toHaveProperty("page_size");
  });

  it("page 仅含非数字 total、无页码信息时，不判定为分页", async () => {
    const res = await run(createInterceptor(), createContext(), {
      data: [1, 2],
      page: { total: "30" },
    });

    expect(res.data.list).toBeUndefined();
    expect(res.data.page_size).toBeUndefined();
  });

  it("兼容历史命名：有 pageNum + pageSize 但缺 total 时仍识别为分页", async () => {
    const res = await run(createInterceptor(), createContext(), {
      data: [1, 2],
      page: { pageNum: 3, pageSize: 10 },
    });

    expect(res.data.list).toEqual([1, 2]);
    expect(res.data.total).toBe(0);
    expect(res.data.page).toBe(3);
    expect(res.data.page_size).toBe(10);
  });

  it("非分页载荷：原样包裹，不附加分页字段", async () => {
    const res = await run(createInterceptor(), createContext(), { id: 7, name: "豆豆" });

    expect(res.code).toBe("00000");
    expect(res.data).toEqual({ id: 7, name: "豆豆" });
    expect(res.data).not.toHaveProperty("list");
    expect(res.data).not.toHaveProperty("page_size");
  });

  it("标注 skipResponseTransform 时透传原始载荷", async () => {
    const res = await run(createInterceptor(true), createContext(), { raw: true });

    expect(res).toEqual({ raw: true });
  });
});
