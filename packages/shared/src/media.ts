/**
 * 媒体 / 附件域（P0-08）—— 媒体类型 / 存储驱动 / 多态关联类型 / 图片处理纯函数
 *
 * 口径：与业务新表 SmallInt / VARCHAR 列对齐；三端与后端共享的**唯一合法值域来源**
 * （对齐 timeline.ts / customer.ts 的既有惯例）。DB 列不设 CHECK，合法性由本常量
 * + DTO / service 校验约束。
 *
 * 约束：本包只放「纯常量 + 纯函数」，不引入任何运行时依赖与 IO
 * （故二进制图像解析 `readImageDimensions` 落在 nest 侧 `src/media/media-image.util.ts`，
 *  本文件仅含与平台无关的字符串 / 数值运算）。
 */

// ─────────────────────────────────────────────────────────────
// 媒体类型（media.media_type；1~9 与 DB 列注释一致，禁改取值）
// ─────────────────────────────────────────────────────────────

/** 媒体类型（media.media_type；SmallInt） */
export const MediaType = {
  /** 图片 */
  IMAGE: 1,
  /** 视频 */
  VIDEO: 2,
  /** 文档 */
  DOCUMENT: 3,
  /** 其他 */
  OTHER: 9,
} as const;

export type MediaType = (typeof MediaType)[keyof typeof MediaType];

/** 媒体类型合法值域（DTO @IsIn / 校验遍历用） */
export const MEDIA_TYPE_VALUES: readonly number[] = Object.values(MediaType);

/** 媒体类型中文名映射（展示 / 断言用） */
export const MEDIA_TYPE_NAMES: Readonly<Record<number, string>> = {
  [MediaType.IMAGE]: "图片",
  [MediaType.VIDEO]: "视频",
  [MediaType.DOCUMENT]: "文档",
  [MediaType.OTHER]: "其他",
};

// ─────────────────────────────────────────────────────────────
// 上传状态（media.upload_status；两阶段上传 P0-08-02）
// ─────────────────────────────────────────────────────────────

/** 上传状态（media.upload_status；SmallInt） */
export const MediaUploadStatus = {
  /** 待确认（已预签名，尚未确认落存储） */
  PENDING: 1,
  /** 已确认（可对外使用） */
  CONFIRMED: 2,
} as const;

export type MediaUploadStatus = (typeof MediaUploadStatus)[keyof typeof MediaUploadStatus];

/** 上传状态合法值域 */
export const MEDIA_UPLOAD_STATUS_VALUES: readonly number[] = Object.values(MediaUploadStatus);

// ─────────────────────────────────────────────────────────────
// 存储驱动（media.storage_driver；凭证一律走 env，不硬编码）
// ─────────────────────────────────────────────────────────────

/** 存储驱动（media.storage_driver；VARCHAR(16)） */
export const StorageDriver = {
  /** 本地文件系统（开发 / 单机默认；亦便于测试） */
  LOCAL: "local",
  /** 内存（进程内 Map；单测 / 临时） */
  MEMORY: "memory",
  /** S3 兼容对象存储（AWS S3 / MinIO / 阿里云 OSS-S3 兼容端点等）预签名 */
  S3: "s3",
  /** 阿里云 OSS 原生预签名 */
  OSS: "oss",
} as const;

export type StorageDriver = (typeof StorageDriver)[keyof typeof StorageDriver];

/** 存储驱动合法值域 */
export const STORAGE_DRIVER_VALUES: readonly string[] = Object.values(StorageDriver);

/** 存储驱动中文名（展示 / 日志用） */
export const STORAGE_DRIVER_NAMES: Readonly<Record<string, string>> = {
  [StorageDriver.LOCAL]: "本地文件系统",
  [StorageDriver.MEMORY]: "内存",
  [StorageDriver.S3]: "S3 兼容对象存储",
  [StorageDriver.OSS]: "阿里云 OSS",
};

// ─────────────────────────────────────────────────────────────
// 多态关联类型（media.ref_type；业务表名 slug，参照 timeline_event.ref_type）
// ─────────────────────────────────────────────────────────────

/** 多态关联对象类型（media.ref_type；业务表名 slug） */
export const MediaRefType = {
  /** 宠物档案 */
  PET: "pet",
  /** 健康档案 */
  HEALTH_RECORD: "health_record",
  /** 体重记录 */
  WEIGHT: "weight",
  /** 萌主档案 / 客户 */
  CUSTOMER: "customer",
  /** 宠物时间线事件 */
  TIMELINE_EVENT: "timeline_event",
  /** 门店 */
  STORE: "store",
  /** 员工 */
  STAFF: "staff",
  /** 宠物转移申请 */
  PET_TRANSFER_REQUEST: "pet_transfer_request",
  /** 黑名单 */
  BLACKLIST: "blacklist",
} as const;

export type MediaRefType = (typeof MediaRefType)[keyof typeof MediaRefType];

/** 多态关联类型合法值域 */
export const MEDIA_REF_TYPES: readonly string[] = Object.values(MediaRefType);

/** 关联类型是否已登记 */
export function isKnownMediaRefType(value: string): boolean {
  return MEDIA_REF_TYPES.includes(value);
}

// ─────────────────────────────────────────────────────────────
// 约束常量（与迁移 20261008120000 列长度 / 业务规则对齐）
// ─────────────────────────────────────────────────────────────

/** 单实体（refType + refId）媒体数量上限（P0-08-03「最多 9 张」） */
export const MEDIA_MAX_PER_ENTITY = 9;

/** 关联类型最大长度（对齐 DB 列 ref_type VARCHAR(32)） */
export const MEDIA_REF_TYPE_MAX_LENGTH = 32;

/** 关联 id 最大长度（对齐 DB 列 ref_id VARCHAR(64)） */
export const MEDIA_REF_ID_MAX_LENGTH = 64;

/** 对象键最大长度（对齐 DB 列 object_key VARCHAR(512)） */
export const MEDIA_OBJECT_KEY_MAX_LENGTH = 512;

/** 默认缩略图最长边（像素；P0-08-03，等比缩放且不放大） */
export const MEDIA_DEFAULT_THUMBNAIL_MAX_EDGE = 320;

/** 预签名 URL 默认有效期（秒） */
export const MEDIA_DEFAULT_PRESIGN_EXPIRES = 900;

/** 单文件大小上限（字节；默认 20MB） */
export const MEDIA_DEFAULT_MAX_FILE_SIZE = 20 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────
// MIME → 媒体类型（纯函数）
// ─────────────────────────────────────────────────────────────

/** 是否图片 MIME（image/*） */
export function isImageMime(mime: string | null | undefined): boolean {
  return typeof mime === "string" && mime.trim().toLowerCase().startsWith("image/");
}

/** 是否视频 MIME（video/*） */
export function isVideoMime(mime: string | null | undefined): boolean {
  return typeof mime === "string" && mime.trim().toLowerCase().startsWith("video/");
}

/**
 * 解析媒体类型：显式合法值优先，否则按 MIME 前缀回落，再回落 OTHER。
 */
export function resolveMediaType(
  mime: string | null | undefined,
  explicit?: number | null
): MediaType {
  if (explicit !== undefined && explicit !== null && MEDIA_TYPE_VALUES.includes(explicit)) {
    return explicit as MediaType;
  }
  if (isImageMime(mime)) {
    return MediaType.IMAGE;
  }
  if (isVideoMime(mime)) {
    return MediaType.VIDEO;
  }
  if (typeof mime === "string" && mime.trim() !== "") {
    return MediaType.DOCUMENT;
  }
  return MediaType.OTHER;
}

/** 是否图片媒体 */
export function isImageMedia(mediaType: number): boolean {
  return mediaType === MediaType.IMAGE;
}

/** 是否图片媒体（按 MIME） */
export function isImageMediaByMime(mime: string | null | undefined): boolean {
  return isImageMime(mime);
}

// ─────────────────────────────────────────────────────────────
// 文件名 / 扩展名（纯函数）
// ─────────────────────────────────────────────────────────────

/** 从文件名取扩展名（小写、去点、限 1~8 位字母数字；非法返回空串） */
export function sanitizeFileExtension(fileName: string | null | undefined): string {
  if (typeof fileName !== "string") {
    return "";
  }
  const dot = fileName.lastIndexOf(".");
  if (dot < 0 || dot === fileName.length - 1) {
    return "";
  }
  const ext = fileName.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : "";
}

/** 常见 MIME → 扩展名（无匹配返回空串） */
const MIME_EXTENSION: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "application/pdf": "pdf",
  "application/zip": "zip",
  "application/json": "json",
  "text/plain": "txt",
};

/** 按 MIME 推断扩展名（优先 MIME，其次文件名） */
export function inferExtension(mime: string | null | undefined, fileName?: string | null): string {
  if (typeof mime === "string") {
    const hit = MIME_EXTENSION[mime.trim().toLowerCase()];
    if (hit) {
      return hit;
    }
  }
  return sanitizeFileExtension(fileName);
}

// ─────────────────────────────────────────────────────────────
// 对象键构造（纯函数；供各存储驱动共享，杜绝键格式漂移）
// ─────────────────────────────────────────────────────────────

/** 对象键构造入参 */
export interface BuildMediaObjectKeyInput {
  /** 关联类型（slug） */
  refType: string;
  /** 租户 id（字符串） */
  tenantId: string | number | bigint;
  /** 关联对象 id（字符串） */
  refId: string;
  /** 媒体 id（uuid，随机，保证对象键唯一） */
  mediaId: string;
  /** 扩展名（不含点，可空） */
  extension?: string;
}

/**
 * 构造对象键：`media/<refType>/<tenantId>/<refId>/<mediaId>[.<ext>]`。
 *
 * 分层以 refType/tenant/refId 作前缀，便于按业务维度做存储侧生命周期管理
 * （如按租户归档）；mediaId 用随机 uuid 保证唯一。所有片段做白名单清洗，
 * 防止路径穿越与不可见字符。
 */
export function buildMediaObjectKey(input: BuildMediaObjectKeyInput): string {
  const safeRefType = sanitizeKeySegment(input.refType);
  const safeTenant = sanitizeKeySegment(String(input.tenantId));
  const safeRefId = sanitizeKeySegment(input.refId);
  const safeMediaId = sanitizeKeySegment(input.mediaId);
  const ext = (input.extension ?? "").replace(/^\./, "").toLowerCase();
  const suffix = /^[a-z0-9]{1,8}$/.test(ext) ? `.${ext}` : "";
  return `media/${safeRefType}/${safeTenant}/${safeRefId}/${safeMediaId}${suffix}`;
}

/** 清洗键片段：仅保留 [A-Za-z0-9_-]（**刻意剔除 `.`**，防 `..` 路径穿越），其余替换为 `_`，并裁剪长度 */
function sanitizeKeySegment(value: string): string {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "");
  return cleaned === "" ? "_" : cleaned.slice(0, 128);
}

// ─────────────────────────────────────────────────────────────
// 图片处理纯函数（P0-08-03）
// ─────────────────────────────────────────────────────────────

/** 尺寸 */
export interface MediaDimension {
  width: number;
  height: number;
}

/**
 * 等比缩放至最长边 ≤ maxEdge（**不放大**）。
 *
 * - 宽高均 ≤ maxEdge → 原样返回（scale=1）；
 * - 否则按 maxEdge/最长边 缩放，四舍五入后下限 1px。
 */
export function fitDimensions(
  width: number,
  height: number,
  maxEdge: number
): MediaDimension & { scale: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 0, height: 0, scale: 1 };
  }
  const edge =
    Number.isFinite(maxEdge) && maxEdge > 0
      ? Math.floor(maxEdge)
      : MEDIA_DEFAULT_THUMBNAIL_MAX_EDGE;
  const longest = Math.max(width, height);
  if (longest <= edge) {
    return { width: Math.round(width), height: Math.round(height), scale: 1 };
  }
  const scale = edge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

/** 水印位置（矩形摆放） */
export const MediaWatermarkPosition = {
  TOP_LEFT: "top-left",
  TOP_RIGHT: "top-right",
  BOTTOM_LEFT: "bottom-left",
  BOTTOM_RIGHT: "bottom-right",
  CENTER: "center",
} as const;

export type MediaWatermarkPosition =
  (typeof MediaWatermarkPosition)[keyof typeof MediaWatermarkPosition];

/** 水印矩形摆放入参 */
export interface WatermarkRectInput {
  /** 画布宽度 */
  canvasWidth: number;
  /** 画布高度 */
  canvasHeight: number;
  /** 水印宽度 */
  markWidth: number;
  /** 水印高度 */
  markHeight: number;
  /** 位置（默认右下） */
  position?: MediaWatermarkPosition;
  /** 边距（默认 12px） */
  margin?: number;
}

/** 水印矩形左上角坐标（越界时收敛到画布内，画布过小时收敛为 0） */
export function computeWatermarkRect(input: WatermarkRectInput): { x: number; y: number } {
  const {
    canvasWidth,
    canvasHeight,
    markWidth,
    markHeight,
    position = MediaWatermarkPosition.BOTTOM_RIGHT,
    margin = 12,
  } = input;

  const clamp = (v: number, max: number): number => {
    if (!Number.isFinite(v)) {
      return 0;
    }
    return Math.max(0, Math.min(Math.round(v), Math.max(0, max)));
  };

  const maxX = canvasWidth - markWidth;
  const maxY = canvasHeight - markHeight;
  const minDim = Math.min(canvasWidth, canvasHeight);

  switch (position) {
    case MediaWatermarkPosition.TOP_LEFT:
      return { x: clamp(margin, maxX), y: clamp(margin, maxY) };
    case MediaWatermarkPosition.TOP_RIGHT:
      return { x: clamp(maxX - margin, maxX), y: clamp(margin, maxY) };
    case MediaWatermarkPosition.BOTTOM_LEFT:
      return { x: clamp(margin, maxX), y: clamp(maxY - margin, maxY) };
    case MediaWatermarkPosition.CENTER:
      return {
        x: clamp((minDim - markWidth) / 2, maxX),
        y: clamp((minDim - markHeight) / 2, maxY),
      };
    case MediaWatermarkPosition.BOTTOM_RIGHT:
    default:
      return { x: clamp(maxX - margin, maxX), y: clamp(maxY - margin, maxY) };
  }
}

// ─────────────────────────────────────────────────────────────
// 数量约束（纯函数；P0-08-03「最多 9 张」）
// ─────────────────────────────────────────────────────────────

/** 是否还能新增指定数量的媒体（existingCount + incomingCount ≤ maxPerEntity） */
export function canAddMedia(
  existingCount: number,
  incomingCount: number,
  maxPerEntity: number = MEDIA_MAX_PER_ENTITY
): boolean {
  const existing =
    Number.isFinite(existingCount) && existingCount > 0 ? Math.floor(existingCount) : 0;
  const incoming =
    Number.isFinite(incomingCount) && incomingCount > 0 ? Math.floor(incomingCount) : 0;
  const max =
    Number.isFinite(maxPerEntity) && maxPerEntity > 0
      ? Math.floor(maxPerEntity)
      : MEDIA_MAX_PER_ENTITY;
  return existing + incoming <= max;
}

/** 已用量（不超过上限），用于展示剩余配额 */
export function remainingMediaQuota(
  existingCount: number,
  maxPerEntity: number = MEDIA_MAX_PER_ENTITY
): number {
  const existing =
    Number.isFinite(existingCount) && existingCount > 0 ? Math.floor(existingCount) : 0;
  const max =
    Number.isFinite(maxPerEntity) && maxPerEntity > 0
      ? Math.floor(maxPerEntity)
      : MEDIA_MAX_PER_ENTITY;
  return Math.max(0, max - existing);
}
