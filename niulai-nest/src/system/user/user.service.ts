import { forwardRef, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, SysUser as SysUserModel } from "@prisma/client";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { BusinessException } from "../../common/exceptions/business.exception";
import { RoleService } from "../role/role.service";
import { DeptService } from "../dept/dept.service";
import { RolePermService } from "../role/role-permission.service";
import { UserAuthInfo } from "./interfaces/user-auth-info.interface";
import { CurrentUserDto } from "./dto/current-user.dto";
import { CurrentUserInfo } from "../../common/interfaces/current-user.interface";
import { DEFAULT_PASSWORD } from "../../common/constants/system.constant";
import { ROOT_ROLE_CODE } from "../../common/constants/role.constant";
import { ConfigService } from "@nestjs/config";
import { RedisService } from "../../common/redis/redis.service";
import { PrismaService } from "../../common/prisma/prisma.service";
import { toBigInt } from "../../common/prisma/prisma-ids";
import { auditOnCreate, auditOnUpdate, currentAuditUserId } from "../../common/prisma/audit.util";
import * as bcrypt from "bcrypt";
import { UserFormDto } from "./dto/user-form.dto";
import type { PasswordChangeDto } from "./dto/password-change.dto";
import type { MobileUpdateDto } from "./dto/mobile-update.dto";
import type { EmailUpdateDto } from "./dto/email-update.dto";
import type { UserProfileDto } from "./dto/user-profile.dto";
import { ErrorCode } from "../../common/enums/error-code.enum";
import * as XLSX from "xlsx";
import { RoleDataScope } from "../../common/models/role-data-scope.model";
import { endOfDay, formatDateTimeInZone, startOfDay } from "../../common/utils/date.util";

/**
 * 用户对外视图（列表 / 导出 / 表单 / 写接口回参共用）。
 *
 * 🔴 主键与外键**一律在 service 内转成字符串**，只靠全局 `toJSON` 垫片是不够的：
 *  - 原 TypeORM 配置是 `supportBigNumbers: true, bigNumberStrings: true`，主键本就以
 *    **字符串**形态出入，前端全程按 string 处理；
 *  - Prisma 对 `bigint` 列返回的是 JS **BigInt**。若在 service 内部就把它当对象使用
 *    （放进 `Map` 键、与 DTO 的 string 比较、拼字符串），`1n !== "1"` 会**静默失配** ——
 *    既不报错也不抛异常，只是「查不到 / 拼出来是空的」，属最难查的一类。
 *  因此统一经 `toUserView()` 出口，边界处一次性转干净。
 */
export interface UserView {
  id: string;
  username: string;
  nickname: string;
  gender: number;
  /** bcrypt 哈希。⚠️ 字段保留只为对齐原契约（原实现把实体直接返回），见类注释「已知缺陷 ⑥」 */
  password: string;
  deptId: string | null;
  avatar: string | null;
  mobile: string | null;
  status: number;
  email: string | null;
  createBy: string | null;
  createTime: Date | null;
  updateBy: string | null;
  updateTime: Date | null;
  isDeleted: number;
}

function toUserView(user: SysUserModel): UserView {
  return {
    id: user.id.toString(),
    username: user.username,
    nickname: user.nickname,
    gender: user.gender,
    password: user.password,
    deptId: user.deptId === null ? null : user.deptId.toString(),
    avatar: user.avatar,
    mobile: user.mobile,
    status: user.status,
    email: user.email,
    createBy: user.createBy === null ? null : user.createBy.toString(),
    createTime: user.createTime,
    updateBy: user.updateBy === null ? null : user.updateBy.toString(),
    updateTime: user.updateTime,
    isDeleted: user.isDeleted,
  };
}

/**
 * 列表 / 导出行（对外形状与原实现逐字段一致，`createTime` 为格式化后的字符串）。
 *
 * 必须 `export`：`tsconfig` 开了 `declaration: true`，而 `UserController.exportUsers()`
 * 的返回类型里带了这个名字 —— 不导出会报 `TS4053 … but cannot be named`。
 */
export interface UserRow {
  id: string;
  username: string;
  nickname: string;
  gender: number;
  mobile: string | null;
  status: number;
  email: string;
  deptId: string | null;
  deptName: string | null;
  roleNames: string;
  createTime: string | null;
  /**
   * 是否持有 ROOT（系统管理员）角色。
   *
   * 供前端在「显示超管」模式下把这类行标成「系统级」并屏蔽删除入口 ——
   * **不要**用 `roleNames` 里含某中文字符串来判断：角色名可在角色管理里被改，
   * 只有角色 `code === ROOT_ROLE_CODE` 才是稳定判据。
   */
  isRoot: boolean;
}

/**
 * 用户服务（PEL-10c：TypeORM → Prisma）
 *
 * 与 `menu` / `role` 不同，本模块**没有任何过渡期实体注册的负担**：
 * 全仓 grep 确认 `SysUser` / `SysUserRole` / `SysUserSocial` 的 TypeORM 元数据消费者
 * 只有本模块自己（`roles` 关系）与 `auth.module.ts` 里一处**已死**的 `forFeature`，
 * 因此三个实体文件可整体归档。
 *
 * ─────────────────────────────────────────────────────────────
 * 🔴 本次修复的 2 处缺陷
 *  ① 【已修·约定 12】`getUserPage` / `listExportUsers` 的 `status` 筛选把**空串当成 0**
 *     —— `UserQueryDto.status` 的 `@Transform` 写的是 `Number(value)`，而前端筛选栏
 *     `el-select` 带 `clearable`，**清空时 emit `''`** ⇒ `Number('') === 0` ⇒
 *     「清空状态筛选」反而变成「只看禁用用户」。同文件里 `deptId` 的 Transform 本来就有
 *     `'' → undefined` 的分支，`status` 是漏掉的那一个，本次补齐。
 *  ② 【已修·安全方向】`mobile` / `email` 的唯一性校验**大小写不敏感**化 ——
 *     旧库 MySQL 默认排序规则 `utf8mb4_general_ci` 下 `a@x.com` 与 `A@x.com` 视为同一值，
 *     PG 的 `varchar` 比较**区分大小写**。⇒ 若保持原样，换库后会允许「同一邮箱不同大小写」
 *     绑定到两个账号。统一用 `mode: "insensitive"`（与 `dict` / `log` 的处理口径一致）。
 *
 * ─────────────────────────────────────────────────────────────
 * ⚠️ 保持原行为的记录项（逐条固化为校验脚本断言，不顺手统一）
 *  ① `update()` 的 `deptId` **无条件写入**：请求体不带 `deptId` 时会被写成 NULL（清空部门）。
 *     未修的理由：`UpdateUserDto.deptId` 的 `@Transform` 会把 `'' → undefined`，
 *     于是**「没传」与「显式清空」在 DTO 层已被抹平**，要区分必须改 DTO 契约；
 *     而管理端表单 `getFormData()` 回显的 `deptId` 恒有值（`?? ""`），任何提交都会带上该键，
 *     ⇒ 该路径**从 UI 不可达**。与 `menu` 的「点一次隐藏就毁掉整棵子树」不同，故本次保留。
 *  ② `update()` 会写入 DTO 里的 `isDeleted` / `createTime` / `createBy` ——
 *     前端表单不发送这三者，属「模板遗留的越权面」，保留原样。
 *  ③ `updateUserStatus()` / `resetUserPassword()` / `changeCurrentUserPassword()` /
 *     `bindOrChangeMobile()` / `bindOrChangeEmail()` **从不刷新 `updateTime`** ——
 *     原实现走 `repository.update()`，不触发 `TypeORM` 的 `AuditSubscriber`。
 *     （对照：`updateProfile()` / `deleteUser()` 是**显式**赋 `updateTime` 的那两个。）
 *  ④ 导入（`importUsersFromBuffer`）逐行独立提交、**无整体事务**：中途失败会留下
 *     「前 N 行已入库、后 M 行未入库」的半成品，且 `validCount` 只统计成功行。
 *  ⑤ `importUsersFromBuffer` 里显式 `createTime: new Date()`，但**不写** `createBy` 之外
 *     的操作人字段差异 —— 原 `AuditSubscriber` 仍会把 `updateTime` / `updateBy` 填上，
 *     本次用 `auditOnCreate()` 等价承接。列本身可空，漏填不会报错，故固化为断言。
 *  ⑥ `create()` / `update()` 的返回值**包含 `password`（bcrypt 哈希）** ——
 *     原实现直接返回实体，本移植保持同形。属**既有契约缺陷**（前端不使用该字段），
 *     收紧会改变响应形状，留作独立任务。
 *  ⑦ `findByMobile()` 按 `mobile` 精确匹配，但**不校验 `mobile` 唯一**：
 *     `sys_user` 原库与 schema 均**无**手机号唯一索引，重复手机号会导致短信登录命中不确定。
 *  ⑧ 分页与导出的 `createTime` 区间语义**曾依赖进程时区**（`new Date(str)` 对
 *     `"yyyy-MM-dd"` 按 UTC 解释、对 `"yyyy-MM-dd HH:mm:ss"` 按本地解释，
 *     `setHours(23,59,59,999)` 又是本地）⇒ 已按移植约定 9 统一改走
 *     `startOfDay()` / `endOfDay()`（应用时区 `Asia/Shanghai`），展示层同改 `formatDateTimeInZone()`。
 *  ⑨ 原 `getUserForm()`（返回 TypeORM 实体、`relations: ["roles"]`）是**死代码** ——
 *     全仓 grep 只有定义、无调用（控制器走的是 `getUserFormData()`），故本次直接删除。
 */
@Injectable()
export class UserService {
  constructor(
    @Inject(forwardRef(() => RoleService))
    private readonly roleService: RoleService,
    @Inject(forwardRef(() => DeptService))
    private readonly deptService: DeptService,
    @Inject(forwardRef(() => RolePermService))
    private readonly rolePermService: RolePermService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly redisCacheService: RedisService
  ) {}

  /**
   * 用户分页列表
   */
  async getUserPage(
    pageNum: number,
    pageSize: number,
    deptId?: string,
    keywords?: string,
    status?: number,
    createTime?: string[],
    includeRoot: boolean | string | number = false
  ) {
    const pageNumSafe = Number(pageNum) > 0 ? Number(pageNum) : 1;
    const pageSizeSafe = Number(pageSize) > 0 ? Number(pageSize) : 20;

    const where = await this.buildUserWhere(deptId, keywords, status, createTime, includeRoot);

    // 读用户列表要带数据权限（`@DataPermission({ model: "SysUser" })`）⇒ 必须走 scoped 客户端。
    // 排序：`createTime DESC` 与旧库一致，但 PG 把 NULL 当**最大**值 ⇒ `DESC` 时 NULL 排最前
    // （MySQL 相反，排最后）。本项目审计字段恒被 `auditOnCreate()` 填满、不存在 NULL，
    // 仍显式写 `nulls: "last"` 把顺序钉死，避免历史脏数据让分页首屏与旧库不一致。
    const [list, total] = await Promise.all([
      this.prisma.scoped.sysUser.findMany({
        where,
        orderBy: { createTime: { sort: "desc", nulls: "last" } },
        skip: (pageNumSafe - 1) * pageSizeSafe,
        take: pageSizeSafe,
      }),
      this.prisma.scoped.sysUser.count({ where }),
    ]);

    const data = await this.decorateUsers(list);

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
   * 列出用于导出的用户数据（不分页）
   */
  async listExportUsers(
    deptId?: string,
    keywords?: string,
    status?: number,
    createTime?: string[],
    includeRoot: boolean | string | number = false
  ): Promise<UserRow[]> {
    // 导出与分页共用同一口径：开关打开时导出同样包含超管，避免「列表看得到、导出没有」
    const where = await this.buildUserWhere(deptId, keywords, status, createTime, includeRoot);

    const list = await this.prisma.scoped.sysUser.findMany({
      where,
      orderBy: { createTime: { sort: "desc", nulls: "last" } },
    });

    return await this.decorateUsers(list);
  }

  /**
   * 获取用户认证凭证信息
   *
   * 用于登录认证阶段，返回用户的基本信息和权限相关数据
   * 权限标识（perms）不在此处获取，而是在权限校验时从角色权限缓存动态读取
   */
  async getAuthCredentialsByUsername(username: string): Promise<UserAuthInfo | null> {
    // 用户名查补 `insensitive`：旧库排序规则不区分大小写，登录 `Admin` / `admin` 均可；
    // PG 区分 ⇒ 不加这个会变成「用户名大小写不对就登不上」。
    const user = await this.prisma.sysUser.findFirst({
      where: { username: { equals: username, mode: "insensitive" }, isDeleted: 0 },
    });

    if (!user) {
      return null;
    }

    const roleIds = await this.findRoleIdsOfUser(user.id);
    const roles = await this.roleService.findRolesByIds(roleIds);
    const roleCodes = roles.map((r) => r.code);

    // 获取多角色数据权限列表
    const dataScopes = await this.roleService.getRoleDataScopes(roleCodes);

    // 获取部门树路径
    let deptTreePath = "";
    if (user.deptId) {
      const depts = await this.deptService.findByIds([user.deptId.toString()]);
      deptTreePath = depts?.[0]?.treePath || "";
    }

    return {
      id: user.id.toString(),
      username: user.username,
      nickname: user.nickname,
      password: user.password,
      status: user.status,
      deptId: user.deptId?.toString() || "",
      deptTreePath,
      // 租户归属（P0-03-01）：字符串化后随令牌签发（BigInt 直入 JWT payload 会序列化炸）
      tenantId: user.tenantId?.toString() ?? null,
      roles: roleCodes,
      dataScopes,
    };
  }

  /**
   * 根据手机号获取用户认证信息（短信登录）
   */
  async findByMobile(mobile: string): Promise<{
    id: string;
    username: string;
    status: number;
    deptId: string;
    deptTreePath: string;
    tenantId: string | null;
    roles: string[];
    dataScopes: RoleDataScope[];
  } | null> {
    const mobileSafe = mobile?.trim();
    if (!mobileSafe) return null;

    const user = await this.prisma.sysUser.findFirst({
      where: { mobile: mobileSafe, isDeleted: 0 },
    });
    if (!user) return null;

    const roleIds = await this.findRoleIdsOfUser(user.id);
    const roles = await this.roleService.findRolesByIds(roleIds);
    const roleCodes = roles.map((r) => r.code);

    // 获取多角色数据权限列表
    const dataScopes = await this.roleService.getRoleDataScopes(roleCodes);

    // 获取部门树路径
    let deptTreePath = "";
    if (user.deptId) {
      const depts = await this.deptService.findByIds([user.deptId.toString()]);
      deptTreePath = depts?.[0]?.treePath || "";
    }

    return {
      id: user.id.toString(),
      username: user.username,
      status: user.status,
      deptId: user.deptId?.toString() || "",
      deptTreePath,
      // 租户归属（P0-03-01）：与密码登录同口径
      tenantId: user.tenantId?.toString() ?? null,
      roles: roleCodes,
      dataScopes,
    };
  }

  /**
   * 获取当前用户信息
   */
  async findMe(currentUserInfo: CurrentUserInfo): Promise<CurrentUserDto> {
    const userId = currentUserInfo?.userId;
    if (!userId) {
      throw new BusinessException(ErrorCode.ACCESS_TOKEN_INVALID);
    }

    const userIdBig = toBigInt(userId);
    const user =
      userIdBig === null
        ? null
        : await this.prisma.sysUser.findFirst({
            where: { id: userIdBig, isDeleted: 0 },
            select: {
              id: true,
              username: true,
              nickname: true,
              mobile: true,
              email: true,
              avatar: true,
              gender: true,
              deptId: true,
              createTime: true,
            },
          });

    if (!user) {
      throw new BusinessException("用户不存在");
    }

    const roleIds = await this.findRoleIdsOfUser(userIdBig);
    const roles = roleIds.length ? await this.roleService.findRolesByIds(roleIds) : [];
    const roleCodes = roles.map((r) => r.code);
    const roleNames = roles.map((r) => r.name).join(",");

    let perms: string[] = [];
    if (roleCodes.length) {
      if (roleCodes.includes(ROOT_ROLE_CODE)) {
        perms = await this.rolePermService.getAllPerms();
      } else {
        perms = await this.rolePermService.getPermsByRoleCodes(roleCodes);
      }
    }

    let deptName: string | undefined;
    if (user.deptId) {
      const dept = await this.deptService.findByIds([user.deptId.toString()]);
      deptName = dept?.[0]?.name;
    }

    return {
      userId: user.id.toString(),
      username: user.username,
      nickname: user.nickname,
      mobile: user.mobile,
      email: user.email,
      avatar: user.avatar,
      gender: user.gender,
      deptId: user.deptId?.toString(),
      deptName,
      roleNames,
      createTime: formatDateTimeInZone(user.createTime),
      roles: roleCodes,
      perms,
    };
  }

  /**
   * 更新当前用户个人信息（个人中心）
   */
  async updateProfile(currentUserInfo: CurrentUserInfo, data: UserProfileDto): Promise<boolean> {
    const userId = currentUserInfo.userId?.toString();
    const userIdBig = toBigInt(userId);
    const user =
      userIdBig === null ? null : await this.prisma.sysUser.findFirst({ where: { id: userIdBig } });
    if (!user) {
      throw new BusinessException("用户不存在");
    }

    // 只收显式传入的字段（原实现是「先铺开再删 undefined」，等价）
    const patch: Prisma.SysUserUncheckedUpdateInput = {};
    if (data.nickname !== undefined) patch.nickname = data.nickname;
    if (data.avatar !== undefined) patch.avatar = data.avatar;
    if (data.gender !== undefined) patch.gender = data.gender;

    if (Object.keys(patch).length === 0) {
      throw new BusinessException("未变更数据");
    }

    // 原实现走 `repository.update()`，不触发 AuditSubscriber ⇒ updateTime 本就是显式赋的
    patch.updateTime = new Date();

    const result = await this.prisma.sysUser.updateMany({ where: { id: userIdBig }, data: patch });
    return result.count > 0;
  }

  /**
   * 新增用户
   */
  async create(createUserDto: CreateUserDto): Promise<UserView> {
    const { username, password = DEFAULT_PASSWORD, roleIds } = createUserDto;

    // 检查用户名是否已存在（排除已删除用户）
    // 查补 insensitive：旧库唯一性判定受 `utf8mb4_general_ci` 影响，`Admin` 与 `admin` 视为同名
    const existingUser = await this.prisma.sysUser.findFirst({
      where: { username: { equals: username, mode: "insensitive" }, isDeleted: 0 },
      select: { id: true },
    });
    if (existingUser) {
      throw new BusinessException("用户名已存在");
    }

    // 角色 ID 先解析再落库：原实现先插入用户、再插关联，非法角色 ID 会在第二步炸掉，
    // 留下一个「建好但没有角色」的半成品用户。这里提前校验，非法规格直接抛业务异常。
    const roleIdBigs = this.parseRoleIdList(roleIds);

    // 使用 bcrypt 加密密码
    const hashedPassword = await bcrypt.hash(password, 10);

    // 审计字段：原实现是「DTO 给值 → AuditSubscriber 再用上下文用户覆盖」，故上下文用户优先；
    // 无上下文时才回落到 DTO 的值。`updateBy` 在原实现里回落到 `dto.updateBy`（不是 createBy），此处对齐。
    const operator = currentAuditUserId();
    const audit = auditOnCreate(this.parseOptionalId(createUserDto.createBy, "创建人ID"));
    if (operator === null && createUserDto.updateBy !== undefined) {
      audit.updateBy = this.parseOptionalId(createUserDto.updateBy, "修改人ID") ?? undefined;
    }

    const data: Prisma.SysUserUncheckedCreateInput = {
      username,
      nickname: createUserDto.nickname,
      password: hashedPassword,
      deptId: this.parseOptionalId(createUserDto.deptId, "部门ID"),
      ...audit,
    };
    // 未传即不写，交由列默认值兜底（`gender` / `status` 默认 1）——与 TypeORM 的 INSERT 行为一致
    if (createUserDto.gender !== undefined) data.gender = createUserDto.gender;
    if (createUserDto.avatar !== undefined) data.avatar = createUserDto.avatar;
    if (createUserDto.mobile !== undefined) data.mobile = createUserDto.mobile;
    if (createUserDto.status !== undefined) data.status = createUserDto.status;
    if (createUserDto.email !== undefined) data.email = createUserDto.email;

    const savedUser = await this.prisma.sysUser.create({ data });

    // 保存用户角色关联
    if (roleIdBigs.length > 0) {
      await this.prisma.sysUserRole.createMany({
        data: roleIdBigs.map((roleId) => ({ userId: savedUser.id, roleId })),
        // 上面已去重，`skipDuplicates` 只作并发兜底（与 `role.service` 的写法一致）
        skipDuplicates: true,
      });
    }

    return toUserView(savedUser);
  }

  async updateUserStatus(userId: string, status: number): Promise<boolean> {
    const userIdBig = toBigInt(userId);
    if (userIdBig === null) return false;

    // 注意：原实现走 `repository.update()` ⇒ **不刷新 updateTime**（见类注释记录项 ③），此处保持
    const result = await this.prisma.sysUser.updateMany({
      where: { id: userIdBig, isDeleted: 0 },
      data: { status: Number(status) },
    });
    return result.count > 0;
  }

  async resetUserPassword(userId: string, password: string): Promise<boolean> {
    if (!password?.trim()) {
      throw new BusinessException("密码不能为空");
    }

    const userIdBig = toBigInt(userId);
    if (userIdBig === null) return false;

    const hashed = await bcrypt.hash(password, 10);
    // 同记录项 ③：不刷新 updateTime
    const result = await this.prisma.sysUser.updateMany({
      where: { id: userIdBig, isDeleted: 0 },
      data: { password: hashed },
    });

    const ok = result.count > 0;
    if (ok) {
      await this.invalidateUserSessions(userId.toString());
    }
    return ok;
  }

  async changeCurrentUserPassword(userId: string, data: PasswordChangeDto): Promise<boolean> {
    const userIdBig = toBigInt(userId);
    const user =
      userIdBig === null
        ? null
        : await this.prisma.sysUser.findFirst({
            where: { id: userIdBig, isDeleted: 0 },
            select: { id: true, password: true },
          });

    if (!user) {
      throw new BusinessException("用户不存在");
    }

    const { oldPassword, newPassword, confirmPassword } = data;
    if (!(await bcrypt.compare(oldPassword, user.password))) {
      throw new BusinessException("原密码错误");
    }

    if (await bcrypt.compare(newPassword, user.password)) {
      throw new BusinessException("新密码不能与原密码相同");
    }

    if (newPassword !== confirmPassword) {
      throw new BusinessException("新密码和确认密码不一致");
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    // 注意：原实现用的是 `update(user.id, …)`，**不带 isDeleted 过滤**（这里保持）
    const result = await this.prisma.sysUser.updateMany({
      where: { id: user.id },
      data: { password: hashed },
    });
    const ok = result.count > 0;
    if (ok) {
      await this.invalidateUserSessions(user.id.toString());
    }
    return ok;
  }

  async sendMobileCode(mobile: string): Promise<boolean> {
    if (!mobile?.trim()) {
      throw new BusinessException("手机号不能为空");
    }
    const code = "1234";
    const redisKey = `captcha:mobile:${mobile.trim()}`;
    await this.redisCacheService.set(redisKey, code, 60 * 5);
    return true;
  }

  async bindOrChangeMobile(userId: string, data: MobileUpdateDto): Promise<boolean> {
    const mobile = data.mobile?.trim();
    const code = data.code?.trim();
    const password = data.password;

    const userIdBig = toBigInt(userId);
    const user =
      userIdBig === null
        ? null
        : await this.prisma.sysUser.findFirst({
            where: { id: userIdBig, isDeleted: 0 },
            select: { id: true, password: true, mobile: true },
          });
    if (!user) {
      throw new BusinessException("用户不存在");
    }
    if (!(await bcrypt.compare(password, user.password))) {
      throw new BusinessException("当前密码错误");
    }

    // 查补 insensitive 的必要性见类注释「本次修复 ②」
    const exist = await this.prisma.sysUser.findFirst({
      where: { mobile: mobile, isDeleted: 0, id: { not: userIdBig } },
      select: { id: true },
    });
    if (exist) {
      throw new BusinessException("手机号已被其他账号绑定");
    }

    const redisKey = `captcha:mobile:${mobile}`;
    const cached = await this.redisCacheService.get<string>(redisKey);

    if (!cached) {
      throw new BusinessException("验证码已过期");
    }
    if (cached !== code) {
      throw new BusinessException("验证码错误");
    }

    await this.redisCacheService.del(redisKey);
    // 同记录项 ③：不刷新 updateTime
    const result = await this.prisma.sysUser.updateMany({
      where: { id: userIdBig, isDeleted: 0 },
      data: { mobile },
    });
    return result.count > 0;
  }

  async sendEmailCode(email: string): Promise<void> {
    if (!email?.trim()) {
      throw new BusinessException("邮箱不能为空");
    }
    const code = "1234";
    const redisKey = `captcha:email:${email.trim()}`;
    await this.redisCacheService.set(redisKey, code, 60 * 5);
  }

  async bindOrChangeEmail(userId: string, data: EmailUpdateDto): Promise<boolean> {
    const email = data.email?.trim();
    const code = data.code?.trim();
    const password = data.password;

    const userIdBig = toBigInt(userId);
    const user =
      userIdBig === null
        ? null
        : await this.prisma.sysUser.findFirst({
            where: { id: userIdBig, isDeleted: 0 },
            select: { id: true, password: true, email: true },
          });
    if (!user) {
      throw new BusinessException("用户不存在");
    }
    if (!(await bcrypt.compare(password, user.password))) {
      throw new BusinessException("当前密码错误");
    }

    // 邮箱比较同样要 `insensitive`（旧库不区分大小写），否则 `A@x.com` 与 `a@x.com` 会各绑一个账号
    const exist = await this.prisma.sysUser.findFirst({
      where: {
        email: { equals: email, mode: "insensitive" },
        isDeleted: 0,
        id: { not: userIdBig },
      },
      select: { id: true },
    });
    if (exist) {
      throw new BusinessException("邮箱已被其他账号绑定");
    }

    const redisKey = `captcha:email:${email}`;
    const cached = await this.redisCacheService.get<string>(redisKey);

    if (!cached) {
      throw new BusinessException("验证码已过期");
    }
    if (cached !== code) {
      throw new BusinessException("验证码错误");
    }

    await this.redisCacheService.del(redisKey);
    // 同记录项 ③：不刷新 updateTime
    const result = await this.prisma.sysUser.updateMany({
      where: { id: userIdBig, isDeleted: 0 },
      data: { email },
    });
    return result.count > 0;
  }

  async unbindMobile(userId: string, password: string): Promise<boolean> {
    const userIdBig = toBigInt(userId);
    const user =
      userIdBig === null
        ? null
        : await this.prisma.sysUser.findFirst({
            where: { id: userIdBig, isDeleted: 0 },
            select: { id: true, password: true, mobile: true },
          });
    if (!user) {
      throw new BusinessException("用户不存在");
    }
    if (!user.mobile?.trim()) {
      throw new BusinessException("当前账号未绑定手机号");
    }
    if (!(await bcrypt.compare(password, user.password))) {
      throw new BusinessException("当前密码错误");
    }

    // ⚠️ 这里原实现走的是 `save()`（不是 `update()`）⇒ 会触发 AuditSubscriber，
    //    因此 `updateTime` / `updateBy` 是**会被刷新**的，必须显式补 `auditOnUpdate()`。
    await this.prisma.sysUser.update({
      where: { id: user.id },
      data: { mobile: null, ...auditOnUpdate() },
    });

    const persisted = await this.prisma.sysUser.findFirst({
      where: { id: userIdBig, isDeleted: 0 },
      select: { mobile: true },
    });
    return !persisted?.mobile;
  }

  async unbindEmail(userId: string, password: string): Promise<boolean> {
    const userIdBig = toBigInt(userId);
    const user =
      userIdBig === null
        ? null
        : await this.prisma.sysUser.findFirst({
            where: { id: userIdBig, isDeleted: 0 },
            select: { id: true, password: true, email: true },
          });
    if (!user) {
      throw new BusinessException("用户不存在");
    }
    if (!user.email?.trim()) {
      throw new BusinessException("当前账号未绑定邮箱");
    }
    if (!(await bcrypt.compare(password, user.password))) {
      throw new BusinessException("当前密码错误");
    }

    // 同 `unbindMobile`：走 save() ⇒ 审计字段会刷新
    await this.prisma.sysUser.update({
      where: { id: user.id },
      data: { email: null, ...auditOnUpdate() },
    });

    const persisted = await this.prisma.sysUser.findFirst({
      where: { id: userIdBig, isDeleted: 0 },
      select: { email: true },
    });
    return !persisted?.email;
  }

  async listUserOptions() {
    const users = await this.prisma.sysUser.findMany({
      where: { status: 1, isDeleted: 0 },
      select: { id: true, nickname: true, username: true },
      orderBy: { id: "asc" },
    });

    return users.map((u) => ({
      label: u.nickname?.trim() || u.username,
      value: u.id.toString(),
    }));
  }

  async importUsersFromBuffer(buffer: Buffer) {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames?.[0];
    const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
    if (!sheet) {
      throw new BusinessException("导入文件为空");
    }

    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
    const excelResult = {
      code: ErrorCode.SUCCESS.code,
      validCount: 0,
      invalidCount: 0,
      messageList: [] as string[],
    };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      const line = i + 2;

      const username = String(row["用户名"] ?? "").trim();
      const nickname = String(row["昵称"] ?? "").trim();
      const genderLabel = String(row["性别"] ?? "").trim();
      const mobile = String(row["手机号码"] ?? "").trim();
      const email = String(row["邮箱"] ?? "").trim();
      const roleCodesRaw = String(row["角色"] ?? "").trim();
      const deptCode = String(row["部门"] ?? "").trim();

      if (!username || !nickname) {
        excelResult.invalidCount++;
        excelResult.messageList.push(`第${line}行：用户名或昵称不能为空`);
        continue;
      }

      const exist = await this.prisma.sysUser.findFirst({
        where: { username: { equals: username, mode: "insensitive" }, isDeleted: 0 },
        select: { id: true },
      });
      if (exist) {
        excelResult.invalidCount++;
        excelResult.messageList.push(`第${line}行：用户名已存在`);
        continue;
      }

      const roleCodes = roleCodesRaw
        ? roleCodesRaw
            .split(/[,，]/)
            .map((c) => c.trim())
            .filter(Boolean)
        : [];

      const roleIds = await this.roleService.findRoleIdsByCodesOrNames(roleCodes);
      if (!roleIds.length) {
        excelResult.invalidCount++;
        excelResult.messageList.push(`第${line}行：角色不存在或为空`);
        continue;
      }

      let deptId: string | undefined;
      if (deptCode) {
        const dept = await this.deptService.findByCodeOrName(deptCode);
        if (!dept) {
          excelResult.invalidCount++;
          excelResult.messageList.push(`第${line}行：部门不存在`);
          continue;
        }
        deptId = dept.id;
      }

      const gender = (() => {
        if (!genderLabel) return 0;
        if (genderLabel === "男" || genderLabel === "1") return 1;
        if (genderLabel === "女" || genderLabel === "2") return 2;
        return 0;
      })();

      const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 10);
      const saved = await this.prisma.sysUser.create({
        data: {
          username,
          nickname,
          gender,
          mobile: mobile || null,
          email: email || null,
          deptId: this.parseOptionalId(deptId, "部门ID"),
          status: 1,
          password: hashedPassword,
          isDeleted: 0,
          // 原实现显式给 `createTime`，再靠 AuditSubscriber 补 `updateTime` / 操作人；
          // 这里统一由 `auditOnCreate()` 承接（两者取值同为「当前时刻」）
          ...auditOnCreate(),
        },
      });

      await this.prisma.sysUserRole.createMany({
        data: roleIds.map((rid) => ({ userId: saved.id, roleId: BigInt(rid) })),
        skipDuplicates: true,
      });
      excelResult.validCount++;
    }

    return excelResult;
  }

  /**
   * 失效指定用户的所有会话
   * - JWT 模式：递增用户 Token 版本号 auth:user:token_version:{userId}
   * - redis-token 模式：删除该用户的 access/refresh 映射
   */
  private async invalidateUserSessions(userId: string): Promise<void> {
    const userIdStr = userId?.toString();
    if (!userIdStr) return;

    const sessionType = this.configService.get<string>("SESSION_TYPE") || "jwt";

    // JWT 模式：递增 Token 版本号，旧 JWT 全部失效
    // ⚠️ 全部走全局键（不做租户前缀）：写入端在已认证请求里（ALS 有租户上下文），
    // 校验端 JwtStrategy.validate 在 ALS 装配前读取 —— 写带前缀/读不带会让吊销静默失效。
    // 版本键 TTL 取 refresh 生命周期，避免默认 1h 过期后版本号回落、旧令牌「复活」。
    const versionKey = `auth:user:token_version:${userIdStr}`;
    const currentVersion = await this.redisCacheService.getGlobal<number>(versionKey);
    const nextVersion = (currentVersion ?? 0) + 1;
    await this.redisCacheService.setGlobal(versionKey, nextVersion);
    await this.redisCacheService.expireGlobal(versionKey, this.redisVersionTtl());

    await this.redisCacheService.delGlobal(`auth:user:jwt_session:${userIdStr}`);

    // redis-token 模式：清理 access/refresh 映射
    if (sessionType === "redis-token") {
      const accessKey = `auth:user:access:${userIdStr}`;
      const refreshKey = `auth:user:refresh:${userIdStr}`;

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

  /** Token 版本键存活窗口 = refresh 令牌生命周期（与 auth.service 吊销口径一致） */
  private redisVersionTtl(): number {
    const expiresIn = Number(this.configService.get<number>("jwt.expiresIn")) || 7200;
    return expiresIn * 10;
  }

  /**
   * 更新用户
   */
  async update(
    userId: string,
    updateUserDto: UpdateUserDto,
    currentUserId?: string
  ): Promise<UserView | null> {
    const userIdStr = userId.toString();
    const { username, deptId, roleIds, password } = updateUserDto;

    if (!roleIds?.length) {
      throw new BusinessException("角色不能为空");
    }

    const userIdBig = toBigInt(userIdStr);
    if (userIdBig === null) {
      throw new BusinessException("用户不存在");
    }

    // 检查用户名是否已存在（排除当前用户）
    if (username) {
      const existingUser = await this.prisma.sysUser.findFirst({
        where: { username: { equals: username, mode: "insensitive" }, isDeleted: 0 },
        select: { id: true },
      });
      if (existingUser && existingUser.id !== userIdBig) {
        throw new BusinessException("用户名已存在");
      }
    }

    // 更新用户信息
    const user = await this.prisma.sysUser.findFirst({ where: { id: userIdBig } });
    if (!user) {
      throw new BusinessException("用户不存在");
    }

    const roleIdBigs = this.parseRoleIdList(roleIds);

    // 如果提供了新密码，则加密新密码
    let hashedPassword: string | undefined;
    if (password) {
      hashedPassword = await bcrypt.hash(password, 10);
    }

    // 🔴 显式逐列挑选，**不要** `{...updateUserDto}`：
    //  - `UpdateUserDto` 里的 `roleIds` / `roles` 在 `sys_user` 中没有对应列；
    //  - 原实现靠 TypeORM 的「只更新变化列」把它过滤掉，Prisma 侧必须自己挑。
    const auditUpdate = auditOnUpdate(this.parseOptionalId(updateUserDto.updateBy, "修改人ID"));
    const data: Prisma.SysUserUncheckedUpdateInput = {
      // ⚠️ `deptId` 无条件写入（记录项 ①）：未传 ⇒ NULL，即「清空部门」。保持原行为。
      deptId: this.parseOptionalId(deptId, "部门ID"),
      // ⚠️ 未传 ⇒ 写 NULL（原实现 `?? null` 后再被订阅器覆盖；无上下文时确实是 NULL）
      updateBy: auditUpdate.updateBy ?? null,
      updateTime: auditUpdate.updateTime,
    };
    if (username !== undefined) data.username = username;
    if (updateUserDto.nickname !== undefined) data.nickname = updateUserDto.nickname;
    if (updateUserDto.gender !== undefined) data.gender = updateUserDto.gender;
    if (updateUserDto.avatar !== undefined) data.avatar = updateUserDto.avatar;
    if (updateUserDto.mobile !== undefined) data.mobile = updateUserDto.mobile;
    if (updateUserDto.status !== undefined) data.status = updateUserDto.status;
    if (updateUserDto.email !== undefined) data.email = updateUserDto.email;
    if (hashedPassword !== undefined) data.password = hashedPassword;
    // 记录项 ②：原实现会把这三者也铺进去，保持原样（前端表单不发送）
    if (updateUserDto.createBy !== undefined) {
      data.createBy = this.parseOptionalId(updateUserDto.createBy, "创建人ID");
    }
    if (updateUserDto.createTime !== undefined) data.createTime = updateUserDto.createTime;
    if (updateUserDto.isDeleted !== undefined) data.isDeleted = updateUserDto.isDeleted;

    const currentRoleIds = await this.findRoleIdsOfUser(userIdBig);
    const nextRoleIds = roleIdBigs.map((id) => id.toString());

    const rolesChanged =
      currentRoleIds.length !== nextRoleIds.length ||
      currentRoleIds.some((r) => !nextRoleIds.includes(r)) ||
      nextRoleIds.some((r) => !currentRoleIds.includes(r));

    // 🔴 自我保护（与「系统管理员禁止删除」配套）：
    // 不允许通过「编辑自己」把自己降级或停用 —— 否则一旦最后一个系统管理员
    // 摘掉自己的 ROOT 角色（或把自己置为禁用），全平台将再无人能进入系统管理。
    // 删除侧已单独兜底，这里补齐「改角色」与「停用」两条路径。
    if (currentUserId !== undefined && currentUserId !== null) {
      const selfIdBig = toBigInt(currentUserId);
      if (selfIdBig !== null && selfIdBig === userIdBig) {
        if (rolesChanged) {
          throw new BusinessException("不能修改自己的角色");
        }
        if (updateUserDto.status !== undefined && Number(updateUserDto.status) === 0) {
          throw new BusinessException("不能停用自己");
        }
      }
    }

    if (rolesChanged) {
      await this.prisma.sysUserRole.deleteMany({ where: { userId: userIdBig } });
      await this.prisma.sysUserRole.createMany({
        data: roleIdBigs.map((roleId) => ({ userId: userIdBig, roleId })),
        skipDuplicates: true,
      });
      await this.invalidateUserSessions(userIdStr);
    }

    // 与原实现一致：先处理角色，再落用户本体
    await this.prisma.sysUser.update({ where: { id: userIdBig }, data });

    const updated = await this.prisma.sysUser.findFirst({ where: { id: userIdBig } });
    return updated ? toUserView(updated) : null;
  }

  /**
   * 获取用户菜单ID列表
   */
  async getUserMenuIds(userId: string): Promise<string[]> {
    const userIdBig = toBigInt(userId);
    if (userIdBig === null) return [];

    const roleIds = await this.findRoleIdsOfUser(userIdBig);
    if (!roleIds.length) return [];

    return await this.roleService.getMenuIdsByRoleIds(roleIds);
  }

  /**
   * 删除用户
   */
  async deleteUser(id: string): Promise<boolean> {
    const idStr = id?.toString();
    if (!idStr) {
      throw new BusinessException("用户ID不能为空");
    }

    // 非法 ID 视为「不存在」：原实现把字符串直接丢进 SQL，旧 MySQL 宽松转换成 0 ⇒ 查不到 ⇒ 返回 true
    const userIdBig = toBigInt(idStr);
    if (userIdBig === null) {
      return true;
    }

    const user = await this.prisma.sysUser.findFirst({
      where: { id: userIdBig, isDeleted: 0 },
      select: { id: true },
    });
    if (!user) {
      return true;
    }

    // 系统管理员禁止删除
    const roleIds = await this.findRoleIdsOfUser(userIdBig);
    if (roleIds.length > 0) {
      const roles = await this.roleService.findRolesByIds(roleIds);
      if (roles.some((r) => r.code === ROOT_ROLE_CODE)) {
        throw new BusinessException("系统管理员禁止删除");
      }
    }

    // 开启事务处理
    const ok = await this.prisma.$transaction(async (tx) => {
      await tx.sysUserRole.deleteMany({ where: { userId: userIdBig } });

      const result = await tx.sysUser.updateMany({
        where: { id: userIdBig, isDeleted: 0 },
        data: { isDeleted: 1, updateTime: new Date() },
      });

      return result.count > 0;
    });

    // 会话失效只动 Redis，不参与事务；放在事务外可以让「已提交」与「已失效」的因果关系更清晰
    if (ok) {
      await this.invalidateUserSessions(idStr);
    }

    return ok;
  }

  /**
   * 获取用户表单数据
   */
  async getUserFormData(id: string): Promise<UserFormDto> {
    const idStr = id?.toString();
    if (!idStr) {
      throw new BusinessException("用户ID不能为空");
    }

    const userIdBig = toBigInt(idStr);
    const user =
      userIdBig === null
        ? null
        : await this.prisma.scoped.sysUser.findFirst({
            where: { id: userIdBig, isDeleted: 0 },
          });
    if (!user) {
      throw new NotFoundException("用户不存在");
    }

    const roleIdBigs = await this.findRoleIdsOfUser(userIdBig);

    return {
      id: user.id.toString(),
      username: user.username,
      nickname: user.nickname,
      mobile: user.mobile,
      gender: user.gender,
      avatar: user.avatar,
      email: user.email || "",
      status: user.status,
      deptId: user.deptId?.toString() ?? "",
      roleIds: roleIdBigs,
    };
  }

  // ─────────────────────────────────────────────
  // 私有工具
  // ─────────────────────────────────────────────

  /**
   * 严格解析布尔标志。
   *
   * 只认 `true` / `"true"` / `1` / `"1"` —— **绝不能写成 `Boolean(value)`**：
   * HTTP query 里的 `"false"` / `"0"` 都是非空字符串，`Boolean()` 会判为真。
   * 全局 ValidationPipe 的 `enableImplicitConversion` 正是踩了这个坑（见 `UserQueryDto.includeRoot` 注释）。
   */
  private static isFlagOn(value: boolean | string | number | undefined | null): boolean {
    return value === true || value === "true" || value === 1 || value === "1";
  }

  /**
   * 组装列表 / 导出的查询条件（分页与导出共用，避免两处口径漂移）。
   */
  private async buildUserWhere(
    deptId?: string,
    keywords?: string,
    status?: number,
    createTime?: string[],
    includeRoot: boolean | string | number = false
  ): Promise<Prisma.SysUserWhereInput> {
    // 统一使用逻辑删除标识过滤
    const where: Prisma.SysUserWhereInput = { isDeleted: 0 };

    // root 用户（ROOT 角色）默认不在用户列表中展示。
    // 仅当调用方显式要求（`includeRoot`）时才放开 —— 放开后前端会额外给这类行
    // 加「系统级」标识并屏蔽删除入口，见 `decorateUsers()` 的 `isRoot`。
    if (!UserService.isFlagOn(includeRoot)) {
      const rootUserIds = await this.findRootRoleUserIds();
      if (rootUserIds.length) {
        where.id = { notIn: rootUserIds };
      }
    }

    if (keywords) {
      // 旧库排序规则不区分大小写，PG 的 LIKE 区分 ⇒ 显式 insensitive
      where.OR = [
        { username: { contains: keywords, mode: "insensitive" } },
        { nickname: { contains: keywords, mode: "insensitive" } },
        { mobile: { contains: keywords, mode: "insensitive" } },
      ];
    }

    const deptFilter = this.parseDeptFilter(deptId);
    if (deptFilter !== null) {
      where.deptId = deptFilter;
    }

    if (status !== undefined && status !== null) {
      where.status = Number(status);
    }

    // 日期筛选：createTime 数组 [startTime, endTime]，按应用时区的自然日闭区间
    if (createTime && createTime.length >= 1 && createTime[0]) {
      const from = startOfDay(createTime[0]);
      if (from) where.createTime = { ...(where.createTime as object), gte: from };
    }
    if (createTime && createTime.length >= 2 && createTime[1]) {
      const to = endOfDay(createTime[1]);
      if (to) where.createTime = { ...(where.createTime as object), lte: to };
    }

    return where;
  }

  /**
   * 回填部门名与角色名，并统一成对外形状。
   *
   * 原实现是两条「单独回填」的查询：角色名走 `sys_user_role JOIN sys_role`（**带** `is_deleted = 0`），
   * 部门名走 `deptService.findByIds()`。此处保持同样的两段式，只是把 JOIN 拆成两次 Prisma 查询。
   */
  private async decorateUsers(list: SysUserModel[]): Promise<UserRow[]> {
    const userIds = list.map((u) => u.id);
    const roleNamesMap = await this.loadRoleNames(userIds);

    // 「系统管理员」标记：按 ROOT 角色的成员集合判定（不以角色名文本匹配）
    const rootUserIdSet = new Set((await this.findRootRoleUserIds()).map((id) => id.toString()));

    // 部门名回填走 `DeptService.findByIds()` —— 它用**基础客户端**，天然不受数据权限影响，
    // 等价于原实现里那对 `RequestContext.setDataPermissionConfig(null)` 的开关（故此处不再需要）。
    const deptIds = [
      ...new Set(list.filter((u) => u.deptId !== null).map((u) => u.deptId!.toString())),
    ];
    const depts = await this.deptService.findByIds(deptIds);
    const deptMap = new Map<string, string>();
    depts.forEach((d) => deptMap.set(d.id, d.name));

    return list.map((u) => {
      const deptIdStr = u.deptId?.toString() ?? null;
      const roleNames = roleNamesMap.get(u.id.toString()) ?? "";
      return {
        id: u.id.toString(),
        username: u.username,
        nickname: u.nickname,
        gender: u.gender,
        mobile: u.mobile,
        status: u.status,
        email: u.email || "",
        deptId: deptIdStr,
        deptName: deptIdStr ? deptMap.get(deptIdStr) || null : null,
        roleNames,
        // 展示层同样按应用时区格式化（原实现手写 getFullYear()/getHours()，依赖进程时区）
        createTime: formatDateTimeInZone(u.createTime),
        isRoot: rootUserIdSet.has(u.id.toString()),
      };
    });
  }

  /**
   * 批量取「用户 → 角色名（逗号分隔）」映射。
   *
   * 语义对齐原 SQL：`sys_user_role JOIN sys_role ON … WHERE r.is_deleted = 0`。
   * ⚠️ 原 SQL **没有 ORDER BY**，多角色时拼接顺序在 MySQL 上取决于执行计划；
   * 这里显式按 `roleId ASC` 排列，让结果**确定**（前端只做展示，顺序不影响功能）。
   */
  private async loadRoleNames(userIds: bigint[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (!userIds.length) return map;

    const userRoles = await this.prisma.sysUserRole.findMany({
      where: { userId: { in: userIds } },
      orderBy: { roleId: "asc" },
      select: { userId: true, roleId: true },
    });
    if (!userRoles.length) return map;

    const roleIds = [...new Set(userRoles.map((ur) => ur.roleId))];
    const roles = await this.prisma.sysRole.findMany({
      where: { id: { in: roleIds }, isDeleted: 0 },
      select: { id: true, name: true },
    });
    const nameById = new Map(roles.map((r) => [r.id.toString(), r.name]));

    for (const ur of userRoles) {
      const name = nameById.get(ur.roleId.toString());
      if (!name) continue;
      const uid = ur.userId.toString();
      const prev = map.get(uid);
      map.set(uid, prev ? `${prev},${name}` : name);
    }
    return map;
  }

  /**
   * 收集「拥有 ROOT 角色的用户 ID」。
   *
   * 🔴 语义对齐原 SQL 的 `NOT EXISTS (… INNER JOIN sys_role r … WHERE r.code = :rootCode)`：
   * **刻意不过滤 `r.is_deleted`** —— 原 SQL 里没有这个条件（角色被逻辑删除后，
   * 其成员依然在用户列表中隐藏）。这与上面 `loadRoleNames()` 里**有** `isDeleted: 0` 的口径不同，
   * 属原实现的既有不一致，本次按原样保留并固化为断言。
   */
  private async findRootRoleUserIds(): Promise<bigint[]> {
    const rootRoles = await this.prisma.sysRole.findMany({
      where: { code: ROOT_ROLE_CODE },
      select: { id: true },
    });
    if (!rootRoles.length) return [];

    const rows = await this.prisma.sysUserRole.findMany({
      where: { roleId: { in: rootRoles.map((r) => r.id) } },
      select: { userId: true },
    });
    return [...new Set(rows.map((r) => r.userId))];
  }

  /** 取某个用户的角色 ID（字符串形态，便于与 DTO / 前端比对） */
  private async findRoleIdsOfUser(userId: bigint): Promise<string[]> {
    const userRoles = await this.prisma.sysUserRole.findMany({
      where: { userId },
      orderBy: { roleId: "asc" },
      select: { roleId: true },
    });
    return userRoles.map((ur) => ur.roleId.toString());
  }

  /**
   * 解析「可空 ID」：空值返回 null。
   *
   * ⚠️ 与非空但**格式非法**的情况严格区分 —— `toBigInt("abc")` 与 `toBigInt(undefined)`
   * 都返回 `null`，若直接拿结果判分支，`PUT /users/abc` 带完整 body 时会静默走错分支
   * （`role.saveRole` 实测踩过，见清单约定 13）。这里对「有实义但解析失败」显式抛业务异常，
   * 比原实现「把字符串塞进 bigint 列由 MySQL 报错（或宽松转 0 静默写错）」更早失败、更好排查。
   */
  private parseOptionalId(value: string | number | bigint | null | undefined, label: string) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = toBigInt(value);
    if (parsed === null) {
      throw new BusinessException(`${label}格式不正确`);
    }
    return parsed;
  }

  /**
   * 列表筛选用：空串 / `undefined` / `"0"` 一律视为「不筛选」（对齐原实现的判断），
   * 但**非空且非法**的值不再静默放行，而是抛业务异常。
   */
  private parseDeptFilter(value?: string | null): bigint | null {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    if (text === "" || text === "0") return null;
    return this.parseOptionalId(text, "部门ID");
  }

  /**
   * 解析角色 ID 列表：去重 + 校验，返回 BigInt 数组。
   *
   * 原实现把字符串数组直接交给 TypeORM，非法值要等 DB 报错（且 `create` 时用户已经插进去了，
   * 留下无角色的半成品）。这里提前抛业务异常。
   */
  private parseRoleIdList(roleIds?: string[]): bigint[] {
    if (!roleIds?.length) return [];
    const parsed: bigint[] = [];
    for (const raw of new Set(roleIds.map((r) => String(r)))) {
      const id = toBigInt(raw);
      if (id === null) {
        throw new BusinessException(`角色ID格式不正确：${raw}`);
      }
      parsed.push(id);
    }
    return parsed;
  }
}
