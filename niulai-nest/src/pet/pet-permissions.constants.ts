/**
 * 宠物模块权限点登记表（P0-06-09）
 *
 * 权限机制（已核实，对齐 store 域既有做法）：
 *  - 仓库**无权限 seed 机制**；权限码是「字符串标识」，运行时由
 *    `PermissionGuard` 从 `@Permissions(...)` 元数据读取，经
 *    `RolePermService.getPermsByRoleCodes()`（Redis 缓存 → 回源
 *    `sys_role_menu ⋈ sys_menu`，仅取 `sys_menu.type='B' AND perm IS NOT NULL`）
 *    校验用户角色是否具备；
 *  - `ROOT_ROLE_CODE` 角色**直接放行**（tenant_admin / admin 均为 ROOT）⇒
 *    新权限点不阻塞既有超级管理员，非 ROOT 角色的可见性由其
 *    `sys_menu(type='B').perm` 记录 + `sys_role_menu` 授权链路决定；
 *  - 因此「登记权限点」= 在代码侧以**唯一常量**声明权限码（本文件为单一事实源），
 *    并在控制器 `@Permissions(...)` 引用；DB 侧 `sys_menu`/`sys_role_menu` 行由
 *    运营在后台按本清单维护（无 seed，故不落库、不改 packages/db）。
 *
 * 命名口径：`域:对象:动作`（对齐 `store:list` / `pet:health:list` 既有风格）。
 */

export const PetPermissions = {
  /** 宠物档案 */
  PET_LIST: "pet:list",
  PET_CREATE: "pet:create",
  PET_UPDATE: "pet:update",
  PET_DELETE: "pet:delete",
  /** 健康档案（P0-06-03） */
  PET_HEALTH_LIST: "pet:health:list",
  PET_HEALTH_CREATE: "pet:health:create",
  PET_HEALTH_UPDATE: "pet:health:update",
  PET_HEALTH_DELETE: "pet:health:delete",
  /** 体重曲线（P0-06-04） */
  PET_WEIGHT_LIST: "pet:weight:list",
  PET_WEIGHT_CREATE: "pet:weight:create",
  PET_WEIGHT_DELETE: "pet:weight:delete",
  /** 行为标签库（P0-06-05） */
  PET_TAG_LIST: "pet:tag:list",
  PET_TAG_CREATE: "pet:tag:create",
  PET_TAG_UPDATE: "pet:tag:update",
  PET_TAG_DELETE: "pet:tag:delete",
  /** 宠物打/取消标签（P0-06-05，PUT /pets/:id/tags） */
  PET_TAG_ASSIGN: "pet:tag:assign",
  /** 宠物时间线（P0-06-06 FR-5，GET /pets/:id/timeline） */
  PET_TIMELINE_LIST: "pet:timeline:list",
  /** 宠物时间线手工补录（P0-06-06，POST /pets/:id/timeline） */
  PET_TIMELINE_CREATE: "pet:timeline:create",
  /** 宠物时间线冲正纠错（P0-06-07，POST /pets/:id/timeline/:eventId/revise） */
  PET_TIMELINE_REVISE: "pet:timeline:revise",
} as const;

export type PetPermission = (typeof PetPermissions)[keyof typeof PetPermissions];

/** 全量权限点清单（登记顺序 = 建议 sys_menu(type='B') 建单顺序） */
export const PET_PERMISSION_CODES: readonly PetPermission[] = Object.values(PetPermissions);

/**
 * 权限点中文名（供 `sys_menu.name` 登记与后台展示参考）。
 * 键为权限码，值为建议菜单名。
 */
export const PET_PERMISSION_LABELS: Readonly<Record<PetPermission, string>> = {
  [PetPermissions.PET_LIST]: "宠物档案-查询",
  [PetPermissions.PET_CREATE]: "宠物档案-新增",
  [PetPermissions.PET_UPDATE]: "宠物档案-修改",
  [PetPermissions.PET_DELETE]: "宠物档案-删除",
  [PetPermissions.PET_HEALTH_LIST]: "健康档案-查询",
  [PetPermissions.PET_HEALTH_CREATE]: "健康档案-新增",
  [PetPermissions.PET_HEALTH_UPDATE]: "健康档案-更正",
  [PetPermissions.PET_HEALTH_DELETE]: "健康档案-删除",
  [PetPermissions.PET_WEIGHT_LIST]: "体重曲线-查询",
  [PetPermissions.PET_WEIGHT_CREATE]: "体重记录-新增",
  [PetPermissions.PET_WEIGHT_DELETE]: "体重记录-删除",
  [PetPermissions.PET_TAG_LIST]: "行为标签-查询",
  [PetPermissions.PET_TAG_CREATE]: "行为标签-新增",
  [PetPermissions.PET_TAG_UPDATE]: "行为标签-修改",
  [PetPermissions.PET_TAG_DELETE]: "行为标签-删除",
  [PetPermissions.PET_TAG_ASSIGN]: "宠物打标签",
  [PetPermissions.PET_TIMELINE_LIST]: "宠物时间线-查询",
  [PetPermissions.PET_TIMELINE_CREATE]: "宠物时间线-补录",
  [PetPermissions.PET_TIMELINE_REVISE]: "宠物时间线-冲正",
};
