/**
 * @peluvida/shared —— 状态机与状态映射单测
 *
 * 重点：映射表的 key 与 meta.value 必须一致（防止三端显示错乱），
 * 以及状态流转表只允许合法流转。
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const shared = require("../dist/index.js");

const {
  SEMANTIC_COLORS,
  getStatusMeta,
  toLabelMap,
  canTransitionBooking,
  canTransitionOrder,
  canTransitionRoom,
  canTransitionCareTask,
  BookingStatus,
  BOOKING_STATUS_META,
  OrderStatus,
  ORDER_STATUS_META,
  PaymentStatus,
  PAYMENT_STATUS_META,
  PaymentMethod,
  PAYMENT_METHOD_META,
  PaymentMode,
  PAYMENT_MODE_META,
  StayStatus,
  STAY_STATUS_META,
  RoomStatus,
  ROOM_STATUS_META,
  RoomType,
  ROOM_TYPE_META,
  CareTaskStatus,
  CARE_TASK_STATUS_META,
  CareTaskType,
  CARE_TASK_TYPE_META,
  DEFAULT_DAILY_CARE_TEMPLATE,
  CARE_TASK_PHOTO_REQUIRED_TYPES,
  CARE_TASK_OVERDUE_GRACE_MINUTES,
  buildPermissionCode,
  parsePermissionCode,
  isPermissionCode,
  SystemRoleCode,
  SYSTEM_ROLE_LABEL,
  DataScope,
} = shared;

const MAPS = {
  Booking: BOOKING_STATUS_META,
  Order: ORDER_STATUS_META,
  Payment: PAYMENT_STATUS_META,
  Stay: STAY_STATUS_META,
  Room: ROOM_STATUS_META,
  CareTask: CARE_TASK_STATUS_META,
};

test("语义色板：五个令牌齐备且为合法十六进制", () => {
  assert.deepEqual(Object.keys(SEMANTIC_COLORS).sort(), [
    "danger",
    "info",
    "neutral",
    "success",
    "warning",
  ]);
  for (const [token, value] of Object.entries(SEMANTIC_COLORS)) {
    assert.match(value, /^#[0-9A-F]{6}$/, `${token} 应为大写十六进制色值`);
  }
});

// 独立硬编码的期望表（不复用被测对象自身的数据，避免「同源自证」）
const EXPECTED_STATUS_META = {
  Booking: {
    pending: ["待确认", "warning"],
    confirmed: ["已确认", "info"],
    in_service: ["服务中", "info"],
    completed: ["已完成", "success"],
    cancelled: ["已取消", "neutral"],
    no_show: ["未到店", "danger"],
    rescheduled: ["已改期", "neutral"],
  },
  Order: {
    draft: ["草稿", "neutral"],
    pending_payment: ["待支付", "warning"],
    paid: ["已支付", "info"],
    in_progress: ["进行中", "info"],
    completed: ["已完成", "success"],
    refunded: ["已退款", "danger"],
    closed: ["已关闭", "neutral"],
  },
  Payment: {
    created: ["已创建", "neutral"],
    paying: ["支付中", "warning"],
    success: ["支付成功", "success"],
    failed: ["支付失败", "danger"],
    expired: ["已过期", "neutral"],
    refunding: ["退款中", "warning"],
    refunded: ["已退款", "danger"],
  },
  Stay: {
    booked: ["已预订", "info"],
    checked_in: ["已入住", "info"],
    staying: ["寄养中", "info"],
    checked_out: ["已退房", "success"],
    extended: ["已延期", "warning"],
    early_leave: ["提前退房", "warning"],
    incident: ["异常", "danger"],
  },
  Room: {
    available: ["空闲", "success"],
    occupied: ["占用", "info"],
    cleaning: ["清洁中", "warning"],
    disabled: ["停用", "neutral"],
  },
  CareTask: {
    todo: ["待执行", "neutral"],
    doing: ["执行中", "info"],
    done: ["已完成", "success"],
    skipped: ["已跳过", "neutral"],
    overdue: ["已超时", "danger"],
  },
};

test("状态映射表：结构不变量（value === key、文案非空、颜色令牌合法）", () => {
  const validTokens = new Set(Object.keys(SEMANTIC_COLORS));
  for (const [domain, map] of Object.entries(MAPS)) {
    const keys = Object.keys(map);
    assert.ok(keys.length > 0, `${domain} 映射表不应为空`);
    for (const key of keys) {
      const meta = map[key];
      assert.equal(meta.value, key, `${domain}.${key} 的 value 必须与 key 相同`);
      assert.ok(meta.label.length > 0, `${domain}.${key} 缺少中文文案`);
      assert.ok(validTokens.has(meta.color), `${domain}.${key} 使用了非法颜色令牌 ${meta.color}`);
    }
  }
});

test("状态映射表：与独立期望表逐项对账（文案 + 颜色）", () => {
  for (const [domain, expected] of Object.entries(EXPECTED_STATUS_META)) {
    const map = MAPS[domain];
    assert.deepEqual(
      Object.keys(map).sort(),
      Object.keys(expected).sort(),
      `${domain} 状态集合与期望不一致`
    );
    for (const [key, [label, color]] of Object.entries(expected)) {
      assert.equal(map[key].label, label, `${domain}.${key} 文案不符`);
      assert.equal(map[key].color, color, `${domain}.${key} 颜色不符`);
    }
  }
});

test("状态映射表：覆盖文档定义的全量状态", () => {
  assert.deepEqual(Object.keys(BOOKING_STATUS_META).sort(), [
    "cancelled",
    "completed",
    "confirmed",
    "in_service",
    "no_show",
    "pending",
    "rescheduled",
  ]);
  assert.deepEqual(Object.keys(ORDER_STATUS_META).sort(), [
    "closed",
    "completed",
    "draft",
    "in_progress",
    "paid",
    "pending_payment",
    "refunded",
  ]);
  assert.deepEqual(Object.keys(PAYMENT_STATUS_META).sort(), [
    "created",
    "expired",
    "failed",
    "paying",
    "refunded",
    "refunding",
    "success",
  ]);
  assert.deepEqual(Object.keys(STAY_STATUS_META).sort(), [
    "booked",
    "checked_in",
    "checked_out",
    "early_leave",
    "extended",
    "incident",
    "staying",
  ]);
  assert.deepEqual(Object.keys(ROOM_STATUS_META).sort(), [
    "available",
    "cleaning",
    "disabled",
    "occupied",
  ]);
  assert.deepEqual(Object.keys(CARE_TASK_STATUS_META).sort(), [
    "doing",
    "done",
    "overdue",
    "skipped",
    "todo",
  ]);
});

test("支付方式与支付形态映射齐备", () => {
  assert.deepEqual(Object.keys(PAYMENT_METHOD_META).sort(), [
    "alipay",
    "cash",
    "package",
    "stored_value",
    "wechat",
  ]);
  assert.deepEqual(Object.keys(PAYMENT_MODE_META).sort(), [
    "deposit",
    "full",
    "installment",
    "on_account",
  ]);
  assert.equal(PaymentMethod.WECHAT, "wechat");
  assert.equal(PaymentMode.ON_ACCOUNT, "on_account");
});

test("房间类型 6 类齐备", () => {
  assert.deepEqual(Object.keys(ROOM_TYPE_META).sort(), [
    "cat",
    "dog",
    "kennel",
    "multi",
    "suite",
    "vip",
  ]);
  assert.equal(Object.keys(RoomType).length, 6);
});

test("getStatusMeta / toLabelMap", () => {
  assert.deepEqual(getStatusMeta(BOOKING_STATUS_META, "pending"), {
    value: "pending",
    label: "待确认",
    color: "warning",
  });
  assert.equal(getStatusMeta(BOOKING_STATUS_META, "unknown"), undefined);
  const labels = toLabelMap(ORDER_STATUS_META);
  assert.equal(labels.pending_payment, "待支付");
  assert.equal(labels.completed, "已完成");
});

test("预约状态机：主链路与分支流转", () => {
  assert.equal(canTransitionBooking(BookingStatus.PENDING, BookingStatus.CONFIRMED), true);
  assert.equal(canTransitionBooking(BookingStatus.CONFIRMED, BookingStatus.IN_SERVICE), true);
  assert.equal(canTransitionBooking(BookingStatus.IN_SERVICE, BookingStatus.COMPLETED), true);
  assert.equal(canTransitionBooking(BookingStatus.CONFIRMED, BookingStatus.NO_SHOW), true);
  assert.equal(canTransitionBooking(BookingStatus.CONFIRMED, BookingStatus.RESCHEDULED), true);

  // 非法流转
  assert.equal(canTransitionBooking(BookingStatus.PENDING, BookingStatus.COMPLETED), false);
  assert.equal(canTransitionBooking(BookingStatus.COMPLETED, BookingStatus.IN_SERVICE), false);
  assert.equal(canTransitionBooking(BookingStatus.CANCELLED, BookingStatus.CONFIRMED), false);
});

test("订单状态机：含 closed 分支", () => {
  assert.equal(canTransitionOrder(OrderStatus.DRAFT, OrderStatus.PENDING_PAYMENT), true);
  assert.equal(canTransitionOrder(OrderStatus.PENDING_PAYMENT, OrderStatus.PAID), true);
  assert.equal(canTransitionOrder(OrderStatus.PAID, OrderStatus.IN_PROGRESS), true);
  assert.equal(canTransitionOrder(OrderStatus.IN_PROGRESS, OrderStatus.COMPLETED), true);
  assert.equal(canTransitionOrder(OrderStatus.DRAFT, OrderStatus.CLOSED), true);
  assert.equal(canTransitionOrder(OrderStatus.PENDING_PAYMENT, OrderStatus.CLOSED), true);

  assert.equal(canTransitionOrder(OrderStatus.CLOSED, OrderStatus.PAID), false);
  assert.equal(canTransitionOrder(OrderStatus.DRAFT, OrderStatus.COMPLETED), false);
});

test("房态闭环：occupied → cleaning → available", () => {
  assert.equal(canTransitionRoom(RoomStatus.AVAILABLE, RoomStatus.OCCUPIED), true);
  assert.equal(canTransitionRoom(RoomStatus.OCCUPIED, RoomStatus.CLEANING), true);
  assert.equal(canTransitionRoom(RoomStatus.CLEANING, RoomStatus.AVAILABLE), true);
  // 不允许从占用直接回空闲（必须经清洁）
  assert.equal(canTransitionRoom(RoomStatus.OCCUPIED, RoomStatus.AVAILABLE), false);
});

test("照护任务状态机：超时与跳过分支", () => {
  assert.equal(canTransitionCareTask(CareTaskStatus.TODO, CareTaskStatus.DOING), true);
  assert.equal(canTransitionCareTask(CareTaskStatus.DOING, CareTaskStatus.DONE), true);
  assert.equal(canTransitionCareTask(CareTaskStatus.TODO, CareTaskStatus.OVERDUE), true);
  assert.equal(canTransitionCareTask(CareTaskStatus.OVERDUE, CareTaskStatus.DONE), true);
  assert.equal(canTransitionCareTask(CareTaskStatus.DONE, CareTaskStatus.DOING), false);
  assert.equal(CARE_TASK_OVERDUE_GRACE_MINUTES, 30);
});

test("每日照护任务默认模板：7 类固定时点（文档给定）", () => {
  assert.equal(DEFAULT_DAILY_CARE_TEMPLATE.length, 7);
  assert.deepEqual(
    DEFAULT_DAILY_CARE_TEMPLATE.map((t) => t.time),
    ["07:30", "09:00", "10:00", "12:00", "15:00", "18:00", "21:30"]
  );
  for (const item of DEFAULT_DAILY_CARE_TEMPLATE) {
    assert.ok(CARE_TASK_TYPE_META[item.type], `模板任务类型 ${item.type} 必须在类型映射表中`);
    assert.equal(CARE_TASK_TYPE_META[item.type].label, item.label);
  }
});

test("用药任务强制拍照", () => {
  assert.deepEqual([...CARE_TASK_PHOTO_REQUIRED_TYPES], [CareTaskType.MEDICATION]);
});

test("权限码：组装 / 解析 / 校验", () => {
  assert.equal(buildPermissionCode("order", "order", "create"), "order:order:create");
  assert.deepEqual(parsePermissionCode("pet:timeline:read"), {
    module: "pet",
    resource: "timeline",
    action: "read",
  });
  assert.equal(parsePermissionCode("order:create"), null);
  assert.equal(parsePermissionCode("a:b:c:d"), null);
  assert.equal(parsePermissionCode("::"), null);
  assert.equal(isPermissionCode("booking:booking:cancel"), true);
  assert.equal(isPermissionCode("booking"), false);
  assert.equal(isPermissionCode(123), false);
});

test("预置角色：9 个且文案齐备", () => {
  const codes = Object.values(SystemRoleCode);
  assert.equal(codes.length, 9);
  for (const code of codes) {
    assert.ok(SYSTEM_ROLE_LABEL[code], `角色 ${code} 缺少中文文案`);
  }
  assert.equal(SYSTEM_ROLE_LABEL[SystemRoleCode.STORE_MANAGER], "店长");
  assert.equal(SYSTEM_ROLE_LABEL[SystemRoleCode.BOARDING_STAFF], "寄养员");
});

test("数据范围：三级", () => {
  assert.deepEqual(Object.values(DataScope).sort(), ["all", "self", "store"]);
});
