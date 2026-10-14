import { forwardRef, Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, SysRole as SysRoleModel } from "@prisma/client";
import { CreateRoleDto } from "./dto/create-role.dto";
import { UpdateRoleDto } from "./dto/update-role.dto";
import { PrismaService } from "../../common/prisma/prisma.service";
import { toBigInt, toBigIntArray } from "../../common/prisma/prisma-ids";
import { auditOnCreate, auditOnUpdate } from "../../common/prisma/audit.util";
import { RolePermService } from "./role-permission.service";
import { BusinessException } from "../../common/exceptions/business.exception";
import { ROOT_ROLE_CODE } from "../../common/constants/role.constant";
import { RedisService } from "../../common/redis/redis.service";
import { RoleDataScope } from "../../common/models/role-data-scope.model";
import { DataScopeEnum } from "../../common/enums/data-scope.enum";

/**
 * 角色服务（Prisma 版）
 *
 * 数据访问客户端的选择：
 *  · 角色本身是**权限元数据**，走**基础客户端**（`this.prisma.sysRole`），不套数据权限；
 *  · 关联表 `sys_role_menu` / `sys_role_dept` / `sys_user_role` 同样走基础客户端。
 *
 * ⚠️ 跨模块约束（**未迁移的 `user` / `auth` / `menu` 模块依赖本服务的返回形状**，勿改）：
 *  · `findRoleIdsByCodes` / `findRoleIdsByCodesOrNames` / `getMenuIdsByRoleIds` / `getRoleDeptIds`
 *    必须返回 **字符串 ID 数组** —— 调用方（`user.service` 导入流程、`getUserMenuIds`、前端表单）
 *    全程按 string 处理，这是原 `bigNumberStrings: true` 契约的延续；
 *  · `findRolesByIds` 返回 `{ id, code, name, dataScope }` —— 比原实现**多**了 `id`/`name`
 *    （原 `select: ["code","dataScope"]` 导致 `user.service` 的 `roleNames` 恒为空，属修复，见该方法注释）；
 *  · `getRoleDataScopes` 的 `customDeptIds` 是 **number[]**（原实现 `Number(rd.deptId)`），不是字符串。
 *
 * ⚠️ 关系表在 Prisma schema 中**没有外键/关系定义**（刻意为之，与原库一致），
 * 因此原 `RolePermService` 里的 `innerJoin("rm.role"/"rm.menu")` 必须改写成显式 JOIN（见 `role-permission.service.ts`）。
 *
 * 🔴 本次移植**修掉的两处写路径缺陷**（已在 `scripts/verify-role-module.ts` 固化为回归断言）：
 *  1. `saveRole` 收到非法 `id`（如 `"abc"`）时，`toBigInt` 返回 null ⇒ 会**静默走新增路径**，
 *     `PUT /roles/abc` 带完整 body 会真的建出一个角色；现显式抛「角色不存在」。
 *  2. `findRolesByIds` 的 `select` 漏了 `name`，导致 `user.service` 的 `roleNames` 恒为空。
 */
@Injectable()
export class RoleService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => RolePermService))
    private readonly rolePermService: RolePermService,
    private readonly configService: ConfigService,
    private readonly redisCacheService: RedisService
  ) {}

  /**
   * 使指定用户的登录态失效（递增 token 版本号 + 清理会话键）
   *
   * ⚠️ 全部走**全局键**（`*Global`，不做租户前缀改写）：本方法在已认证的
   * 管理端请求里执行（ALS 有租户上下文），而校验端 `JwtStrategy.validate`
   * 在 ALS 装配前读取 —— 若写侧带前缀、读侧不带，**踢下线会静默失效**。
   * 键名中的 userId 全局唯一，不需要租户隔离。
   * 版本键 TTL 取 refresh 令牌生命周期（`jwt.expiresIn * 10`），
   * 否则默认 1h 过期后版本号回落，被吊销的旧令牌会「复活」。
   */
  private async invalidateUsersSessions(userIds: string[]): Promise<void> {
    const ids = (userIds || []).map((v) => v?.toString()).filter(Boolean);
    if (ids.length === 0) return;

    const sessionType = this.configService.get<string>("SESSION_TYPE") || "jwt";
    for (const userId of ids) {
      const versionKey = `auth:user:token_version:${userId}`;
      const currentVersion = await this.redisCacheService.getGlobal<number>(versionKey);
      const nextVersion = (currentVersion ?? 0) + 1;
      await this.redisCacheService.setGlobal(versionKey, nextVersion);
      await this.redisCacheService.expireGlobal(versionKey, this.redisVersionTtl());
      await this.redisCacheService.delGlobal(`auth:user:jwt_session:${userId}`);

      if (sessionType === "redis-token") {
        const accessKey = `auth:user:access:${userId}`;
        const refreshKey = `auth:user:refresh:${userId}`;

        const accessToken = await this.redisCacheService.getGlobal<string>(accessKey);
        const refreshToken = await this.redisCacheService.getGlobal<string>(refreshKey);

        if (accessToken) {
          await this.redisCacheService.delGlobal(`auth:token:access:${accessToken}`);
        }
        if (refreshToken) {
          await this.redisCacheService.delGlobal(`auth:token:refresh:${refreshToken}`);
        }

        await this.redisCacheService.delGlobal(accessKey);
        await this.redisCacheService.delGlobal(refreshKey);
      }
    }
  }

  /** Token 版本键存活窗口 = refresh 令牌生命周期（与 auth.service 吊销口径一致） */
  private redisVersionTtl(): number {
    const expiresIn = Number(this.configService.get<number>("jwt.expiresIn")) || 7200;
    return expiresIn * 10;
  }

  /**
   * 按角色编码批量取角色 ID（**返回字符串**，供未迁移模块消费）
   */
  async findRoleIdsByCodes(roleCodes: string[]): Promise<string[]> {
    const codes = (roleCodes || []).map((c) => (c ?? "").trim()).filter(Boolean);
    const roles = await this.prisma.sysRole.findMany({
      where: { code: { in: codes }, isDeleted: 0 },
      select: { id: true },
    });

    return roles.map((r) => r.id.toString());
  }

  /**
   * 根据角色编码或名称查找角色ID（导入时使用，支持编码或名称匹配）
   *
   * **返回字符串**，供未迁移的 `user.service` 导入流程直接消费。
   */
  async findRoleIdsByCodesOrNames(codesOrNames: string[]): Promise<string[]> {
    const items = (codesOrNames || []).map((c) => (c ?? "").trim()).filter(Boolean);
    if (!items.length) return [];

    // 先按编码查
    const rolesByCode = await this.prisma.sysRole.findMany({
      where: { code: { in: items }, isDeleted: 0 },
      select: { id: true, code: true },
    });

    const foundCodes = new Set(rolesByCode.map((r) => r.code));
    const remaining = items.filter((it) => !foundCodes.has(it));

    // 未匹配的按名称查
    if (remaining.length) {
      const rolesByName = await this.prisma.sysRole.findMany({
        where: { name: { in: remaining }, isDeleted: 0 },
        select: { id: true },
      });
      return [
        ...rolesByCode.map((r) => r.id.toString()),
        ...rolesByName.map((r) => r.id.toString()),
      ];
    }

    return rolesByCode.map((r) => r.id.toString());
  }

  /**
   * 保存角色（新增或更新）
   */
  async saveRole(
    roleForm: Partial<CreateRoleDto> & Partial<UpdateRoleDto> & { id?: string | number }
  ) {
    const rawId = roleForm.id;
    const roleId = toBigInt(rawId);

    // 🔴 传了 id 却不是合法主键 ⇒ 一律视为「角色不存在」，**绝不能退化成新增**。
    //    原实现用 `roleForm.id?.toString()` 判空，`"abc"` 是 truthy ⇒ 会走去查库；
    //    而本移植用 `toBigInt`（非法值 → null），若不显式拦一道，
    //    `PUT /roles/abc` 带完整 body 时会**真的新建出一个角色**（写路径缺陷，已修）。
    if (roleId === null && rawId !== undefined && rawId !== null && String(rawId).trim() !== "") {
      throw new BusinessException("角色不存在");
    }

    let oldRole: SysRoleModel | null = null;
    if (roleId !== null) {
      oldRole = await this.prisma.sysRole.findFirst({ where: { id: roleId, isDeleted: 0 } });
      if (!oldRole) {
        throw new BusinessException("角色不存在");
      }
    }

    const roleCode = (roleForm as { code?: string }).code;
    const roleName = (roleForm as { name?: string }).name;
    const roleSort = (roleForm as { sort?: number | null }).sort;
    const roleStatus = (roleForm as { status?: number }).status;
    const roleDataScope = (roleForm as { dataScope?: number | null }).dataScope;

    // 唯一性：`code = ? OR name = ?`（排除自身）。
    // 注意：原实现用 TypeORM 的 `= :code` 传 undefined 时会生成 `col = NULL`，
    // 在 SQL 里**永不成立**；Prisma 则把 `{ code: undefined }` 当「未提供」⇒ 该分支会退化成恒真。
    // 故这里只在「确实传了值」时才加对应分支，精确对齐原语义。
    const dupOr: Prisma.SysRoleWhereInput[] = [];
    if (roleCode !== undefined) dupOr.push({ code: roleCode });
    if (roleName !== undefined) dupOr.push({ name: roleName });

    if (dupOr.length) {
      const dupWhere: Prisma.SysRoleWhereInput = {
        isDeleted: 0,
        OR: dupOr,
        ...(oldRole ? { id: { not: oldRole.id } } : {}),
      };
      const dupCount = await this.prisma.sysRole.count({ where: dupWhere });
      if (dupCount > 0) {
        throw new BusinessException("角色名称或角色编码已存在，请修改后重试！");
      }
    }

    if (oldRole) {
      // ---------------- 更新路径 ----------------
      // 原实现走 `create({...oldRole, ...roleForm, ...})` + `save()`：
      //  · `createTime` 被显式赋回旧值 ⇒ 不变；
      //  · `updateTime` 每次刷新；
      //  · TypeORM 的 save() 会**跳过 undefined** ⇒ 未传字段保持原值（不动）；
      //  · 审计字段由订阅器填：`beforeUpdate` 只写 `updateBy`/`updateTime`（`createBy` 不动）。
      const data: Prisma.SysRoleUpdateInput = { ...auditOnUpdate() };
      if (roleCode !== undefined) data.code = roleCode;
      if (roleName !== undefined) data.name = roleName;
      if (roleSort !== undefined) data.sort = roleSort;
      if (roleStatus !== undefined) data.status = roleStatus;
      if (roleDataScope !== undefined) data.dataScope = roleDataScope;

      await this.prisma.sysRole.update({ where: { id: oldRole.id }, data });

      // 数据权限发生变化时，失效该角色关联用户的登录态（JWT tokenVersion）。
      // ⚠️ 保持原实现口径：直接比较「入参本次传入的 dataScope」与旧值。
      //    即**未传 dataScope 时也会判定为「变了」**（undefined !== 旧值）⇒ 会多失效一次会话。
      //    属安全方向的保守行为，且前端表单总会带上该字段；已登记为已知缺陷，不在此处「顺手修」。
      if (oldRole.dataScope !== (roleDataScope as number)) {
        const relations = await this.prisma.sysUserRole.findMany({
          where: { roleId: oldRole.id },
          select: { userId: true },
        });
        await this.invalidateUsersSessions(relations.map((r) => r.userId.toString()));
      }
      return true;
    }

    // ---------------- 新增路径 ----------------
    await this.prisma.sysRole.create({
      data: {
        name: roleName,
        code: roleCode,
        status: roleStatus,
        ...(roleSort !== undefined ? { sort: roleSort } : {}),
        ...(roleDataScope !== undefined ? { dataScope: roleDataScope } : {}),
        isDeleted: 0,
        // 原实现显式赋 createTime/updateTime = now，再由订阅器补 createBy/updateBy
        ...auditOnCreate(),
      },
    });

    return true;
  }

  /**
   * 角色分页列表
   */
  async getRolePage(pageNum: number, pageSize: number, keywords?: string) {
    const pageNumSafe = Number(pageNum) > 0 ? Number(pageNum) : 1;
    const pageSizeSafe = Number(pageSize) > 0 ? Number(pageSize) : 20;

    const where: Prisma.SysRoleWhereInput = {
      isDeleted: 0,
      // 内置超级管理员角色不进列表
      code: { notIn: [ROOT_ROLE_CODE] },
    };

    if (keywords) {
      where.OR = [
        { name: { contains: keywords, mode: "insensitive" } },
        { code: { contains: keywords, mode: "insensitive" } },
      ];
    }

    // ⚠️ NULL 排序：MySQL 视 NULL 为最小值（ASC 在前 / DESC 在后），PG 视其为最大值（相反）。
    //    原库跑在 MySQL 上，这里显式写出 nulls 以精确保持旧库顺序
    //    （`sort` 可空；`create_time`/`update_time` 由审计路径保证有值）。
    const [list, total] = await Promise.all([
      this.prisma.sysRole.findMany({
        where,
        orderBy: [
          { sort: { sort: "asc", nulls: "first" } },
          { createTime: { sort: "desc", nulls: "last" } },
          { updateTime: { sort: "desc", nulls: "last" } },
        ],
        skip: (pageNumSafe - 1) * pageSizeSafe,
        take: pageSizeSafe,
      }),
      this.prisma.sysRole.count({ where }),
    ]);

    const dataScopeLabelMap: Record<number, string> = {
      [DataScopeEnum.ALL]: "全部数据",
      [DataScopeEnum.DEPT_AND_SUB]: "部门及子部门数据",
      [DataScopeEnum.DEPT]: "本部门数据",
      [DataScopeEnum.SELF]: "本人数据",
      [DataScopeEnum.CUSTOM]: "自定义部门数据",
    };

    const data = list.map((item) => ({
      ...item,
      dataScopeLabel: dataScopeLabelMap[item.dataScope] ?? "",
    }));

    return {
      data,
      page: {
        pageNum: pageNumSafe,
        pageSize: pageSizeSafe,
        total,
      },
    };
  }

  /**
   * 根据角色查询菜单 ID（**返回字符串数组**）
   */
  async getMenuIdsByRoleIds(roleIds: string[]): Promise<string[]> {
    if (!roleIds?.length) return [];
    const ids = toBigIntArray(roleIds);
    if (!ids.length) return [];

    const roleMenus = await this.prisma.sysRoleMenu.findMany({
      where: { roleId: { in: ids } },
      select: { menuId: true },
    });

    return [...new Set(roleMenus.map((rm) => rm.menuId.toString()))];
  }

  async getRoleMenuIds(roleId: string): Promise<string[]> {
    return await this.getMenuIdsByRoleIds([roleId.toString()]);
  }

  /**
   * 角色下拉列表
   */
  async getRoleOptions() {
    const roles = await this.prisma.sysRole.findMany({
      where: { isDeleted: 0, code: { notIn: [ROOT_ROLE_CODE] } },
      orderBy: [{ sort: { sort: "asc", nulls: "first" } }],
      select: { id: true, name: true },
    });

    return roles
      .filter(({ name }) => !!name?.trim())
      .map(({ id, name }) => ({
        label: name,
        value: id.toString(),
      }));
  }

  /**
   * 创建角色
   */
  async create(createRoleDto: CreateRoleDto) {
    return await this.saveRole(createRoleDto);
  }

  /**
   * 根据 ID 查询角色
   */
  async getRoleForm(id: string) {
    const roleId = toBigInt(id);
    const role =
      roleId === null
        ? null
        : await this.prisma.sysRole.findFirst({ where: { id: roleId, isDeleted: 0 } });
    if (!role) {
      return null;
    }

    // 自定义数据权限时回显部门ID列表
    if (role.dataScope === DataScopeEnum.CUSTOM) {
      const deptIds = await this.getRoleDeptIds(role.id.toString());
      return {
        ...role,
        deptIds,
      };
    }

    return role;
  }

  /**
   * 更新角色
   */
  async update(id: string, updateRoleDto: UpdateRoleDto) {
    return await this.saveRole({ ...updateRoleDto, id });
  }

  /**
   * 更新角色状态
   *
   * ⚠️ 原实现走 `repository.update()`：**不刷新 `updateTime`、也不失效会话 / 刷新权限缓存**。
   *    本次保持原行为（已登记为已知缺陷：停用角色后，已缓存的权限与在线会话都不会被撤销）。
   */
  async updateRoleStatus(roleId: string, status: number): Promise<boolean> {
    const id = toBigInt(roleId);
    const role =
      id === null
        ? null
        : await this.prisma.sysRole.findFirst({
            where: { id, isDeleted: 0 },
            select: { id: true },
          });

    if (!role) {
      throw new BusinessException("角色不存在");
    }

    const result = await this.prisma.sysRole.updateMany({
      where: { id: id! },
      data: { status: Number(status) },
    });
    return result.count > 0;
  }

  /**
   * 更新角色菜单
   *
   * 更新后需要：
   * 1. 刷新该角色的权限缓存
   * 2. 使已登录用户的会话失效（触发重新加载权限）
   */
  async updateMenus(roleId: string, menuIds: string[]) {
    const roleIdBig = toBigInt(roleId);
    if (roleIdBig === null) {
      // 原实现会把 "abc" 直接塞进 bigint 列、由 MySQL 报错；
      // 本移植沿用全项目口径「非法 ID 不产生 SQL 错误」，返回空数组。
      return [];
    }

    // 获取角色编码（用于刷新权限缓存）
    const role = await this.prisma.sysRole.findFirst({
      where: { id: roleIdBig, isDeleted: 0 },
      select: { id: true, code: true },
    });

    // 删除旧的菜单关联
    await this.prisma.sysRoleMenu.deleteMany({ where: { roleId: roleIdBig } });

    // 添加新的菜单关联
    // 去重后再写：菜单关联是**集合语义**，重复入参静默去重
    //（原 TypeORM `save()` 会撞复合主键报错）。去重同时保证下面 `rows.length`
    // 与「实际写入行数」一致 —— 返回的是**持久化后的集合**，不是原始入参。
    const seenMenuIds = new Set<string>();
    const rows = (menuIds || [])
      .map((menuId) => ({ roleId: roleIdBig, menuId: toBigInt(menuId) }))
      .filter((r): r is { roleId: bigint; menuId: bigint } => r.menuId !== null)
      .filter((r) => {
        const key = r.menuId.toString();
        if (seenMenuIds.has(key)) return false;
        seenMenuIds.add(key);
        return true;
      });
    if (rows.length) {
      // skipDuplicates：并发场景下的兜底（正常路径上旧关联已删除，不会命中）
      await this.prisma.sysRoleMenu.createMany({ data: rows, skipDuplicates: true });
    }

    // 刷新角色权限缓存
    if (role?.code) {
      await this.rolePermService.refreshRolePermsCache(role.code);
    }

    // 使已登录用户的会话失效
    const relations = await this.prisma.sysUserRole.findMany({
      where: { roleId: roleIdBig },
      select: { userId: true },
    });
    await this.invalidateUsersSessions(relations.map((r) => r.userId.toString()));

    return rows.map((r) => ({ roleId: r.roleId.toString(), menuId: r.menuId.toString() }));
  }

  /**
   * 删除角色（单条，逻辑删除）
   */
  async remove(id: string) {
    const roleId = toBigInt(id);
    if (roleId === null) {
      return { affected: 0 };
    }
    const result = await this.prisma.sysRole.updateMany({
      where: { id: roleId },
      data: { isDeleted: 1 },
    });
    return { affected: result.count };
  }

  async deleteRoles(ids: string) {
    if (!ids?.trim()) {
      throw new BusinessException("删除的角色ID不能为空");
    }

    const roleIds = ids
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

    for (const roleId of roleIds) {
      const id = toBigInt(roleId);
      if (id === null) continue;

      const role = await this.prisma.sysRole.findFirst({ where: { id, isDeleted: 0 } });
      if (!role) {
        continue;
      }

      // 系统内置角色禁止删除
      if (role.code === ROOT_ROLE_CODE) {
        throw new BusinessException(`系统内置角色【${role.name}】禁止删除`);
      }

      const assignedCount = await this.prisma.sysUserRole.count({ where: { roleId: id } });
      if (assignedCount > 0) {
        throw new BusinessException(`角色【${role.name}】已分配用户，请先解除关联后删除`);
      }

      await this.prisma.sysRoleMenu.deleteMany({ where: { roleId: id } });
      // 原实现走 update()，不刷新 updateTime（保持原样）
      await this.prisma.sysRole.update({ where: { id }, data: { isDeleted: 1 } });

      // 刷新角色权限缓存（删除角色编码对应的缓存）
      await this.rolePermService.refreshRolePermsCache(role.code);
    }
  }

  /**
   * 查询角色信息
   *
   * 供 `user`/`auth` 等未迁移模块消费。
   *
   * 🔴 **修复了一处原实现缺陷**：原 `select` 只取 `["code", "dataScope"]`，但
   * `user.service.ts` 的用户详情里写了 `roles.map((r) => r.name).join(",")` 来拼 `roleNames`
   * ⇒ 该字段在旧实现下**恒为 `undefined`**（两个角色时 join 出 `","`）。
   * 这里补上了 `name`（并顺带补 `id`，便于后续调用方使用），使 `roleNames` 真正返回角色名。
   * 已在 `scripts/verify-role-module.ts` 中以断言固化新行为。
   */
  async findRolesByIds(
    roleIds: string[]
  ): Promise<{ id: bigint; code: string; name: string; dataScope: number }[]> {
    const ids = toBigIntArray(roleIds);
    if (!ids.length) return [];

    return await this.prisma.sysRole.findMany({
      where: { id: { in: ids }, isDeleted: 0 },
      select: { id: true, code: true, name: true, dataScope: true },
    });
  }

  /**
   * 获取角色的数据权限列表
   *
   * 支持多角色数据权限，返回每个角色的数据权限信息
   *
   * @param roleCodes 角色编码列表
   * @returns 角色数据权限列表
   */
  async getRoleDataScopes(roleCodes: string[]): Promise<RoleDataScope[]> {
    if (!roleCodes || roleCodes.length === 0) {
      return [];
    }

    const roles = await this.prisma.sysRole.findMany({
      where: { code: { in: roleCodes }, isDeleted: 0, status: 1 },
      select: { code: true, dataScope: true },
    });

    if (!roles || roles.length === 0) {
      return [];
    }

    const customRoleCodes = roles
      .filter((r) => r.dataScope === DataScopeEnum.CUSTOM)
      .map((r) => r.code);

    const customDeptIdsMap = new Map<string, number[]>();

    if (customRoleCodes.length > 0) {
      const customRoles = await this.prisma.sysRole.findMany({
        where: { code: { in: customRoleCodes }, isDeleted: 0 },
        select: { id: true, code: true },
      });

      const customRoleIds = customRoles.map((r) => r.id);
      const roleIdToCodeMap = new Map(customRoles.map((r) => [r.id.toString(), r.code]));

      if (customRoleIds.length > 0) {
        const roleDepts = await this.prisma.sysRoleDept.findMany({
          where: { roleId: { in: customRoleIds } },
        });

        // 按角色编码分组
        for (const rd of roleDepts) {
          const roleCode = roleIdToCodeMap.get(rd.roleId.toString());
          if (roleCode) {
            if (!customDeptIdsMap.has(roleCode)) {
              customDeptIdsMap.set(roleCode, []);
            }
            customDeptIdsMap.get(roleCode)!.push(Number(rd.deptId));
          }
        }
      }
    }

    // 构建 RoleDataScope 列表
    return roles.map((role) => {
      const customDeptIds = customDeptIdsMap.get(role.code);
      return new RoleDataScope(role.code, role.dataScope, customDeptIds);
    });
  }

  /**
   * 更新角色部门（自定义数据权限）
   *
   * @param roleId 角色ID
   * @param deptIds 部门ID列表
   */
  async updateRoleDepts(roleId: string, deptIds: string[]): Promise<void> {
    const roleIdBig = toBigInt(roleId);
    if (roleIdBig === null) return;

    // 删除旧的关联
    await this.prisma.sysRoleDept.deleteMany({ where: { roleId: roleIdBig } });

    // 添加新的关联
    if (deptIds && deptIds.length > 0) {
      const rows = deptIds
        .map((deptId) => ({ roleId: roleIdBig, deptId: toBigInt(deptId) }))
        .filter((r): r is { roleId: bigint; deptId: bigint } => r.deptId !== null);
      if (rows.length) {
        await this.prisma.sysRoleDept.createMany({ data: rows, skipDuplicates: true });
      }
    }

    // 使相关用户的会话失效
    const relations = await this.prisma.sysUserRole.findMany({
      where: { roleId: roleIdBig },
      select: { userId: true },
    });
    await this.invalidateUsersSessions(relations.map((r) => r.userId.toString()));
  }

  /**
   * 获取角色的自定义部门ID列表（**返回字符串数组**）
   *
   * @param roleId 角色ID
   * @returns 部门ID列表
   */
  async getRoleDeptIds(roleId: string): Promise<string[]> {
    const roleIdBig = toBigInt(roleId);
    if (roleIdBig === null) return [];

    const roleDepts = await this.prisma.sysRoleDept.findMany({
      where: { roleId: roleIdBig },
    });
    return roleDepts.map((rd) => rd.deptId.toString());
  }
}
