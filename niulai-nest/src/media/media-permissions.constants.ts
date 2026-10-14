/**
 * 媒体模块权限点登记表（P0-08）
 *
 * 权限机制（对齐 pet / store 域既有做法）：
 *  - 仓库**无权限 seed 机制**；权限码是「字符串标识」，运行时由 `PermissionGuard`
 *    从 `@Permissions(...)` 元数据读取，经 `RolePermService.getPermsByRoleCodes()`
 *    （Redis 缓存 → 回源 `sys_role_menu ⋈ sys_menu`）校验用户角色是否具备；
 *  - `ROOT_ROLE_CODE` 角色（tenant_admin / admin）**直接放行** ⇒ 新权限点不阻塞既有
 *    超级管理员；非 ROOT 角色的可见性由 `sys_menu(type='B').perm` + `sys_role_menu` 授权链路决定；
 *  - 因此「登记权限点」= 在代码侧以**唯一常量**声明权限码（本文件为单一事实源），
 *    并在控制器 `@Permissions(...)` 引用；DB 侧行由运营在后台按本清单维护（无 seed，不落库）。
 *
 * 命名口径：`域:对象:动作`（对齐 `pet:list` / `pet:timeline:list` 既有风格）。
 */
export const MediaPermissions = {
  /** 媒体列表 / 详情（任意多态关联对象） */
  MEDIA_LIST: "media:list",
  /** 媒体上传（预签名 + 直传 + 确认/回调） */
  MEDIA_UPLOAD: "media:upload",
  /** 媒体更新（可见性 / 排序等） */
  MEDIA_UPDATE: "media:update",
  /** 媒体删除（软删） */
  MEDIA_DELETE: "media:delete",
} as const;

export type MediaPermission = (typeof MediaPermissions)[keyof typeof MediaPermissions];

/** 全量权限点清单（登记顺序 = 建议 sys_menu(type='B') 建单顺序） */
export const MEDIA_PERMISSION_CODES: readonly MediaPermission[] = Object.values(MediaPermissions);

/** 权限点中文名（供 `sys_menu.name` 登记与后台展示参考） */
export const MEDIA_PERMISSION_LABELS: Readonly<Record<MediaPermission, string>> = {
  [MediaPermissions.MEDIA_LIST]: "媒体-查询",
  [MediaPermissions.MEDIA_UPLOAD]: "媒体-上传",
  [MediaPermissions.MEDIA_UPDATE]: "媒体-修改",
  [MediaPermissions.MEDIA_DELETE]: "媒体-删除",
};
