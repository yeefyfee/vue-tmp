import type { Request, Response } from "express";

interface RequestLogContext {
  url: string;
  method: string;
  clientIP: string;
  userAgent?: string;
  referrer?: string;
  params: Record<string, unknown>;
  query: Record<string, unknown>;
  /** 脱敏后的请求头（键级打码后不再是 IncomingHttpHeaders 原始形状） */
  headers: Record<string, unknown>;
  body: Record<string, unknown>;
}

interface ResponseLogContext {
  statusCode: number;
  latency: number;
  contentLength?: number;
}

/** 触发键级脱敏的键名（小写匹配，含常见别名的超集；CROSS-14） */
const SENSITIVE_KEY_PATTERNS: RegExp[] = [
  /pass(word)?/,
  /token/,
  /secret/,
  /authorization/,
  /cookie/,
  /id_?card/,
  /captcha/,
  /credit_?card/,
  /mobile/,
  /phone/,
  /email/,
];

/** 中国大陆手机号（值级脱敏）：138****5678 */
const CN_MOBILE_RE = /(?<!\d)1[3-9]\d{9}(?!\d)/g;

/** 身份证 18 位（值级脱敏）：前 6 后 2 保留 */
const CN_ID_CARD_RE = /(?<!\d)\d{17}[\dXx](?!\d)/g;

export class LoggerUtils {
  static captureRequestContext(req: Request): RequestLogContext {
    return {
      url: req.originalUrl,
      method: req.method,
      clientIP: this.parseClientIP(req),
      userAgent: req.headers["user-agent"],
      referrer: req.headers.referer,
      params: req.params as Record<string, unknown>,
      query: this.maskSensitive(req.query as Record<string, unknown>),
      headers: this.maskSensitive(req.headers as Record<string, unknown>),
      body: this.maskSensitive(req.body as Record<string, unknown>),
    };
  }

  static captureResponseContext(res: Response, startTime: number): ResponseLogContext {
    return {
      statusCode: res.statusCode,
      latency: Date.now() - startTime,
      contentLength: res.getHeader("content-length") as number,
    };
  }

  static parseClientIP(req: Request): string {
    return (
      req.ip || req.socket?.remoteAddress || req.headers["x-forwarded-for"]?.toString() || "unknown"
    );
  }

  /**
   * 递归脱敏（CROSS-14 结构化日志）：
   *  1. **键级** —— 键名命中 {@link SENSITIVE_KEY_PATTERNS} 时整值替换为 `***`；
   *  2. **值级** —— 字符串值里的手机号 `138****5678`、身份证号（前6后2）脱敏。
   * 原对象不被修改（返回深拷贝）；循环引用按 `[Circular]` 处理。
   */
  static maskSensitive<T>(value: T, depth = 0, seen = new WeakSet<object>()): T {
    if (value === null || typeof value !== "object" || depth > 6) {
      return this.maskStringified(value);
    }
    if (seen.has(value as object)) return "[Circular]" as unknown as T;
    seen.add(value as object);

    if (Array.isArray(value)) {
      return value.map((item) => this.maskSensitive(item, depth + 1, seen)) as unknown as T;
    }

    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERNS.some((re) => re.test(key.toLowerCase()))) {
        out[key] = "***";
      } else {
        out[key] = this.maskSensitive(val, depth + 1, seen);
      }
    }
    return out as unknown as T;
  }

  /** 原始值的值级脱敏：手机号 / 身份证号出现在任意字符串中时打码 */
  private static maskStringified<T>(value: T): T {
    if (typeof value !== "string") return value;
    return value
      .replace(CN_MOBILE_RE, (m) => m.slice(0, 3) + "****" + m.slice(7))
      .replace(CN_ID_CARD_RE, (m) => m.slice(0, 6) + "********" + m.slice(-2)) as unknown as T;
  }
}
