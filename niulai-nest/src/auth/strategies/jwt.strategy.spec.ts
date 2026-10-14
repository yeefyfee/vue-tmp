import { UnauthorizedException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";

import { JwtStrategy } from "./jwt.strategy";
import { RequestContext } from "../../common/context/request-context";
import type { RedisService } from "../../common/redis/redis.service";
import type { RoleService } from "../../system/role/role.service";

/**
 * JwtStrategy 单元测试（P0-02-09）
 *
 * JWT 认证策略此前 **0 覆盖**。覆盖 `validate(payload)`：
 *  - 缺 sub / username → UnauthorizedException("无效的令牌载荷")；
 *  - tokenVersion < Redis 当前版本 → "Token 已失效，请重新登录"；
 *  - jti 命中黑名单 → 失效；
 *  - 正常路径 → 标准化 user（roles / dataScopes / activeStoreId 随动），
 *    并核对 roleService.getRoleDataScopes 入参 = payload.roles；
 *  - activeStoreId 仅在 ALS 无门店上下文时兜底写入（请求头显式优先）。
 */
describe("JwtStrategy（P0-02-09 JWT 认证策略）", () => {
  const redisMock = { getGlobal: jest.fn(), hasGlobalKey: jest.fn() };
  const roleServiceMock = { getRoleDataScopes: jest.fn() };
  const configServiceMock = { getOrThrow: jest.fn() };

  let strategy: JwtStrategy;

  beforeEach(() => {
    jest.resetAllMocks();
    configServiceMock.getOrThrow.mockReturnValue("test-secret");
    redisMock.getGlobal.mockResolvedValue(null);
    redisMock.hasGlobalKey.mockResolvedValue(false);
    roleServiceMock.getRoleDataScopes.mockResolvedValue([]);
    strategy = new JwtStrategy(
      configServiceMock as unknown as ConfigService,
      redisMock as unknown as RedisService,
      roleServiceMock as unknown as RoleService
    );
  });

  it("构造时从 ConfigService 取 jwt.secretKey（getOrThrow）", () => {
    expect(configServiceMock.getOrThrow).toHaveBeenCalledWith("jwt.secretKey");
  });

  it("缺 sub → UnauthorizedException('无效的令牌载荷')", async () => {
    await expect(strategy.validate({ username: "u" })).rejects.toThrow(
      new UnauthorizedException("无效的令牌载荷")
    );
  });

  it("缺 username → UnauthorizedException('无效的令牌载荷')", async () => {
    await expect(strategy.validate({ sub: "92" })).rejects.toThrow(
      new UnauthorizedException("无效的令牌载荷")
    );
  });

  it("tokenVersion < Redis 当前版本 → 'Token 已失效，请重新登录'", async () => {
    redisMock.getGlobal.mockResolvedValue(3);
    await expect(strategy.validate({ sub: "92", username: "u", tokenVersion: 0 })).rejects.toThrow(
      "Token 已失效，请重新登录"
    );
  });

  it("tokenVersion ≥ 当前版本 → 通过版本校验", async () => {
    redisMock.getGlobal.mockResolvedValue(2);
    await expect(
      strategy.validate({ sub: "92", username: "u", tokenVersion: 2, roles: [] })
    ).resolves.toMatchObject({ userId: "92" });
  });

  it("jti 命中黑名单 → 'Token 已失效，请重新登录'（全局键，无租户前缀）", async () => {
    redisMock.hasGlobalKey.mockResolvedValue(true);
    await expect(strategy.validate({ sub: "92", username: "u", jti: "abc" })).rejects.toThrow(
      "Token 已失效，请重新登录"
    );
    expect(redisMock.hasGlobalKey).toHaveBeenCalledWith("auth:token:blacklist:abc");
  });

  it("正常路径 → 标准化 user，且 getRoleDataScopes 入参 = payload.roles", async () => {
    roleServiceMock.getRoleDataScopes.mockResolvedValue([1, 2]);

    const result = await strategy.validate({
      sub: "92",
      username: "tenant_admin",
      roles: ["ROOT", "OPERATOR"],
      deptId: "61",
      deptTreePath: "0",
      tenantId: "1",
    });

    expect(result).toEqual({
      userId: "92",
      username: "tenant_admin",
      roles: ["ROOT", "OPERATOR"],
      deptId: "61",
      dataScopes: [1, 2],
      deptTreePath: "0",
      tenantId: "1",
      activeStoreId: null,
    });
    expect(roleServiceMock.getRoleDataScopes).toHaveBeenCalledWith(["ROOT", "OPERATOR"]);
  });

  it("roles 缺失 → 视为 []，dataScopes 查询收到 []", async () => {
    await strategy.validate({ sub: "92", username: "u" });
    expect(roleServiceMock.getRoleDataScopes).toHaveBeenCalledWith([]);
  });

  it("activeStoreId：ALS 无门店上下文时兜底写入（随令牌流转）", async () => {
    await RequestContext.run(async () => {
      const result = await strategy.validate({
        sub: "92",
        username: "u",
        roles: [],
        activeStoreId: "store-9",
      });
      expect(result.activeStoreId).toBe("store-9");
      expect(RequestContext.getStoreId()).toBe("store-9");
    });
  });

  it("activeStoreId：ALS 已有门店上下文（请求头）→ 不覆盖", async () => {
    await RequestContext.run(async () => {
      RequestContext.setStoreId("header-store");
      await strategy.validate({
        sub: "92",
        username: "u",
        roles: [],
        activeStoreId: "token-store",
      });
      expect(RequestContext.getStoreId()).toBe("header-store");
    });
  });
});
