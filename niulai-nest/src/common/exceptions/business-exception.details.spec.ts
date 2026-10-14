import { HttpStatus } from "@nestjs/common";
import { BusinessException } from "./business.exception";
import { ErrorCode } from "../enums/error-code.enum";
import { DomainErrorCode } from "../enums/domain-error-code.enum";
import { HttpExceptionFilter } from "../filters/http-exception.filter";

function makeResponseSpy() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

function makeHost(res: Record<string, unknown>): Parameters<HttpExceptionFilter["catch"]>[1] {
  return {
    switchToHttp: () =>
      ({
        getResponse: () => res,
        getRequest: () => ({}),
      }) as never,
    switchToRpc: () => ({}) as never,
    switchToWs: () => ({}) as never,
    getArgs: () => [] as never,
    getArgByIndex: () => undefined as never,
    getType: () => "http",
    switchToWs2: undefined,
  } as never;
}

describe("BusinessException details（CROSS-13 错误信封 code/msg/details）", () => {
  it("携带 details 时 getResponse 含 details", () => {
    const details = [{ field: "phone", reason: "格式不正确" }];
    const ex = new BusinessException(ErrorCode.INVALID_USER_INPUT, details);
    const resp = ex.getResponse() as Record<string, unknown>;
    expect(resp.code).toBe(ErrorCode.INVALID_USER_INPUT.code);
    expect(resp.msg).toBe(ErrorCode.INVALID_USER_INPUT.msg);
    expect(resp.details).toEqual(details);
  });

  it("不传 details 时响应体无 details 键（历史形状不变）", () => {
    const ex = new BusinessException(ErrorCode.INVALID_USER_INPUT);
    const resp = ex.getResponse() as Record<string, unknown>;
    expect(resp).not.toHaveProperty("details");
  });

  it("域错误码条目可直接作为 BusinessError 使用（code 取 name）", () => {
    const ex = new BusinessException(DomainErrorCode.BOOKING_SLOT_CONFLICT);
    const resp = ex.getResponse() as Record<string, unknown>;
    expect(resp.code).toBe("BOOKING_SLOT_CONFLICT");
    expect(ex.getStatus()).toBe(HttpStatus.CONFLICT);
  });

  it("字符串重载 + details 兼容", () => {
    const ex = new BusinessException("自定义消息", HttpStatus.BAD_REQUEST, { k: 1 });
    const resp = ex.getResponse() as Record<string, unknown>;
    expect(resp.code).toBe(ErrorCode.SYSTEM_ERROR.code);
    expect(resp.msg).toBe("自定义消息");
    expect(resp.details).toEqual({ k: 1 });
  });
});

describe("HttpExceptionFilter details 透传", () => {
  it("业务异常 details 进入信封", () => {
    const res = makeResponseSpy();
    new HttpExceptionFilter().catch(
      new BusinessException(ErrorCode.INVALID_USER_INPUT, [{ field: "a" }]),
      makeHost(res)
    );
    expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    expect(res.body).toMatchObject({ code: "A0402", details: [{ field: "a" }], data: null });
  });

  it("无 details 的业务异常信封形状与历史一致", () => {
    const res = makeResponseSpy();
    new HttpExceptionFilter().catch(
      new BusinessException(ErrorCode.TENANT_CONTEXT_MISSING),
      makeHost(res)
    );
    expect(res.body).toEqual({
      code: "A0302",
      msg: ErrorCode.TENANT_CONTEXT_MISSING.msg,
      data: null,
    });
  });
});
