/**
 * API 相关枚举
 *
 * @description
 * 前端响应码与后端权威枚举 `niulai-nest/src/common/enums/error-code.enum.ts` 严格对齐。
 * 铁律：新增错误码前必须先核对后端枚举 / controller，禁止臆造（踩坑 56）。
 *
 * ## 01-06 收敛记录（全局请求层）
 * - 原 `PERMISSION_DENIED = "A0301"` 为**死码**：后端定义了 `ACCESS_UNAUTHORIZED`，
 *   但全仓无任何抛出点；后端 403 实际返回的是 `A0300`
 *   （`http-exception.filter.ts` 对 `HttpException` FORBIDDEN 的统一映射）。
 *   前端此前按 `A0301` 判定「权限不足」⇒ 该分支**永不命中**（踩坑 57）。
 * - 原 `CHOOSE_TENANT = "A0250"` 后端**不存在** → 删除。
 * - 补齐权限 / 租户域 403 家族（`A0212` / `A0302`~`A0306`）与幂等域（`A0408`/`A0409`/`A0411`）。
 */

/**
 * API 响应码
 *
 * 使用 `as const` 对象而非 `const enum`：可直接用于运行时集合（如 403 码表），
 * 规避 `const enum` 跨模块在打包器下不内联的歧义。
 */
export const ApiCodeEnum = {
  /** 成功 */
  SUCCESS: "00000",

  /** 访问令牌无效或已过期（HTTP 401） */
  ACCESS_TOKEN_INVALID: "A0230",
  /** 刷新令牌无效或已过期（HTTP 401） */
  REFRESH_TOKEN_INVALID: "A0231",

  /** 门店上下文不可用：目标门店不存在 / 不属于当前租户 / 已停用（HTTP 403，fail-closed 防枚举） */
  STORE_CONTEXT_UNAVAILABLE: "A0212",

  /** 访问权限异常（HTTP 403，后端对 FORBIDDEN 的统一映射） */
  ACCESS_PERMISSION_EXCEPTION: "A0300",
  /** 租户上下文缺失（HTTP 403，PEL-11 fail-closed） */
  TENANT_CONTEXT_MISSING: "A0302",
  /** 租户不存在或已停用（HTTP 403） */
  TENANT_NOT_FOUND: "A0303",
  /** 当前租户套餐未包含该能力（HTTP 403） */
  TENANT_CAPABILITY_NOT_INCLUDED: "A0304",
  /** 仅平台账号可操作（HTTP 403） */
  TENANT_PLATFORM_ONLY: "A0305",
  /** 租户已停用，禁止登录（HTTP 403） */
  TENANT_DISABLED: "A0306",

  /** 用户请求参数错误（HTTP 400） */
  USER_REQUEST_PARAMETER_ERROR: "A0400",
  /** 幂等：同 key 首次请求仍在处理中（HTTP 409） */
  IDEMPOTENCY_REQUEST_IN_PROGRESS: "A0408",
  /** 幂等：同 key 被复用于不同请求体（HTTP 409） */
  IDEMPOTENCY_KEY_REUSED: "A0409",
  /** 幂等：强一致写接口缺少 `Idempotency-Key` 请求头（HTTP 400） */
  IDEMPOTENCY_KEY_REQUIRED: "A0411",

  /**
   * 门店域（P0-04-02 · FR-1，`A0420~A0429` 段）
   *
   * 与后端 `error-code.enum.ts` 严格对齐；前端对 `STORE_VERSION_CONFLICT`
   * 有专门的「刷新后重试」文案（PRD《操作流程》§流程通用规则 3 的乐观锁口径）。
   */
  /** 门店编码在租户内已存在（HTTP 409） */
  STORE_CODE_DUPLICATED: "A0422",
  /** 门店数据已被他人修改（HTTP 409，`version` 乐观锁冲突） */
  STORE_VERSION_CONFLICT: "A0423",
  /** 门店不存在（HTTP 404，含已软删） */
  STORE_NOT_FOUND: "A0424",

  /**
   * 房间资源域（P0-04-03 · FR-2，`A0430~A0439` 段）
   *
   * 与后端 `error-code.enum.ts` 严格对齐；`ROOM_VERSION_CONFLICT` 有专门的
   * 「刷新后重试」文案（PRD《操作流程》§流程通用规则 3 的乐观锁口径）。
   */
  /** 房间不存在（HTTP 404，含已软删） */
  ROOM_NOT_FOUND: "A0430",
  /** 房间编号在同门店内已存在（HTTP 409） */
  ROOM_NO_DUPLICATED: "A0431",
  /** 房间数据已被他人修改（HTTP 409，`version` 乐观锁冲突） */
  ROOM_VERSION_CONFLICT: "A0432",
  /** 房态人工切换目标非法（HTTP 400，仅允许空闲 ↔ 维护中） */
  ROOM_STATUS_INVALID: "A0433",
  /** 所属门店不存在或已删除（HTTP 400，创建时校验） */
  ROOM_STORE_INVALID: "A0434",
  /** 房态看板门店不存在（HTTP 404） */
  ROOM_STORE_NOT_FOUND: "A0435",

  /**
   * 门店运营配置域（P0-04-04 · FR-3 / P0-04-05 · FR-4，`A0436~A0439` 段）
   *
   * 与后端 `error-code.enum.ts` 严格对齐。承载每周营业时段（02-03）、门店配置
   * （02-03）与日期级例外日历（02-04）三处校验失败的文案。
   */
  /** 每周营业时段结构非法（HTTP 400，非 7 天键 / 超 3 段 / 时间格式错 / close <= open） */
  STORE_BUSINESS_HOURS_INVALID: "A0436",
  /** 门店配置项非法（HTTP 400，键不在六键白名单或取值越界） */
  STORE_CONFIG_INVALID: "A0437",
  /** 该日期已存在日历记录（HTTP 409，同店同日唯一） */
  STORE_CALENDAR_DATE_DUPLICATED: "A0438",
  /** 日历记录不存在或已删除（HTTP 404，含跨门店/跨租户的不可见记录） */
  STORE_CALENDAR_NOT_FOUND: "A0439",

  /** 系统执行出错 */
  SYSTEM_ERROR: "B0001",

  /** 接口不存在（HTTP 404，后端对 NOT_FOUND 的统一映射） */
  INTERFACE_NOT_EXIST: "C0113",
} as const;

/** 响应码字面量联合类型 */
export type ApiCode = (typeof ApiCodeEnum)[keyof typeof ApiCodeEnum];

/**
 * 权限 / 租户域错误码集合
 *
 * 后端一律以 HTTP 403 + 下列码之一返回；前端统一按「无访问权限」口径处理，
 * 不做逐码分支跳转（避免把租户停用等场景误导向 403 页）。
 */
export const FORBIDDEN_API_CODES: readonly ApiCode[] = [
  ApiCodeEnum.ACCESS_PERMISSION_EXCEPTION,
  ApiCodeEnum.TENANT_CONTEXT_MISSING,
  ApiCodeEnum.TENANT_NOT_FOUND,
  ApiCodeEnum.TENANT_CAPABILITY_NOT_INCLUDED,
  ApiCodeEnum.TENANT_PLATFORM_ONLY,
  ApiCodeEnum.TENANT_DISABLED,
  ApiCodeEnum.STORE_CONTEXT_UNAVAILABLE,
];

/** 幂等域错误码（由统一请求适配器自动注入 `Idempotency-Key`，正常流程不应出现） */
export const IDEMPOTENCY_API_CODES: readonly ApiCode[] = [
  ApiCodeEnum.IDEMPOTENCY_REQUEST_IN_PROGRESS,
  ApiCodeEnum.IDEMPOTENCY_KEY_REUSED,
  ApiCodeEnum.IDEMPOTENCY_KEY_REQUIRED,
];

/** 判定是否为权限 / 租户域错误码（HTTP 403 家族） */
export function isForbiddenApiCode(code: string | undefined): boolean {
  return !!code && (FORBIDDEN_API_CODES as readonly string[]).includes(code);
}
