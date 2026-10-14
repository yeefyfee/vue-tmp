import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";

import {
  MEDIA_MAX_PER_ENTITY,
  MEDIA_TYPE_NAMES,
  MediaType,
  MediaUploadStatus,
  buildMediaObjectKey,
  canAddMedia,
  inferExtension,
  isImageMedia,
  resolveMediaType,
  sanitizeFileExtension,
} from "@peluvida/shared";
import { PrismaService } from "../common/prisma/prisma.service";
import { toBigInt } from "../common/prisma/prisma-ids";
import { RequestContext } from "../common/context/request-context";
import { ErrorCode } from "../common/enums/error-code.enum";
import { BusinessException } from "../common/exceptions/business.exception";
import { normalizePagination } from "../common/pagination";
import { writeTimelineEventSync } from "../pet/timeline-write.service";
import {
  MEDIA_EVENT_PHOTO_UPLOADED,
  MEDIA_REF_TYPE_PET,
  MEDIA_TIMELINE_EVENT_TYPE_PHOTO,
  MediaError,
} from "./media.constants";
import { ImageProcessingService } from "./media-image.service";
import { sniffMimeType } from "./media-image.util";
import {
  createStorageDriver,
  resolveMediaStorageConfig,
  type StorageDriver,
} from "./media.storage";
import { QueryMediaDto } from "./dto/query-media.dto";
import { PresignMediaDto } from "./dto/presign-media.dto";
import { ConfirmMediaDto } from "./dto/confirm-media.dto";
import { UpdateMediaDto } from "./dto/update-media.dto";
import { MediaCallbackDto } from "./dto/media-callback.dto";

/** 上传文件形态（FileInterceptor 注入；兼容 memoryStorage 与 diskStorage） */
export interface UploadedMediaFile {
  buffer?: Buffer;
  originalname?: string;
  originalName?: string;
  mimetype?: string;
  size?: number;
  path?: string;
}

/** 直传端点附加参数（multipart query） */
export interface DirectUploadParams {
  refType: string;
  refId: string;
  storeId?: string;
  visibleToOwner?: string | boolean;
  sort?: string | number;
  watermark?: string;
}

/** 媒体对外视图（BigInt 字符串化，PEL 约定） */
export interface MediaView {
  id: string;
  tenantId: string;
  storeId: string | null;
  refType: string;
  refId: string;
  mediaType: number;
  storageDriver: string;
  bucket: string | null;
  objectKey: string;
  url: string;
  thumbnailUrl: string | null;
  watermarked: boolean;
  mimeType: string | null;
  fileSize: string | null;
  width: number | null;
  height: number | null;
  sort: number;
  visibleToOwner: boolean;
  uploadStatus: number;
  uploadedBy: string | null;
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

/** 预签名结果视图 */
export interface MediaPresignView {
  mediaId: string;
  objectKey: string;
  url: string;
  uploadUrl: string | null;
  method: string;
  headers: Record<string, string>;
  expiresIn: number;
  uploadMode: "presigned" | "direct";
  driver: string;
  mediaType: number;
  maxPerEntity: number;
}

/** media 行类型 */
export type MediaRow = Prisma.MediaGetPayload<null>;

/** 行 → 视图（BigInt 字符串化在此完成，出参不含原始 BigInt） */
export function toMediaView(row: MediaRow): MediaView {
  return {
    id: row.id,
    tenantId: String(row.tenantId),
    storeId: row.storeId ?? null,
    refType: row.refType,
    refId: row.refId,
    mediaType: row.mediaType,
    storageDriver: row.storageDriver,
    bucket: row.bucket ?? null,
    objectKey: row.objectKey,
    url: row.url,
    thumbnailUrl: row.thumbnailUrl ?? null,
    watermarked: row.watermarked,
    mimeType: row.mimeType ?? null,
    fileSize: row.fileSize === null || row.fileSize === undefined ? null : String(row.fileSize),
    width: row.width ?? null,
    height: row.height ?? null,
    sort: row.sort,
    visibleToOwner: row.visibleToOwner,
    uploadStatus: row.uploadStatus,
    uploadedBy:
      row.uploadedBy === null || row.uploadedBy === undefined ? null : String(row.uploadedBy),
    confirmedAt: row.confirmedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

/** 解析当前租户（缺失 fail-closed 抛 A0302） */
function resolveTenantId(): bigint {
  const tid = RequestContext.getTenantId();
  if (!tid || String(tid).trim() === "") {
    throw new BusinessException(ErrorCode.TENANT_CONTEXT_MISSING);
  }
  return BigInt(String(tid));
}

/**
 * 媒体 / 附件服务（P0-08）
 *
 * 数据访问统一走 `prisma.scoped.media`（租户隔离扩展自动注入 tenantId，RLS 兜底）。
 *
 * 契约口径：
 *  - **两阶段上传**（P0-08-02）：{@link presign}（pending 记录 + 预签名）→
 *    {@link confirm}（置 confirmed）；local/memory 等不支持前端直传的驱动改走
 *    {@link directUpload}（服务端落盘并直接 confirmed）；
 *  - **图片处理**（P0-08-03）：图片经 {@link ImageProcessingService} 生成缩略图 / 水印
 *    （无原生依赖时降级透传）；单实体（refType + refId）图片数 ≤ 9；
 *  - **可见性**（P0-08-04）：visibleToOwner 控制宠主端可见，支持列表筛选与更新；
 *  - 宠物关联（refType=pet）在确认后**最佳努力**写入时间线（photo.uploaded），
 *    失败不阻断上传。
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly storage: StorageDriver;

  constructor(
    private readonly prisma: PrismaService,
    private readonly imageProcessing: ImageProcessingService
  ) {
    this.storage = createStorageDriver(resolveMediaStorageConfig());
  }

  /** 当前存储驱动名（可观测 / 单测断言） */
  get driverName(): string {
    return this.storage.driver;
  }

  // ─────────────────────────────────────────────────────────────
  // P0-08-02 预签名上传 + 确认
  // ─────────────────────────────────────────────────────────────

  /**
   * 预签名上传：校验关联对象 + 图片配额 → 落 pending 记录 → 返回上传目标。
   * 云端驱动返回 presigned PUT 地址；local/memory 返回 uploadMode=direct（走直传端点）。
   */
  async presign(dto: PresignMediaDto): Promise<MediaPresignView> {
    const tenantId = resolveTenantId();
    await this.assertRef(dto.refType, dto.refId);

    const mediaType = resolveMediaType(dto.mimeType);
    await this.assertImageQuota(dto.refType, dto.refId, mediaType, 1);

    const mediaId = randomUUID();
    const extension = inferExtension(dto.mimeType, dto.fileName);
    const objectKey = buildMediaObjectKey({
      refType: dto.refType,
      tenantId,
      refId: dto.refId,
      mediaId,
      extension,
    });
    const url = this.storage.publicUrl(objectKey);
    const expiresIn = 900;

    const presigned = await this.storage.presignPut({
      objectKey,
      mimeType: dto.mimeType ?? null,
      contentLength: dto.fileSize ?? null,
      expiresIn,
    });

    const row = await this.prisma.scoped.media.create({
      data: {
        id: mediaId,
        tenantId,
        storeId: dto.storeId ?? null,
        refType: dto.refType,
        refId: dto.refId,
        mediaType,
        storageDriver: this.storage.driver,
        bucket: this.storage.bucket,
        objectKey,
        url,
        mimeType: dto.mimeType ?? null,
        fileSize: dto.fileSize === undefined || dto.fileSize === null ? null : BigInt(dto.fileSize),
        sort: dto.sort ?? 0,
        visibleToOwner: dto.visibleToOwner ?? true,
        uploadStatus: MediaUploadStatus.PENDING,
        uploadedBy: toBigInt(RequestContext.getUserId()),
      },
    });

    return {
      mediaId: row.id,
      objectKey: row.objectKey,
      url: row.url,
      uploadUrl: presigned.uploadUrl,
      method: presigned.method,
      headers: presigned.headers,
      expiresIn: presigned.expiresIn,
      uploadMode: presigned.uploadMode,
      driver: this.storage.driver,
      mediaType: row.mediaType,
      maxPerEntity: MEDIA_MAX_PER_ENTITY,
    };
  }

  /**
   * 确认上传：pending → confirmed（写 confirmed_at），best-effort 生成缩略图 / 施加水印。
   *
   * 对已确认记录再次确认抛 A0713（明确契约；客户端 / 回调勿重复确认）。
   */
  async confirm(mediaId: string, dto: ConfirmMediaDto): Promise<MediaView> {
    const row = await this.findActiveOrThrow(mediaId);
    if (row.uploadStatus === MediaUploadStatus.CONFIRMED) {
      throw new BusinessException(MediaError.MEDIA_UPLOAD_STATUS_INVALID);
    }

    const mimeType = dto.mimeType ?? row.mimeType ?? null;
    const mediaType = resolveMediaType(mimeType, row.mediaType);
    const buffer = await this.storage.readObject(row.objectKey);

    const processed = buffer
      ? await this.imageProcessing.process(buffer, { mimeType, watermarkText: null })
      : null;

    let thumbnailUrl: string | null = row.thumbnailUrl ?? null;
    let watermarked = row.watermarked;
    if (buffer && processed) {
      // 施加水印：以水印版本覆盖主对象（水印为期望的展示形态）
      if (processed.watermarked) {
        await this.storage.putObject(row.objectKey, processed.watermarked, mimeType);
        watermarked = true;
      }
      // 生成缩略图并落存储
      if (processed.thumbnail) {
        const thumbKey = buildThumbnailKey(row.objectKey);
        const thumbStored = await this.storage.putObject(thumbKey, processed.thumbnail, mimeType);
        thumbnailUrl = thumbStored.url;
      }
    }

    const width = dto.width ?? processed?.width ?? row.width ?? null;
    const height = dto.height ?? processed?.height ?? row.height ?? null;
    const fileSize =
      dto.fileSize !== undefined && dto.fileSize !== null
        ? BigInt(dto.fileSize)
        : (row.fileSize ?? null);

    const updated = await this.prisma.scoped.media.update({
      where: { id: row.id },
      data: {
        uploadStatus: MediaUploadStatus.CONFIRMED,
        confirmedAt: new Date(),
        mimeType,
        mediaType,
        width,
        height,
        fileSize,
        thumbnailUrl,
        watermarked,
        version: { increment: 1 },
      },
    });

    await this.writeTimelineBestEffort(updated);
    return toMediaView(updated);
  }

  /**
   * 服务端直传（local/memory 等不支持前端直传的驱动）：一份请求完成落盘 + 确认。
   * 图片按需生成缩略图 / 施加水印（P0-08-03）。
   */
  async directUpload(params: DirectUploadParams, file: UploadedMediaFile): Promise<MediaView> {
    const tenantId = resolveTenantId();
    const buffer = await this.readUploadedBuffer(file);
    if (!buffer || buffer.length === 0) {
      throw new BusinessException(MediaError.MEDIA_FILE_REQUIRED);
    }

    const mimeType = file.mimetype || this.sniffOrNull(buffer) || "application/octet-stream";
    const mediaType = resolveMediaType(mimeType);
    await this.assertRef(params.refType, params.refId);
    await this.assertImageQuota(params.refType, params.refId, mediaType, 1);

    const mediaId = randomUUID();
    const extension = inferExtension(mimeType, file.originalname ?? file.originalName ?? null);
    const objectKey = buildMediaObjectKey({
      refType: params.refType,
      tenantId,
      refId: params.refId,
      mediaId,
      extension,
    });

    // 图片处理（best-effort；降级透传时 outputs 全为 null，复用原图）
    const processed = await this.imageProcessing.process(buffer, {
      mimeType,
      watermarkText: params.watermark ?? null,
    });

    // 存储主对象（施加水印后优先作为展示图；否则存原图）
    const displayBuffer = processed.watermarked ?? buffer;
    const stored = await this.storage.putObject(objectKey, displayBuffer, mimeType);

    let thumbnailUrl: string | null = null;
    if (processed.thumbnail) {
      const thumbKey = buildThumbnailKey(objectKey);
      const thumbStored = await this.storage.putObject(thumbKey, processed.thumbnail, mimeType);
      thumbnailUrl = thumbStored.url;
    }

    const fileSize = file.size ?? buffer.length;
    const row = await this.prisma.scoped.media.create({
      data: {
        id: mediaId,
        tenantId,
        storeId: params.storeId ?? null,
        refType: params.refType,
        refId: params.refId,
        mediaType,
        storageDriver: this.storage.driver,
        bucket: this.storage.bucket,
        objectKey: stored.objectKey,
        url: stored.url,
        thumbnailUrl,
        watermarked: processed.watermarked !== null,
        mimeType,
        fileSize: BigInt(fileSize),
        width: processed.width,
        height: processed.height,
        sort: this.parseSort(params.sort),
        visibleToOwner: this.parseVisibility(params.visibleToOwner),
        uploadStatus: MediaUploadStatus.CONFIRMED,
        uploadedBy: toBigInt(RequestContext.getUserId()),
        confirmedAt: new Date(),
      },
    });

    await this.writeTimelineBestEffort(row);
    return toMediaView(row);
  }

  /**
   * 上传回调（云存储回调服务端）：按 mediaId 或 objectKey 定位 pending 记录并确认。
   * 幂等友好：若记录已 confirmed，直接返回现状（回调可能重试）。
   */
  async callback(dto: MediaCallbackDto): Promise<MediaView> {
    if (!dto.mediaId && !dto.objectKey) {
      throw new BusinessException(MediaError.MEDIA_NOT_FOUND);
    }
    const row = await this.prisma.scoped.media.findFirst({
      where: dto.mediaId ? { id: dto.mediaId } : { objectKey: dto.objectKey },
      orderBy: { createdAt: "desc" },
    });
    if (!row) {
      throw new BusinessException(MediaError.MEDIA_NOT_FOUND);
    }
    if (row.uploadStatus === MediaUploadStatus.CONFIRMED) {
      return toMediaView(row);
    }
    return this.confirm(row.id, {
      fileSize: dto.size,
      mimeType: dto.mimeType,
      width: dto.width,
      height: dto.height,
    });
  }

  // ─────────────────────────────────────────────────────────────
  // 读取（P0-08-02 / P0-08-04）
  // ─────────────────────────────────────────────────────────────

  /** 分页查询（refType+refId / mediaType / uploadStatus / visibleToOwner 精确筛选） */
  async list(
    query: QueryMediaDto
  ): Promise<{ data: MediaView[]; page: { page: number; page_size: number; total: number } }> {
    const { skip, take, page, page_size } = normalizePagination(query);

    const where: Prisma.MediaWhereInput = { deletedAt: null };
    if (query.refType) where.refType = query.refType;
    if (query.refId) where.refId = query.refId;
    if (query.mediaType !== undefined && query.mediaType !== null)
      where.mediaType = query.mediaType;
    if (query.uploadStatus !== undefined && query.uploadStatus !== null) {
      where.uploadStatus = query.uploadStatus;
    }
    // 查询串布尔：显式解析（enableImplicitConversion 会把 "false" 误转 true）
    if (query.visibleToOwner === "true") where.visibleToOwner = true;
    else if (query.visibleToOwner === "false") where.visibleToOwner = false;

    const orderBy: Prisma.MediaOrderByWithRelationInput[] = [
      { sort: "asc" },
      { createdAt: "desc" },
    ];

    const [list, total] = await Promise.all([
      this.prisma.scoped.media.findMany({ where, orderBy, skip, take }),
      this.prisma.scoped.media.count({ where }),
    ]);

    return { data: list.map((row) => toMediaView(row)), page: { page, page_size, total } };
  }

  /** 媒体详情（不存在 / 跨租户 / 非法 id 统一 A0711，防枚举） */
  async detail(mediaId: string): Promise<MediaView> {
    const row = await this.findActiveOrThrow(mediaId);
    return toMediaView(row);
  }

  // ─────────────────────────────────────────────────────────────
  // 更新 / 删除（P0-08-04）
  // ─────────────────────────────────────────────────────────────

  /** 更新可见性 / 排序（version 乐观锁） */
  async update(mediaId: string, dto: UpdateMediaDto): Promise<MediaView> {
    const row = await this.findActiveOrThrow(mediaId);
    if (row.version !== dto.version) {
      throw new BusinessException(MediaError.MEDIA_VERSION_CONFLICT);
    }
    const data: Prisma.MediaUpdateInput = { version: { increment: 1 } };
    if (dto.visibleToOwner !== undefined) data.visibleToOwner = dto.visibleToOwner;
    if (dto.sort !== undefined) data.sort = dto.sort;

    const updated = await this.prisma.scoped.media.update({ where: { id: row.id }, data });
    return toMediaView(updated);
  }

  /** 软删除（并 best-effort 清理存储对象） */
  async remove(mediaId: string): Promise<{ success: boolean }> {
    const row = await this.findActiveOrThrow(mediaId);
    await this.prisma.scoped.media.update({
      where: { id: row.id },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });
    // best-effort 清理存储对象（含缩略图）；失败仅告警
    try {
      await this.storage.deleteObject(row.objectKey);
      if (row.thumbnailUrl) {
        await this.storage.deleteObject(buildThumbnailKey(row.objectKey));
      }
    } catch (error) {
      this.logger.warn(`媒体对象清理失败：${(error as Error)?.message ?? error}`);
    }
    return { success: true };
  }

  // ─────────────────────────────────────────────────────────────
  // 内部工具
  // ─────────────────────────────────────────────────────────────

  /** 取「租户内 + 未软删」记录，否则 A0711 */
  private async findActiveOrThrow(mediaId: string): Promise<MediaRow> {
    if (!mediaId || String(mediaId).trim() === "") {
      throw new BusinessException(MediaError.MEDIA_NOT_FOUND);
    }
    const row = await this.prisma.scoped.media.findFirst({
      where: { id: mediaId, deletedAt: null },
    });
    if (!row) {
      throw new BusinessException(MediaError.MEDIA_NOT_FOUND);
    }
    return row;
  }

  /**
   * 校验多态关联对象：`refType=pet` 时校验宠物存在（租户内 + 未软删，防越权探测）；
   * 其余关联类型不做存在性硬校验（多态无法穷举目标表，跨表一致性由业务层保证）。
   */
  private async assertRef(refType: string, refId: string): Promise<void> {
    if (!refType || !refId) {
      throw new BusinessException(MediaError.MEDIA_REF_INVALID);
    }
    if (refType === MEDIA_REF_TYPE_PET) {
      const pet = await this.prisma.scoped.pet.findFirst({
        where: { id: refId, deletedAt: null },
        select: { id: true },
      });
      if (!pet) {
        throw new BusinessException(ErrorCode.PET_NOT_FOUND);
      }
    }
  }

  /** 图片配额：单实体（refType + refId）图片数 ≤ 9（非图片不限制） */
  private async assertImageQuota(
    refType: string,
    refId: string,
    mediaType: number,
    incoming: number
  ): Promise<void> {
    if (!isImageMedia(mediaType)) return;
    const existing = await this.prisma.scoped.media.count({
      where: { refType, refId, mediaType: MediaType.IMAGE, deletedAt: null },
    });
    if (!canAddMedia(existing, incoming, MEDIA_MAX_PER_ENTITY)) {
      throw new BusinessException(MediaError.MEDIA_COUNT_EXCEEDED);
    }
  }

  /** 读取上传文件缓冲（memoryStorage 用 buffer；diskStorage 用 path） */
  private async readUploadedBuffer(file: UploadedMediaFile | undefined): Promise<Buffer | null> {
    if (!file) return null;
    if (file.buffer && file.buffer.length > 0) return file.buffer;
    if (file.path) {
      // 延迟 require，避免无谓依赖

      const fs = require("node:fs");
      try {
        return await fs.promises.readFile(file.path);
      } catch {
        return null;
      }
    }
    return null;
  }

  /** 嗅探 MIME（按文件头；无法识别返回 null） */
  private sniffOrNull(buffer: Buffer): string | null {
    return sniffMimeType(buffer);
  }

  /** 解析排序入参（multipart 字段为字符串） */
  private parseSort(value: string | number | undefined): number {
    if (value === undefined || value === null || value === "") return 0;
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }

  /** 解析可见性入参（字符串 / 布尔） */
  private parseVisibility(value: string | boolean | undefined): boolean {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return value !== "false" && value !== "0";
    return true;
  }

  /** 最佳努力写时间线（仅宠物关联；失败不阻断上传） */
  private async writeTimelineBestEffort(row: MediaRow): Promise<void> {
    if (row.refType !== MEDIA_REF_TYPE_PET) return;
    try {
      await writeTimelineEventSync(this.prisma, {
        petId: row.refId,
        eventName: MEDIA_EVENT_PHOTO_UPLOADED,
        eventType: MEDIA_TIMELINE_EVENT_TYPE_PHOTO,
        content: `上传${MEDIA_TYPE_NAMES[row.mediaType] ?? "媒体"}`,
        payload: {
          mediaId: row.id,
          url: row.url,
          thumbnailUrl: row.thumbnailUrl ?? null,
          mimeType: row.mimeType ?? null,
          mediaType: row.mediaType,
        },
        refType: "media",
        refId: row.id,
        visibleToOwner: row.visibleToOwner,
      });
    } catch (error) {
      this.logger.warn(
        `媒体上传写入时间线失败（best-effort）：media=${row.id} ${(error as Error)?.message ?? error}`
      );
    }
  }
}

/** 构造缩略图对象键：`<objectKey>` 去扩展名后追加 `.thumb[.ext]` */
function buildThumbnailKey(objectKey: string): string {
  const ext = sanitizeFileExtension(objectKey);
  if (!ext) return `${objectKey}.thumb`;
  return `${objectKey.slice(0, objectKey.length - ext.length - 1)}.thumb.${ext}`;
}
