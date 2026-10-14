import axios, { type AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import qs from "qs";

import { isPageResult, normalizePageQuery } from "@peluvida/shared";

import { ApiCodeEnum, isForbiddenApiCode } from "@/enums/api";
import { STORAGE_KEYS } from "@/constants";
import { Storage } from "@/utils/storage";
import { AuthStorage, redirectToLogin } from "@/utils/auth";
import {
  API_FALLBACK_MESSAGE,
  API_CODE_MESSAGE,
  ApiError,
  isCanceledError,
  resolveApiErrorMessage,
  resolveTransportErrorMessage,
  type ApiErrorKind,
  type ApiErrorReport,
} from "@/utils/api-error";
import { reportApiError } from "@/utils/request-reporter";
import { usePermissionStoreHook } from "@/stores/permission";
import { useUserStoreHook } from "@/stores/user";
import type { ApiResult } from "@/api/common";

export { ApiError, isApiError } from "@/utils/api-error";
export type { ApiErrorReport, ApiErrorKind } from "@/utils/api-error";
export { setApiErrorReporter, API_ERROR_EVENT } from "@/utils/request-reporter";

/** 需要「自动注入幂等键」的写方法集合 */
const MUTATING_METHODS: readonly string[] = ["post", "put", "patch", "delete"];

/** 提示去重窗口：同一文案在该窗口内只弹一次（PRD《交互规范》：同一操作不允许重复弹反馈） */
const TOAST_DEDUPE_WINDOW_MS = 2000;

/** 连续失败升级阈值：达到后以对话框给出引导（PRD《交互规范》§操作反馈 4） */
const FAILURE_ESCALATION_THRESHOLD = 3;

/** 403 后刷新权限码的冷却时间，避免权限风暴时反复拉取 */
const PERMISSION_REFRESH_COOLDOWN_MS = 3000;

/** 防止同一请求在 token 刷新后重复进入重试，导致死循环 */
const retriedRequests = new WeakSet<InternalAxiosRequestConfig>();

/** 已提示过的文案 → 最近一次提示时间 */
const toastShownAt = new Map<string, number>();

/** 连续失败计数（任一请求成功即清零） */
let consecutiveFailures = 0;
/** 升级对话框是否正在展示，避免叠加弹出 */
let escalating = false;
/** 最近一次刷新权限码的时间 */
let lastPermissionRefreshAt = 0;

const http = axios.create({
  baseURL: import.meta.env.VITE_APP_BASE_API,
  timeout: 50000,
  headers: { "Content-Type": "application/json;charset=utf-8" },
  // 数组参数序列化为 ids=1&ids=2，而非 ids[]=1&ids[]=2
  paramsSerializer: (params) => qs.stringify(params, { arrayFormat: "repeat" }),
});

/* -------------------------------------------------------------------------- */
/* 请求拦截：统一注入凭证、幂等键与语言                                        */
/* -------------------------------------------------------------------------- */

http.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // 1) 语言：随请求下发，便于后端产出本地化文案
    const language = Storage.get<string>(STORAGE_KEYS.LANGUAGE, "");
    if (language && !config.headers.has("Accept-Language")) {
      config.headers.set("Accept-Language", language);
    }

    // 2) 凭证：调用方设置 Authorization 为 "no-auth" 即跳过 token 注入（登录/验证码等匿名接口）
    const token = AuthStorage.getAccessToken();
    if (config.headers.Authorization === "no-auth") {
      delete config.headers.Authorization;
    } else if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // 3) Idempotency-Key：写方法自动生成，抵御双击/重试造成的重复创建。
    //    重放（token 续期后重发）复用同一 config ⇒ 幂等键自动保持一致，符合服务端语义。
    const method = (config.method ?? "get").toLowerCase();
    if (
      MUTATING_METHODS.includes(method) &&
      !config.skipIdempotencyKey &&
      !config.headers.has("Idempotency-Key")
    ) {
      config.headers.set("Idempotency-Key", createIdempotencyKey());
    }

    return config;
  },
  (error) => Promise.reject(error)
);

/* -------------------------------------------------------------------------- */
/* 响应拦截：信封解包 + 分页标准化 + 统一错误处理                              */
/* -------------------------------------------------------------------------- */

http.interceptors.response.use(
  (response: AxiosResponse<ApiResult>) => {
    const { responseType } = response.config;

    // 二进制数据（下载 / 导出）直接透传
    if (responseType === "blob" || responseType === "arraybuffer") {
      return response;
    }

    const body = response.data;

    if (body?.code === ApiCodeEnum.SUCCESS) {
      // 成功即清零连续失败计数
      consecutiveFailures = 0;
      // 业务数据「裸返回」是本适配器对外契约：调用方拿到的即 data 本身。
      // 真实类型由 `request<unknown, T>` 的第二泛型承担（本返回值仅满足拦截器签名）。
      return normalizeListEnvelope(body.data, response.config) as unknown as AxiosResponse;
    }

    // 少数网关会以 HTTP 2xx 返回非成功信封（如 DTO 校验失败被改写为 200 + A0400）
    const code = body?.code ?? "";
    const message = resolveApiErrorMessage(code, body?.msg, response.status);
    handleApiError({
      code,
      message,
      kind: "business",
      httpStatus: response.status,
      url: stringifyRequestUrl(response.config),
      method: String(response.config.method ?? "").toUpperCase(),
    });

    return Promise.reject(
      new ApiError({
        code,
        message,
        httpStatus: response.status,
        kind: "business",
        url: stringifyRequestUrl(response.config),
        method: String(response.config.method ?? "").toUpperCase(),
        payload: body,
      })
    );
  },

  async (error: AxiosError<ApiResult>) => {
    // 主动取消（组件卸载 / 路由切换 / 取消令牌）一律静默：不提示、不上报
    if (isCanceledError(error)) {
      return Promise.reject(toApiError(error, API_FALLBACK_MESSAGE.unknown, "canceled"));
    }

    const { config, response } = error;

    // 1) 无响应：超时 / 断网。此时没有任何业务码可用
    if (!response) {
      const kind = classifyTransportError(error);
      const message = resolveTransportErrorMessage(error);
      handleApiError({
        code: "",
        message,
        kind,
        httpStatus: 0,
        url: config?.url ?? "",
        method: String(config?.method ?? "").toUpperCase(),
      });
      return Promise.reject(toApiError(error, message, kind));
    }

    // 2) 二进制响应异常：后端错误体被包进 Blob，无法解析业务码
    if (response.data instanceof Blob) {
      handleApiError({
        code: "",
        message: API_FALLBACK_MESSAGE.download,
        kind: "business",
        httpStatus: response.status,
        url: stringifyRequestUrl(config),
        method: String(config?.method ?? "").toUpperCase(),
      });
      return Promise.reject(toApiError(error, API_FALLBACK_MESSAGE.download, "business"));
    }

    const body = response.data;
    const code = body?.code ?? "";

    // 3) 访问令牌失效：静默续期（单飞）后重放原请求
    if (code === ApiCodeEnum.ACCESS_TOKEN_INVALID) {
      return handleAccessTokenInvalid(error, config);
    }

    // 4) 刷新令牌失效：清理会话并回登录页（保留原路径以便登录后回到现场）
    if (code === ApiCodeEnum.REFRESH_TOKEN_INVALID) {
      await redirectToLogin("登录已过期，请重新登录", false);
      return Promise.reject(
        toApiError(error, API_CODE_MESSAGE[ApiCodeEnum.REFRESH_TOKEN_INVALID], "business")
      );
    }

    // 5) 权限 / 租户域 403：统一「无权限」口径 + 刷新权限码，使前端隐藏入口与服务端保持一致
    if (isForbiddenApiCode(code) || response.status === 403) {
      const message = resolveApiErrorMessage(code, body?.msg, response.status);
      handleApiError({
        code,
        message,
        kind: "business",
        httpStatus: response.status,
        url: stringifyRequestUrl(config),
        method: String(config?.method ?? "").toUpperCase(),
      });
      refreshPermissionsThrottled();
      return Promise.reject(toApiError(error, message, "business"));
    }

    // 6) 其余业务错误 / HTTP 错误
    const message = resolveApiErrorMessage(code, body?.msg, response.status);
    handleApiError({
      code,
      message,
      kind: "business",
      httpStatus: response.status,
      url: stringifyRequestUrl(config),
      method: String(config?.method ?? "").toUpperCase(),
    });
    return Promise.reject(toApiError(error, message, "business"));
  }
);

/* -------------------------------------------------------------------------- */
/* 内部实现                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 处理访问令牌失效：refresh 单飞续期 → 重放原请求。
 * 同一请求只允许重试一次，避免服务端持续 401 时的重试风暴。
 */
async function handleAccessTokenInvalid(
  error: AxiosError<ApiResult>,
  config: InternalAxiosRequestConfig | undefined
): Promise<unknown> {
  const expiredMessage = API_CODE_MESSAGE[ApiCodeEnum.ACCESS_TOKEN_INVALID];

  if (!config || retriedRequests.has(config)) {
    await redirectToLogin("登录已过期，请重新登录");
    return Promise.reject(toApiError(error, expiredMessage, "business"));
  }

  retriedRequests.add(config);

  try {
    const userStore = useUserStoreHook();
    await userStore.refreshTokenOnce();

    const token = AuthStorage.getAccessToken();
    if (token) {
      config.headers.set("Authorization", `Bearer ${token}`);
    }

    return await http(config);
  } catch {
    await redirectToLogin("登录已过期，请重新登录");
    return Promise.reject(toApiError(error, expiredMessage, "business"));
  }
}

/**
 * 统一列表信封标准化：`{ list, total, page, page_size }`
 *
 * 存量系统域端点只返回 `{ list, total }`，此处依据请求参数补齐 `page` / `page_size`，
 * 使前端所有消费点的分页结构恒为统一形状（契约收敛，不在页面层写分支）。
 */
function normalizeListEnvelope<T>(data: T, config: InternalAxiosRequestConfig): T {
  if (!isPageResult(data)) return data;
  if (typeof data.page === "number" && typeof data.page_size === "number") return data;

  const query = normalizePageQuery((config.params ?? {}) as Record<string, unknown>);
  return { ...data, page: query.page, page_size: query.page_size };
}

/** 生成幂等键（UUID v4；无 `crypto.randomUUID` 时降级为时间戳 + 随机数） */
function createIdempotencyKey(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  return `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 归类「无响应」错误 */
function classifyTransportError(error: AxiosError): ApiErrorKind {
  return error.code === "ECONNABORTED" || error.code === "ETIMEDOUT" ? "timeout" : "network";
}

/** 取请求路径（不含 query），用于提示去重与埋点 */
function stringifyRequestUrl(config?: InternalAxiosRequestConfig): string {
  const url = config?.url ?? "";
  return url.split("?")[0] ?? url;
}

/** 构造类型化错误 */
function toApiError(error: AxiosError<ApiResult>, message: string, kind: ApiErrorKind): ApiError {
  const config = error.config;
  return new ApiError({
    code: error.response?.data?.code ?? "",
    message,
    httpStatus: error.response?.status ?? 0,
    kind,
    url: stringifyRequestUrl(config),
    method: String(config?.method ?? "").toUpperCase(),
    payload: error.response?.data,
  });
}

/**
 * 错误统一出口：埋点上报 → 去重提示 → 连续失败升级。
 * 所有分支（含网络层）都必须经此出口，保证提示与上报行为一致。
 */
function handleApiError(report: ApiErrorReport): void {
  reportApiError(report);
  notifyErrorMessage(report.message);
  trackFailure();
}

/** 去重提示：同一文案在窗口内只弹一次 */
function notifyErrorMessage(message: string): void {
  const now = Date.now();
  const last = toastShownAt.get(message);
  if (last !== undefined && now - last < TOAST_DEDUPE_WINDOW_MS) return;

  toastShownAt.set(message, now);
  if (toastShownAt.size > 50) {
    for (const [key, at] of toastShownAt) {
      if (now - at >= TOAST_DEDUPE_WINDOW_MS) toastShownAt.delete(key);
    }
  }

  ElMessage.error(message);
}

/** 连续失败升级：达到阈值时以对话框给出「怎么办」引导 */
function trackFailure(): void {
  consecutiveFailures += 1;
  if (consecutiveFailures < FAILURE_ESCALATION_THRESHOLD || escalating) return;

  consecutiveFailures = 0;
  escalating = true;

  ElMessageBox.alert(
    "操作连续失败，可能是网络或服务异常。请检查网络后重试；若仍无法解决，请联系门店管理员。",
    "操作失败",
    { confirmButtonText: "知道了", type: "warning", closeOnClickModal: false }
  )
    .catch(() => undefined)
    .finally(() => {
      escalating = false;
    });
}

/** 403 后节流刷新权限码（失败静默：仅用于刷新前端缓存，失败不影响当前提示） */
function refreshPermissionsThrottled(): void {
  const now = Date.now();
  if (now - lastPermissionRefreshAt < PERMISSION_REFRESH_COOLDOWN_MS) return;
  lastPermissionRefreshAt = now;

  void usePermissionStoreHook()
    .refreshPermissions()
    .catch(() => undefined);
}

declare module "axios" {
  interface AxiosRequestConfig {
    /** 设为 `true` 时跳过 `Idempotency-Key` 自动注入 */
    skipIdempotencyKey?: boolean;
  }
}

// DEV-only 调试入口：向 window 暴露请求适配器，供真机调试与自动化验证直接驱动。
// `import.meta.env.DEV` 是编译期常量，生产构建下整段被摇树移除（踩坑 71）。
if (import.meta.env.DEV) {
  (window as Window & { __veaHttp__?: typeof http }).__veaHttp__ = http;
}

export default http;
