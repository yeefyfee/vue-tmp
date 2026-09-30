import { Logger } from "@nestjs/common";
import { BusinessException } from "@/common/exceptions/business.exception";

/**
 * Suno 开放平台原始响应结构
 *
 * 平台成功时返回 { code: 200, data: ..., msg?: string }，
 * 部分接口（如积分）直接返回 data 内容，这里做统一兼容处理。
 */
interface SunoRawResponse<T> {
  code?: number;
  msg?: string;
  message?: string;
  data?: T;
}

/** 平台错误码到提示文案的映射 */
const SUNO_ERROR_MESSAGE: Record<number, string> = {
  400: "请求参数有误，请检查后重试",
  401: "Suno 密钥无效或已过期，请在接入配置中更新",
  402: "Suno 账户积分不足，请前往商户后台充值",
  429: "请求过于频繁，请稍后重试",
  500: "Suno 服务异常，请稍后重试",
};

/**
 * Suno 开放平台 HTTP 客户端
 *
 * 职责：拼装请求、注入 Bearer 密钥、解析响应壳、统一错误码提示。
 * 不承载任何业务逻辑，业务编排见 SunoService。
 */
export class SunoClient {
  private static readonly logger = new Logger(SunoClient.name);

  constructor(
    private readonly baseUrl: string,
    private readonly accessKey: string
  ) {}

  /** 发起 GET 请求 */
  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const query = this.buildQuery(params);
    return this.request<T>("GET", `${path}${query}`);
  }

  /** 发起 POST 请求 */
  async post<T>(path: string, body?: Record<string, unknown>): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  /**
   * 统一请求实现
   *
   * 平台文档约定成功码为 200；若响应体未携带 code 字段，
   * 则视为已直接返回业务数据。
   */
  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl.replace(/\/+$/, "")}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessKey}`,
      "Content-Type": "application/json",
    };

    let raw: Response;
    try {
      raw = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
    } catch (error) {
      SunoClient.logger.error(`Suno 请求失败: ${method} ${url} - ${(error as Error).message}`);
      throw new BusinessException("无法连接 Suno 服务，请检查网络或接口地址");
    }

    const text = await raw.text();
    let payload: SunoRawResponse<T>;
    try {
      payload = text ? (JSON.parse(text) as SunoRawResponse<T>) : ({} as SunoRawResponse<T>);
    } catch {
      throw new BusinessException(`Suno 返回内容无法解析: ${text.slice(0, 200)}`);
    }

    const bizCode = payload.code ?? (raw.ok ? 200 : raw.status);
    if (bizCode !== 200) {
      const message =
        payload.msg ||
        payload.message ||
        SUNO_ERROR_MESSAGE[bizCode] ||
        `Suno 接口调用失败（错误码 ${bizCode}）`;
      throw new BusinessException(message);
    }

    // 兼容两种返回：{ code, data } 或 直接返回业务对象
    return (payload.data !== undefined ? payload.data : (payload as unknown)) as T;
  }

  /** 将对象转为 query string，自动跳过空值 */
  private buildQuery(params?: Record<string, unknown>): string {
    if (!params) return "";
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      search.append(key, String(value));
    });
    const query = search.toString();
    return query ? `?${query}` : "";
  }
}
