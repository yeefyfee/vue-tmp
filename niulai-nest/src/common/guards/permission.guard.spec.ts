import { ForbiddenException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";

import { PermissionGuard } from "./permission.guard";
import { METADATA } from "../constants/metadata.constant";
import { ROOT_ROLE_CODE } from "../constants/role.constant";
import { IS_PUBLIC_KEY } from "../decorators/auth.decorator";

/**
 * PermissionGuard 单元测试（P0-02-09）
 *
 * RBAC 权限守卫此前 **0 覆盖**。覆盖：
 *  - @Public 直放（不查 rolePermService）；
 *  - 未声明 / 空数组权限要求 → 放行；
 *  - ROOT 角色直放（不查 rolePermService）；
 *  - user 缺失 / roles 非数组 → 视为无角色；
 *  - getPermsByRoleCodes 收到 **user.roles 原值**；
 *  - 命中任一必需权限 → 放行（any-of 语义）；
 *  - 无命中 → ForbiddenException("权限不足")。
 */
describe("PermissionGuard（P0-02-09 RBAC 权限守卫）", () => {
  const rolePermService = { getPermsByRoleCodes: jest.fn() };

  /** 构造 Reflector 桩：按元数据键返回 Public / 权限要求 */
  function makeReflector(meta: { isPublic?: boolean; perms?: unknown }): Reflector {
    return {
      getAllAndOverride: jest.fn((key: string) => {
        if (key === IS_PUBLIC_KEY) return meta.isPublic ?? false;
        if (key === METADATA.PERMISSIONS) return meta.perms;
        return undefined;
      }),
    } as unknown as Reflector;
  }

  function makeContext(user: unknown): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => () => undefined,
      getClass: () => Object,
    } as unknown as ExecutionContext;
  }

  function makeGuard(meta: { isPublic?: boolean; perms?: unknown }): PermissionGuard {
    return new PermissionGuard(makeReflector(meta), rolePermService as any);
  }

  beforeEach(() => {
    jest.resetAllMocks();
    rolePermService.getPermsByRoleCodes.mockResolvedValue([]);
  });

  it("@Public 接口 → 直接放行，且不查 rolePermService", async () => {
    const guard = makeGuard({ isPublic: true, perms: ["customer:list"] });
    await expect(guard.canActivate(makeContext({ roles: ["OPERATOR"] }))).resolves.toBe(true);
    expect(rolePermService.getPermsByRoleCodes).not.toHaveBeenCalled();
  });

  it("未声明权限要求（undefined）→ 放行", async () => {
    const guard = makeGuard({ perms: undefined });
    await expect(guard.canActivate(makeContext({ roles: ["OPERATOR"] }))).resolves.toBe(true);
    expect(rolePermService.getPermsByRoleCodes).not.toHaveBeenCalled();
  });

  it("权限要求为空数组 → 放行", async () => {
    const guard = makeGuard({ perms: [] });
    await expect(guard.canActivate(makeContext({ roles: ["OPERATOR"] }))).resolves.toBe(true);
    expect(rolePermService.getPermsByRoleCodes).not.toHaveBeenCalled();
  });

  it("ROOT 角色 → 直放，且不查 rolePermService（超级管理员短路）", async () => {
    const guard = makeGuard({ perms: ["customer:list"] });
    await expect(guard.canActivate(makeContext({ roles: [ROOT_ROLE_CODE] }))).resolves.toBe(true);
    expect(rolePermService.getPermsByRoleCodes).not.toHaveBeenCalled();
  });

  it("ROOT 混在多角色里 → 仍直放", async () => {
    const guard = makeGuard({ perms: ["customer:list"] });
    await expect(
      guard.canActivate(makeContext({ roles: ["OPERATOR", ROOT_ROLE_CODE] }))
    ).resolves.toBe(true);
    expect(rolePermService.getPermsByRoleCodes).not.toHaveBeenCalled();
  });

  it("user 缺失 → 视为无角色，传入 [] 查权限，无命中则拒绝", async () => {
    const guard = makeGuard({ perms: ["customer:list"] });
    await expect(guard.canActivate(makeContext(undefined))).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(rolePermService.getPermsByRoleCodes).toHaveBeenCalledWith([]);
  });

  it("roles 非数组（字符串）→ 视为无角色 []", async () => {
    const guard = makeGuard({ perms: ["customer:list"] });
    await expect(guard.canActivate(makeContext({ roles: "OPERATOR" }))).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(rolePermService.getPermsByRoleCodes).toHaveBeenCalledWith([]);
  });

  it("命中任一必需权限 → 放行，且 getPermsByRoleCodes 收到 user.roles 原值", async () => {
    const roles = ["OPERATOR", "AUDITOR"];
    rolePermService.getPermsByRoleCodes.mockResolvedValue(["customer:list"]);
    const guard = makeGuard({ perms: ["customer:list"] });

    await expect(guard.canActivate(makeContext({ roles }))).resolves.toBe(true);
    expect(rolePermService.getPermsByRoleCodes).toHaveBeenCalledWith(roles);
  });

  it("any-of 语义：多值权限要求，命中其一即放行", async () => {
    rolePermService.getPermsByRoleCodes.mockResolvedValue(["pet:list"]);
    const guard = makeGuard({ perms: ["customer:list", "pet:list", "store:list"] });

    await expect(guard.canActivate(makeContext({ roles: ["OPERATOR"] }))).resolves.toBe(true);
  });

  it("无命中 → 抛 ForbiddenException('权限不足')", async () => {
    rolePermService.getPermsByRoleCodes.mockResolvedValue(["pet:list"]);
    const guard = makeGuard({ perms: ["customer:list"] });

    await expect(guard.canActivate(makeContext({ roles: ["OPERATOR"] }))).rejects.toThrow(
      "权限不足"
    );
  });
});
