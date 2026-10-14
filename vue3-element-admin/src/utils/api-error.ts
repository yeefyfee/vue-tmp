/**
 * 接口错误模型与用户可读文案（01-06 · 全局请求层）
 *
 * 本模块**纯逻辑、零副作用**：不做任何 UI 提示、不读 store、不读 i18n
 * （`@/lang` 顶层会调 store，若在此引入将形成循环初始化，见踩坑 69）。
 * 弹提示 / 跳登录 / 上报埋点等副作用一律留在 `utils/request.ts`。
 *
 * 文案口径（PRD《交互规范》§操作反馈 · §错误预防与恢复）：
 * 1. 必须写清「发生了什么」+「怎么办」，禁止只给一句「操作失败」；
 * 2. 不含技术细节（不出现响应码、堆栈、英文异常名、字段名）。
 */

import { ApiCodeEnum, isForbiddenApiCode } from "@/enums/api";

/** 后端统一错误信封（失败时 `data` 恒为 `null`，`details` 仅调用方显式携带时出现） */
export interface ApiErrorPayload {
  code: string;
  msg: string;
  data?: unknown;
  details?: unknown;
}

/** 接口错误的来源类别 */
export type ApiErrorKind = "business" | "http" | "timeout" | "network" | "canceled" | "unknown";

/**
 * 类型化的接口错误
 *
 * 统一请求适配器 reject 的一律是本类型（`extends Error`，与既有 `catch` 兼容），
 * 调用方可通过 `code` / `kind` 做分支，不必解析文案字符串。
 */
export class ApiError extends Error {
  /** 业务响应码（无响应体时为 `""`） */
  readonly code: string;
  /** HTTP 状态码（无响应时为 `0`） */
  readonly httpStatus: number;
  /** 错误来源类别 */
  readonly kind: ApiErrorKind;
  /** 请求地址（不含 query 的路径） */
  readonly url: string;
  /** 请求方法（大写） */
  readonly method: string;
  /** 后端返回的原始错误体 */
  readonly payload?: unknown;

  constructor(init: {
    code?: string;
    message: string;
    httpStatus?: number;
    kind?: ApiErrorKind;
    url?: string;
    method?: string;
    payload?: unknown;
  }) {
    super(init.message);
    this.name = "ApiError";
    this.code = init.code ?? "";
    this.httpStatus = init.httpStatus ?? 0;
    this.kind = init.kind ?? "unknown";
    this.url = init.url ?? "";
    this.method = init.method ?? "";
    this.payload = init.payload;
  }

  /** 是否为权限 / 租户域错误（403 家族） */
  get isForbidden(): boolean {
    return this.httpStatus === 403 || isForbiddenApiCode(this.code);
  }
}

/** 判定任意值是否为 {@link ApiError} */
export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/** 兜底文案 */
export const API_FALLBACK_MESSAGE = {
  /** 有响应但无法识别响应码 */
  business: "请求失败，请稍后重试",
  /** 请求超时 */
  timeout: "请求超时，请稍后重试",
  /** 网络不可达 */
  network: "网络连接失败，请检查网络后重试",
  /** 服务端 5xx */
  server: "服务暂时不可用，请稍后重试或联系管理员",
  /** 下载 / 导出失败 */
  download: "文件下载失败，请稍后重试",
  unknown: "请求失败，请稍后重试",
} as const;

/**
 * 已知错误码 → 用户可读文案
 *
 * 仅收敛「文案质量明显优于后端原文」的通用码；业务码（如「门店编码已存在」）
 * 直接采用后端 `msg`，避免前端维护一份庞大的业务文案副本而漂移。
 */
export const API_CODE_MESSAGE: Readonly<Record<string, string>> = {
  [ApiCodeEnum.ACCESS_TOKEN_INVALID]: "登录状态已失效，请重新登录后再试",
  [ApiCodeEnum.REFRESH_TOKEN_INVALID]: "登录状态已失效，请重新登录后再试",

  [ApiCodeEnum.ACCESS_PERMISSION_EXCEPTION]: "暂无该操作的权限，请联系管理员开通后再试",
  [ApiCodeEnum.TENANT_CONTEXT_MISSING]: "当前登录会话缺少租户信息，请重新登录后再试",
  [ApiCodeEnum.TENANT_NOT_FOUND]: "所属租户不存在或已停用，请联系平台管理员",
  [ApiCodeEnum.TENANT_CAPABILITY_NOT_INCLUDED]: "当前套餐未包含该功能，请联系管理员升级套餐",
  [ApiCodeEnum.TENANT_PLATFORM_ONLY]: "该功能仅平台账号可用，请改用平台账号操作",
  [ApiCodeEnum.TENANT_DISABLED]: "所属租户已停用，请联系平台管理员",
  [ApiCodeEnum.STORE_CONTEXT_UNAVAILABLE]: "目标门店不可用，请切换到其他门店后重试",

  [ApiCodeEnum.USER_REQUEST_PARAMETER_ERROR]: "提交的内容不合法，请检查后重新提交",
  [ApiCodeEnum.IDEMPOTENCY_REQUEST_IN_PROGRESS]: "请求正在处理中，请稍候再试",
  [ApiCodeEnum.IDEMPOTENCY_KEY_REUSED]: "请勿重复提交，请刷新页面后重试",
  [ApiCodeEnum.IDEMPOTENCY_KEY_REQUIRED]: "请求缺少必要标识，请刷新页面后重试",

  // 门店域（P0-04-02）：文案明确「对象 + 怎么办」，优于后端通用 msg
  [ApiCodeEnum.STORE_CODE_DUPLICATED]: "该门店编码已被占用，请更换编码后重新提交",
  [ApiCodeEnum.STORE_VERSION_CONFLICT]: "该门店已被他人修改，请刷新列表后重试",
  [ApiCodeEnum.STORE_NOT_FOUND]: "门店不存在或已被删除，请刷新列表后重试",

  // 房间资源域（P0-04-03）：文案明确「对象 + 怎么办」，优于后端通用 msg
  [ApiCodeEnum.ROOM_NOT_FOUND]: "房间不存在或已被删除，请刷新列表后重试",
  [ApiCodeEnum.ROOM_NO_DUPLICATED]: "该门店下已存在相同编号的房间，请更换编号后重新提交",
  [ApiCodeEnum.ROOM_VERSION_CONFLICT]: "该房间已被他人修改，请刷新列表后重试",
  [ApiCodeEnum.ROOM_STATUS_INVALID]: "仅支持在「空闲」与「维护中」之间切换房态，请重新选择",
  [ApiCodeEnum.ROOM_STORE_INVALID]: "所选门店不存在或已删除，请重新选择门店后再提交",
  [ApiCodeEnum.ROOM_STORE_NOT_FOUND]: "门店不存在或已被删除，请刷新后重试",

  // 门店运营配置域（02-03 营业时间/配置 · 02-04 日期级例外日历）
  // 文案一律写「怎么办」（PRD《交互规范》§文案规范）
  [ApiCodeEnum.STORE_BUSINESS_HOURS_INVALID]:
    "营业时段格式不合法（需覆盖周一至周日、每天最多 3 段、结束时间晚于开始时间），请调整后重新保存",
  [ApiCodeEnum.STORE_CONFIG_INVALID]: "门店配置项不合法，请按页面标注的取值范围重新填写后保存",
  [ApiCodeEnum.STORE_CALENDAR_DATE_DUPLICATED]:
    "该日期已存在例外设置，请修改原有记录或改用其他日期后重试",
  [ApiCodeEnum.STORE_CALENDAR_NOT_FOUND]: "该例外设置已不存在或已被删除，请刷新日历后重试",

  [ApiCodeEnum.SYSTEM_ERROR]: "服务暂时不可用，请稍后重试或联系管理员",
  [ApiCodeEnum.INTERFACE_NOT_EXIST]: "请求的接口不存在，请刷新页面后重试",
};
/**
 * HTTP 状态码 → 用户可读文案
 *
 * 仅在响应体未携带可识别业务码时使用（如网关 / 反代直接返回 5xx HTML）。
 */
const HTTP_STATUS_MESSAGE: Readonly<Record<number, string>> = {
  400: "提交的内容不合法，请检查后重新提交",
  401: "登录状态已失效，请重新登录后再试",
  403: "暂无该操作的权限，请联系管理员开通后再试",
  404: "请求的资源不存在，请刷新页面后重试",
  405: "当前操作不被支持，请刷新页面后重试",
  408: "请求超时，请稍后重试",
  413: "上传内容过大，请压缩后重试",
  429: "操作过于频繁，请稍候再试",
  500: API_FALLBACK_MESSAGE.server,
  502: API_FALLBACK_MESSAGE.server,
  503: API_FALLBACK_MESSAGE.server,
  504: "服务响应超时，请稍后重试",
};

/**
 * 解析业务错误文案
 *
 * 优先级：已知通用码文案 → 后端 `msg` → HTTP 状态码文案 → 兜底文案。
 *
 * @param code       业务响应码
 * @param backendMsg 后端返回的 `msg`
 * @param httpStatus HTTP 状态码
 */
export function resolveApiErrorMessage(
  code?: string,
  backendMsg?: string,
  httpStatus?: number
): string {
  if (code && API_CODE_MESSAGE[code]) return API_CODE_MESSAGE[code];
  const trimmed = typeof backendMsg === "string" ? backendMsg.trim() : "";
  // 后端已给出可读业务文案（如「门店编码已存在」）则优先采用
  if (trimmed && trimmed !== "成功" && !/^[A-Z]\d{4}$/.test(trimmed)) return trimmed;
  if (httpStatus && HTTP_STATUS_MESSAGE[httpStatus]) return HTTP_STATUS_MESSAGE[httpStatus];
  return API_FALLBACK_MESSAGE.business;
}

/**
 * 解析传输层错误文案（无响应：超时 / 断网 / 取消）
 *
 * @param error axios 抛出的错误对象
 */
export function resolveTransportErrorMessage(error: unknown): string {
  const code = readErrorCode(error);
  if (code === "ECONNABORTED" || code === "ETIMEDOUT") return API_FALLBACK_MESSAGE.timeout;
  return API_FALLBACK_MESSAGE.network;
}

/** 判定是否为「请求被主动取消」（如路由切换、重复请求取消），此类错误应静默处理 */
export function isCanceledError(error: unknown): boolean {
  if (readErrorCode(error) === "ERR_CANCELED") return true;
  return !!(error as { __CANCEL__?: boolean } | null)?.__CANCEL__;
}

/** 读取 axios 错误的 `code` 字段 */
function readErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "";
}

/** 埋点上报载荷 */
export interface ApiErrorReport {
  /** 业务响应码 */
  code: string;
  /** 提示给用户的文案 */
  message: string;
  /** 错误来源类别 */
  kind: ApiErrorKind;
  /** HTTP 状态码 */
  httpStatus: number;
  /** 请求路径 */
  url: string;
  /** 请求方法 */
  method: string;
}
