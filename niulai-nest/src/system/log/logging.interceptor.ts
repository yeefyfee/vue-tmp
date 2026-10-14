import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable, throwError } from "rxjs";
import { catchError, tap } from "rxjs/operators";
import { PrismaService } from "../../common/prisma/prisma.service";
import { toBigInt } from "../../common/prisma/prisma-ids";
import { LOG_MODULE, LogMetadata } from "../../common/decorators/log.decorator";
import { parseUserAgent } from "../../common/utils/user-agent.util";
import { LOG_COLUMN_LIMITS, clampLogText, resolveLogTitle } from "./log.util";

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== "http") {
      return next.handle();
    }

    const now = Date.now();
    const http = context.switchToHttp();
    const req: any = http.getRequest();

    return next.handle().pipe(
      tap(async () => {
        await this.saveLog(context, req, now, null);
      }),
      catchError((err) => {
        this.saveLog(context, req, now, err).catch(() => {});
        return throwError(() => err);
      })
    );
  }

  private async saveLog(context: ExecutionContext, req: any, startTime: number, error: any) {
    try {
      const duration = Date.now() - startTime;
      const userAgent = (req.headers?.["user-agent"] as string) || "";
      const { browser, os } = parseUserAgent(userAgent);

      // 没有 @Log 装饰器的接口不记录日志
      const logMetadata = this.reflector.get<LogMetadata>(LOG_MODULE, context.getHandler());
      if (!logMetadata) return;

      const { module, actionType, title, content } = logMetadata;

      const xff = (req.headers?.["x-forwarded-for"] as string) || "";
      const realIp = xff.split(",")[0].trim();

      await this.prisma.sysLog.create({
        data: {
          module,
          actionType,
          title: clampLogText(
            resolveLogTitle(module, actionType, title),
            LOG_COLUMN_LIMITS.title
          ) as string,
          content: content || null,
          requestMethod: clampLogText(req.method, LOG_COLUMN_LIMITS.requestMethod),
          requestUri: clampLogText(req.originalUrl || req.url, LOG_COLUMN_LIMITS.requestUri),
          ip: clampLogText(
            realIp || req.ip || req.connection?.remoteAddress || null,
            LOG_COLUMN_LIMITS.ip
          ),
          province: null,
          city: null,
          device: clampLogText(os, LOG_COLUMN_LIMITS.device),
          os: clampLogText(os, LOG_COLUMN_LIMITS.os),
          browser: clampLogText(browser, LOG_COLUMN_LIMITS.browser),
          status: error ? 0 : 1,
          errorMsg: clampLogText(error?.message, LOG_COLUMN_LIMITS.errorMsg),
          executionTime: duration,
          operatorId: toBigInt(req.user?.userId),
          operatorName: clampLogText(req.user?.username, LOG_COLUMN_LIMITS.operatorName),
          createTime: new Date(),
        },
      });
    } catch {
      // 日志保存失败不影响主流程
    }
  }
}
