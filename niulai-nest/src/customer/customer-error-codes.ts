import { HttpStatus } from "@nestjs/common";

/**
 * 客户域增量错误码（P0-05-04 触达 FR-3 / P0-05-05 黑名单 FR-4 / P0-05-06 生命周期 FR-6）
 *
 * ⚠️ 本轮文件域隔离：仅可改 `src/customer/**`（不改 `src/common/enums/error-code.enum.ts`，
 * 避免与并行域代理互相覆盖）。故本域**新增**码（A0521 起续用；A0501~A0520 已在通用
 * 枚举 `error-code.enum.ts` 占用）就近登记于此文件。
 *
 * 条目形状与通用 `ErrorCode` 完全一致（`{ code, msg, httpStatus }`），
 * `BusinessException` 直接接受；对外响应信封 `code` 即此处字面量。
 * 后续若收敛进通用枚举，逐条平移即可（对外 code 不变，零破坏）。
 */
export const CustomerErrorCode = {
  /** 触达偏好配置不合法（PUT /customers/:id/reach-preferences 入参非法） */
  CUSTOMER_REACH_PREFERENCE_INVALID: {
    code: "A0521",
    msg: "触达偏好配置不合法",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  /** 硬拦截：客户已被列入黑名单（BlacklistService.checkBlocked 抛出） */
  CUSTOMER_BLACKLISTED: {
    code: "A0522",
    msg: "客户已被列入黑名单",
    httpStatus: HttpStatus.CONFLICT,
  },
  /** 黑名单记录不存在 */
  BLACKLIST_NOT_FOUND: {
    code: "A0523",
    msg: "黑名单记录不存在",
    httpStatus: HttpStatus.NOT_FOUND,
  },
  /** 黑名单范围不合法（门店级须指定有效且未软删的门店） */
  BLACKLIST_SCOPE_INVALID: {
    code: "A0524",
    msg: "黑名单范围不合法（门店级须指定有效门店）",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  /** 该客户在此范围已在黑名单生效（重复拉黑） */
  CUSTOMER_BLACKLIST_DUPLICATED: {
    code: "A0525",
    msg: "该客户在此范围已在黑名单生效",
    httpStatus: HttpStatus.CONFLICT,
  },
  /** 客户生命周期取值不合法（service 层防御，DTO @IsIn 已前置拦截） */
  CUSTOMER_LIFECYCLE_INVALID: {
    code: "A0526",
    msg: "客户生命周期取值不合法",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  /** 触达渠道被客户偏好拒绝（渠道明确拒收 / 不在允许白名单内） */
  CUSTOMER_REACH_CHANNEL_REJECTED: {
    code: "A0527",
    msg: "该触达渠道已被客户偏好拒绝",
    httpStatus: HttpStatus.CONFLICT,
  },

  // ── 客户合并（P0-05-07 · FR-7）：A0528 起续用 ──
  /** 被并入的源客户存在在途宠物转移申请（status=1），合并须先处理 */
  CUSTOMER_MERGE_TRANSFER_PENDING: {
    code: "A0528",
    msg: "存在在途宠物转移申请，请先处理",
    httpStatus: HttpStatus.CONFLICT,
  },
  /** 源客户与目标客户为同一档案，禁止自我合并 */
  CUSTOMER_MERGE_SELF: {
    code: "A0529",
    msg: "不能将客户合并到自身",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  /** 源客户不存在 / 已软删 / 已合并归档（跨租户与不存在不可区分，统一此码） */
  CUSTOMER_MERGE_SOURCE_INVALID: {
    code: "A0530",
    msg: "源客户不存在或已归档",
    httpStatus: HttpStatus.NOT_FOUND,
  },
  /** 目标客户不存在 / 已软删 / 已并入他档（保留方须为有效未归档档案） */
  CUSTOMER_MERGE_TARGET_INVALID: {
    code: "A0531",
    msg: "目标客户不存在或已归档",
    httpStatus: HttpStatus.NOT_FOUND,
  },
} as const;
