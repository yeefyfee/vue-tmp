import { SetMetadata } from "@nestjs/common";
import type { AuditEntityType, AuditAction } from "@peluvida/shared";

/**
 * @Audit 装饰器元数据（P0-02-08 自动轨）
 *
 * 适用场景：系统域关键操作（角色 / 授权 / 菜单 / 配置变更、重置密码等）——
 * 操作者视角完整但业务数据 diff 意义不大，自动轨不写 before/after（评估报告 3.4）。
 * 业务域变更留痕（卡转让 / 代打卡等资金 / 责任场景）不要用装饰器，
 * 走 AuditLogService.record() 显式同事务轨。
 */
export const AUDIT_METADATA = "audit_metadata";

export interface AuditMetadata {
  /** 审计对象类型（合法值域见 @peluvida/shared AuditEntityType） */
  entityType: AuditEntityType;
  /** 审计动作（合法值域见 @peluvida/shared AuditAction） */
  action: AuditAction;
  /**
   * 描述（预留）：当前 audit_log 模型无自由文本列，本轨只记「谁在何时对什么做了什么」，
   * 文本性描述由 sys_log 的 @Log 轨承担，故暂不落库；保留入参是为打点清单（子任务 3）
   * 落地时不必改调用签名。
   */
  description?: string;
}

/** 元数据装饰器：`@Audit({ entityType: AuditEntityType.ROLE, action: AuditAction.GRANT })` */
export const Audit = (metadata: AuditMetadata) => SetMetadata(AUDIT_METADATA, metadata);
