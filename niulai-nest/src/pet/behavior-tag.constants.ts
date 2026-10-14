import { HttpStatus } from "@nestjs/common";

/**
 * 行为标签模块常量与域错误码（P0-06-05 · FR-4）
 *
 * ⚠️ 文件域隔离（本轮任务书）：本模块只能改 `src/pet/**`，**禁止**触碰
 * `src/common/**`（含 `enums/error-code.enum.ts`）。因此 A0610~A0612 段在此
 * 以「域局部错误码常量」形式登记：`BusinessException` 的对象分支接受
 * `{ code: string; msg: string; httpStatus?: HttpStatus }`，对外信封 code 与
 * `error-code.enum.ts` 的 A06 段口径完全一致。后续若由 common 归属代理将
 * 这三码收编进 `ErrorCode`，仅需把引用替换为 `ErrorCode.BEHAVIOR_TAG_*`，
 * 线上契约码不变（`IS_PENDING_CONSOLIDATION` 见报告遗留项）。
 *
 * 段位占用：A0601~A0609 已被宠物档案/健康档案/体重曲线占用 → 本轮从 A0610 续增。
 */

/** 行为标签状态（对齐 schema behavior_tag.status：1 启用 / 0 停用） */
export const BehaviorTagStatus = {
  /** 停用（新宠物不可挂，存量关联保留） */
  DISABLED: 0,
  /** 启用 */
  ENABLED: 1,
} as const;

export type BehaviorTagStatusValue = (typeof BehaviorTagStatus)[keyof typeof BehaviorTagStatus];

/** 状态合法值域（DTO @IsIn 与 E2E 断言复用） */
export const BEHAVIOR_TAG_STATUS_VALUES: readonly number[] = [
  BehaviorTagStatus.DISABLED,
  BehaviorTagStatus.ENABLED,
];

/**
 * 行为标签域错误码（A0610~A0612）。
 *
 * 形态与 `ErrorCode` 条目一致（`{ code, msg, httpStatus }`），可直接作为
 * `new BusinessException(BehaviorTagError.XXX)` 的入参。
 */
export const BehaviorTagError = {
  /** 标签名租户内唯一（uk_behavior_tag_tenant_name 应用层前置 + 并发兜底） */
  NAME_DUPLICATED: {
    code: "A0610",
    msg: "行为标签名称已存在",
    httpStatus: HttpStatus.CONFLICT,
  },
  /** 标签不存在 / 已软删 / 跨租户（RLS 下不可区分，统一此码防枚举） */
  NOT_FOUND: {
    code: "A0611",
    msg: "行为标签不存在",
    httpStatus: HttpStatus.NOT_FOUND,
  },
  /** 乐观锁版本冲突 */
  VERSION_CONFLICT: {
    code: "A0612",
    msg: "数据已被他人修改，请刷新后重试",
    httpStatus: HttpStatus.CONFLICT,
  },
} as const;
