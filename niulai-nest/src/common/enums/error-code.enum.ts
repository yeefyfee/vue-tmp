/**
 * 响应码枚举
 * 00000 正常
 * A**** 用户端错误
 * B**** 系统执行出错
 * C**** 调用第三方服务出错
 */

import { HttpStatus } from "@nestjs/common";

export const ErrorCode = {
  SUCCESS: { code: "00000", msg: "成功", httpStatus: HttpStatus.OK },

  USER_ERROR: { code: "A0001", msg: "用户端错误", httpStatus: HttpStatus.BAD_REQUEST },

  USER_REGISTRATION_ERROR: {
    code: "A0100",
    msg: "用户注册错误",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  USER_NOT_AGREE_PRIVACY_AGREEMENT: {
    code: "A0101",
    msg: "用户未同意隐私协议",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  VERIFICATION_CODE_INPUT_ERROR: {
    code: "A0130",
    msg: "校验码输入错误",
    httpStatus: HttpStatus.BAD_REQUEST,
  },

  USER_LOGIN_EXCEPTION: { code: "A0200", msg: "用户登录异常", httpStatus: HttpStatus.BAD_REQUEST },
  ACCOUNT_NOT_FOUND: { code: "A0201", msg: "用户账户不存在", httpStatus: HttpStatus.BAD_REQUEST },
  ACCOUNT_FROZEN: { code: "A0202", msg: "用户账户被冻结", httpStatus: HttpStatus.BAD_REQUEST },
  USER_PASSWORD_ERROR: {
    code: "A0210",
    msg: "用户名或密码错误",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  LOGIN_ATTEMPT_LIMIT_EXCEEDED: {
    code: "A0211",
    msg: "登录失败次数过多，账户已临时锁定",
    httpStatus: HttpStatus.BAD_REQUEST,
  },

  // 门店上下文切换（P0-02-06）：目标门店不存在 / 不属于当前租户 / 已停用，
  // 统一 fail-closed 拒绝（不区分具体原因，防门店枚举探测）
  STORE_CONTEXT_UNAVAILABLE: {
    code: "A0212",
    msg: "目标门店不存在、不属于当前租户或已停用",
    httpStatus: HttpStatus.FORBIDDEN,
  },

  ACCESS_TOKEN_INVALID: {
    code: "A0230",
    msg: "访问令牌无效或已过期",
    httpStatus: HttpStatus.UNAUTHORIZED,
  },
  REFRESH_TOKEN_INVALID: {
    code: "A0231",
    msg: "刷新令牌无效或已过期",
    httpStatus: HttpStatus.UNAUTHORIZED,
  },

  USER_VERIFICATION_CODE_ERROR: {
    code: "A0240",
    msg: "验证码错误",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  USER_VERIFICATION_CODE_ATTEMPT_LIMIT_EXCEEDED: {
    code: "A0241",
    msg: "用户验证码尝试次数超限",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  USER_VERIFICATION_CODE_EXPIRED: {
    code: "A0242",
    msg: "用户验证码过期",
    httpStatus: HttpStatus.BAD_REQUEST,
  },

  ACCESS_PERMISSION_EXCEPTION: {
    code: "A0300",
    msg: "访问权限异常",
    httpStatus: HttpStatus.FORBIDDEN,
  },
  ACCESS_UNAUTHORIZED: { code: "A0301", msg: "访问未授权", httpStatus: HttpStatus.UNAUTHORIZED },

  // 租户隔离（PEL-11）：上下文缺失一律 fail-closed
  TENANT_CONTEXT_MISSING: {
    code: "A0302",
    msg: "租户上下文缺失，已拒绝访问",
    httpStatus: HttpStatus.FORBIDDEN,
  },
  TENANT_NOT_FOUND: {
    code: "A0303",
    msg: "租户不存在或已停用",
    httpStatus: HttpStatus.FORBIDDEN,
  },
  TENANT_CAPABILITY_NOT_INCLUDED: {
    code: "A0304",
    msg: "当前租户套餐未包含该能力",
    httpStatus: HttpStatus.FORBIDDEN,
  },
  // 租户管理（P0-03-04）：平台侧接口拒绝带租户上下文的账号（防租户 ROOT 自改套餐）
  TENANT_PLATFORM_ONLY: {
    code: "A0305",
    msg: "仅平台账号可操作",
    httpStatus: HttpStatus.FORBIDDEN,
  },
  // 登录链路租户状态闭环（P0-03-04 挂账增量）：平台停用的租户禁止其用户登录/刷新
  TENANT_DISABLED: {
    code: "A0306",
    msg: "租户已停用，禁止登录",
    httpStatus: HttpStatus.FORBIDDEN,
  },

  USER_REQUEST_PARAMETER_ERROR: {
    code: "A0400",
    msg: "用户请求参数错误",
    httpStatus: HttpStatus.BAD_REQUEST,
  },

  // 门店档案（P0-04-02）：资源状态类业务错误（A0422~A0424 段内新增）
  STORE_CODE_DUPLICATED: {
    code: "A0422",
    msg: "门店编码已存在",
    httpStatus: HttpStatus.CONFLICT,
  },
  STORE_VERSION_CONFLICT: {
    code: "A0423",
    msg: "数据已被他人修改，请刷新后重试",
    httpStatus: HttpStatus.CONFLICT,
  },
  STORE_NOT_FOUND: {
    code: "A0424",
    msg: "门店不存在",
    httpStatus: HttpStatus.NOT_FOUND,
  },

  // 房间资源（P0-04-03 · FR-2）：A0430~A0439 段
  ROOM_NOT_FOUND: {
    code: "A0430",
    msg: "房间不存在",
    httpStatus: HttpStatus.NOT_FOUND,
  },
  ROOM_NO_DUPLICATED: {
    code: "A0431",
    msg: "房间编号已存在",
    httpStatus: HttpStatus.CONFLICT,
  },
  ROOM_VERSION_CONFLICT: {
    code: "A0432",
    msg: "数据已被他人修改，请刷新后重试",
    httpStatus: HttpStatus.CONFLICT,
  },
  ROOM_STATUS_INVALID: {
    code: "A0433",
    msg: "仅允许在空闲(1)与维护中(4)之间切换房态",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  ROOM_STORE_INVALID: {
    code: "A0434",
    msg: "所属门店不存在或已删除",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  ROOM_STORE_NOT_FOUND: {
    code: "A0435",
    msg: "门店不存在",
    httpStatus: HttpStatus.NOT_FOUND,
  },

  // 门店营业时间 / 门店配置 / 门店日历（P0-04-04 · FR-3 / P0-04-05 · FR-4）：A0436~A0439 段
  STORE_BUSINESS_HOURS_INVALID: {
    code: "A0436",
    msg: "每周营业时段格式不合法",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  STORE_CONFIG_INVALID: {
    code: "A0437",
    msg: "门店配置项不合法",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  STORE_CALENDAR_DATE_DUPLICATED: {
    code: "A0438",
    msg: "该日期已存在日历记录",
    httpStatus: HttpStatus.CONFLICT,
  },
  STORE_CALENDAR_NOT_FOUND: {
    code: "A0439",
    msg: "日历记录不存在",
    httpStatus: HttpStatus.NOT_FOUND,
  },

  // 客户域（P0-05-01 / P0-05-02 萌主档案 FR-1）：A05 段（A0501 起；
  // A0500/A0502/A0506 已被「用户请求服务异常」通用码占用，跳用 A0510+ 段）
  CUSTOMER_MOBILE_DUPLICATED: {
    code: "A0501",
    msg: "该手机号已存在客户档案",
    httpStatus: HttpStatus.CONFLICT,
  },
  CUSTOMER_NOT_FOUND: {
    code: "A0510",
    msg: "客户档案不存在",
    httpStatus: HttpStatus.NOT_FOUND,
  },
  CUSTOMER_VERSION_CONFLICT: {
    code: "A0511",
    msg: "数据已被他人修改，请刷新后重试",
    httpStatus: HttpStatus.CONFLICT,
  },
  CUSTOMER_STORE_INVALID: {
    code: "A0512",
    msg: "归属门店不存在或已删除",
    httpStatus: HttpStatus.BAD_REQUEST,
  },

  // 客户-宠物归属 / 转移审批（P0-05-03 · FR-2）：A0513+ 段续增
  PET_TRANSFER_NOT_FOUND: {
    code: "A0513",
    msg: "转移申请不存在",
    httpStatus: HttpStatus.NOT_FOUND,
  },
  // 绑定宠物时该宠物已归属其他客户（未审批不可变更归属 → 引导走转移申请）
  PET_BINDING_CONFLICT: {
    code: "A0514",
    msg: "该宠物已归属其他客户，请发起转移申请",
    httpStatus: HttpStatus.CONFLICT,
  },
  // 同一宠物同时仅允许一条待审批转移申请（应用层查重 + 部分唯一索引并发兜底）
  PET_TRANSFER_ALREADY_PENDING: {
    code: "A0515",
    msg: "该宠物已有在途转移申请，请勿重复发起",
    httpStatus: HttpStatus.CONFLICT,
  },
  // 转移申请状态机：仅允许 1→2/3/4 的合法跃迁，其余一律拒绝
  PET_TRANSFER_STATUS_INVALID: {
    code: "A0516",
    msg: "转移申请当前状态不允许此操作",
    httpStatus: HttpStatus.CONFLICT,
  },
  PET_TRANSFER_TARGET_INVALID: {
    code: "A0517",
    msg: "目标客户不存在或不属于当前租户",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  PET_TRANSFER_SELF: {
    code: "A0518",
    msg: "不能将宠物转移给当前主人",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  // 归属变更须经审批流，禁止直接解绑当前归属关联（保持 ownerCustomerId 与关联强一致）
  PET_UNBIND_FORBIDDEN: {
    code: "A0519",
    msg: "归属变更须经转移申请审批，禁止直接解绑",
    httpStatus: HttpStatus.CONFLICT,
  },
  PET_BINDING_NOT_FOUND: {
    code: "A0520",
    msg: "宠物归属关联不存在",
    httpStatus: HttpStatus.NOT_FOUND,
  },

  // 宠物域（P0-06-01 / P0-06-02 宠物档案 FR-1）：A06 段（A0601 起；
  // A0600 与 A05 段同因「通用异常码」惯例预留，跳用 A0601+）
  PET_NOT_FOUND: {
    code: "A0601",
    msg: "宠物档案不存在",
    httpStatus: HttpStatus.NOT_FOUND,
  },
  PET_VERSION_CONFLICT: {
    code: "A0602",
    msg: "数据已被他人修改，请刷新后重试",
    httpStatus: HttpStatus.CONFLICT,
  },
  // 主人客户不存在 / 已软删 / 跨租户（RLS 下跨租户与不存在不可区分，统一 A0603）
  PET_OWNER_INVALID: {
    code: "A0603",
    msg: "主人客户档案不存在或不属于当前租户",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  PET_STORE_INVALID: {
    code: "A0604",
    msg: "归属门店不存在或已删除",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  PET_BEHAVIOR_TAG_INVALID: {
    code: "A0605",
    msg: "行为标签不存在或不属于当前租户",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  // 健康档案 / 体重曲线（P0-06-03 FR-2 / P0-06-04 FR-3）：A0606 起顺延
  HEALTH_RECORD_NOT_FOUND: {
    code: "A0606",
    msg: "健康档案记录不存在",
    httpStatus: HttpStatus.NOT_FOUND,
  },
  WEIGHT_RECORD_NOT_FOUND: {
    code: "A0607",
    msg: "体重记录不存在",
    httpStatus: HttpStatus.NOT_FOUND,
  },
  HEALTH_RECORD_DATE_INVALID: {
    code: "A0608",
    msg: "健康档案日期不合法（到期日不得早于记录日）",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  HEALTH_RECORD_VERSION_CONFLICT: {
    code: "A0609",
    msg: "数据已被他人修改，请刷新后重试",
    httpStatus: HttpStatus.CONFLICT,
  },

  // 总部-门店两级管理（P0-04-06 · FR-5 骨架）：A0440 段
  STORE_BATCH_DISPATCH_INVALID: {
    code: "A0440",
    msg: "批量下发请求不合法（storeIds 为空或未提供任何配置键）",
    httpStatus: HttpStatus.BAD_REQUEST,
  },

  // 预约域（P0-08-05；MVP-WEB-06-01 预约列表与状态展示）：A08 段（A0801 起）
  // 注：A07 段已被媒体域（A0700/A0710/A0711~A0719）占用 ⇒ 预约域自 A0801 起独立段。
  BOOKING_NOT_FOUND: {
    code: "A0801",
    msg: "预约不存在",
    httpStatus: HttpStatus.NOT_FOUND,
  },
  // 预约创建（MVP-WEB-06-02）：关联对象引用校验失败一律 400（对齐 ROOM_STORE_INVALID 口径）
  BOOKING_STORE_INVALID: {
    code: "A0802",
    msg: "门店不存在或不可用",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  BOOKING_PET_INVALID: {
    code: "A0803",
    msg: "宠物档案不存在或不可用",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  BOOKING_SERVICE_INVALID: {
    code: "A0804",
    msg: "服务项不存在或已停用",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  // 寄养类（cat_type=3）预约必须指定房间（PRD《Booking API》room_id「条件」）
  BOOKING_ROOM_REQUIRED: {
    code: "A0805",
    msg: "寄养类预约必须指定房间",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  BOOKING_ROOM_INVALID: {
    code: "A0806",
    msg: "房间不存在或不属于所选门店",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  BOOKING_EMPLOYEE_INVALID: {
    code: "A0807",
    msg: "员工不存在或不在职",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  BOOKING_TIME_INVALID: {
    code: "A0808",
    msg: "预约时间格式非法",
    httpStatus: HttpStatus.BAD_REQUEST,
  },

  // 统一请求适配器 · 幂等（P0-07-01）：A0408~A0411 段（未占用码）
  // 并发同 key 且首次请求仍在处理中：拒绝第二次以免穿透到 handler
  IDEMPOTENCY_REQUEST_IN_PROGRESS: {
    code: "A0408",
    msg: "请求处理中，请稍后重试",
    httpStatus: HttpStatus.CONFLICT,
  },
  // 同 key 复用于不同请求体：幂等键误用，拒绝以保护业务语义
  IDEMPOTENCY_KEY_REUSED: {
    code: "A0409",
    msg: "幂等键已用于不同的请求",
    httpStatus: HttpStatus.CONFLICT,
  },
  // @Idempotent({ required: true }) 的强一致写接口缺失幂等键
  IDEMPOTENCY_KEY_REQUIRED: {
    code: "A0411",
    msg: "缺少 Idempotency-Key 请求头",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  INVALID_USER_INPUT: { code: "A0402", msg: "无效的用户输入", httpStatus: HttpStatus.BAD_REQUEST },
  REQUEST_REQUIRED_PARAMETER_IS_EMPTY: {
    code: "A0410",
    msg: "请求必填参数为空",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  PARAMETER_FORMAT_MISMATCH: {
    code: "A0421",
    msg: "参数格式不匹配",
    httpStatus: HttpStatus.BAD_REQUEST,
  },

  USER_REQUEST_SERVICE_EXCEPTION: {
    code: "A0500",
    msg: "用户请求服务异常",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  REQUEST_CONCURRENCY_LIMIT_EXCEEDED: {
    code: "A0502",
    msg: "请求并发数超出限制",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  DUPLICATE_SUBMISSION: { code: "A0506", msg: "请勿重复提交", httpStatus: HttpStatus.BAD_REQUEST },

  UPLOAD_FILE_EXCEPTION: { code: "A0700", msg: "上传文件异常", httpStatus: HttpStatus.BAD_REQUEST },
  DELETE_FILE_EXCEPTION: { code: "A0710", msg: "删除文件异常", httpStatus: HttpStatus.BAD_REQUEST },

  // 订单域（MVP-WEB-07-02 订单详情四页签 / 07-03 订单生成与组合明细）：A09 段（A0901 起）
  // 注：A07 段=媒体、A08 段=预约 ⇒ 订单域自 A0901 起独立段。
  ORDER_NOT_FOUND: {
    code: "A0901",
    msg: "订单不存在",
    httpStatus: HttpStatus.NOT_FOUND,
  },
  ORDER_STORE_INVALID: {
    code: "A0902",
    msg: "门店不存在或已停用",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  ORDER_CUSTOMER_INVALID: {
    code: "A0903",
    msg: "客户不存在",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  ORDER_PET_INVALID: {
    code: "A0904",
    msg: "宠物不存在",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  ORDER_ITEMS_EMPTY: {
    code: "A0905",
    msg: "订单明细不能为空",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  ORDER_SERVICE_INVALID: {
    code: "A0906",
    msg: "服务项不存在或已停用",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  ORDER_STATUS_NOT_EDITABLE: {
    code: "A0907",
    msg: "当前订单状态不允许编辑",
    httpStatus: HttpStatus.CONFLICT,
  },
  ORDER_STATUS_NOT_DELETABLE: {
    code: "A0908",
    msg: "当前订单状态不允许删除",
    httpStatus: HttpStatus.CONFLICT,
  },
  ORDER_VERSION_CONFLICT: {
    code: "A0909",
    msg: "订单版本已变更，请刷新后重试",
    httpStatus: HttpStatus.CONFLICT,
  },
  ORDER_DISCOUNT_EXCEEDS_TOTAL: {
    code: "A0910",
    msg: "优惠金额不得超过订单总额",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  // 履约联动（MVP-WEB-07-05）：开始服务仅 paid、完成服务仅 in_progress；
  // 其余状态一律拒绝（非法跃迁），不裸 500。
  ORDER_FULFILL_TRANSITION_INVALID: {
    code: "A0911",
    msg: "当前订单状态不允许该履约操作",
    httpStatus: HttpStatus.CONFLICT,
  },
  // 订单关闭（MVP-WEB-07-06）：手动关闭仅 pending_payment（A0912），
  // 其余状态一律拒绝（终态 / 已支付不可关闭），不裸 500。
  ORDER_CLOSE_INVALID: {
    code: "A0912",
    msg: "当前订单状态不允许关闭",
    httpStatus: HttpStatus.CONFLICT,
  },

  SYSTEM_ERROR: { code: "B0001", msg: "系统执行出错", httpStatus: HttpStatus.BAD_REQUEST },
  SYSTEM_EXECUTION_TIMEOUT: {
    code: "B0100",
    msg: "系统执行超时",
    httpStatus: HttpStatus.BAD_REQUEST,
  },

  THIRD_PARTY_SERVICE_ERROR: {
    code: "C0001",
    msg: "调用第三方服务出错",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  INTERFACE_NOT_EXIST: { code: "C0113", msg: "接口不存在", httpStatus: HttpStatus.NOT_FOUND },
  DATABASE_SERVICE_ERROR: {
    code: "C0300",
    msg: "数据库服务出错",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  DATABASE_EXECUTION_SYNTAX_ERROR: {
    code: "C0313",
    msg: "数据库执行语法错误",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  INTEGRITY_CONSTRAINT_VIOLATION: {
    code: "C0342",
    msg: "违反了完整性约束",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  DATABASE_ACCESS_DENIED: {
    code: "C0351",
    msg: "当前环境禁止数据库写入",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
} as const;
