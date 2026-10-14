import { forwardRef, Inject, Injectable } from "@nestjs/common";
import { Prisma, SysMenu as SysMenuModel } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { toBigInt, toBigIntArray } from "../../common/prisma/prisma-ids";
import { BusinessException } from "../../common/exceptions/business.exception";
import { CreateMenuDto } from "./dto/create-menu.dto";
import { UpdateMenuDto } from "./dto/update-menu.dto";
import { UserService } from "../user/user.service";
import { RolePermService } from "../role/role-permission.service";
import { Route } from "./interfaces/menu.interface";

/**
 * 菜单对外视图。
 *
 * 主键与父节点 ID 一律转成**字符串**：原 TypeORM 配置 `bigNumberStrings: true`，
 * 主键本就以字符串出入，前端（`MenuItem.id` / `parentId` / `OptionItem.value`）全程按 string 处理。
 * 且本模块的两个方法仍被未迁移的模块消费：
 *  · `getRoutes()` ← `MenuController`（只做转发）
 *  · `MenuService` 自身被 `AuthModule`/`UserModule` 间接依赖的 `MenuModule` 导出
 * ⇒ 字符串主键契约不能变。
 *
 * `type` 字段在 schema 里的列名是 `type`（Prisma 属性名为 `menuType`，靠 `@map` 映射），
 * 对外仍叫 `type` —— 前端 `MenuItem.type`、`buildRoutes` 的过滤条件都按这个名字。
 */
export interface MenuView {
  id: string;
  parentId: string;
  treePath: string | null;
  name: string;
  type: string;
  routeName: string | null;
  routePath: string | null;
  component: string | null;
  perm: string | null;
  alwaysShow: number | null;
  keepAlive: number | null;
  visible: number;
  sort: number;
  icon: string | null;
  redirect: string | null;
  params: unknown;
  createTime: Date | null;
  updateTime: Date | null;
}

function toMenuView(menu: SysMenuModel): MenuView {
  return {
    id: menu.id.toString(),
    parentId: menu.parentId.toString(),
    treePath: menu.treePath,
    name: menu.name,
    type: menu.menuType,
    routeName: menu.routeName,
    routePath: menu.routePath,
    component: menu.component,
    perm: menu.perm,
    alwaysShow: menu.alwaysShow,
    keepAlive: menu.keepAlive,
    visible: menu.visible,
    sort: menu.sort,
    icon: menu.icon,
    redirect: menu.redirect,
    params: menu.params,
    createTime: menu.createTime,
    updateTime: menu.updateTime,
  };
}

/** 顶层判定：空、`"0"` 都算根（与 `buildMenuTree` / `buildOptionsTree` 的原逻辑一致） */
function isRootMenu(view: { parentId: string }): boolean {
  return !view.parentId || view.parentId === "0";
}

/**
 * 菜单服务（Prisma 版）
 *
 * 数据访问客户端：菜单是**权限元数据**，原 `DataPermissionPlugin` 也从不作用于 `sys_menu`
 * （该插件只覆盖带 `is_deleted` + 数据范围的业务表），因此全程走**基础客户端**
 * （`this.prisma.sysMenu`），不用 `this.prisma.scoped`。与 `role` 模块口径一致。
 *
 * `sys_menu` 的两点结构特性（决定了本模块的写法）：
 *  · **没有 `is_deleted`** —— 「菜单属于系统元数据，不需要审计字段和逻辑删除」，
 *    所以本模块的查询一律**不带逻辑删除过滤**，删除是**物理删除**；
 *  · **没有 `create_by` / `update_by`** —— 只有 `create_time` / `update_time`，
 *    因此不能套 `auditOnCreate()` / `auditOnUpdate()`（它们会写 `createBy`/`updateBy`，
 *    对 `SysMenu` 而言那两个键不是列 ⇒ 编译期就会报错），改为显式写时间列。
 *
 * 🔴 本次移植**修掉的两处写路径缺陷**（均已在 `scripts/verify-menu-module.ts` 固化为回归断言）：
 *
 *  1. **请求体不带 `parentId` 会把子菜单整体「上提」到根节点**。
 *     原实现无条件执行 `const newParentId = parentId || "0"`，再在
 *     `newParentId !== menu.parentId` 时重算自己的 `treePath` **并级联改写全部子孙的 `treePath`**。
 *     而 `MenuController.update()`（`PATCH /menus/:id?visible=0` 那个「显示/隐藏」开关）
 *     只传 `{ visible }` ⇒ 点一次隐藏，该菜单连同其子树会被搬到根节点，`treePath` 全被冲掉。
 *     现改为：**只有请求显式给出 `parentId` 时才动 `parentId` / `treePath`**。
 *     前端表单（`normalizeMenuPayload()` 展开 `formData`，其 `parentId` 恒有值）
 *     始终携带 `parentId`，故接口契约不变。
 *
 *  2. **请求体带上表里不存在的字段会让 `PUT /menus/:id` 直接 500**。
 *     `CreateMenuDto` 里有 5 个字段在 `sys_menu` 中**没有对应列**：
 *     `permissionType` / `authSymbol` / `orderWeight` / `remark` / `createTab`（模板遗留）。
 *     原实现把整个 DTO 丢给 `repository.update()`，而 TypeORM 的
 *     `UpdateQueryBuilder#createUpdateExpression()` 会对**每一个**传入键调用
 *     `metadata.findColumnsWithPropertyPath()`，查不到就
 *     `throw new EntityPropertyNotFoundError`（`QueryBuilder#createPropertyPath()` 只按
 *     `Object.keys()` 收集路径，不做白名单过滤；`findColumnsWithPropertyPath` 未命中时返回 `[]`，
 *     由调用方抛错）⇒ 只要请求体带上这 5 个之一就是 HTTP 500。
 *     本次移植改为**显式逐列挑选**，未知字段一律忽略 —— 这也让 update 的行为对齐到 create
 *     （`save()` 走 INSERT 时本就只按元数据取列，未知字段被静默忽略）。
 *
 * 【已知缺陷·保持原行为】不做修正、仅登记：
 *  · 删除菜单只删 `sys_menu`，**不清理 `sys_role_menu` 的孤儿关联行**。
 *    原库（`sql/mysql/niulai_admin.sql`）**零外键**（已核对：`grep -c "FOREIGN KEY"` = 0），
 *    所以这本来就是既有行为，不是移植引入的。
 *  · `params` 在「表单 → 库 → 表单」之间**不能往返**：前端提交的是
 *    `[{ key, value }]` 数组，而 `getMenuForm()` 按**普通对象**用 `Object.entries()` 解码
 *    ⇒ 数组会被解成 `[{ key: "0", value: "[object Object]" }]`。
 *    由于 `params` 会被 `buildRoutes()` 原样塞进 `route.meta.params` 交给前端路由消费，
 *    擅自改存储形状会影响路由行为，故本次**不动**，留作独立任务。
 *  · `sort` 相同的同级菜单，返回顺序由引擎决定（原 `ORDER BY sort ASC` 单键排序，
 *    两库都不保证 tie 的次序）。
 *  · `treePath` 的「是否含自身 ID」两处口径不同：`create()` 写「父路径,自身ID」（含自身），
 *    而 `update()` 只写 `generateMenuTreePath(新父)` 的返回值（**不含**自身），
 *    `updateChildrenTreePath()` 写「新父路径,父自身ID」（含父、不含子）。
 *    另外 `update()` 把菜单提为顶层时 `treePath` 落 `"0"`，而 `create()` 落**自身 ID**。
 *    影响有限 —— **祖先链始终完整**，`getMenus()` 的祖先补全不受影响；
 *    但「`treePath` 一定以自身 ID 结尾」这条不成文约定只对 `create()` 出来的子树成立。
 *  · `findButtons()` / `findPermsByMenuIds()` 的 SQL 是 `id IN (入参) AND type = 'B'`，
 *    入参必须是**按钮菜单自身的 ID**；传父菜单 ID 会静默返回空数组
 *    （方法名读起来像「查这些菜单下的按钮」，实际不是）。
 */
@Injectable()
export class MenuService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => UserService))
    private readonly userService: UserService,
    @Inject(forwardRef(() => RolePermService))
    private readonly rolePermService: RolePermService
  ) {}

  async findAll(): Promise<MenuView[]> {
    const menus = await this.prisma.sysMenu.findMany({
      orderBy: { sort: "asc" },
    });
    return menus.map(toMenuView);
  }

  async find(menuIds: (number | string)[]): Promise<MenuView[]> {
    const ids = toBigIntArray(menuIds);
    if (!ids.length) return [];

    const menus = await this.prisma.sysMenu.findMany({
      where: { id: { in: ids } },
      orderBy: { sort: "asc" },
    });
    return menus.map(toMenuView);
  }

  /**
   * 获取所有按钮权限标识
   */
  async findALLButtons(): Promise<string[]> {
    const buttons = await this.prisma.sysMenu.findMany({
      where: { menuType: "B", visible: 1 },
      select: { perm: true },
    });

    return Array.from(
      new Set(buttons.map((menu) => menu.perm?.trim()).filter((perm): perm is string => !!perm))
    );
  }

  async findButtons(menuIds: string[]) {
    const ids = toBigIntArray(menuIds);
    if (!ids.length) return [];

    const permslist = await this.prisma.sysMenu.findMany({
      where: { id: { in: ids }, menuType: "B" },
      orderBy: { sort: "asc" },
    });
    return permslist.map((item) => item.perm).filter((perm): perm is string => !!perm);
  }

  /**
   * 根据菜单ID查询权限集合
   */
  async findPermsByMenuIds(menuIds: string[]): Promise<string[]> {
    if (!menuIds?.length) return [];

    const ids = toBigIntArray(menuIds);
    if (!ids.length) return [];

    const menus = await this.prisma.sysMenu.findMany({
      where: { id: { in: ids }, menuType: "B" },
      select: { perm: true },
    });

    return Array.from(
      new Set(menus.map((menu) => menu.perm?.trim()).filter((perm): perm is string => !!perm))
    );
  }

  /**
   * 获取用户菜单
   */
  async getRoutes(userId: string): Promise<Route[]> {
    // 超级管理员返回所有菜单
    if (userId === "1") {
      // 后端路由用于前端注册，不仅决定侧边栏显示；因此这里会包含 visible=0 的隐藏菜单
      const menuList = await this.prisma.sysMenu.findMany({
        where: { menuType: { in: ["C", "M"] } },
        orderBy: { sort: "asc" },
      });
      return this.buildRoutes(menuList.map(toMenuView));
    }

    // 其他用户返回其角色对应的菜单
    const menuIds = await this.userService.getUserMenuIds(userId);
    if (!menuIds || menuIds.length === 0) {
      return [];
    }

    const ids = toBigIntArray(menuIds);
    if (!ids.length) return [];

    // 保持路由完整，防止路由未注册问题
    const menuList = await this.prisma.sysMenu.findMany({
      where: { id: { in: ids }, menuType: { in: ["C", "M"] } },
      orderBy: { sort: "asc" },
    });
    return this.buildRoutes(menuList.map(toMenuView));
  }

  /**
   * 获取菜单树形表格列表
   *
   * 语义：先按关键字捞出命中项，再把命中项的**祖先链**补进结果集，
   * 最后整片建树（`treePath` 是逗号分隔的「祖先…自身」路径，故补祖先只需拆它）。
   * 因此「只命中深层节点」时，父链会一起返回，树不会断 —— 这一点与 `dept` 模块
   * 的「孤儿丢弃」语义不同，属本模块特有行为，保持原样。
   */
  async getMenus(keyword: string) {
    let matchedMenus: SysMenuModel[];
    if (keyword) {
      // MySQL 默认排序规则不区分大小写，PG 的 LIKE 区分 ⇒ 显式 insensitive
      matchedMenus = await this.prisma.sysMenu.findMany({
        where: { name: { contains: keyword, mode: "insensitive" } },
        orderBy: { sort: "asc" },
      });
    } else {
      matchedMenus = await this.prisma.sysMenu.findMany({
        orderBy: { sort: "asc" },
      });
      return this.buildMenuTree(matchedMenus.map(toMenuView));
    }

    if (matchedMenus.length === 0) {
      return [];
    }

    const allMenuIds = new Set<string>();
    matchedMenus.forEach((menu) => {
      allMenuIds.add(menu.id.toString());
      if (menu.treePath) {
        const parentIds = menu.treePath.split(",").filter(Boolean);
        parentIds.forEach((id) => allMenuIds.add(id));
      }
    });

    const allIds = toBigIntArray(Array.from(allMenuIds));
    const allMenus = allIds.length
      ? await this.prisma.sysMenu.findMany({
          where: { id: { in: allIds } },
          orderBy: { sort: "asc" },
        })
      : [];

    return this.buildMenuTree(allMenus.map(toMenuView));
  }

  /**
   * 获取菜单下拉树形列表
   */
  async findOptions() {
    const menus = await this.prisma.sysMenu.findMany({
      select: { id: true, name: true, parentId: true },
      orderBy: { sort: "asc" },
    });
    return this.buildOptionsTree(
      menus.map((menu) => ({
        id: menu.id.toString(),
        name: menu.name,
        parentId: menu.parentId.toString(),
      }))
    );
  }

  /**
   * 创建菜单
   *
   * 保留原实现的**两段式落库**：先 INSERT（`tree_path` 只写到父路径），
   * 拿到自增主键后再 UPDATE 把自身 ID 追加进去。
   * 于是最终形态是：
   *  · 顶层：`tree_path = 自身ID`（**不含** `"0"`）
   *  · 子级：`tree_path = 父的tree_path + "," + 自身ID`
   * `getMenus()` 的祖先补全依赖这个约定（`treePath.split(",")` 里含自身也无妨）。
   */
  async create(createMenuDto: CreateMenuDto) {
    const { type, routePath } = createMenuDto;

    // 判断是否为外链菜单
    const isExternalLink =
      type === "M" &&
      !!routePath &&
      (routePath.startsWith("http://") || routePath.startsWith("https://"));

    // 目录类型处理
    let component = createMenuDto.component;
    // 一级目录需以 / 开头（原实现直接改写 DTO，这里用局部变量承接）
    let normalizedRoutePath = routePath;
    if (type === "C") {
      if (
        (!createMenuDto.parentId || createMenuDto.parentId === "0") &&
        routePath &&
        !routePath.startsWith("/")
      ) {
        normalizedRoutePath = "/" + routePath;
      }
      component = "Layout";
    } else if (isExternalLink) {
      // 外链菜单组件设为 null
      component = null;
    }

    const parentIdStr = createMenuDto.parentId || "0";
    // 缺省/`"0"` ⇒ 顶层。非空但解析不出数字时**提前失败**：
    // 原实现会把 `"abc"` 直接塞进 bigint 列，由 MySQL 报
    // `Incorrect integer value` 抛 500；这里换成语义明确的业务错误。
    const parentIdBig = toBigInt(parentIdStr);
    if (parentIdBig === null) {
      throw new BusinessException("父菜单ID格式不正确");
    }

    // 生成 treePath
    const treePath = await this.generateMenuTreePath(parentIdStr);
    const now = new Date();

    const data: Prisma.SysMenuUncheckedCreateInput = {
      name: createMenuDto.name,
      menuType: type,
      parentId: parentIdBig,
      treePath,
      component: component ?? null,
      // 原实现走 save()，由 AuditSubscriber 填 createTime / updateTime；
      // `sys_menu` 无 create_by / update_by 列，故只需补这两个时间列。
      createTime: now,
      updateTime: now,
    };
    // 只写显式传入的可选列：省略时套用列默认值（`sort` 0 / `visible` 1 / `alwaysShow` 0 / `keepAlive` 0），
    // 与原 INSERT 省略该列的行为一致。
    // ⚠️ `permissionType` / `authSymbol` / `orderWeight` / `remark` / `createTab` 不在列中 ⇒ 一律丢弃。
    if (normalizedRoutePath !== undefined) data.routePath = normalizedRoutePath;
    if (createMenuDto.routeName !== undefined) data.routeName = createMenuDto.routeName;
    if (createMenuDto.perm !== undefined) data.perm = createMenuDto.perm;
    if (createMenuDto.icon !== undefined) data.icon = createMenuDto.icon;
    if (createMenuDto.redirect !== undefined) data.redirect = createMenuDto.redirect;
    if (createMenuDto.sort !== undefined) data.sort = createMenuDto.sort;
    if (createMenuDto.alwaysShow !== undefined) data.alwaysShow = createMenuDto.alwaysShow;
    if (createMenuDto.keepAlive !== undefined) data.keepAlive = createMenuDto.keepAlive;
    if (createMenuDto.visible !== undefined) data.visible = createMenuDto.visible;
    if (createMenuDto.params !== undefined)
      data.params = createMenuDto.params as Prisma.InputJsonValue;

    const created = await this.prisma.sysMenu.create({ data });

    // 更新菜单 ID 到 treePath（对齐原实现第二次 save()；该次 save 触发订阅器刷新 updateTime）
    const finalTreePath =
      parentIdStr === "0" ? created.id.toString() : `${treePath},${created.id.toString()}`;
    await this.prisma.sysMenu.update({
      where: { id: created.id },
      data: { treePath: finalTreePath, updateTime: new Date() },
    });

    return true;
  }

  /**
   * 生成菜单树路径
   *
   * 返回**父节点自身**的 `tree_path`（不是「父 + 父ID」）：自身 ID 由调用方在拿到主键后追加。
   * 父节点不存在或 ID 非法时返回 `"0"`（即该菜单落成顶层），这是原实现的行为，保持原样。
   */
  private async generateMenuTreePath(parentId: string): Promise<string> {
    if (!parentId || parentId === "0") {
      return "0";
    }
    const pid = toBigInt(parentId);
    if (pid === null) {
      return "0";
    }
    const parent = await this.prisma.sysMenu.findFirst({
      where: { id: pid },
      select: { id: true, treePath: true },
    });
    if (!parent) {
      return "0";
    }
    return parent.treePath || "0";
  }

  /**
   * 获取菜单表单
   */
  async getMenuForm(id: string | number) {
    // 非法 ID 视为「不存在」（原实现会把字符串直接下推给引擎并抛 500）
    const menuId = toBigInt(id);
    if (menuId === null) return null;

    const menu = await this.prisma.sysMenu.findFirst({ where: { id: menuId } });
    if (!menu) return null;

    // params: {k: v} -> [{key: k, value: v}]
    const result: any = { ...toMenuView(menu) };
    const rawParams = menu.params;
    if (rawParams && typeof rawParams === "object") {
      result.params = Object.entries(rawParams as Record<string, unknown>).map(([key, value]) => ({
        key,
        value: String(value),
      }));
    } else {
      result.params = null;
    }
    return result;
  }

  /**
   * 更新菜单
   */
  async update(id: string | number, updateMenuDto: UpdateMenuDto) {
    const menuId = toBigInt(id);
    if (menuId === null) return null;

    const menu = await this.prisma.sysMenu.findFirst({ where: { id: menuId } });
    if (!menu) {
      return null;
    }

    const { type, routePath, parentId } = updateMenuDto;

    // 判断是否为外链菜单
    const isExternalLink =
      type === "M" &&
      !!routePath &&
      (routePath.startsWith("http://") || routePath.startsWith("https://"));

    // 目录类型处理
    let component = updateMenuDto.component ?? menu.component;
    let normalizedRoutePath = routePath;
    if (type === "C") {
      // 一级目录需以 / 开头
      if ((!parentId || parentId === "0") && routePath && !routePath.startsWith("/")) {
        normalizedRoutePath = "/" + routePath;
      }
      component = "Layout";
    } else if (isExternalLink) {
      component = null;
    }

    const idStr = menu.id.toString();
    // 检查父级不能为自己
    if (parentId === idStr) {
      throw new Error("父级菜单不能为当前菜单");
    }

    const currentParentIdStr = menu.parentId.toString();
    // 🔴 缺陷 1 的修复点：只有请求**显式给出** parentId 时才动 parentId / treePath。
    //    `undefined` / `null` / 空串 / 纯空白 都算「未给出」⇒ 保持原父级，不重算 treePath，
    //    也不级联改写子孙。这样 `PATCH /menus/:id?visible=0` 才不会把子树搬到根节点。
    const parentProvided =
      parentId !== undefined && parentId !== null && String(parentId).trim() !== "";
    const newParentIdStr = parentProvided ? String(parentId).trim() : currentParentIdStr;
    const newParentId = toBigInt(newParentIdStr);
    if (newParentId === null) {
      throw new BusinessException("父菜单ID格式不正确");
    }

    // 重新计算 treePath（如果父级变化）
    let newTreePath = menu.treePath;
    const parentChanged = newParentId !== menu.parentId;
    if (parentChanged) {
      newTreePath = await this.generateMenuTreePath(newParentIdStr);
    }

    const data: Prisma.SysMenuUncheckedUpdateInput = {
      // component / parentId / treePath 每次都显式写入（对齐原实现 updatedMenu 里恒有这三个键；
      // 值未变时写回原值是幂等的）
      component: component ?? null,
      parentId: newParentId,
      treePath: newTreePath,
      updateTime: new Date(),
    };
    // 只写显式传入的列 —— 这正是缺陷 2 的修复点（对齐 TypeORM `update()` 跳过 `undefined` 的语义，
    // 同时不再把表里不存在的 DTO 字段下推给引擎）。
    if (updateMenuDto.name !== undefined) data.name = updateMenuDto.name;
    if (type !== undefined) data.menuType = type;
    if (normalizedRoutePath !== undefined) data.routePath = normalizedRoutePath;
    if (updateMenuDto.routeName !== undefined) data.routeName = updateMenuDto.routeName;
    if (updateMenuDto.perm !== undefined) data.perm = updateMenuDto.perm;
    if (updateMenuDto.icon !== undefined) data.icon = updateMenuDto.icon;
    if (updateMenuDto.redirect !== undefined) data.redirect = updateMenuDto.redirect;
    if (updateMenuDto.sort !== undefined) data.sort = updateMenuDto.sort;
    if (updateMenuDto.alwaysShow !== undefined) data.alwaysShow = updateMenuDto.alwaysShow;
    if (updateMenuDto.keepAlive !== undefined) data.keepAlive = updateMenuDto.keepAlive;
    if (updateMenuDto.visible !== undefined) data.visible = updateMenuDto.visible;
    if (updateMenuDto.params !== undefined) {
      // 可空 Json 列：传 `null` 必须用 `Prisma.DbNull`（SQL NULL），
      // 直接给 `null` 会被 Prisma 拒绝（它要求区分 JSON null 与 SQL NULL）
      data.params =
        updateMenuDto.params === null
          ? Prisma.DbNull
          : (updateMenuDto.params as Prisma.InputJsonValue);
    }

    await this.prisma.sysMenu.update({ where: { id: menuId }, data });

    // 更新子菜单的 treePath
    if (parentChanged) {
      await this.updateChildrenTreePath(idStr, newTreePath ?? "0");
    }

    // 刷新角色权限缓存
    await this.rolePermService.refreshAllRolePermsCache();

    return true;
  }

  /**
   * 更新子菜单树路径
   */
  private async updateChildrenTreePath(id: string, treePath: string): Promise<void> {
    const idBig = toBigInt(id);
    if (idBig === null) return;

    const children = await this.prisma.sysMenu.findMany({
      where: { parentId: idBig },
    });

    if (children.length > 0) {
      const childTreePath = `${treePath},${id}`;
      for (const child of children) {
        // 原实现走 `repository.update()`，**不触发** AuditSubscriber ⇒ 这里同样不刷新 updateTime
        await this.prisma.sysMenu.update({
          where: { id: child.id },
          data: { treePath: childTreePath },
        });
        await this.updateChildrenTreePath(child.id.toString(), childTreePath);
      }
    }
  }

  /**
   * 删除菜单（级联删除子菜单）
   *
   * 物理删除（`sys_menu` 无 `is_deleted`）。
   * 非法 ID 不再抛 500（原实现把字符串下推给引擎会报错），而是按「无可删」处理并返回 `true`,
   * 与原实现对「不存在的合法 ID」静默成功的语义一致。
   */
  async deleteMenu(id: string | number) {
    const idStr = id.toString();

    // 查找所有子菜单（包括嵌套的）
    const allMenus = await this.prisma.sysMenu.findMany({
      select: { id: true, parentId: true },
    });

    const idsToDelete = new Set<string>([idStr]);

    // 递归查找子菜单
    const findChildren = (parentId: string) => {
      for (const menu of allMenus) {
        if (menu.parentId.toString() === parentId) {
          const childId = menu.id.toString();
          // 原实现无环保护：若数据里出现「自己的父级是自己」会无限递归。
          // 这里用 Set 判重收口，正常树形下行为不变。
          if (idsToDelete.has(childId)) continue;
          idsToDelete.add(childId);
          findChildren(childId);
        }
      }
    };
    findChildren(idStr);

    const idList = toBigIntArray(Array.from(idsToDelete));
    if (idList.length > 0) {
      await this.prisma.sysMenu.deleteMany({ where: { id: { in: idList } } });
    }

    // 刷新角色权限缓存
    await this.rolePermService.refreshAllRolePermsCache();

    return true;
  }

  /**
   * 菜单树形数据处理
   */
  private buildMenuTree(menuList: MenuView[]): any[] {
    const map: { [key: string]: any } = {};
    const roots: any[] = [];

    menuList.forEach((menu) => {
      map[menu.id] = {
        ...menu,
        children: [],
      };
    });

    menuList.forEach((menu) => {
      if (isRootMenu(menu)) {
        roots.push(map[menu.id]);
      } else {
        if (map[menu.parentId]) {
          map[menu.parentId].children.push(map[menu.id]);
        }
      }
    });

    return roots;
  }

  /**
   * 构建菜单选项树
   */
  private buildOptionsTree(menus: { id: string; name: string; parentId: string }[]): any[] {
    const map: { [key: string]: any } = {};
    const roots: any[] = [];

    menus.forEach((menu) => {
      map[menu.id] = {
        value: menu.id,
        label: menu.name,
        children: [],
      };
    });

    menus.forEach((menu) => {
      if (isRootMenu(menu)) {
        roots.push(map[menu.id]);
      } else {
        if (map[menu.parentId]) {
          map[menu.parentId].children.push(map[menu.id]);
        }
      }
    });

    return roots;
  }

  /**
   * 构建前端路由
   */
  private buildRoutes(menus: MenuView[], parentId: string = "0"): Route[] {
    const routes: Route[] = [];

    menus.forEach((menu) => {
      if (menu.parentId === parentId) {
        const route: Route = {
          path: menu.routePath || "",
          component: menu.component || "",
          name: menu.routeName || "",
          meta: {
            title: menu.name,
            icon: menu.icon || "",
            hidden: menu.visible === 0,
            keepAlive: menu.keepAlive === 1,
            alwaysShow: menu.alwaysShow === 1,
            params: this.parseMenuParams(menu.params),
          },
          children: this.buildRoutes(menus, menu.id),
        };

        if (route.children.length === 0) {
          delete route.children;
        }

        routes.push(route);
      }
    });

    return routes;
  }

  private parseMenuParams(raw: unknown): Record<string, any> {
    if (!raw) return {};

    if (typeof raw === "object") {
      return raw as Record<string, any>;
    }

    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        return typeof parsed === "object" && parsed !== null ? parsed : {};
      } catch {
        return {};
      }
    }

    return {};
  }

  /**
   * 代码生成菜单
   *
   * 原实现按 `parentMenuId` 建一个 `M` 菜单，再挂 6 个动作按钮。
   * 【已知偏差·保持原行为】`treePath` 用的是 `${父.treePath},${父ID}` ——
   * 父的 `treePath` 本就以父自身结尾，于是这里会把父 ID **重复一次**（如 `"5,5"`）；
   * 且父 `treePath` 为 NULL 时会拼出字面量 `"null,5"`。两处都照搬，不做改动。
   */
  async addMenuForCodegen(
    parentMenuId: number,
    tableName: string,
    moduleName: string,
    businessName: string,
    entityName: string
  ): Promise<void> {
    const parentIdBig = toBigInt(parentMenuId);
    if (parentIdBig === null) {
      return;
    }

    const parent = await this.prisma.sysMenu.findFirst({ where: { id: parentIdBig } });
    if (!parent) {
      return;
    }

    // 计算同级最大排序号 +1
    let sort = 1;
    const maxSortMenu = await this.prisma.sysMenu.findFirst({
      where: { parentId: parentIdBig },
      orderBy: { sort: "desc" },
    });
    if (maxSortMenu) {
      sort = maxSortMenu.sort + 1;
    }

    // 构建菜单实体
    const parentIdStr = parentIdBig.toString();
    const entityKebab = this.toKebabCase(entityName);
    const treePath = `${parent.treePath},${parentIdStr}`;

    // 创建菜单记录
    const menu = await this.prisma.sysMenu.create({
      data: {
        parentId: parentIdBig,
        menuType: "M",
        name: businessName,
        routeName: entityName,
        routePath: entityKebab,
        component: `${moduleName}/${entityKebab}/index`,
        sort,
        visible: 1,
        treePath,
        createTime: new Date(),
        updateTime: new Date(),
      },
    });

    // 生成按钮权限标识
    const permPrefix = `${moduleName}:${tableName.replace(/_/g, "-")}:`;
    const actions = ["add", "edit", "delete", "detail", "export", "import"];
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      await this.prisma.sysMenu.create({
        data: {
          parentId: menu.id,
          menuType: "B",
          name: action,
          perm: permPrefix + action,
          sort: i + 1,
          treePath: `${treePath},${menu.id.toString()}`,
          createTime: new Date(),
          updateTime: new Date(),
        },
      });
    }
  }

  /**
   * 驼峰转换为kebab-case
   */
  private toKebabCase(s: string): string {
    if (!s) return "";
    let result = "";
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (i > 0 && c >= "A" && c <= "Z") {
        result += "-";
      }
      result += c.toLowerCase();
    }
    return result;
  }
}
