import type { Request, Response } from "express";
import { RequestContext } from "../context/request-context";
import { RequestContextMiddleware } from "../middleware/request-context.middleware";
import { traceContextFormat } from "./trace-context.format";
import { LoggerUtils } from "../utils/logger.utils";

function makeReq(headers: Record<string, unknown> = {}): Request {
  return { headers } as unknown as Request;
}

function makeRes(): Response & { _headers: Record<string, unknown> } {
  const store: Record<string, unknown> = {};
  return {
    _headers: store,
    setHeader(key: string, value: unknown) {
      store[key] = value;
    },
  } as never;
}

describe("CROSS-14 · trace_id 全链路", () => {
  it("无上游头时中间件生成 trace_id 并写回响应头", () => {
    const req = makeReq();
    const res = makeRes();
    let generated: string | null = null;
    // ALS store 只在 run() 回调内可见（真实请求的全部处理都在回调内），断言须在 next 内读
    RequestContextMiddleware.prototype.use.call(null, req, res, () => {
      generated = RequestContext.getTraceId();
    });
    expect(generated).toBeTruthy();
    expect(res._headers["X-Trace-Id"]).toBe(generated);
  });

  it("上游已带 X-Trace-Id 时透传（保持全链路一致）", () => {
    const req = makeReq({ "x-trace-id": "gw-abc-123" });
    const res = makeRes();
    let propagated: string | null = null;
    RequestContextMiddleware.prototype.use.call(null, req, res, () => {
      propagated = RequestContext.getTraceId();
    });
    expect(propagated).toBe("gw-abc-123");
    expect(res._headers["X-Trace-Id"]).toBe("gw-abc-123");
  });

  it("winston format 从 ALS 注入 traceId/userId/tenantId", () => {
    RequestContext.run(() => {
      RequestContext.setTraceId("trace-xyz");
      RequestContext.setTenantId("900042");
      const format = traceContextFormat();
      const info = format.transform({ level: "info", message: "demo" }) as Record<string, unknown>;
      expect(info["traceId"]).toBe("trace-xyz");
      expect(info["tenantId"]).toBe("900042");
      // 未认证请求：getUserId() 对空 store 返回 null
      expect(info["userId"]).toBeNull();
    });
  });

  it("无请求上下文（启动期）时 traceId 为 null，日志形状稳定", () => {
    const format = traceContextFormat();
    const info = format.transform({ level: "info", message: "boot" }) as Record<string, unknown>;
    expect(info["traceId"]).toBeNull();
  });

  it("一次请求内中间件与后续读取同源（串联全链路的前提）", () => {
    const req = makeReq({ "x-trace-id": "flow-1" });
    let seenInRoute: string | null = null;
    RequestContextMiddleware.prototype.use.call(null, req, makeRes(), () => {
      seenInRoute = RequestContext.getTraceId();
    });
    expect(seenInRoute).toBe("flow-1");
  });
});

describe("CROSS-14 · 敏感字段脱敏", () => {
  it("键级脱敏：password/token/authorization/phone 等", () => {
    const masked = LoggerUtils.maskSensitive({
      password: "plain123",
      accessToken: "tok",
      Authorization: "Bearer x",
      phone: "13800001111",
      nested: { idCard: "x", safe: 1 },
    });
    expect(masked).toMatchObject({
      password: "***",
      accessToken: "***",
      Authorization: "***",
      phone: "***",
      nested: { idCard: "***", safe: 1 },
    });
  });

  it("值级脱敏：任意字符串中的手机号与身份证号", () => {
    const masked = LoggerUtils.maskSensitive({
      note: "客户手机号 13812345678 请联系",
      id: "110101199003077777",
      arr: ["19512345678", "ok"],
    });
    expect(masked).toMatchObject({ note: "客户手机号 138****5678 请联系" });
    expect((masked as Record<string, unknown>).id).toBe("110101********77");
    expect(masked).toMatchObject({ arr: ["195****5678", "ok"] });
  });

  it("请求日志上下文的 body/headers/query 已脱敏", () => {
    const req = {
      originalUrl: "/api/v1/auth/login",
      method: "POST",
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
      headers: { authorization: "Bearer abc", "user-agent": "jest" },
      query: {},
      params: {},
      body: { username: "u", password: "p", mobile: "13812345678" },
    } as unknown as Request;
    const ctx = LoggerUtils.captureRequestContext(req);
    expect(ctx.headers).toMatchObject({ authorization: "***" });
    expect(ctx.body).toMatchObject({ username: "u", password: "***", mobile: "***" });
  });
});
