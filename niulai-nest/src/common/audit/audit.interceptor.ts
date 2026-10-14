import { Injectable, Logger } from "@nestjs/common";
import type { CallHandler, ExecutionContext, NestInterceptor } from "@nestjs/common";
// Reflector 必须值导入：type-only import 不产生运行时值，emitDecoratorMetadata
// 会把构造参数序列化为 Object，DI 无法识别 → APP_INTERCEPTOR 全局注册时解析失败
import { Reflector } from "@nestjs/core";
import type { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { RequestContext } from "../context/request-context";
import { AuditLogService } from "./audit-log.service";
import { AUDIT_METADATA, type AuditMetadata } from "./audit.decorator";

/**
 * 审计拦截器（P0-02-08 · 自动轨）
 *
 * 读取 @Audit() 元数据 + 请求上下文，在下游**成功返回后**异步写审计；
 * 自动轨无 before/after（评估报告 3.4：系统域操作记「谁在何时对什么做了什么」）。
 *
 * 失败策略（有意设计）：写入失败仅 logger.warn，绝不阻断响应——系统域操作
 * 本身在 sys_log 有双份留痕（@Log 轨），不丢线索。
 *
 * ⚠️ 本任务不全局注册（不动 app.module.ts）：全局注册（APP_INTERCEPTOR 或
 * useGlobalInterceptors）随子任务 3「系统域关键操作打点」一起落地；现阶段由
 * 需要的模块 import AuditModule 后 `@UseInterceptors(AuditInterceptor)` 按路由启用。
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly auditLogService: AuditLogService,
    private readonly reflector: Reflector
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") {
      return next.handle();
    }
    const metadata = this.reflector.get<AuditMetadata>(AUDIT_METADATA, context.getHandler());
    if (!metadata) {
      return next.handle();
    }
    return next.handle().pipe(
      tap(() => {
        // fire-and-forget：tap 不等待 promise，审计写入异步进行、不拖慢响应；
        // recordAudit 内部已 catch + warn，此处 catch 仅兜 ALS/同步抛出等意外
        void this.recordAudit(context, metadata).catch(() => {});
      })
    );
  }

  private async recordAudit(context: ExecutionContext, metadata: AuditMetadata): Promise<void> {
    try {
      const req = context.switchToHttp().getRequest();
      const xff = (req.headers?.["x-forwarded-for"] as string) || "";
      const ip = xff.split(",")[0].trim() || req.ip || req.connection?.remoteAddress || null;
      // 锚点（tenantId/userId/traceId/idempotencyKey/storeId）由 AuditLogService
      // 从 RequestContext（ALS）解析；拦截器只补 HTTP 侧的 ip、操作人姓名与对象 ID。
      // entityId 约定：@Audit 打点的接口路径带 :id / :uuid 路由参数（系统域改删授权类
      // 接口的常态）；开关类路由用 :roleId / :userId，批量删除用 :ids（逗号分隔原样
      // 保留，回溯「删了谁」）；以上皆无的路由（如批量导出）落空串——仅作操作留痕，
      // 不供对象回溯。新增打点路由若引入新参数名，在此登记。
      const params = (req.params ?? {}) as Record<string, unknown>;
      const entityId = String(
        params.id ??
          params.uuid ??
          params.entityId ??
          params.userId ??
          params.roleId ??
          params.ids ??
          ""
      );
      await this.auditLogService.record({
        entityType: metadata.entityType,
        entityId,
        action: metadata.action,
        operatorName: RequestContext.getCurrentUser()?.username ?? null,
        ip: ip ?? null,
      });
    } catch (err) {
      this.logger.warn(
        `审计写入失败（自动轨，不阻断响应）: ${metadata.entityType}#${metadata.action} —— ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
}
