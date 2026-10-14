/**
 * 媒体 / 附件域（P0-08）—— shared 层纯常量 / 纯函数测试
 *
 * 覆盖：MediaType / MediaUploadStatus / StorageDriver / MediaRefType 取值冻结、
 * 常量约束、isImageMime / resolveMediaType、sanitizeFileExtension / inferExtension、
 * buildMediaObjectKey、fitDimensions / computeWatermarkRect、canAddMedia / remainingMediaQuota。
 *
 * 运行：node --test test/media.test.cjs（依赖先 tsc build 出 dist）
 */
const assert = require("node:assert");
const test = require("node:test");

const {
  MediaType,
  MEDIA_TYPE_VALUES,
  MEDIA_TYPE_NAMES,
  MediaUploadStatus,
  MEDIA_UPLOAD_STATUS_VALUES,
  StorageDriver,
  STORAGE_DRIVER_VALUES,
  MediaRefType,
  MEDIA_REF_TYPES,
  isKnownMediaRefType,
  MEDIA_MAX_PER_ENTITY,
  MEDIA_REF_TYPE_MAX_LENGTH,
  MEDIA_REF_ID_MAX_LENGTH,
  MEDIA_DEFAULT_THUMBNAIL_MAX_EDGE,
  isImageMime,
  isVideoMime,
  resolveMediaType,
  isImageMedia,
  sanitizeFileExtension,
  inferExtension,
  buildMediaObjectKey,
  fitDimensions,
  computeWatermarkRect,
  MediaWatermarkPosition,
  canAddMedia,
  remainingMediaQuota,
} = require("../dist/index.js");

test("MediaType：取值 1/2/3/9 冻结", () => {
  assert.deepStrictEqual({ ...MediaType }, { IMAGE: 1, VIDEO: 2, DOCUMENT: 3, OTHER: 9 });
  assert.deepStrictEqual([...MEDIA_TYPE_VALUES].sort((a, b) => a - b), [1, 2, 3, 9]);
  assert.strictEqual(MEDIA_TYPE_NAMES[1], "图片");
  assert.strictEqual(MEDIA_TYPE_NAMES[9], "其他");
});

test("MediaUploadStatus：1 pending / 2 confirmed", () => {
  assert.deepStrictEqual({ ...MediaUploadStatus }, { PENDING: 1, CONFIRMED: 2 });
  assert.deepStrictEqual([...MEDIA_UPLOAD_STATUS_VALUES].sort((a, b) => a - b), [1, 2]);
});

test("StorageDriver：local / memory / s3 / oss", () => {
  assert.deepStrictEqual(
    { ...StorageDriver },
    { LOCAL: "local", MEMORY: "memory", S3: "s3", OSS: "oss" }
  );
  assert.deepStrictEqual([...STORAGE_DRIVER_VALUES].sort(), ["local", "memory", "oss", "s3"]);
});

test("MediaRefType：已登记多态关联类型 + isKnownMediaRefType", () => {
  assert.strictEqual(MediaRefType.PET, "pet");
  assert.strictEqual(MediaRefType.HEALTH_RECORD, "health_record");
  assert.ok(MEDIA_REF_TYPES.includes("pet"));
  assert.strictEqual(isKnownMediaRefType("pet"), true);
  assert.strictEqual(isKnownMediaRefType("nope"), false);
});

test("常量约束：9 张上限 / 列长度 / 缩略图最长边", () => {
  assert.strictEqual(MEDIA_MAX_PER_ENTITY, 9);
  assert.strictEqual(MEDIA_REF_TYPE_MAX_LENGTH, 32);
  assert.strictEqual(MEDIA_REF_ID_MAX_LENGTH, 64);
  assert.strictEqual(MEDIA_DEFAULT_THUMBNAIL_MAX_EDGE, 320);
});

test("isImageMime / isVideoMime：大小写与空白归一", () => {
  assert.strictEqual(isImageMime("image/png"), true);
  assert.strictEqual(isImageMime(" IMAGE/JPEG "), true);
  assert.strictEqual(isImageMime("video/mp4"), false);
  assert.strictEqual(isImageMime(null), false);
  assert.strictEqual(isVideoMime("video/mp4"), true);
  assert.strictEqual(isVideoMime("image/png"), false);
});

test("resolveMediaType：显式优先 → MIME 前缀 → OTHER", () => {
  assert.strictEqual(resolveMediaType("image/png"), MediaType.IMAGE);
  assert.strictEqual(resolveMediaType("video/mp4"), MediaType.VIDEO);
  assert.strictEqual(resolveMediaType("application/pdf"), MediaType.DOCUMENT);
  assert.strictEqual(resolveMediaType(""), MediaType.OTHER);
  assert.strictEqual(resolveMediaType(null), MediaType.OTHER);
  // 显式合法值优先于 MIME
  assert.strictEqual(resolveMediaType("image/png", MediaType.DOCUMENT), MediaType.DOCUMENT);
  // 显式非法值回落
  assert.strictEqual(resolveMediaType("image/png", 999), MediaType.IMAGE);
  assert.strictEqual(isImageMedia(MediaType.IMAGE), true);
  assert.strictEqual(isImageMedia(MediaType.VIDEO), false);
});

test("sanitizeFileExtension / inferExtension", () => {
  assert.strictEqual(sanitizeFileExtension("a.PNG"), "png");
  assert.strictEqual(sanitizeFileExtension("photo.jpeg"), "jpeg");
  assert.strictEqual(sanitizeFileExtension("noext"), "");
  assert.strictEqual(sanitizeFileExtension("bad.ext!"), "");
  assert.strictEqual(sanitizeFileExtension("trailing."), "");
  assert.strictEqual(sanitizeFileExtension(null), "");
  assert.strictEqual(inferExtension("image/webp"), "webp");
  assert.strictEqual(inferExtension("application/octet-stream", "x/photo.gif"), "gif");
  assert.strictEqual(inferExtension("application/octet-stream"), "");
});

test("buildMediaObjectKey：分层 + 扩展名 + 片段清洗（防路径穿越）", () => {
  const key = buildMediaObjectKey({
    refType: "pet",
    tenantId: "1",
    refId: "11111111-1111-4111-8111-111111111111",
    mediaId: "22222222-2222-4222-8222-222222222222",
    extension: "png",
  });
  assert.strictEqual(
    key,
    "media/pet/1/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.png"
  );
  // 非法片段（含 ../）被清洗为安全字符
  const evil = buildMediaObjectKey({
    refType: "../pet",
    tenantId: "1",
    refId: "a/../../b",
    mediaId: "m",
    extension: "php",
  });
  assert.ok(!evil.includes(".."));
  assert.ok(!evil.includes("//"));
  assert.ok(evil.startsWith("media/"));
  // 无扩展名时不追加点
  const noExt = buildMediaObjectKey({ refType: "pet", tenantId: 1, refId: "r", mediaId: "m" });
  assert.strictEqual(noExt, "media/pet/1/r/m");
});

test("fitDimensions：等比缩放且不放大", () => {
  // 小图不放大
  assert.deepStrictEqual(fitDimensions(100, 80, 320), { width: 100, height: 80, scale: 1 });
  // 横向大图缩到最长边 320
  const wide = fitDimensions(1000, 500, 320);
  assert.strictEqual(wide.width, 320);
  assert.strictEqual(wide.height, 160);
  // 纵向大图
  const tall = fitDimensions(400, 1200, 300);
  assert.strictEqual(tall.height, 300);
  assert.strictEqual(tall.width, 100);
  // 非法尺寸
  assert.deepStrictEqual(fitDimensions(0, 0, 320), { width: 0, height: 0, scale: 1 });
});

test("computeWatermarkRect：各位置摆放 + 越界收敛", () => {
  const base = { canvasWidth: 1000, canvasHeight: 800, markWidth: 200, markHeight: 100 };
  assert.deepStrictEqual(computeWatermarkRect({ ...base, position: MediaWatermarkPosition.BOTTOM_RIGHT }), {
    x: 788,
    y: 688,
  });
  assert.deepStrictEqual(computeWatermarkRect({ ...base, position: MediaWatermarkPosition.TOP_LEFT }), {
    x: 12,
    y: 12,
  });
  assert.deepStrictEqual(computeWatermarkRect({ ...base, position: MediaWatermarkPosition.TOP_RIGHT }), {
    x: 788,
    y: 12,
  });
  assert.deepStrictEqual(computeWatermarkRect({ ...base, position: MediaWatermarkPosition.BOTTOM_LEFT }), {
    x: 12,
    y: 688,
  });
  // 画布小于水印 → 坐标收敛为 0（不为负）
  const tiny = computeWatermarkRect({
    canvasWidth: 50,
    canvasHeight: 40,
    markWidth: 200,
    markHeight: 100,
    position: MediaWatermarkPosition.BOTTOM_RIGHT,
  });
  assert.deepStrictEqual(tiny, { x: 0, y: 0 });
});

test("canAddMedia / remainingMediaQuota：最多 9 张", () => {
  assert.strictEqual(canAddMedia(0, 1), true);
  assert.strictEqual(canAddMedia(8, 1), true);
  assert.strictEqual(canAddMedia(9, 1), false);
  assert.strictEqual(canAddMedia(9, 0), true);
  assert.strictEqual(canAddMedia(5, 4), true);
  assert.strictEqual(canAddMedia(5, 5), false);
  // 负数 / 非法归一
  assert.strictEqual(canAddMedia(-1, 1), true);
  assert.strictEqual(remainingMediaQuota(0), 9);
  assert.strictEqual(remainingMediaQuota(4), 5);
  assert.strictEqual(remainingMediaQuota(20), 0);
});
