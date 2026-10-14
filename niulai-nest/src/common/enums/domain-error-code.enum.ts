import { HttpStatus } from "@nestjs/common";

/**
 * 业务域错误码体系（CROSS-13）
 *
 * 与通用层 `error-code.enum.ts`（A/B/C，阿里风格）**并行**的一套业务域错误码：
 *  - **分段**：`1xxxx` 通用 / `2xxxx` 客户宠物 / `3xxxx` 预约订单 / `4xxxx` 支付 / `5xxxx` 寄养照护；
 *    每段预留 999 个码位（段内 `x001~x999`），段基线见 {@link DOMAIN_ERROR_SEGMENTS}。
 *  - **命名**：`域_对象_原因` 大写蛇形（如 `BOOKING_SLOT_CONFLICT`），作为响应信封 `code`
 *    的对外取值；数字 `code` 用于内部归组 / 监控告警。
 *  - **去重边界**：本文件只落「分段规则 + 注册守卫 + 各段代表条目」；各业务模块
 *    （P0-05 客户 / P0-06 宠物 / MVP 预约订单…）落地时在对应段位追加条目，
 *    追加必须走 {@link registerDomainError} 以获得分段与命名冲突检查。
 *
 * 错误信封：`{ code, msg, details? }` —— 字段名保留 `msg`（决策 A4）；
 * `details` 为可选的结构化错误明细（如字段级校验失败列表），由
 * `BusinessException` 第三参携带、`HttpExceptionFilter` 透传。
 */

export interface DomainErrorEntry {
  /** 数字分段错误码（如 30001），段位必须落在对应业务段区间内 */
  readonly code: number;
  /** `域_对象_原因`（大写蛇形），响应信封 `code` 的对外取值 */
  readonly name: string;
  /** 展示文案 */
  readonly msg: string;
  readonly httpStatus: HttpStatus;
}

/** 业务段基线：`[起始码, 结束码]`，闭区间 */
export const DOMAIN_ERROR_SEGMENTS = {
  /** 1xxxx 通用 */
  COMMON: [10000, 19999],
  /** 2xxxx 客户宠物 */
  CUSTOMER_PET: [20000, 29999],
  /** 3xxxx 预约订单 */
  BOOKING_ORDER: [30000, 39999],
  /** 4xxxx 支付 */
  PAYMENT: [40000, 49999],
  /** 5xxxx 寄养照护 */
  STAY_CARE: [50000, 59999],
} as const;

export type DomainErrorSegmentKey = keyof typeof DOMAIN_ERROR_SEGMENTS;

/** 已登记的业务域错误码（`域_对象_原因` → 条目），含启动期防冲突守卫所需全部信息 */
export const DOMAIN_ERROR_REGISTRY = new Map<string, DomainErrorEntry>();

function assertSegment(code: number, segment: readonly [number, number], key: string): void {
  if (code < segment[0] || code > segment[1]) {
    throw new Error(
      `[DomainErrorCode] 错误码 ${code} 不在 ${key} 段 [${segment[0]}, ${segment[1]}] 内`
    );
  }
}

/**
 * 登记一个业务域错误码（模块落地时追加条目的唯一入口）。
 * 冲突（数字码 / 命名重复）直接抛错，把问题拦在启动期而不是线上。
 */
export function registerDomainError(
  segmentKey: DomainErrorSegmentKey,
  entry: DomainErrorEntry
): DomainErrorEntry {
  const segment = DOMAIN_ERROR_SEGMENTS[segmentKey];
  assertSegment(entry.code, segment, segmentKey);
  if (DOMAIN_ERROR_REGISTRY.has(entry.name)) {
    throw new Error(`[DomainErrorCode] 命名冲突：${entry.name} 已登记`);
  }
  for (const existing of DOMAIN_ERROR_REGISTRY.values()) {
    if (existing.code === entry.code) {
      throw new Error(`[DomainErrorCode] 数字码冲突：${entry.code} 已被 ${existing.name} 占用`);
    }
  }
  DOMAIN_ERROR_REGISTRY.set(entry.name, entry);
  return entry;
}

/** 按 `域_对象_原因` 命名取错误条目；未登记返回 undefined（调用方决定兜底语义） */
export function getDomainError(name: string): DomainErrorEntry | undefined {
  return DOMAIN_ERROR_REGISTRY.get(name);
}

// ---------------------------------------------------------------------------
// 各段代表条目（验证分段机制的锚点；业务模块追加自己的条目时不允许与其冲突）
// ---------------------------------------------------------------------------

export const DomainErrorCode = {
  /** 2xxxx 客户宠物 · 代表条目 */
  CUSTOMER_NOT_FOUND: registerDomainError("CUSTOMER_PET", {
    code: 20001,
    name: "CUSTOMER_NOT_FOUND",
    msg: "客户不存在",
    httpStatus: HttpStatus.BAD_REQUEST,
  }),

  /** 3xxxx 预约订单 · 代表条目（任务说明中的示例） */
  BOOKING_SLOT_CONFLICT: registerDomainError("BOOKING_ORDER", {
    code: 30001,
    name: "BOOKING_SLOT_CONFLICT",
    msg: "预约时段冲突",
    httpStatus: HttpStatus.CONFLICT,
  }),

  /**
   * 3xxxx 预约订单 · MVP-WEB-06-05 状态流转。
   *
   * 口径：PRD《Booking API》《预约管理》用**数字码**（30002 / 30003 / 30004）描述
   * 预约域异常；本仓经 CROSS-13 的域错误码体系落成 `域_对象_原因` 命名，
   * 数字码用于内部归组 / 监控（信封 `code` 对外取命名，见 BusinessException 注释）。
   * 30001 即上面已登记的 BOOKING_SLOT_CONFLICT（PRD「confirm 冲突返回 30001」）。
   */
  BOOKING_INVALID_TRANSITION: registerDomainError("BOOKING_ORDER", {
    code: 30002,
    name: "BOOKING_INVALID_TRANSITION",
    msg: "预约状态流转非法",
    httpStatus: HttpStatus.CONFLICT,
  }),
  BOOKING_RESCHEDULE_LIMIT_EXCEEDED: registerDomainError("BOOKING_ORDER", {
    code: 30003,
    name: "BOOKING_RESCHEDULE_LIMIT_EXCEEDED",
    msg: "预约累计改期次数已超限，需店长二次确认",
    httpStatus: HttpStatus.CONFLICT,
  }),
  BOOKING_CANCEL_WINDOW_EXCEEDED: registerDomainError("BOOKING_ORDER", {
    code: 30004,
    name: "BOOKING_CANCEL_WINDOW_EXCEEDED",
    msg: "已超出宠主端可取消的时间窗",
    httpStatus: HttpStatus.CONFLICT,
  }),
  /**
   * 服务已开始 ⇒ 不可取消（PRD《预约管理》BR-3「开始后不可取消，仅可走异常流程」）。
   *
   * 为什么另立 30005 而非复用 30002：状态表要求取消的前置条件是「**服务未开始**」——
   * 一个 `confirmed` 单在开始时刻之后取消，其**状态**本身是允许取消的（pending /
   * confirmed 都在合法来源里），被拒的是**时间前置条件**。若复用 30002（「预约状态
   * 流转非法」），用户会收到一句与实际原因不符的提示；另立一码可给出「服务已开始，
   * 仅可标记爽约或走异常流程」的准确文案。PRD 只点名了 30001~30004 四个场景，
   * 本条属 BR-3 的文字规则，补 30005 不占用既有码位。
   */
  BOOKING_CANCEL_AFTER_START: registerDomainError("BOOKING_ORDER", {
    code: 30005,
    name: "BOOKING_CANCEL_AFTER_START",
    msg: "服务已开始，不可取消（仅可标记爽约或走异常流程）",
    httpStatus: HttpStatus.CONFLICT,
  }),

  /** 4xxxx 支付 · 代表条目 */
  PAYMENT_CHANNEL_ERROR: registerDomainError("PAYMENT", {
    code: 40001,
    name: "PAYMENT_CHANNEL_ERROR",
    msg: "支付渠道异常",
    httpStatus: HttpStatus.BAD_REQUEST,
  }),

  /** 5xxxx 寄养照护 · 代表条目 */
  STAY_ROOM_UNAVAILABLE: registerDomainError("STAY_CARE", {
    code: 50001,
    name: "STAY_ROOM_UNAVAILABLE",
    msg: "寄养房间不可用",
    httpStatus: HttpStatus.CONFLICT,
  }),
} as const;
