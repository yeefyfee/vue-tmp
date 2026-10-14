/**
 * User 用户类型定义
 */

import type { BaseQueryParams } from "@/api/common";

/**
 * 登录用户信息
 *
 * 字段与后端 `GET /api/v1/users/me`（`CurrentUserDto`）逐字对齐，
 * 避免出现「后端已返回、前端类型不认识」的静默丢弃。
 */
export interface UserInfo {
  /** 用户ID */
  userId?: string;
  /** 用户名（登录账号） */
  username?: string;
  /** 用户昵称 */
  nickname?: string;
  /** 头像URL */
  avatar?: string;
  /** 手机号 */
  mobile?: string | null;
  /** 邮箱 */
  email?: string | null;
  /** 性别（1=男，2=女） */
  gender?: number;
  /** 部门ID */
  deptId?: string;
  /** 部门名称 */
  deptName?: string;
  /** 角色名称（多角色以逗号拼接） */
  roleNames?: string;
  /** 创建时间 */
  createTime?: string;
  /** 租户切换权限（true 可切换租户） */
  canSwitchTenant?: boolean;
  /** 角色集合（角色编码） */
  roles: string[];
  /** 权限集合 */
  perms: string[];
}

/** 用户分页查询参数 */
export interface UserQueryParams extends BaseQueryParams {
  /** 搜索关键字 */
  keywords?: string;
  /** 用户状态 */
  status?: number;
  /** 部门ID */
  deptId?: string;
  /** 创建时间 */
  createTime?: [string, string];
  /**
   * 是否展示系统管理员（ROOT 角色）账号。
   *
   * 默认不传 / `false` —— 与后端 `buildUserWhere()` 的「超管不进列表」默认口径一致；
   * 只有用户主动打开「显示超管」开关时才传 `true`。
   */
  includeRoot?: boolean;
}

/** 用户分页对象 */
export interface UserItem {
  /** 用户ID */
  id: string;
  /** 用户头像地址 */
  avatar?: string;
  /** 创建时间 */
  createTime?: Date;
  /** 部门名称 */
  deptName?: string;
  /** 用户邮箱 */
  email?: string;
  /** 性别 */
  gender?: number;
  /** 手机号 */
  mobile?: string;
  /** 用户昵称 */
  nickname?: string;
  /** 角色名称，多个使用英文逗号(,)分割 */
  roleNames?: string;
  /** 用户状态(1:启用;0:禁用) */
  status?: number;
  /** 用户名 */
  username?: string;
  /**
   * 是否系统管理员（持有 ROOT 角色）。
   *
   * 仅在「显示超管」模式下会出现 `true` 的行：此类行展示「系统级」标识并禁用删除。
   */
  isRoot?: boolean;
}

/** 用户表单对象 */
export interface UserForm {
  /** 用户ID */
  id?: string;
  /** 用户头像 */
  avatar?: string;
  /** 部门ID */
  deptId?: string;
  /** 用户邮箱 */
  email?: string;
  /** 性别 */
  gender?: number;
  /** 手机号 */
  mobile?: string;
  /** 用户昵称 */
  nickname?: string;
  /** 角色ID集合 */
  roleIds?: number[];
  /** 用户状态(1:正常;0:禁用) */
  status?: number;
  /** 用户名 */
  username?: string;
}

/** 个人中心用户信息 */
export interface UserProfileDetail {
  /** 用户ID */
  id?: string;
  /** 用户名 */
  username?: string;
  /** 用户昵称 */
  nickname?: string;
  /** 头像URL */
  avatar?: string;
  /** 性别 */
  gender?: number;
  /** 手机号 */
  mobile?: string;
  /** 邮箱 */
  email?: string;
  /** 部门名称 */
  deptName?: string;
  /** 角色名称 */
  roleNames?: string;
  /** 创建时间 */
  createTime?: Date;
}

/** 个人中心用户信息表单 */
export interface UserProfileForm {
  /** 用户昵称 */
  nickname?: string;
  /** 头像URL */
  avatar?: string;
  /** 性别 */
  gender?: number;
}

/** 修改密码表单 */
export interface PasswordChangeForm {
  /** 原密码 */
  oldPassword?: string;
  /** 新密码 */
  newPassword?: string;
  /** 确认新密码 */
  confirmPassword?: string;
}

/** 密码校验表单 */
export interface PasswordVerifyForm {
  /** 当前密码 */
  password?: string;
}

/** 修改手机表单 */
export interface MobileUpdateForm {
  /** 手机号 */
  mobile?: string;
  /** 验证码 */
  code?: string;
  /** 当前密码 */
  password?: string;
}

/** 修改邮箱表单 */
export interface EmailUpdateForm {
  /** 邮箱 */
  email?: string;
  /** 验证码 */
  code?: string;
  /** 当前密码 */
  password?: string;
}
