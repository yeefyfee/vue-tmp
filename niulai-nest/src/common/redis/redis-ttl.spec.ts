import { DEFAULT_TTL_SECONDS } from "@peluvida/shared";
import { RedisService } from "./redis.service";
import { RequestContext } from "../context/request-context";

describe("CROSS-10 · RedisService 默认 TTL（键规范）", () => {
  function makeService() {
    const calls: Array<{ cmd: string; args: unknown[] }> = [];
    const client = {
      setex: (...args: unknown[]) => {
        calls.push({ cmd: "setex", args });
        return "OK";
      },
      set: (...args: unknown[]) => {
        calls.push({ cmd: "set", args });
        return "OK";
      },
    };
    const svc = new RedisService({ getOrThrow: () => client } as never);
    return { svc, calls };
  }

  it("不传 ttl 时落默认 1h（setex 3600）", async () => {
    const { svc, calls } = makeService();
    await svc.set("demo:key", 1);
    expect(calls[0].cmd).toBe("setex");
    expect(calls[0].args[1]).toBe(DEFAULT_TTL_SECONDS);
  });

  it("显式 ttl 覆盖默认值", async () => {
    const { svc, calls } = makeService();
    await svc.set("demo:key", 1, 120);
    expect(calls[0].cmd).toBe("setex");
    expect(calls[0].args[1]).toBe(120);
  });

  it("非法 ttl（0/负数）也落默认值", async () => {
    const { svc, calls } = makeService();
    await svc.set("demo:key", 1, 0);
    await svc.set("demo:key", 1, -5);
    expect(calls[0].args[1]).toBe(DEFAULT_TTL_SECONDS);
    expect(calls[1].args[1]).toBe(DEFAULT_TTL_SECONDS);
  });

  it("租户上下文下键名仍自动加 tenant: 前缀（PEL-11 行为不变）", async () => {
    const { svc, calls } = makeService();
    RequestContext.run(() => {
      RequestContext.setTenantId("900042");
      void svc.set("demo:key", 1);
    });
    expect(String(calls[0].args[0])).toBe("tenant:900042:demo:key");
  });
});
