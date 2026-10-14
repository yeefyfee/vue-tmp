/**
 * 宠物时间线 · 统一事件模型（P0-06-06）—— shared 层纯常量 / 纯函数测试
 *
 * 覆盖：TimelineEventType 取值 1~8 冻结、actor_type 取值、事件名常量表完整性、
 * buildTimelineEventName、isKnownTimelineEventName / getTimelineEventNameMeta、
 * resolveTimelineEventType / resolveTimelineActorType / resolveTimelineVisibility
 * 的「显式优先 + 事件名默认 + 兜底」三态逻辑。
 *
 * 运行：node --test test/timeline.test.cjs（依赖先 tsc build 出 dist）
 */
const assert = require("node:assert");
const test = require("node:test");

const {
  TimelineEventType,
  TIMELINE_EVENT_TYPE_VALUES,
  TIMELINE_EVENT_TYPE_NAMES,
  TimelineActorType,
  TIMELINE_ACTOR_TYPE_VALUES,
  TIMELINE_EVENT_NAMES,
  TIMELINE_EVENT_NAME_VALUES,
  TIMELINE_REVISION_EVENT_NAME,
  buildTimelineEventName,
  isKnownTimelineEventName,
  getTimelineEventNameMeta,
  resolveTimelineEventType,
  resolveTimelineActorType,
  resolveTimelineVisibility,
} = require("../dist/index.js");

test("TimelineEventType：取值 1~8 冻结（改值即破坏 DB 列契约）", () => {
  assert.deepStrictEqual(
    { ...TimelineEventType },
    {
      CHECK_IN: 1,
      CHECK_OUT: 2,
      FEEDING: 3,
      GROOMING: 4,
      MEDICAL: 5,
      WEIGHT: 6,
      PHOTO: 7,
      SYSTEM: 8,
    }
  );
  assert.deepStrictEqual([...TIMELINE_EVENT_TYPE_VALUES].sort((a, b) => a - b), [
    1, 2, 3, 4, 5, 6, 7, 8,
  ]);
  assert.strictEqual(TIMELINE_EVENT_TYPE_NAMES[6], "体重");
  assert.strictEqual(TIMELINE_EVENT_TYPE_NAMES[8], "系统");
});

test("TimelineActorType：1 员工 / 2 系统 / 3 宠主", () => {
  assert.deepStrictEqual(
    { ...TimelineActorType },
    { STAFF: 1, SYSTEM: 2, OWNER: 3 }
  );
  assert.deepStrictEqual([...TIMELINE_ACTOR_TYPE_VALUES].sort((a, b) => a - b), [1, 2, 3]);
});

test("TIMELINE_EVENT_NAMES：事件名常量表完整且元数据合法", () => {
  const names = [...TIMELINE_EVENT_NAME_VALUES].sort();
  assert.deepStrictEqual(names, [
    "booking.cancelled",
    "booking.checked_in",
    "booking.completed",
    "booking.confirmed",
    "booking.no_show",
    "booking.rescheduled",
    "booking.started",
    "health.record.created",
    "health.record.updated",
    "pet.created",
    "pet.tags.changed",
    "pet.updated",
    "timeline.event.revised",
    "weight.recorded",
  ]);
  for (const name of TIMELINE_EVENT_NAME_VALUES) {
    const meta = TIMELINE_EVENT_NAMES[name];
    assert.strictEqual(typeof meta.module, "string");
    assert.strictEqual(TIMELINE_EVENT_TYPE_VALUES.includes(meta.eventType), true);
    assert.strictEqual(typeof meta.visibleToOwner, "boolean");
    assert.strictEqual(TIMELINE_ACTOR_TYPE_VALUES.includes(meta.actorType), true);
    assert.strictEqual(typeof meta.description, "string");
    // 事件名以「模块.动作」形态出现，模块段与 meta.module 一致
    assert.strictEqual(name.split(".")[0], meta.module);
  }
  assert.strictEqual(TIMELINE_REVISION_EVENT_NAME, "timeline.event.revised");
});

test("buildTimelineEventName：拼接并归一空白", () => {
  assert.strictEqual(buildTimelineEventName("health", "record.created"), "health.record.created");
  assert.strictEqual(buildTimelineEventName(" pet ", "created"), "pet.created");
});

test("isKnownTimelineEventName / getTimelineEventNameMeta", () => {
  assert.strictEqual(isKnownTimelineEventName("pet.created"), true);
  assert.strictEqual(isKnownTimelineEventName("nope.unknown"), false);
  assert.strictEqual(getTimelineEventNameMeta("pet.created").eventType, TimelineEventType.CHECK_IN);
  assert.strictEqual(getTimelineEventNameMeta("nope.unknown"), undefined);
});

test("resolveTimelineEventType：显式优先 → 事件名默认 → SYSTEM 兜底", () => {
  // 显式合法值优先
  assert.strictEqual(resolveTimelineEventType("pet.created", TimelineEventType.PHOTO), 7);
  // 无显式 → 事件名默认
  assert.strictEqual(resolveTimelineEventType("weight.recorded"), TimelineEventType.WEIGHT);
  assert.strictEqual(resolveTimelineEventType("pet.created"), TimelineEventType.CHECK_IN);
  // 未登记事件名 → SYSTEM
  assert.strictEqual(resolveTimelineEventType("nope.unknown"), TimelineEventType.SYSTEM);
  // 显式非法值 → 回落（不透传脏值）
  assert.strictEqual(resolveTimelineEventType("weight.recorded", 999), TimelineEventType.WEIGHT);
  assert.strictEqual(resolveTimelineEventType("nope.unknown", 0), TimelineEventType.SYSTEM);
});

test("resolveTimelineActorType：显式优先 → 事件名默认 → SYSTEM 兜底", () => {
  assert.strictEqual(resolveTimelineActorType("pet.created"), TimelineActorType.STAFF);
  assert.strictEqual(resolveTimelineActorType("nope.unknown"), TimelineActorType.SYSTEM);
  assert.strictEqual(
    resolveTimelineActorType("pet.created", TimelineActorType.OWNER),
    TimelineActorType.OWNER
  );
  assert.strictEqual(
    resolveTimelineActorType("pet.created", 99),
    TimelineActorType.STAFF
  );
});

test("resolveTimelineVisibility：显式布尔优先 → 事件名默认 → true 兜底", () => {
  // 事件名默认
  assert.strictEqual(resolveTimelineVisibility("pet.created"), true);
  assert.strictEqual(resolveTimelineVisibility("pet.tags.changed"), false);
  // 显式覆盖（含覆盖默认 true 的 false）
  assert.strictEqual(resolveTimelineVisibility("pet.created", false), false);
  assert.strictEqual(resolveTimelineVisibility("pet.tags.changed", true), true);
  // null 视为未指定 → 回落默认
  assert.strictEqual(resolveTimelineVisibility("pet.tags.changed", null), false);
  // 未登记事件名 → 默认可见
  assert.strictEqual(resolveTimelineVisibility("nope.unknown"), true);
});
