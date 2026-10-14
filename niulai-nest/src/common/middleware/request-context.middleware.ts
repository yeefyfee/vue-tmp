import { Injectable, NestMiddleware } from "@nestjs/common";
import { randomUUID } from "crypto";
import { RequestContext } from "../context/request-context";

/**
 * 请求上下文中间件
 * 初始化 AsyncLocalStorage 上下文，确保数据权限系统正常工作
 *
 * CROSS-14：请求入口同源生成/透传 trace_id ——
 *  - `X-Trace-Id` 请求头优先（网关 / 上游服务已生成时保持全链路一致）；
 *  - 否则生成 UUID；
 *  - 写回响应头 `X-Trace-Id`，客户端报障时可携带该值精确定位本次请求的全链路日志。
 * trace_id 随后可从 `RequestContext.getTraceId()` 读取，winston 的
 * trace-context format 会自动注入每条日志（业务代码零感知）。
 *
 * P0-01-04 统一请求头：解析 `X-Store-Id` / `X-Client` / `Idempotency-Key`
 * 写入请求上下文（业务代码经 `RequestContext.getStoreId()` 等读取）：
 *  - `X-Store-Id`：门店上下文（与令牌租户上下文互补：租户来自令牌不可传参，门店来自请求头可切换）；
 *  - `X-Client`：客户端类型（web / staff / owner），仅透传记录；
 *  - `Idempotency-Key`：幂等键，基座只解析，去重判定由具体写接口实现。
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: any, res: any, next: () => void) {
    RequestContext.run(() => {
      const headers = req?.headers ?? {};

      // trace_id：请求头优先透传，否则生成
      const incoming = headers["x-trace-id"];
      const traceId =
        typeof incoming === "string" && incoming.trim() !== ""
          ? incoming.trim().slice(0, 64)
          : randomUUID();
      RequestContext.setTraceId(traceId);
      try {
        res?.setHeader?.("X-Trace-Id", traceId);
      } catch {
        // 响应头写入失败不影响主流程（如 SSE 场景头已发出）
      }

      // P0-01-04 统一请求头锚点
      const readHeader = (name: string, maxLen: number): string | null => {
        const value = headers[name];
        if (typeof value !== "string" || value.trim() === "") return null;
        return value.trim().slice(0, maxLen);
      };
      RequestContext.setStoreId(readHeader("x-store-id", 64));
      RequestContext.setClient(readHeader("x-client", 32));
      RequestContext.setIdempotencyKey(readHeader("idempotency-key", 128));

      next();
    });
  }
}
