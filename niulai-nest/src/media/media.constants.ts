import { HttpStatus } from "@nestjs/common";

/**
 * 媒体 / 附件域常量与错误码（P0-08）
 *
 * 媒体类型 / 存储驱动 / 多态关联类型 / 图片处理纯函数的**唯一事实源**在
 * `@peluvida/shared`（packages/shared/src/media.ts），本文件只登记域内错误码、
 * 环境变量键名与少量后端专属常量。
 *
 * ⚠️ 文件域隔离（本轮任务书）：本模块只改 `src/media/**`（+ `src/file/**` 复用挂点），
 * 不改 `src/common/**`（含 `enums/error-code.enum.ts`）。因此媒体错误码在此以
 * 「域局部常量」形式登记：`BusinessException` 的对象分支接受
 * `{ code: string; msg: string; httpStatus?: HttpStatus }`，对外信封 code 与
 * `error-code.enum.ts` 的 A07 段口径一致。
 *
 * 段位占用：A0700 上传文件异常 / A0710 删除文件异常（既有通用码）→ 媒体域自 A0711 续增。
 */
export const MediaError = {
  /** 媒体不存在 / 已跨租户 / 已软删（RLS 下不可区分，统一此码防枚举；非法 id 形态亦归此码） */
  MEDIA_NOT_FOUND: {
    code: "A0711",
    msg: "媒体记录不存在",
    httpStatus: HttpStatus.NOT_FOUND,
  },
  /** 单实体媒体数量超限（P0-08-03「最多 9 张」） */
  MEDIA_COUNT_EXCEEDED: {
    code: "A0712",
    msg: "该对象媒体数量已达上限（最多 9 张）",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  /** 上传状态不允许该操作（如对已确认记录重复确认、对 pending 记录取缩略图等） */
  MEDIA_UPLOAD_STATUS_INVALID: {
    code: "A0713",
    msg: "当前上传状态不允许此操作",
    httpStatus: HttpStatus.CONFLICT,
  },
  /** 关联对象非法（refType 未登记 / 关联目标不存在 / 越权探测） */
  MEDIA_REF_INVALID: {
    code: "A0714",
    msg: "关联对象不存在或类型不受支持",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  /** 乐观锁版本冲突 */
  MEDIA_VERSION_CONFLICT: {
    code: "A0715",
    msg: "数据已被他人修改，请刷新后重试",
    httpStatus: HttpStatus.CONFLICT,
  },
  /** 媒体类型不受支持 */
  MEDIA_TYPE_UNSUPPORTED: {
    code: "A0716",
    msg: "不支持的媒体类型",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  /** 存储驱动不可用 / 凭证缺失 / 云端返回异常 */
  MEDIA_STORAGE_UNAVAILABLE: {
    code: "A0717",
    msg: "媒体存储服务不可用",
    httpStatus: HttpStatus.BAD_GATEWAY,
  },
  /** 直传缺少文件 */
  MEDIA_FILE_REQUIRED: {
    code: "A0718",
    msg: "缺少上传文件",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  /** 文件超出大小上限 */
  MEDIA_FILE_TOO_LARGE: {
    code: "A0719",
    msg: "文件大小超出上限",
    httpStatus: HttpStatus.BAD_REQUEST,
  },
} as const;

/** 审计实体类型（媒体；@Audit 装饰器用，运行时落库值 `media`） */
export const AUDIT_ENTITY_MEDIA = "media";

/** 直传端点支持的字段名（multipart） */
export const MEDIA_UPLOAD_FILE_FIELD = "file";

/** 多态关联：宠物的 refType（唯一做存在性校验的关联类型，对齐 timeline 的宠物锚点） */
export const MEDIA_REF_TYPE_PET = "pet";

/** 媒体确认后写入时间线的事件名（best-effort；未登记事件名兜底 SYSTEM，写侧显式给 eventType=7 照片） */
export const MEDIA_EVENT_PHOTO_UPLOADED = "photo.uploaded";

/** 时间线事件类型：7 照片（对齐 @peluvida/shared TimelineEventType.PHOTO） */
export const MEDIA_TIMELINE_EVENT_TYPE_PHOTO = 7;

// ─────────────────────────────────────────────────────────────
// 存储驱动环境变量键名（凭证一律走 env，不硬编码；见 media.storage.ts）
// ─────────────────────────────────────────────────────────────

/** 媒体存储驱动选择（local | memory | s3 | oss；缺省 local） */
export const ENV_MEDIA_DRIVER = "MEDIA_STORAGE_DRIVER";

/** 本地驱动存储根目录（缺省 os.tmpdir()/peluvida-media） */
export const ENV_MEDIA_LOCAL_PATH = "MEDIA_LOCAL_STORAGE_PATH";

/** 对外访问基址（拼接 url / 预签名回调；缺省空 → 相对路径） */
export const ENV_MEDIA_PUBLIC_BASE_URL = "MEDIA_PUBLIC_BASE_URL";

/** S3 兼容端点（如 http://localhost:9000 或 https://s3.amazonaws.com） */
export const ENV_MEDIA_S3_ENDPOINT = "MEDIA_S3_ENDPOINT";
/** S3 区域（缺省 us-east-1） */
export const ENV_MEDIA_S3_REGION = "MEDIA_S3_REGION";
/** S3 AccessKey（凭证，禁止硬编码） */
export const ENV_MEDIA_S3_ACCESS_KEY = "MEDIA_S3_ACCESS_KEY";
/** S3 SecretKey（凭证，禁止硬编码） */
export const ENV_MEDIA_S3_SECRET_KEY = "MEDIA_S3_SECRET_KEY";
/** S3 桶名 */
export const ENV_MEDIA_S3_BUCKET = "MEDIA_S3_BUCKET";
/** S3 是否强制 path-style（MinIO 多为 true） */
export const ENV_MEDIA_S3_FORCE_PATH_STYLE = "MEDIA_S3_FORCE_PATH_STYLE";

/** 阿里云 OSS 端点 */
export const ENV_MEDIA_OSS_ENDPOINT = "MEDIA_OSS_ENDPOINT";
/** 阿里云 OSS AccessKeyId（凭证，禁止硬编码） */
export const ENV_MEDIA_OSS_ACCESS_KEY_ID = "MEDIA_OSS_ACCESS_KEY_ID";
/** 阿里云 OSS AccessKeySecret（凭证，禁止硬编码） */
export const ENV_MEDIA_OSS_ACCESS_KEY_SECRET = "MEDIA_OSS_ACCESS_KEY_SECRET";
/** 阿里云 OSS 桶名 */
export const ENV_MEDIA_OSS_BUCKET = "MEDIA_OSS_BUCKET";
