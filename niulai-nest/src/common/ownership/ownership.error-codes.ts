import { HttpStatus } from "@nestjs/common";

/**
 * P0-07-03 归属链越权防护基座 —— 域内局部错误码
 *
 * ⚠️ 待 common 归属方收编：本轮的「文件域隔离」约束禁止修改
 * `src/common/enums/*`（error-code.enum.ts / domain-error-code.enum.ts），
 * 因此归属链错误码先落在**本目录局部常量文件**里，暂不注册进
 * `DOMAIN_ERROR_REGISTRY`（避免与共享注册表 / 分段规则产生耦合或冲突）。
 *
 * 命名沿用 CROSS-13 域错误码对外信封口径：`code` 取 `域_对象_原因` 大写蛇形
 * （如 `OWNERSHIP_MISMATCH`），与 `ErrorCode`（A/B/C 数字段）并行、互不占用；
 * `httpStatus` 供 BusinessException 决定 HTTP 状态码。
 *
 * ⤵ 后续收编动作（交 common 归属方）：
 *   - 在 `domain-error-code.enum.ts` 选定分段（建议 COMMON 段 `1xxxx`）落地对应
 *     数字码条目，并将本文件的 `code` 值替换为收编后的 DomainErrorEntry；
 *   - 收编后本文件可退化为「别名层」，或整体删除、由引用方改指 DomainErrorCode。
 */

/** 归属链错误码条目形态（与 `{ code, msg, httpStatus }` 三参 BusinessException 兼容） */
export interface OwnershipErrorCodeEntry {
  /** 响应信封 `code`（域内占位命名，待收编为 DomainErrorCode） */
  readonly code: string;
  /** 展示文案 */
  readonly msg: string;
  /** HTTP 状态码 */
  readonly httpStatus: HttpStatus;
}

/**
 * 归属链错误码集合（域内局部占位，待 common 归属方收编）。
 *
 * 语义约定：
 *  - `ENTITY_ID_REQUIRED` / `ENTITY_TYPE_UNSUPPORTED`：入参/配置错误（400）；
 *  - `ENTITY_NOT_FOUND` / `PET_NOT_FOUND`：scoped 视角下不存在或跨租户（404，
 *    二者不可区分——RLS / 扩展层把跨租户折叠为「不存在」，防资源枚举）；
 *  - `OWNERSHIP_MISMATCH`：归属不匹配（403）；
 *  - `OWNERSHIP_INCONSISTENT`：归属链数据不一致（409）；
 *  - `ACTOR_CUSTOMER_REQUIRED`：需客户身份的操作缺客户上下文（400）。
 */
export const OwnershipErrorCode = {
  /** 缺少归属实体标识（id 为空 / 非法） */
  ENTITY_ID_REQUIRED: {
    code: "OWNERSHIP_ENTITY_ID_REQUIRED",
    msg: "缺少归属实体标识",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  /** 不支持的归属实体类型（未建模 / 未登记映射） */
  ENTITY_TYPE_UNSUPPORTED: {
    code: "OWNERSHIP_ENTITY_TYPE_UNSUPPORTED",
    msg: "不支持的归属实体类型",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  /** 归属实体不存在或不属于当前租户（fail-closed） */
  ENTITY_NOT_FOUND: {
    code: "OWNERSHIP_ENTITY_NOT_FOUND",
    msg: "归属实体不存在或不属于当前租户",
    httpStatus: HttpStatus.NOT_FOUND,
  },
  /** 宠物档案不存在或不属于当前租户（fail-closed） */
  PET_NOT_FOUND: {
    code: "OWNERSHIP_PET_NOT_FOUND",
    msg: "宠物档案不存在或不属于当前租户",
    httpStatus: HttpStatus.NOT_FOUND,
  },
  /** 归属校验失败：当前客户非该宠物主人（越权访问） */
  CUSTOMER_PET_MISMATCH: {
    code: "OWNERSHIP_MISMATCH",
    msg: "归属校验失败：当前客户非该宠物主人",
    httpStatus: HttpStatus.FORBIDDEN,
  },
  /** 归属链数据不一致：存在与权威主人冲突的宠物归属关联 */
  CUSTOMER_PET_INCONSISTENT: {
    code: "OWNERSHIP_INCONSISTENT",
    msg: "归属链不一致：存在冲突的宠物归属关联",
    httpStatus: HttpStatus.CONFLICT,
  },
  /** 需要客户身份的操作缺失客户上下文 */
  ACTOR_CUSTOMER_REQUIRED: {
    code: "OWNERSHIP_ACTOR_CUSTOMER_REQUIRED",
    msg: "缺少操作者客户上下文",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
} as const satisfies Record<string, OwnershipErrorCodeEntry>;

/** 归属链错误码条目的联合类型（供内部签名引用） */
export type OwnershipErrorCodeValue = (typeof OwnershipErrorCode)[keyof typeof OwnershipErrorCode];
