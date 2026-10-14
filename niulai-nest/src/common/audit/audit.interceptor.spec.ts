import "reflect-metadata"; // 装饰器元数据 polyfill：jest 环境需显式加载（main.ts 的 import 链不生效）
import { AuditInterceptor } from "./audit.interceptor";
import { Audit } from "./audit.decorator";
import { RequestContext } from "../context/request-context";
import { AuditEntityType, AuditAction } from "@peluvida/shared";
import { Reflector } from "@nestjs/core";
import type { ExecutionContext, CallHandler } from "@nestjs/common";
import { of } from "rxjs";

function makeContext(req: Record<string, any>, handler: () => void): ExecutionContext {
  return {
    getType: () => "http",
    getHandler: () => handler, // 方法须返回 handler 本体（此前误赋值导致 getHandler() 调用 handler 返回 undefined）
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

/** 构造被 @Audit 标注的 handler（元数据真实经 SetMetadata 写入，验证 Reflector 惯例链路） */
const auditHandler = () => undefined;
Audit({ entityType: AuditEntityType.ROLE, action: AuditAction.GRANT })(auditHandler);

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("AuditInterceptor（自动轨）", () => {
  let service: { record: jest.Mock };
  let interceptor: AuditInterceptor;

  beforeEach(() => {
    service = { record: jest.fn().mockResolvedValue(undefined) };
    // 用真实 Reflector：验证 SetMetadata（@Audit）→ Reflector.get 全链路惯例
    interceptor = new AuditInterceptor(service as never, new Reflector());
  });

  it("无 @Audit 元数据的接口直通：不读上下文、不写审计", async () => {
    const plainHandler = () => undefined; // 未装饰 handler → Reflector 返回 undefined
    const result = await new Promise((resolve) => {
      interceptor
        .intercept(makeContext({}, plainHandler), { handle: () => of("resp") } as CallHandler)
        .subscribe(resolve);
    });
    expect(result).toBe("resp");
    expect(service.record).not.toHaveBeenCalled();
  });

  it("成功响应后异步写审计：entityType/action 来自装饰器元数据", async () => {
    await RequestContext.run(async () => {
      await new Promise((resolve) => {
        interceptor
          .intercept(makeContext({}, auditHandler), {
            handle: () => of("resp"),
          } as CallHandler)
          .subscribe(resolve);
      });
      await flushMicrotasks();
      expect(service.record).toHaveBeenCalledTimes(1);
      const entry = service.record.mock.calls[0][0];
      expect(entry.entityType).toBe(AuditEntityType.ROLE);
      expect(entry.action).toBe(AuditAction.GRANT);
    });
  });

  it("审计写入失败只告警、不阻断响应（自动轨失败策略）", async () => {
    service.record.mockRejectedValue(new Error("audit db down"));
    const warnSpy = jest.spyOn((interceptor as any).logger, "warn").mockImplementation(() => {});
    const result = await new Promise((resolve) => {
      interceptor
        .intercept(makeContext({}, auditHandler), { handle: () => of("resp") } as CallHandler)
        .subscribe(resolve);
    });
    await flushMicrotasks();
    expect(result).toBe("resp"); // 响应照常返回
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("audit db down"));
    warnSpy.mockRestore();
  });

  it("fire-and-forget：record 挂起时响应立即发出，不等待审计写入", async () => {
    let release!: () => void;
    service.record.mockReturnValue(
      new Promise((resolve) => {
        release = resolve as () => void;
      })
    );
    const result = await new Promise((resolve) => {
      interceptor
        .intercept(makeContext({}, auditHandler), { handle: () => of("resp") } as CallHandler)
        .subscribe(resolve);
    });
    expect(result).toBe("resp"); // 未 release 前响应已到达
    release();
  });

  it("ip 提取：x-forwarded-for 首段优先，缺失回退 req.ip", async () => {
    const warnSpy = jest.spyOn((interceptor as any).logger, "warn").mockImplementation(() => {});
    await RequestContext.run(async () => {
      const req = { headers: { "x-forwarded-for": "203.0.113.1, 70.41.3.18" }, ip: "192.0.2.5" };
      await new Promise((resolve) => {
        interceptor
          .intercept(makeContext(req, auditHandler), { handle: () => of(1) } as CallHandler)
          .subscribe(resolve);
      });
      await flushMicrotasks();
      expect(service.record.mock.calls[0][0].ip).toBe("203.0.113.1");

      const reqNoXff = { headers: {}, ip: "192.0.2.5" };
      await new Promise((resolve) => {
        interceptor
          .intercept(makeContext(reqNoXff, auditHandler), { handle: () => of(1) } as CallHandler)
          .subscribe(resolve);
      });
      await flushMicrotasks();
      expect(service.record.mock.calls[1][0].ip).toBe("192.0.2.5");
    });
    warnSpy.mockRestore();
  });

  it("操作人姓名取 ALS username，随 record 透传（元数据不指定 operator）", async () => {
    await RequestContext.run(async () => {
      RequestContext.initUserContext({
        userId: "9001",
        deptId: "0",
        deptTreePath: "0",
        dataScopes: [],
        roles: [],
        username: "审计管理员",
      });
      await new Promise((resolve) => {
        interceptor
          .intercept(makeContext({}, auditHandler), { handle: () => of(1) } as CallHandler)
          .subscribe(resolve);
      });
      await flushMicrotasks();
      expect(service.record.mock.calls[0][0].operatorName).toBe("审计管理员");
    });
  });
});
