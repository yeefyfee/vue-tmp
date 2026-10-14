/**
 * @peluvida/shared —— 分页契约单测
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE,
  MAX_PAGE_SIZE,
  PAGE_QUERY_KEY,
  normalizePageQuery,
  buildPageResult,
  isPageResult,
  toOffset,
} = require("../dist/index.js");

test("分页常量：默认值 20 / 上限 100（与 API 约定一致）", () => {
  assert.equal(DEFAULT_PAGE, 1);
  assert.equal(DEFAULT_PAGE_SIZE, 20);
  assert.equal(MAX_PAGE_SIZE, 100);
  assert.deepEqual(PAGE_QUERY_KEY, { page: "page", pageSize: "page_size" });
});

test("normalizePageQuery：缺省回落默认值", () => {
  assert.deepEqual(normalizePageQuery(), { page: 1, page_size: 20 });
  assert.deepEqual(normalizePageQuery({}), { page: 1, page_size: 20 });
});

test("normalizePageQuery：兼容后端历史命名 pageNum / pageSize", () => {
  assert.deepEqual(normalizePageQuery({ pageNum: 3, pageSize: 50 }), { page: 3, page_size: 50 });
  assert.deepEqual(normalizePageQuery({ pageNum: "2", pageSize: "30" }), { page: 2, page_size: 30 });
});

test("normalizePageQuery：page_size 上限截断与非法值回落", () => {
  assert.equal(normalizePageQuery({ page_size: 999 }).page_size, MAX_PAGE_SIZE);
  assert.equal(normalizePageQuery({ page_size: 0 }).page_size, DEFAULT_PAGE_SIZE);
  assert.equal(normalizePageQuery({ page_size: -5 }).page_size, DEFAULT_PAGE_SIZE);
  assert.equal(normalizePageQuery({ page_size: "abc" }).page_size, DEFAULT_PAGE_SIZE);
  assert.equal(normalizePageQuery({ page: -1 }).page, DEFAULT_PAGE);
  assert.equal(normalizePageQuery({ page: 2.7 }).page, 2);
});

test("normalizePageQuery：页码超上限时截断", () => {
  assert.equal(normalizePageQuery({ page: 99999999 }).page, MAX_PAGE);
  assert.equal(normalizePageQuery({ pageNum: 99999999 }).page, MAX_PAGE);
  assert.equal(normalizePageQuery({ page: MAX_PAGE }).page, MAX_PAGE);
  assert.equal(normalizePageQuery({ page: MAX_PAGE + 1 }).page, MAX_PAGE);
});

test("buildPageResult：统一信封 list / total / page / page_size", () => {
  const result = buildPageResult([{ id: 1 }], 42, { page: 2, page_size: 20 });
  assert.deepEqual(result, { list: [{ id: 1 }], total: 42, page: 2, page_size: 20 });
});

test("buildPageResult：非法 total 归零", () => {
  assert.equal(buildPageResult([], -1, { page: 1, page_size: 20 }).total, 0);
  assert.equal(buildPageResult([], NaN, { page: 1, page_size: 20 }).total, 0);
});

test("isPageResult：识别分页信封", () => {
  assert.equal(isPageResult({ list: [], total: 0 }), true);
  assert.equal(isPageResult({ list: [], total: 0, page: 1, page_size: 20 }), true);
  assert.equal(isPageResult({ list: [] }), false);
  assert.equal(isPageResult({ data: [], total: 0 }), false);
  assert.equal(isPageResult(null), false);
  assert.equal(isPageResult([]), false);
});

test("toOffset：推导 SQL 偏移量", () => {
  assert.equal(toOffset({ page: 1, page_size: 20 }), 0);
  assert.equal(toOffset({ page: 3, page_size: 20 }), 40);
});
