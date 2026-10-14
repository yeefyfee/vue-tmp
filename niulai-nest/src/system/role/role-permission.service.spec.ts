import { RolePermService } from "./role-permission.service";
import type { PrismaService } from "../../common/prisma/prisma.service";
import type { RedisService } from "../../common/redis/redis.service";

/**
 * RolePermService 单元测试（P0-02-09）
 *
 * 角色权限缓存服务此前 **0 覆盖**。Read-Through 缓存策略全覆盖，
 * `PrismaService` 与 `RedisService` 全 mock（不真连库 / Redis）。
 *
 * 缓存结构：Hash `system:role:perms`，Field=角色编码，Value=权限标识数组。
 */
describe("RolePermService（P0-02-09 角色权限缓存）", () => {
  const CACHE_KEY = "system:role:perms";

  const prismaMock = {
    $queryRaw: jest.fn(),
    sysMenu: { findMany: jest.fn() },
  };
  const redisMock = {
    hmget: jest.fn(),
    hset: jest.fn(),
    hdel: jest.fn(),
    delHash: jest.fn(),
  };

  let service: RolePermService;

  beforeEach(() => {
    jest.resetAllMocks();
    redisMock.hmget.mockResolvedValue([]);
    redisMock.hset.mockResolvedValue(1);
    redisMock.hdel.mockResolvedValue(1);
    redisMock.delHash.mockResolvedValue(1);
    prismaMock.sysMenu.findMany.mockResolvedValue([]);
    service = new RolePermService(
      prismaMock as unknown as PrismaService,
      redisMock as unknown as RedisService
    );
  });

  describe("getPermsByRoleCodes（Read-Through 缓存）", () => {
    it("空数组 → 返回 []，不碰 Redis", async () => {
      await expect(service.getPermsByRoleCodes([])).resolves.toEqual([]);
      expect(redisMock.hmget).not.toHaveBeenCalled();
    });

    it("null / undefined → 返回 []，不碰 Redis", async () => {
      await expect(service.getPermsByRoleCodes(undefined as unknown as string[])).resolves.toEqual(
        []
      );
      expect(redisMock.hmget).not.toHaveBeenCalled();
    });

    it("重复 roleCode 先去重再查缓存", async () => {
      redisMock.hmget.mockResolvedValue([["a"]]);
      await expect(service.getPermsByRoleCodes(["R1", "R1", "R1"])).resolves.toEqual(["a"]);
      expect(redisMock.hmget).toHaveBeenCalledWith(CACHE_KEY, ["R1"]);
    });

    it("缓存全命中 → 直接合并返回，**不回源 DB**", async () => {
      redisMock.hmget.mockResolvedValue([["a", "b"], ["c"]]);
      const result = await service.getPermsByRoleCodes(["R1", "R2"]);
      expect(new Set(result)).toEqual(new Set(["a", "b", "c"]));
      expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
      expect(redisMock.hset).not.toHaveBeenCalled();
    });

    it("缓存未命中（null）→ 回源 DB + hset 回填 + 合并结果", async () => {
      redisMock.hmget.mockResolvedValue([null]);
      prismaMock.$queryRaw.mockResolvedValue([
        { perm: "customer:list" },
        { perm: "customer:create" },
      ]);

      const result = await service.getPermsByRoleCodes(["R1"]);

      expect(new Set(result)).toEqual(new Set(["customer:list", "customer:create"]));
      expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
      expect(redisMock.hset).toHaveBeenCalledWith(CACHE_KEY, "R1", [
        "customer:list",
        "customer:create",
      ]);
    });

    it("部分命中 + 部分未命中 → 仅对未命中者回源并合并去重", async () => {
      redisMock.hmget.mockResolvedValue([["a"], null]);
      prismaMock.$queryRaw.mockResolvedValue([{ perm: "a" }, { perm: "b" }]);

      const result = await service.getPermsByRoleCodes(["R1", "R2"]);

      expect(new Set(result)).toEqual(new Set(["a", "b"])); // a 去重
      expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
      expect(redisMock.hset).toHaveBeenCalledWith(CACHE_KEY, "R2", ["a", "b"]);
      // R1 命中缓存不回填
      expect(redisMock.hset).not.toHaveBeenCalledWith(CACHE_KEY, "R1", expect.anything());
    });

    it("多角色结果合并去重（跨角色重复权限只出现一次）", async () => {
      redisMock.hmget.mockResolvedValue([
        ["x", "y"],
        ["y", "z"],
      ]);
      const result = await service.getPermsByRoleCodes(["R1", "R2"]);
      expect(new Set(result)).toEqual(new Set(["x", "y", "z"]));
      expect(result.length).toBe(3);
    });
  });

  describe("refreshAllRolePermsCache（全量刷新）", () => {
    it("先 delHash 清空，再对**非空 perms 的角色**逐个 hset（空 perms 不写）", async () => {
      jest.spyOn(service as any, "getRolePermsListFromDB").mockResolvedValue([
        { roleCode: "A", perms: ["p1", "p2"] },
        { roleCode: "B", perms: [] }, // 空 → 不写
        { roleCode: "C", perms: ["p3"] },
      ]);

      await service.refreshAllRolePermsCache();

      expect(redisMock.delHash).toHaveBeenCalledWith(CACHE_KEY);
      expect(redisMock.hset).toHaveBeenCalledWith(CACHE_KEY, "A", ["p1", "p2"]);
      expect(redisMock.hset).toHaveBeenCalledWith(CACHE_KEY, "C", ["p3"]);
      expect(redisMock.hset).toHaveBeenCalledTimes(2); // B 被跳过
      expect(redisMock.hset).not.toHaveBeenCalledWith(CACHE_KEY, "B", expect.anything());
    });
  });

  describe("refreshRolePermsCache（单角色刷新）", () => {
    it("先 hdel 再回源；**空数组也 hset**（防缓存穿透）", async () => {
      jest.spyOn(service as any, "getRolePermsByRoleCodeFromDB").mockResolvedValue([]);

      await service.refreshRolePermsCache("R1");

      expect(redisMock.hdel).toHaveBeenCalledWith(CACHE_KEY, "R1");
      expect(redisMock.hset).toHaveBeenCalledWith(CACHE_KEY, "R1", []);
    });
  });

  describe("refreshRolePermsCacheOnCodeChange（编码变更）", () => {
    it("hdel(旧,新) 后回源新编码并 hset 新编码", async () => {
      jest.spyOn(service as any, "getRolePermsByRoleCodeFromDB").mockResolvedValue(["p1"]);

      await service.refreshRolePermsCacheOnCodeChange("OLD", "NEW");

      expect(redisMock.hdel).toHaveBeenCalledWith(CACHE_KEY, "OLD", "NEW");
      expect(redisMock.hset).toHaveBeenCalledWith(CACHE_KEY, "NEW", ["p1"]);
      expect(redisMock.hset).not.toHaveBeenCalledWith(CACHE_KEY, "OLD", expect.anything());
    });
  });

  describe("getAllPerms（超级管理员）", () => {
    it("仅取 type=B 且过滤掉 falsy / 空 perm", async () => {
      prismaMock.sysMenu.findMany.mockResolvedValue([
        { perm: "a" },
        { perm: null },
        { perm: "" },
        { perm: "b" },
      ]);

      await expect(service.getAllPerms()).resolves.toEqual(["a", "b"]);
      expect(prismaMock.sysMenu.findMany).toHaveBeenCalledWith({
        where: { menuType: "B" },
        select: { perm: true },
      });
    });
  });
});
