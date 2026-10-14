import request from "@/utils/request";
import type { CaptchaInfo, LoginRequest, LoginResult } from "./types";

/** 切换门店上下文的响应：新 access token 与当前激活门店 */
export interface SwitchContextResult {
  /** 内嵌 activeStoreId 的新访问令牌 */
  accessToken: string;
  /** 当前激活门店 */
  activeStore: {
    id: string;
    name: string;
  };
}

/** 当前租户可切换门店项（对齐后端 AuthContextService.listSwitchableStores） */
export interface OrganizationItem {
  /** 门店 ID */
  id: string;
  /** 门店名称 */
  name: string;
  /** 门店编码 */
  code: string;
  /** 状态（1=启用） */
  status: number;
}

const AUTH_BASE_URL = "/api/v1/auth";

const AuthAPI = {
  /**
   * 账号密码登录
   *
   * 后端 DTO 仅接受 username / password / captchaId / captchaCode 四个必填字段。
   */
  login(data: LoginRequest) {
    return request<unknown, LoginResult>({
      url: `${AUTH_BASE_URL}/login`,
      method: "post",
      data: {
        username: data.username,
        password: data.password,
        captchaId: data.captchaId,
        captchaCode: data.captchaCode,
      },
    });
  },

  /**
   * 切换门店上下文（P0-02-06）
   *
   * 校验目标门店后签发内嵌 activeStoreId 的新 access token；
   * refresh token 沿用原值，tokenVersion 语义不变。
   */
  switchContext(storeId: string) {
    return request<unknown, SwitchContextResult>({
      url: `${AUTH_BASE_URL}/switch-context`,
      method: "post",
      data: { storeId },
    });
  },

  /**
   * 当前租户可切换门店列表（启用状态，供切店 UI 数据源）
   */
  getOrganizations() {
    return request<unknown, OrganizationItem[]>({
      url: `${AUTH_BASE_URL}/organizations`,
      method: "get",
    });
  },

  refreshToken(refreshToken: string) {
    return request<unknown, LoginResult>({
      url: `${AUTH_BASE_URL}/refresh-token`,
      method: "post",
      params: { refreshToken },
      headers: {
        Authorization: "no-auth",
      },
    });
  },

  logout() {
    return request({
      url: `${AUTH_BASE_URL}/logout`,
      method: "delete",
    });
  },

  getCaptcha() {
    return request<unknown, CaptchaInfo>({
      url: `${AUTH_BASE_URL}/captcha`,
      method: "get",
    });
  },
};

export default AuthAPI;

// 重导出类型
export * from "./types";
