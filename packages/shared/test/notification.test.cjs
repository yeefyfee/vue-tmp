/**
 * 预约通知触发规则单测（MVP-WEB-06-06）
 */
const test = require("node:test");
const assert = require("node:assert");

const {
  BookingAction,
  BookingNotificationScenario,
  NotificationPriority,
  NotificationAudience,
  BOOKING_NOTIFICATION_TRIGGERS,
  getBookingNotificationTrigger,
  shouldNotifyBookingCustomer,
  getBookingNotificationPriority,
  SSE_TOPIC_BOOKING_NOTIFICATION,
} = require("../dist/index.js");

test("BOOKING_NOTIFICATION_TRIGGERS：7 个动作各有一条规则", () => {
  const actions = Object.values(BookingAction);
  assert.strictEqual(actions.length, 7);
  for (const action of actions) {
    assert.ok(BOOKING_NOTIFICATION_TRIGGERS[action], `缺少动作 ${action} 的触发规则`);
  }
});

test("BOOKING_NOTIFICATION_TRIGGERS：场景码与时间线事件名对齐", () => {
  // booking.confirmed / booking.checked_in / booking.started / booking.completed /
  // booking.rescheduled / booking.cancelled / booking.no_show
  const scenarios = Object.values(BookingNotificationScenario);
  assert.strictEqual(scenarios.length, 7);
  assert.ok(scenarios.includes("booking.confirmed"));
  assert.ok(scenarios.includes("booking.no_show"));
});

test("BOOKING_NOTIFICATION_TRIGGERS：取消/爽约是 P0 即时优先级", () => {
  assert.strictEqual(
    BOOKING_NOTIFICATION_TRIGGERS[BookingAction.CANCEL].priority,
    NotificationPriority.P0
  );
  assert.strictEqual(
    BOOKING_NOTIFICATION_TRIGGERS[BookingAction.NO_SHOW].priority,
    NotificationPriority.P0
  );
});

test("BOOKING_NOTIFICATION_TRIGGERS：确认/改期是 P1 常规优先级", () => {
  assert.strictEqual(
    BOOKING_NOTIFICATION_TRIGGERS[BookingAction.CONFIRM].priority,
    NotificationPriority.P1
  );
  assert.strictEqual(
    BOOKING_NOTIFICATION_TRIGGERS[BookingAction.RESCHEDULE].priority,
    NotificationPriority.P1
  );
});

test("BOOKING_NOTIFICATION_TRIGGERS：到店/开始/完成是 P2 静默优先级", () => {
  assert.strictEqual(
    BOOKING_NOTIFICATION_TRIGGERS[BookingAction.CHECKIN].priority,
    NotificationPriority.P2
  );
  assert.strictEqual(
    BOOKING_NOTIFICATION_TRIGGERS[BookingAction.START].priority,
    NotificationPriority.P2
  );
  assert.strictEqual(
    BOOKING_NOTIFICATION_TRIGGERS[BookingAction.COMPLETE].priority,
    NotificationPriority.P2
  );
});

test("shouldNotifyBookingCustomer：取消/爽约/确认/改期/完成通知宠主", () => {
  assert.strictEqual(shouldNotifyBookingCustomer(BookingAction.CANCEL), true);
  assert.strictEqual(shouldNotifyBookingCustomer(BookingAction.NO_SHOW), true);
  assert.strictEqual(shouldNotifyBookingCustomer(BookingAction.CONFIRM), true);
  assert.strictEqual(shouldNotifyBookingCustomer(BookingAction.RESCHEDULE), true);
  assert.strictEqual(shouldNotifyBookingCustomer(BookingAction.COMPLETE), true);
});

test("shouldNotifyBookingCustomer：到店/开始不通知宠主", () => {
  assert.strictEqual(shouldNotifyBookingCustomer(BookingAction.CHECKIN), false);
  assert.strictEqual(shouldNotifyBookingCustomer(BookingAction.START), false);
});

test("getBookingNotificationPriority：未知动作回落 P2", () => {
  assert.strictEqual(getBookingNotificationPriority("unknown-action"), NotificationPriority.P2);
});

test("getBookingNotificationTrigger：未知动作返回 null", () => {
  assert.strictEqual(getBookingNotificationTrigger("unknown-action"), null);
});

test("SSE_TOPIC_BOOKING_NOTIFICATION：常量值稳定", () => {
  assert.strictEqual(SSE_TOPIC_BOOKING_NOTIFICATION, "booking-notification");
});
