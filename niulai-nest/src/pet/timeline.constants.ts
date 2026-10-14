import { HttpStatus } from "@nestjs/common";

/**
 * 宠物时间线域常量与错误码（P0-06-06 / P0-06-07）
 *
 * 事件类型 / 事件名 / 操作者类型 / 可见性规则的**唯一事实源**在
 * `@peluvida/shared`（packages/shared/src/timeline.ts），本文件只登记域内错误码
 * 与「写入点清单」。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Timeline 写入点清单（P0-06-10 交付物；唯一来源 = shared TIMELINE_EVENT_NAMES）
 * ═══════════════════════════════════════════════════════════════════════════
 * 约定：所有写入一律经 `TimelineWriteService.recordSync`（事务内/强一致）或
 *      `TimelineWriteService.recordAsync`（入队异步，最终一致）；**最佳努力**——
 *      时间线写入失败绝不阻断主业务流程（各写入点自行 try/catch + 告警）。
 *
 * | 业务动作         | 事件名                  | eventType | 宠主可见 | 状态        | 当前写入点 / 归属任务                     |
 * |------------------|-------------------------|-----------|----------|-------------|-------------------------------------------|
 * | 宠物档案创建     | pet.created             | 1 入驻    | 是       | ✅ 已接入   | PetService.createPet（P0-06-10）          |
 * | 宠物档案更新     | pet.updated             | 8 系统    | 是       | ⛔ 待接入   | 事件名已登记；如需可在 PetService.updatePet 挂（P0-06-10 后续） |
 * | 行为标签变更     | pet.tags.changed        | 8 系统    | 否       | ✅ 已接入   | BehaviorTagLinkageService.onTagsChanged（P0-06-05/10） |
 * | 健康档案建档     | health.record.created   | 5 医疗    | 是       | ✅ 已接入   | HealthRecordService.createRecord（P0-06-10） |
 * | 健康档案更正     | health.record.updated   | 5 医疗    | 是       | ✅ 已接入   | HealthRecordService.updateRecord（P0-06-10） |
 * | 体重记录         | weight.recorded         | 6 体重    | 是       | ✅ 已接入   | WeightService.appendWeightTimeline（收敛至 SDK，P0-06-10） |
 * | 时间线冲正       | timeline.event.revised  | 8 系统    | 否       | ✅ 已接入   | TimelineService.reviseEvent（P0-06-07）   |
 * | 健康档案删除     | health.record.deleted   | 5 医疗    | 是       | ⛔ 待接入   | P0-06-03 后续（软删留痕；事件名待登记）   |
 * | 体重记录删除     | weight.deleted          | 6 体重    | 是       | ⛔ 待接入   | P0-06-04 后续（软删留痕；事件名待登记）   |
 * | 订单创建/支付/退款 | order.created/paid/refunded | 8 系统 | 视配置 | ⛔ 待接入 | P0-08 订单域（事件名待登记）            |
 * | 预约创建/改约/取消 | booking.*             | 8 系统    | 视配置   | ⛔ 待接入   | P0-08 预约域（事件名待登记）              |
 * | 寄养入住/离店     | stay.checkin/checkout  | 1/2       | 是       | ⛔ 待接入   | P0-08 寄养域（事件名待登记）              |
 * | 宠物照片上传      | photo.uploaded          | 7 照片    | 是       | ⛔ 待接入   | 文件域/宠物域后续（事件名待登记）         |
 *
 * 新增写入点步骤：① 在 shared TIMELINE_EVENT_NAMES 登记事件名（默认 eventType/
 * 可见性/操作者类型）；② 业务服务注入 TimelineWriteService 并 recordSync/recordAsync；
 * ③ 更新本表。未登记事件名仍可写入（兜底 SYSTEM + 可见），但不纳入枚举纪律。
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ 文件域隔离（本轮任务书）：本模块只能改 `src/pet/**`，禁止触碰
 * `src/common/**`（含 `enums/error-code.enum.ts`）。因此时间线错误码在此以
 * 「域局部常量」形式登记：`BusinessException` 的对象分支接受
 * `{ code: string; msg: string; httpStatus?: HttpStatus }`，对外信封 code 与
 * `error-code.enum.ts` 的 A06 段口径完全一致。后续若由 common 归属代理收编进
 * `ErrorCode`，仅需替换引用，线上契约码不变。
 *
 * 段位占用：A0601~A0609 宠物/健康/体重、A0610~A0612 行为标签 → 本轮从 A0613 续增。
 */
export const TimelineError = {
  /** 事件不存在 / 已跨租户（RLS 下不可区分，统一此码防枚举；非法 id 形态亦归此码） */
  EVENT_NOT_FOUND: {
    code: "A0613",
    msg: "时间线事件不存在",
    httpStatus: HttpStatus.NOT_FOUND,
  },
  /** 手工补录时事件名未登记且未显式给出事件类型 */
  EVENT_NAME_INVALID: {
    code: "A0614",
    msg: "事件名未登记，请显式提供 eventType",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
} as const;

/** 多态关联类型：时间线冲正事件 refType 指向的事件表 slug */
export const TIMELINE_REF_TYPE_EVENT = "timeline_event";

/** 手工补录 / 冲正事件默认操作者类型（员工），见 shared TimelineActorType */
export const TIMELINE_DEFAULT_ACTOR_TYPE = 1;

/** 时间线列表默认每页条数 */
export const TIMELINE_DEFAULT_PAGE_SIZE = 20;

/** 时间线列表最大每页条数（防大结果集拖垮响应） */
export const TIMELINE_MAX_PAGE_SIZE = 100;

/** 事件名最大长度（对齐 DB 列 event_name VARCHAR(64)） */
export const TIMELINE_EVENT_NAME_MAX_LENGTH = 64;

/** 多态关联类型最大长度（对齐 DB 列 ref_type VARCHAR(32)） */
export const TIMELINE_REF_TYPE_MAX_LENGTH = 32;

/** 多态关联 id 最大长度（对齐 DB 列 ref_id VARCHAR(64)） */
export const TIMELINE_REF_ID_MAX_LENGTH = 64;
