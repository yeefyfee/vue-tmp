import { RedisService } from "./redis.service";
import { RequestContext } from "../context/request-context";

/**
 * 认证域全局键（`*Global`）回归测试 —— 缺陷根因固化
 *
 * 背景：`JwtStrategy.validate` / `RedisTokenAuthGuard` 在 `DataScopeGuard` **之前**执行，
 * ALS 里尚无租户上下文；而写入端（登出 / 踢下线 / switch-context）在已认证请求里带租户上下文。
 * 同一键名在两侧被 `resolveKey` 解析成**两个不同的物理键**
 * → 黑名单 / Token 版本号 / 会话映射三组校验恒 miss（登出与踢下线静默失效）。
 *
 * 固化约定：这 3 组键（jti / userId 全局唯一）一律走 `*Global`，**不做租户前缀改写**，
 * 与当前请求有无租户上下文无关。
 */
describe("认证域全局键（RedisService `*Global` 无租户前缀）", () => {
  const TENANT = "900042";

  function makeService() {
    const calls: Array<{ cmd: string; args: unknown[] }> = [];
    const client = {
      setex: (...args: unknown[]) => {
        calls.push({ cmd: "setex", args });
        return "OK";
      },
      get: (...args: unknown[]) => {
        calls.push({ cmd: "get", args });
        return null;
      },
      exists: (...args: unknown[]) => {
        calls.push({ cmd: "exists", args });
        return 0;
      },
      del: (...args: unknown[]) => {
        calls.push({ cmd: "del", args });
        return 1;
      },
      incr: (...args: unknown[]) => {
        calls.push({ cmd: "incr", args });
        return 1;
      },
      expire: (...args: unknown[]) => {
        calls.push({ cmd: "expire", args });
        return 1;
      },
    };
    return { svc: new RedisService({ getOrThrow: () => client } as never), calls };
  }

  /** 在「已有租户上下文」的请求里执行（模拟已认证写入端） */
  const withTenant = <T>(fn: () => T): T =>
    RequestContext.run(() => {
      RequestContext.setTenantId(TENANT);
      return fn();
    });

  it("有租户上下文：set/setGlobal 前缀行为对照（前者加前缀，后者不加）", async () => {
    const { svc, calls } = makeService();
    await withTenant(async () => {
      await svc.setGlobal("auth:token:blacklist:jti-1", true, 60);
      await svc.set("auth:token:blacklist:jti-1", true, 60);
    });
    expect(String(calls[0].args[0])).toBe("auth:token:blacklist:jti-1");
    expect(String(calls[1].args[0])).toBe(`tenant:${TENANT}:auth:token:blacklist:jti-1`);
  });

  it("有租户上下文：getGlobal 读无前缀键（get 会加前缀）", async () => {
    const { svc, calls } = makeService();
    await withTenant(async () => {
      await svc.getGlobal("auth:user:token_version:92");
      await svc.get("auth:user:token_version:92");
    });
    expect(String(calls[0].args[0])).toBe("auth:user:token_version:92");
    expect(String(calls[1].args[0])).toBe(`tenant:${TENANT}:auth:user:token_version:92`);
  });

  it("有租户上下文：hasGlobalKey / delGlobal / incrGlobal / expireGlobal 均不加前缀", async () => {
    const { svc, calls } = makeService();
    await withTenant(async () => {
      await svc.hasGlobalKey("auth:token:blacklist:jti-1");
      await svc.delGlobal("auth:user:jwt_session:92");
      await svc.incrGlobal("auth:user:token_version:92");
      await svc.expireGlobal("auth:user:token_version:92", 72000);
    });
    expect(calls.map((c) => String(c.args[0]))).toEqual([
      "auth:token:blacklist:jti-1",
      "auth:user:jwt_session:92",
      "auth:user:token_version:92",
      "auth:user:token_version:92",
    ]);
    expect(calls[3].args[1]).toBe(72000);
  });

  it("无租户上下文：Global 与普通方法键名一致（认证链前置读取路径）", async () => {
    const { svc, calls } = makeService();
    await svc.setGlobal("auth:token:blacklist:jti-2", true, 60);
    await svc.set("auth:token:blacklist:jti-2", true, 60);
    expect(String(calls[0].args[0])).toBe("auth:token:blacklist:jti-2");
    expect(String(calls[1].args[0])).toBe("auth:token:blacklist:jti-2");

    await svc.hasGlobalKey("auth:token:blacklist:jti-2");
    await svc.hasKey("auth:token:blacklist:jti-2");
    expect(String(calls[2].args[0])).toBe("auth:token:blacklist:jti-2");
    expect(String(calls[3].args[0])).toBe("auth:token:blacklist:jti-2");
  });

  it("读写闭环：写入端（无上下文登录）与校验端（无上下文守卫）命中同一物理键", async () => {
    const { svc, calls } = makeService();
    // 写入端：登出（已认证，带租户上下文）
    await withTenant(async () => {
      await svc.setGlobal("auth:token:blacklist:jti-3", true, 60);
    });
    // 校验端：JwtStrategy（无租户上下文）
    await svc.hasGlobalKey("auth:token:blacklist:jti-3");
    expect(String(calls[0].args[0])).toBe(String(calls[1].args[0]));
  });
});
