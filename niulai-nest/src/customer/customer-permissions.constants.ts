/**
 * 客户模块权限点登记表（P0-05-08）
 *
 * ── 权限机制（已核实，对齐 store / pet 域既有做法）──
 *  - 仓库**无权限 seed 机制**；权限码是「字符串标识」，运行时由
 *    `PermissionGuard` 从 `@Permissions(...)` 元数据读取，经
 *    `RolePermService.getPermsByRoleCodes()`（Redis 缓存 → 回源
 *    `sys_role_menu ⋈ sys_menu`，仅取 `sys_menu.type='B' AND perm IS NOT NULL`）
 *    校验用户角色是否具备；
 *  - `ROOT` 角色（tenant_admin / admin 均为 ROOT）**直接放行** ⇒ 新增权限点
 *    不阻塞既有超级管理员，非 ROOT 角色的可见性由其 `sys_menu(type='B').perm`
 *    记录 + `sys_role_menu` 授权链路决定；
 *  - 因此「登记权限点」= 在代码侧以**唯一常量**声明权限码（本文件为单一事实源），
 *    并在控制器 `@Permissions(...)` 引用；DB 侧 `sys_menu`/`sys_role_menu` 行由
 *    运营在后台按本清单维护（无 seed，故不落库、不改 packages/db）。
 *
 * ── 与既有实现的口径关系 ──
 *  - 萌主档案 CRUD 四码（customer:list/create/update/delete）**字符串与既有实现
 *    完全一致**（纯提取常量，零行为变化）；
 *  - 触达 / 黑名单 / 客户-宠物归属 / 转移审批等此前**复用**客户域粗粒度四码
 *    （customer:list / customer:update），本次按 P0-05-08「客户模块权限点」目标
 *    细化为「能力点」权限码（`域:对象:动作`）；ROOT 直放 ⇒ 对既有可运行链路
 *    零运行时/测试影响，非 ROOT 角色按本清单在后台维护 `sys_menu.perm` 授权。
 *
 * 命名口径：`域:对象:动作`（对齐 `store:list` / `pet:health:list` / `pet:tag:assign`
 * 既有风格）。
 */

export const CustomerPermissions = {
  // ── 萌主档案（P0-05-02 · FR-1；字符串与既有实现一致，零行为变化）──
  /** 客户列表 / 详情 */
  CUSTOMER_LIST: "customer:list",
  /** 客户建档 */
  CUSTOMER_CREATE: "customer:create",
  /** 客户资料更新 */
  CUSTOMER_UPDATE: "customer:update",
  /** 客户软删 */
  CUSTOMER_DELETE: "customer:delete",

  // ── 客户合并（P0-05-07 · FR-7）──
  /** 客户合并（source 并入 target） */
  CUSTOMER_MERGE: "customer:merge",

  // ── 触达渠道与偏好（P0-05-04 · FR-3）──
  /** 触达历史查询 */
  CUSTOMER_REACH_LIST: "customer:reach:list",
  /** 记录触达 */
  CUSTOMER_REACH_CREATE: "customer:reach:create",
  /** 读取触达偏好 */
  CUSTOMER_REACH_PREFERENCE_READ: "customer:reach:preference:read",
  /** 设置触达偏好 */
  CUSTOMER_REACH_PREFERENCE_UPDATE: "customer:reach:preference:update",

  // ── 黑名单（P0-05-05 · FR-4，门店 / 租户两级）──
  /** 黑名单查询 */
  CUSTOMER_BLACKLIST_LIST: "customer:blacklist:list",
  /** 拉黑客户 */
  CUSTOMER_BLACKLIST_CREATE: "customer:blacklist:create",
  /** 解除黑名单 */
  CUSTOMER_BLACKLIST_RELEASE: "customer:blacklist:release",

  // ── 客户-宠物归属（P0-05-03 · FR-2）──
  /** 客户宠物列表 */
  CUSTOMER_PET_LIST: "customer:pet:list",
  /** 绑定宠物归属 */
  CUSTOMER_PET_BIND: "customer:pet:bind",
  /** 解绑宠物归属（历史脏关联清理） */
  CUSTOMER_PET_UNBIND: "customer:pet:unbind",

  // ── 转移申请（P0-05-03 · FR-2，归属变更唯一合法通道）──
  /** 转移申请列表 */
  CUSTOMER_TRANSFER_LIST: "customer:transfer:list",
  /** 发起转移申请（宠物归属变更） */
  CUSTOMER_TRANSFER_CREATE: "customer:transfer:create",
  /** 审批通过转移申请 */
  CUSTOMER_TRANSFER_APPROVE: "customer:transfer:approve",
  /** 拒绝转移申请 */
  CUSTOMER_TRANSFER_REJECT: "customer:transfer:reject",
  /** 撤销转移申请 */
  CUSTOMER_TRANSFER_CANCEL: "customer:transfer:cancel",
} as const;

export type CustomerPermission = (typeof CustomerPermissions)[keyof typeof CustomerPermissions];

/** 全量权限点清单（登记顺序 = 建议 sys_menu(type='B') 建单顺序） */
export const CUSTOMER_PERMISSION_CODES: readonly CustomerPermission[] =
  Object.values(CustomerPermissions);

/**
 * 权限点中文名（供 `sys_menu.name` 登记与后台展示参考）。
 * 键为权限码，值为建议菜单名。
 */
export const CUSTOMER_PERMISSION_LABELS: Readonly<Record<CustomerPermission, string>> = {
  [CustomerPermissions.CUSTOMER_LIST]: "萌主档案-查询",
  [CustomerPermissions.CUSTOMER_CREATE]: "萌主档案-新增",
  [CustomerPermissions.CUSTOMER_UPDATE]: "萌主档案-修改",
  [CustomerPermissions.CUSTOMER_DELETE]: "萌主档案-删除",
  [CustomerPermissions.CUSTOMER_MERGE]: "客户合并",
  [CustomerPermissions.CUSTOMER_REACH_LIST]: "客户触达-查询",
  [CustomerPermissions.CUSTOMER_REACH_CREATE]: "客户触达-记录",
  [CustomerPermissions.CUSTOMER_REACH_PREFERENCE_READ]: "触达偏好-查询",
  [CustomerPermissions.CUSTOMER_REACH_PREFERENCE_UPDATE]: "触达偏好-设置",
  [CustomerPermissions.CUSTOMER_BLACKLIST_LIST]: "黑名单-查询",
  [CustomerPermissions.CUSTOMER_BLACKLIST_CREATE]: "黑名单-拉黑",
  [CustomerPermissions.CUSTOMER_BLACKLIST_RELEASE]: "黑名单-解除",
  [CustomerPermissions.CUSTOMER_PET_LIST]: "客户宠物-查询",
  [CustomerPermissions.CUSTOMER_PET_BIND]: "客户宠物-绑定",
  [CustomerPermissions.CUSTOMER_PET_UNBIND]: "客户宠物-解绑",
  [CustomerPermissions.CUSTOMER_TRANSFER_LIST]: "转移申请-查询",
  [CustomerPermissions.CUSTOMER_TRANSFER_CREATE]: "转移申请-发起",
  [CustomerPermissions.CUSTOMER_TRANSFER_APPROVE]: "转移申请-审批",
  [CustomerPermissions.CUSTOMER_TRANSFER_REJECT]: "转移申请-拒绝",
  [CustomerPermissions.CUSTOMER_TRANSFER_CANCEL]: "转移申请-撤销",
};
