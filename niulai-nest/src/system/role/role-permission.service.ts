import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { RedisService } from "../../common/redis/redis.service";
import { RedisConstants } from "../../common/constants/redis.constants";

/**
 * 角色权限缓存服务（Prisma 版）
 *
 * 负责管理角色与权限标识的映射关系，采用 Read-Through 缓存策略：
 * - 优先从 Redis Hash 缓存读取
 * - 缓存未命中时自动回源数据库并写入缓存
 *
 * 缓存结构：
 * - Key: system:role:perms
 * - Field: 角色编码
 * - Value: 权限标识数组
 *
 * 🔴 **移植要点**：原实现依赖 `SysRoleMenu` 上的 TypeORM 关系（`@ManyToOne(() => SysRole)` /
 * `@ManyToOne(() => SysMenu)`）做 `innerJoin("rm.role") / innerJoin("rm.menu")`；
 * 而 Prisma schema **刻意不定义关系/外键**（与原 MySQL 库一致）⇒ 这里改写为**显式 JOIN 的原生 SQL**。
 * 因为 `sys_role_menu` 有几十万行级别的潜在量级，两次往返查询不如一次 JOIN。
 *
 * ⚠️ 原生 SQL 约定（移植约定第 10 条）：列名写**下划线**、参数走 Prisma 的 `${}` 插值（自动参数化，无注入）。
 */
@Injectable()
export class RolePermService {
  private readonly logger = new Logger(RolePermService.name);
  private readonly cacheKey = RedisConstants.System.ROLE_PERMS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService
  ) {}

  /**
   * 刷新所有角色的权限缓存
   *
   * 清空现有缓存，重新从数据库加载所有角色的权限标识
   */
  async refreshAllRolePermsCache(): Promise<void> {
    // 清空现有缓存
    await this.redisService.delHash(this.cacheKey);

    // 从数据库获取所有角色权限映射
    const rolePermsList = await this.getRolePermsListFromDB();

    // 写入缓存
    for (const item of rolePermsList) {
      if (item.perms && item.perms.length > 0) {
        await this.redisService.hset(this.cacheKey, item.roleCode, item.perms);
      }
    }

    this.logger.log(`权限缓存刷新完成，共 ${rolePermsList.length} 个角色`);
  }

  /**
   * 刷新指定角色的权限缓存
   *
   * @param roleCode 角色编码
   */
  async refreshRolePermsCache(roleCode: string): Promise<void> {
    // 删除该角色的缓存
    await this.redisService.hdel(this.cacheKey, roleCode);

    // 从数据库重新获取
    const perms = await this.getRolePermsByRoleCodeFromDB(roleCode);

    // 写入缓存（空数组也写入，防止缓存穿透）
    await this.redisService.hset(this.cacheKey, roleCode, perms);

    this.logger.log(`角色 [${roleCode}] 权限缓存刷新完成`);
  }

  /**
   * 刷新角色权限缓存（角色编码变更时调用）
   *
   * @param oldRoleCode 旧角色编码
   * @param newRoleCode 新角色编码
   */
  async refreshRolePermsCacheOnCodeChange(oldRoleCode: string, newRoleCode: string): Promise<void> {
    // 删除新旧两个角色的缓存
    await this.redisService.hdel(this.cacheKey, oldRoleCode, newRoleCode);

    // 重新获取新角色编码的权限
    const perms = await this.getRolePermsByRoleCodeFromDB(newRoleCode);

    // 写入缓存
    await this.redisService.hset(this.cacheKey, newRoleCode, perms);

    this.logger.log(`角色编码变更: ${oldRoleCode} -> ${newRoleCode}，权限缓存已刷新`);
  }

  /**
   * 获取角色权限集合（带缓存）
   *
   * 采用 Read-Through 缓存策略：
   * 1. 优先从 Redis Hash 缓存读取
   * 2. 缓存未命中时回源数据库并写入缓存
   *
   * @param roleCodes 角色编码集合
   * @returns 权限标识集合
   */
  async getPermsByRoleCodes(roleCodes: string[]): Promise<string[]> {
    if (!roleCodes || roleCodes.length === 0) {
      return [];
    }

    const uniqueRoleCodes = [...new Set(roleCodes)];
    const perms: Set<string> = new Set();
    const missingRoleCodes: string[] = [];

    const cachedPermsList = await this.redisService.hmget<string[]>(this.cacheKey, uniqueRoleCodes);

    for (let i = 0; i < uniqueRoleCodes.length; i++) {
      const cachedPerms = cachedPermsList[i];
      const roleCode = uniqueRoleCodes[i];

      if (cachedPerms === null) {
        missingRoleCodes.push(roleCode);
      } else if (Array.isArray(cachedPerms)) {
        cachedPerms.forEach((p) => perms.add(p));
      }
    }

    if (missingRoleCodes.length > 0) {
      for (const roleCode of missingRoleCodes) {
        const dbPerms = await this.getRolePermsByRoleCodeFromDB(roleCode);
        await this.redisService.hset(this.cacheKey, roleCode, dbPerms);
        dbPerms.forEach((p) => perms.add(p));
      }
    }

    return Array.from(perms);
  }

  /**
   * 从数据库获取角色权限列表
   *
   * 原 TypeORM 版：`role_menu innerJoin role innerJoin menu`（靠实体关系）。
   * 现改为显式 JOIN 的原生 SQL。
   *
   * @param roleCode 可选，指定角色编码时只返回该角色的权限
   * @returns 角色权限映射列表
   */
  private async getRolePermsListFromDB(
    roleCode?: string
  ): Promise<{ roleCode: string; perms: string[] }[]> {
    const rows = await this.prisma.$queryRaw<{ roleCode: string; perm: string }[]>`
      SELECT r.code AS "roleCode", m.perm AS "perm"
      FROM sys_role_menu rm
      INNER JOIN sys_role r ON r.id = rm.role_id
      INNER JOIN sys_menu m ON m.id = rm.menu_id
      WHERE r.is_deleted = 0
        AND r.status = 1
        AND m.type = 'B'
        AND m.perm IS NOT NULL
        ${roleCode ? Prisma.sql`AND r.code = ${roleCode}` : Prisma.empty}
    `;

    // 按角色编码分组（保持原实现：`perm` 的顺序 = 数据库返回顺序）
    const rolePermsMap = new Map<string, string[]>();
    for (const row of rows) {
      const code = row.roleCode;
      const perm = row.perm;
      if (!rolePermsMap.has(code)) {
        rolePermsMap.set(code, []);
      }
      rolePermsMap.get(code)!.push(perm);
    }

    // 转换为数组返回
    return Array.from(rolePermsMap.entries()).map(([code, perms]) => ({
      roleCode: code,
      perms,
    }));
  }

  /**
   * 从数据库获取单个角色的权限
   *
   * @param roleCode 角色编码
   * @returns 权限标识数组
   */
  private async getRolePermsByRoleCodeFromDB(roleCode: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ perm: string }[]>`
      SELECT m.perm AS "perm"
      FROM sys_role_menu rm
      INNER JOIN sys_role r ON r.id = rm.role_id
      INNER JOIN sys_menu m ON m.id = rm.menu_id
      WHERE r.code = ${roleCode}
        AND r.is_deleted = 0
        AND r.status = 1
        AND m.type = 'B'
        AND m.perm IS NOT NULL
    `;

    return rows.map((r) => r.perm);
  }

  /**
   * 获取所有权限标识（超级管理员使用）
   *
   * 原实现 `menuRepository.find({ where: { type: "B" } })` 没有任何 `isDeleted` 过滤 ——
   * 这里保持一致，但**并非疏漏**：`sys_menu` 表压根没有 `is_deleted` 列
   * （见 `sys-menu.entity.ts` 的注释「菜单属于系统元数据，不需要审计字段和逻辑删除」，
   * 与 `prisma/schema.prisma` 的 `SysMenu` 一致）⇒ 无过滤可选，也不可能存在"已删除菜单"。
   */
  async getAllPerms(): Promise<string[]> {
    const menus = await this.prisma.sysMenu.findMany({
      where: { menuType: "B" },
      select: { perm: true },
    });
    return menus.map((m) => m.perm).filter((p): p is string => !!p);
  }
}
