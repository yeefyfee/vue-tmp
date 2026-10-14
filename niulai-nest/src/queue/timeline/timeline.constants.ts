/**
 * 宠物时间线异步写入队列 · 常量与载荷（P0-06-07）
 *
 * 与 CROSS-11 `pet-health` 消费器同范式：平台级队列，租户归属由
 * `job.data.tenantId` 承载，消费端经 `RequestContext.run` 恢复租户上下文。
 *
 * 载荷口径：字段全部为「可安全 JSON 序列化」的原始类型（BigInt / Date 在入队前
 * 已字符串化），避免 BullMQ 序列化丢类型（operatorId → string、eventTime → ISO）。
 */

/** 时间线异步写入任务载荷（由 TimelineWriteService.recordAsync 入队） */
export interface TimelineWriteJobData {
  /** 租户快照（消费端 RequestContext 恢复锚点） */
  tenantId: string;
  /** 宠物 id（uuid） */
  petId: string;
  /** 统一事件名（`模块.动作`） */
  eventName: string;
  /** 显式事件类型（缺省由消费端按事件名回落，见 shared） */
  eventType?: number | null;
  /** 事件内容摘要 */
  content?: string | null;
  /** 结构化负载 */
  payload?: Record<string, unknown> | null;
  /** 多态关联对象类型 */
  refType?: string | null;
  /** 多态关联对象 id */
  refId?: string | null;
  /** 操作者类型（缺省由消费端按事件名回落） */
  actorType?: number | null;
  /** 操作人（BigInt 字符串化；NULL=系统） */
  operatorId?: string | null;
  /** 宠主端可见性（缺省由消费端按事件名回落） */
  visibleToOwner?: boolean | null;
  /** 事件时间（ISO 8601 字符串；缺省=消费时刻 now()） */
  eventTime?: string | null;
}
