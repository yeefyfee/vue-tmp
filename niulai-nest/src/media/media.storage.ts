import { Logger } from "@nestjs/common";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { StorageDriver as StorageDriverConst } from "@peluvida/shared";
import {
  ENV_MEDIA_DRIVER,
  ENV_MEDIA_LOCAL_PATH,
  ENV_MEDIA_OSS_ACCESS_KEY_ID,
  ENV_MEDIA_OSS_ACCESS_KEY_SECRET,
  ENV_MEDIA_OSS_BUCKET,
  ENV_MEDIA_OSS_ENDPOINT,
  ENV_MEDIA_PUBLIC_BASE_URL,
  ENV_MEDIA_S3_ACCESS_KEY,
  ENV_MEDIA_S3_BUCKET,
  ENV_MEDIA_S3_ENDPOINT,
  ENV_MEDIA_S3_FORCE_PATH_STYLE,
  ENV_MEDIA_S3_REGION,
  ENV_MEDIA_S3_SECRET_KEY,
  MediaError,
} from "./media.constants";
import { BusinessException } from "../common/exceptions/business.exception";

/**
 * 媒体 · 存储驱动（P0-08-02 统一媒体上传 API 的存储抽象层）
 *
 * 设计：
 *  - {@link StorageDriver} 抽象「预签名上传 / 直传落盘 / 删除 / 公开 URL」四件事，
 *    屏蔽 local / memory / s3 / oss 差异；上层的媒体服务与控制器只依赖该接口；
 *  - **凭证一律走 env，不硬编码**（键名见 media.constants.ts）；驱动工厂按
 *    `MEDIA_STORAGE_DRIVER` 选择实现，缺省 `local`（单机 / 测试零外部依赖）；
 *  - 云端驱动（s3 / oss）的 SDK 以**动态 require + 惰性构造**接入：仅在真正使用时
 *    才 require（`minio` / `ali-oss` 为仓库既有依赖），配置非法时抛
 *    `MEDIA_STORAGE_UNAVAILABLE`（不硬崩启动）；
 *  - 预签名返回 `uploadMode`：`presigned`（云端直传，前端 PUT 到 uploadUrl）或
 *    `direct`（local/memory 不支持前端直传，改走 `POST /media/upload` 服务端落盘，
 *    便于开发与测试）。
 */

/** 驱动名联合 */
export type StorageDriverName = (typeof StorageDriverConst)[keyof typeof StorageDriverConst];

/** 预签名入参 */
export interface PresignPutInput {
  objectKey: string;
  mimeType?: string | null;
  contentLength?: number | null;
  expiresIn: number;
}

/** 预签名结果 */
export interface PresignPutResult {
  /** 上传地址（direct 模式为 null，改走服务端直传端点） */
  uploadUrl: string | null;
  /** HTTP 方法（presigned 模式为 PUT） */
  method: string;
  /** 附加请求头（如 Content-Type） */
  headers: Record<string, string>;
  /** 有效期（秒） */
  expiresIn: number;
  /** 上传模式：presigned（前端直传）/ direct（服务端直传） */
  uploadMode: "presigned" | "direct";
}

/** 落盘结果 */
export interface PutObjectResult {
  url: string;
  objectKey: string;
}

/** 存储驱动接口 */
export interface StorageDriver {
  readonly driver: StorageDriverName;
  readonly bucket: string | null;
  presignPut(input: PresignPutInput): Promise<PresignPutResult>;
  putObject(objectKey: string, buffer: Buffer, mimeType?: string | null): Promise<PutObjectResult>;
  deleteObject(objectKey: string): Promise<boolean>;
  /** 公开访问 URL（同步，纯拼接） */
  publicUrl(objectKey: string): string;
  /** 读取对象（测试 / 内部需要时用；不支持的驱动返回 null） */
  readObject(objectKey: string): Promise<Buffer | null>;
}

// ─────────────────────────────────────────────────────────────
// 配置解析（env）
// ─────────────────────────────────────────────────────────────

/** 媒体存储配置 */
export interface MediaStorageConfig {
  driver: StorageDriverName;
  publicBaseUrl: string;
  local: { root: string };
  s3: {
    endpoint: string;
    region: string;
    accessKey: string;
    secretKey: string;
    bucket: string;
    forcePathStyle: boolean;
  };
  oss: { endpoint: string; accessKeyId: string; accessKeySecret: string; bucket: string };
}

const DRIVER_VALUES: readonly string[] = Object.values(StorageDriverConst);

/** 归一驱动名（非法 / 缺失回落 local） */
export function normalizeDriverName(value: string | undefined | null): StorageDriverName {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (
    DRIVER_VALUES.includes(normalized) ? normalized : StorageDriverConst.LOCAL
  ) as StorageDriverName;
}

/** 解析媒体存储配置（默认读 process.env；测试可注入） */
export function resolveMediaStorageConfig(
  env: Record<string, string | undefined> = process.env
): MediaStorageConfig {
  const localRoot =
    (env[ENV_MEDIA_LOCAL_PATH] && env[ENV_MEDIA_LOCAL_PATH].trim()) ||
    path.join(os.tmpdir(), "peluvida-media");
  return {
    driver: normalizeDriverName(env[ENV_MEDIA_DRIVER]),
    publicBaseUrl: (env[ENV_MEDIA_PUBLIC_BASE_URL] ?? "").trim().replace(/\/+$/, ""),
    local: { root: localRoot },
    s3: {
      endpoint: (env[ENV_MEDIA_S3_ENDPOINT] ?? "").trim(),
      region: (env[ENV_MEDIA_S3_REGION] ?? "us-east-1").trim() || "us-east-1",
      accessKey: (env[ENV_MEDIA_S3_ACCESS_KEY] ?? "").trim(),
      secretKey: (env[ENV_MEDIA_S3_SECRET_KEY] ?? "").trim(),
      bucket: (env[ENV_MEDIA_S3_BUCKET] ?? "").trim(),
      forcePathStyle: (env[ENV_MEDIA_S3_FORCE_PATH_STYLE] ?? "true").trim() !== "false",
    },
    oss: {
      endpoint: (env[ENV_MEDIA_OSS_ENDPOINT] ?? "").trim(),
      accessKeyId: (env[ENV_MEDIA_OSS_ACCESS_KEY_ID] ?? "").trim(),
      accessKeySecret: (env[ENV_MEDIA_OSS_ACCESS_KEY_SECRET] ?? "").trim(),
      bucket: (env[ENV_MEDIA_OSS_BUCKET] ?? "").trim(),
    },
  };
}

/** 拼接公开 URL（相对路径兜底） */
function joinPublicUrl(base: string, objectKey: string): string {
  const key = objectKey.replace(/^\/+/, "");
  if (!base) return `/${key}`;
  return `${base}/${key}`;
}

// ─────────────────────────────────────────────────────────────
// 本地文件系统驱动（默认；开发 / 测试）
// ─────────────────────────────────────────────────────────────

/** 本地文件系统驱动 */
export class LocalStorageDriver implements StorageDriver {
  readonly driver = StorageDriverConst.LOCAL;
  readonly bucket: string | null = null;

  constructor(
    private readonly root: string,
    private readonly publicBaseUrl: string
  ) {}

  async presignPut(input: PresignPutInput): Promise<PresignPutResult> {
    // local 不支持前端直传（无外部可写端点），返回 direct 模式
    return {
      uploadUrl: null,
      method: "POST",
      headers: {},
      expiresIn: input.expiresIn,
      uploadMode: "direct",
    };
  }

  async putObject(objectKey: string, buffer: Buffer): Promise<PutObjectResult> {
    const fullPath = this.resolvePath(objectKey);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.promises.writeFile(fullPath, buffer);
    return { url: this.publicUrl(objectKey), objectKey };
  }

  async deleteObject(objectKey: string): Promise<boolean> {
    try {
      await fs.promises.unlink(this.resolvePath(objectKey));
      return true;
    } catch {
      return false;
    }
  }

  publicUrl(objectKey: string): string {
    return joinPublicUrl(this.publicBaseUrl, objectKey);
  }

  async readObject(objectKey: string): Promise<Buffer | null> {
    try {
      return await fs.promises.readFile(this.resolvePath(objectKey));
    } catch {
      return null;
    }
  }

  /** 对象键 → 绝对路径（防路径穿越：解析后必须仍落在 root 之内） */
  private resolvePath(objectKey: string): string {
    const rootAbs = path.resolve(this.root);
    const full = path.resolve(rootAbs, objectKey.replace(/^\/+/, ""));
    if (full !== rootAbs && !full.startsWith(rootAbs + path.sep)) {
      throw new BusinessException(MediaError.MEDIA_STORAGE_UNAVAILABLE);
    }
    return full;
  }
}

// ─────────────────────────────────────────────────────────────
// 内存驱动（单测 / 临时；进程内 Map）
// ─────────────────────────────────────────────────────────────

/** 内存存储驱动：写入进程内 Map；用于单测与无外部依赖场景 */
export class MemoryStorageDriver implements StorageDriver {
  readonly driver = StorageDriverConst.MEMORY;
  readonly bucket: string | null = null;

  /** 进程内对象表：objectKey → buffer */
  private readonly store = new Map<string, Buffer>();

  constructor(private readonly publicBaseUrl: string = "memory://") {}

  async presignPut(input: PresignPutInput): Promise<PresignPutResult> {
    return {
      uploadUrl: null,
      method: "POST",
      headers: {},
      expiresIn: input.expiresIn,
      uploadMode: "direct",
    };
  }

  async putObject(objectKey: string, buffer: Buffer): Promise<PutObjectResult> {
    this.store.set(objectKey, buffer);
    return { url: this.publicUrl(objectKey), objectKey };
  }

  async deleteObject(objectKey: string): Promise<boolean> {
    return this.store.delete(objectKey);
  }

  publicUrl(objectKey: string): string {
    return `${this.publicBaseUrl}${objectKey.replace(/^\/+/, "")}`;
  }

  async readObject(objectKey: string): Promise<Buffer | null> {
    return this.store.get(objectKey) ?? null;
  }
}

// ─────────────────────────────────────────────────────────────
// S3 兼容对象存储驱动（预签名走 minio 客户端本地签名）
// ─────────────────────────────────────────────────────────────

/** minio 客户端最小结构接口（避免 `any`；仅声明用到的能力） */
interface MinioClientLike {
  presignedPutObject(bucket: string, object: string, expiry: number): Promise<string>;
  putObject(
    bucket: string,
    object: string,
    buffer: Buffer,
    size: number,
    metadata?: Record<string, string>
  ): Promise<unknown>;
  removeObject(bucket: string, object: string): Promise<void>;
}

/** S3 兼容存储驱动（AWS S3 / MinIO / 兼容端点）；预签名为纯本地签名，无网络调用 */
export class S3StorageDriver implements StorageDriver {
  readonly driver = StorageDriverConst.S3;
  readonly bucket: string | null;

  private readonly logger = new Logger(S3StorageDriver.name);
  private client: MinioClientLike | null = null;

  constructor(
    private readonly cfg: MediaStorageConfig["s3"],
    private readonly publicBaseUrl: string
  ) {
    this.bucket = cfg.bucket || null;
  }

  private assertReady(): void {
    if (!this.cfg.endpoint || !this.cfg.bucket || !this.cfg.accessKey || !this.cfg.secretKey) {
      throw new BusinessException(MediaError.MEDIA_STORAGE_UNAVAILABLE);
    }
  }

  private getClient(): MinioClientLike {
    this.assertReady();
    if (!this.client) {
      // 动态 require：仅在真正使用时加载 minio（仓库既有依赖）

      const Minio = require("minio");
      const MinioClientCtor = Minio.Client ?? Minio;
      const url = new URL(this.cfg.endpoint);
      const useSSL = url.protocol === "https:";
      const port = Number(url.port) || (useSSL ? 443 : 80);
      this.client = new MinioClientCtor({
        endPoint: url.hostname,
        port,
        useSSL,
        accessKey: this.cfg.accessKey,
        secretKey: this.cfg.secretKey,
        region: this.cfg.region,
      }) as MinioClientLike;
    }
    return this.client;
  }

  async presignPut(input: PresignPutInput): Promise<PresignPutResult> {
    const client = this.getClient();
    const uploadUrl: string = await client.presignedPutObject(
      this.cfg.bucket,
      input.objectKey,
      input.expiresIn
    );
    return {
      uploadUrl,
      method: "PUT",
      headers: input.mimeType ? { "Content-Type": input.mimeType } : {},
      expiresIn: input.expiresIn,
      uploadMode: "presigned",
    };
  }

  async putObject(
    objectKey: string,
    buffer: Buffer,
    mimeType?: string | null
  ): Promise<PutObjectResult> {
    const client = this.getClient();
    await client.putObject(this.cfg.bucket, objectKey, buffer, buffer.length, {
      "Content-Type": mimeType || "application/octet-stream",
    });
    return { url: this.publicUrl(objectKey), objectKey };
  }

  async deleteObject(objectKey: string): Promise<boolean> {
    try {
      await this.getClient().removeObject(this.cfg.bucket, objectKey);
      return true;
    } catch (error) {
      this.logger.warn(`S3 删除失败：${(error as Error)?.message ?? error}`);
      return false;
    }
  }

  publicUrl(objectKey: string): string {
    const key = objectKey.replace(/^\/+/, "");
    if (this.publicBaseUrl) return `${this.publicBaseUrl}/${key}`;
    const base = this.cfg.endpoint.replace(/\/+$/, "");
    return `${base}/${this.cfg.bucket}/${key}`;
  }

  async readObject(): Promise<Buffer | null> {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// 阿里云 OSS 原生驱动（预签名走 ali-oss 客户端）
// ─────────────────────────────────────────────────────────────

/** ali-oss 客户端最小结构接口（避免 `any`；仅声明用到的能力） */
interface OssClientLike {
  signatureUrl(key: string, options: { method: string; expires: number }): string;
  put(key: string, body: Buffer, options?: { mime?: string }): Promise<unknown>;
  delete(key: string): Promise<unknown>;
}

/** 阿里云 OSS 驱动 */
export class OssStorageDriver implements StorageDriver {
  readonly driver = StorageDriverConst.OSS;
  readonly bucket: string | null;

  private readonly logger = new Logger(OssStorageDriver.name);
  private client: OssClientLike | null = null;

  constructor(
    private readonly cfg: MediaStorageConfig["oss"],
    private readonly publicBaseUrl: string
  ) {
    this.bucket = cfg.bucket || null;
  }

  private assertReady(): void {
    if (
      !this.cfg.endpoint ||
      !this.cfg.bucket ||
      !this.cfg.accessKeyId ||
      !this.cfg.accessKeySecret
    ) {
      throw new BusinessException(MediaError.MEDIA_STORAGE_UNAVAILABLE);
    }
  }

  private getClient(): OssClientLike {
    this.assertReady();
    if (!this.client) {
      // 动态 require：仅在真正使用时加载 ali-oss（仓库既有依赖）

      const OSS = require("ali-oss");
      const OssClientCtor = OSS.default ?? OSS;
      this.client = new OssClientCtor({
        region: this.cfg.endpoint,
        endpoint: this.cfg.endpoint,
        accessKeyId: this.cfg.accessKeyId,
        accessKeySecret: this.cfg.accessKeySecret,
        bucket: this.cfg.bucket,
        secure: true,
      }) as OssClientLike;
    }
    return this.client;
  }

  async presignPut(input: PresignPutInput): Promise<PresignPutResult> {
    const client = this.getClient();
    const uploadUrl: string = client.signatureUrl(input.objectKey, {
      method: "PUT",
      expires: input.expiresIn,
    });
    return {
      uploadUrl,
      method: "PUT",
      headers: input.mimeType ? { "Content-Type": input.mimeType } : {},
      expiresIn: input.expiresIn,
      uploadMode: "presigned",
    };
  }

  async putObject(
    objectKey: string,
    buffer: Buffer,
    mimeType?: string | null
  ): Promise<PutObjectResult> {
    const client = this.getClient();
    await client.put(objectKey, buffer, mimeType ? { mime: mimeType } : undefined);
    return { url: this.publicUrl(objectKey), objectKey };
  }

  async deleteObject(objectKey: string): Promise<boolean> {
    try {
      await this.getClient().delete(objectKey);
      return true;
    } catch (error) {
      this.logger.warn(`OSS 删除失败：${(error as Error)?.message ?? error}`);
      return false;
    }
  }

  publicUrl(objectKey: string): string {
    const key = objectKey.replace(/^\/+/, "");
    if (this.publicBaseUrl) return `${this.publicBaseUrl}/${key}`;
    const host = this.cfg.endpoint.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    return `https://${this.cfg.bucket}.${host}/${key}`;
  }

  async readObject(): Promise<Buffer | null> {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// 驱动工厂
// ─────────────────────────────────────────────────────────────

/** 依配置构造存储驱动（未知驱动回落 local） */
export function createStorageDriver(config: MediaStorageConfig): StorageDriver {
  switch (config.driver) {
    case StorageDriverConst.MEMORY:
      return new MemoryStorageDriver();
    case StorageDriverConst.S3:
      return new S3StorageDriver(config.s3, config.publicBaseUrl);
    case StorageDriverConst.OSS:
      return new OssStorageDriver(config.oss, config.publicBaseUrl);
    case StorageDriverConst.LOCAL:
    default:
      return new LocalStorageDriver(config.local.root, config.publicBaseUrl);
  }
}
