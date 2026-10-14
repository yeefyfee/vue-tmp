import type { Request, Response } from "express";
import { RequestContextMiddleware } from "./request-context.middleware";
import { RequestContext } from "../context/request-context";

/**
 * 请求上下文中间件单测（CROSS-14 trace_id + P0-01-04 统一请求头锚点）
 *
 * ALS store 只在 run() 回调内可见（踩坑 6）——断言必须在 next() 回调内完成。
 */

describe("RequestContextMiddleware", () => {
  let middleware: RequestContextMiddleware;
  let req: Partial<Request> & { headers: Record<string, string> };
  let res: Partial<Response>;
  let next: () => void;

  /** 在 next 回调（ALS store 可见窗口）内断言 */
  function runMiddleware(insideStore: () => void): void {
    next = () => insideStore();
    middleware.use(req as Request, res as Response, next);
  }

  beforeEach(() => {
    middleware = new RequestContextMiddleware();
    req = { headers: {} };
    res = { setHeader: jest.fn() };
  });

  it("无任何请求头：生成 traceId 并写回响应头；新增锚点均为 null", () => {
    runMiddleware(() => {
      const traceId = RequestContext.getTraceId();
      expect(traceId).toBeTruthy();
      expect(res.setHeader).toHaveBeenCalledWith("X-Trace-Id", traceId);
      expect(RequestContext.getStoreId()).toBeNull();
      expect(RequestContext.getClient()).toBeNull();
      expect(RequestContext.getIdempotencyKey()).toBeNull();
    });
  });

  it("X-Store-Id / X-Client / Idempotency-Key 全携带：逐项写入上下文", () => {
    req.headers = {
      "x-store-id": "  42  ",
      "x-client": "staff",
      "idempotency-key": "order-create-2f1c",
    };

    runMiddleware(() => {
      // 中间件已 trim
      expect(RequestContext.getStoreId()).toBe("42");
      expect(RequestContext.getClient()).toBe("staff");
      expect(RequestContext.getIdempotencyKey()).toBe("order-create-2f1c");
    });
  });

  it("空串与超长请求头：空串落 null，超长截断", () => {
    req.headers = {
      "x-store-id": "   ",
      "x-client": "web",
      "idempotency-key": "k".repeat(200),
    };

    runMiddleware(() => {
      expect(RequestContext.getStoreId()).toBeNull();
      expect(RequestContext.getClient()).toBe("web");
      expect(RequestContext.getIdempotencyKey()).toBe("k".repeat(128));
    });
  });

  it("X-Trace-Id 透传：携带时保持原值", () => {
    req.headers = { "x-trace-id": "gw-generated-trace-001" };

    runMiddleware(() => {
      expect(RequestContext.getTraceId()).toBe("gw-generated-trace-001");
    });
  });

  it("requireStoreId：无头时抛错、有头时返回值（多门店接口缺头策略钩子）", () => {
    runMiddleware(() => {
      expect(() => RequestContext.requireStoreId()).toThrow(/X-Store-Id/);
    });

    req.headers = { "x-store-id": "7" };
    runMiddleware(() => {
      expect(RequestContext.requireStoreId()).toBe("7");
    });
  });
});
