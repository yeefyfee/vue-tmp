import * as winston from "winston";
import { RequestContext } from "../context/request-context";

/**
 * trace 上下文注入（CROSS-14 结构化日志）
 *
 * winston 自定义 format：把 AsyncLocalStorage 里的请求上下文
 * （traceId / userId / tenantId）注入每条日志 —— logger 调用是同步链，
 * ALS 在 format 内可读，因此 **任何走 winston 的日志自动带 trace_id**，
 * controller / service / repository 无需手动传参。
 *
 * 请求级 trace_id 由 `RequestContextMiddleware` 在入口生成；
 * 无请求上下文（启动期 / 定时任务）时字段为 null，日志形状保持稳定。
 */
export const traceContextFormat = winston.format((info) => {
  info.traceId = RequestContext.getTraceId();
  info.userId = RequestContext.getUserId();
  info.tenantId = RequestContext.getTenantId();
  return info;
});
