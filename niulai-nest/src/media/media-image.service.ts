import { Injectable, Logger, Optional } from "@nestjs/common";

import { MEDIA_DEFAULT_THUMBNAIL_MAX_EDGE, fitDimensions } from "@peluvida/shared";
import { isSupportedImageMime, readImageDimensions } from "./media-image.util";

/**
 * 媒体 · 图片处理服务（P0-08-03：水印 / 缩略图）
 *
 * 设计（**原生依赖可降级**，任务书明示取舍）：
 *  - 以 {@link ImageProcessor} 抽象「像素改写」引擎，实现可插拔：
 *    ① `SharpImageProcessor`（若环境安装了 `sharp`）：真实生成缩略图 + 施加文字水印；
 *    ② `PassthroughImageProcessor`（默认，仓库无原生图像库时的降级）：透传原图
 *       —— 尺寸探测（`readImageDimensions`）仍可用，缩略图 / 水印标记为未产出，
 *       调用方复用原图 URL，功能不阻断、行为可预期；
 *  - 引擎解析在 `resolveImageProcessor()` 内**动态探测**（try/require + 捕获），
 *    缺 `sharp` 时静默退化为 passthrough，绝不因缺原生依赖导致启动失败；
 *  - 处理异常一律**降级不抛**：图片处理失败不影响上传主流程（best-effort）。
 *
 * 纯函数（尺寸等比、水印摆放）在 `@peluvida/shared`（media.ts），本文件只做编排与引擎适配。
 */

/** 图片处理入参 */
export interface ImageProcessOptions {
  /** 原始 MIME（用于判断是否图片 + 引擎支持） */
  mimeType: string | null;
  /** 水印文字（空 / 未给则不施加水印） */
  watermarkText?: string | null;
  /** 缩略图最长边（缺省 320） */
  thumbnailMaxEdge?: number;
}

/** 图片处理出参（null 表示「未产出，调用方复用原图」） */
export interface ImageProcessOutput {
  /** 缩略图缓冲（null=复用原图） */
  thumbnail: Buffer | null;
  /** 施加水印后的显示图缓冲（null=复用原图） */
  watermarked: Buffer | null;
  /** 原图宽（px，探测不到为 null） */
  width: number | null;
  /** 原图高（px，探测不到为 null） */
  height: number | null;
  /** 缩略图宽（px，未产出为 null） */
  thumbnailWidth: number | null;
  /** 缩略图高（px，未产出为 null） */
  thumbnailHeight: number | null;
  /** 实际使用的引擎名（含降级后缀，便于可观测） */
  engine: string;
}

/** 图片处理引擎抽象 */
export interface ImageProcessor {
  readonly name: string;
  /** 该引擎是否支持处理该 MIME */
  supports(mime: string | null): boolean;
  /** 处理（可能抛错，由服务层兜底降级） */
  process(buffer: Buffer, options: ImageProcessOptions): Promise<ImageProcessOutput>;
}

/** 空产出（非图片 / 不支持） */
function emptyOutput(engine: string): ImageProcessOutput {
  return {
    thumbnail: null,
    watermarked: null,
    width: null,
    height: null,
    thumbnailWidth: null,
    thumbnailHeight: null,
    engine,
  };
}

/**
 * 透传处理器（默认）：不改写像素，仅探测尺寸。
 * 库存缩略图 / 水印均标记为未产出，调用方复用原图（降级口径见文件头）。
 */
export class PassthroughImageProcessor implements ImageProcessor {
  readonly name = "passthrough";

  supports(mime: string | null): boolean {
    return isSupportedImageMime(mime);
  }

  async process(buffer: Buffer, _options: ImageProcessOptions): Promise<ImageProcessOutput> {
    const dims = readImageDimensions(buffer);
    return {
      thumbnail: null,
      watermarked: null,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
      thumbnailWidth: null,
      thumbnailHeight: null,
      engine: this.name,
    };
  }
}

/** SVG 水印叠加（sharp 引擎用；文字转义防注入） */
function buildWatermarkSvg(canvasWidth: number, canvasHeight: number, text: string): Buffer {
  const safe = text.replace(
    /[<>&"']/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c] as string
  );
  const fontSize = Math.max(12, Math.round(Math.min(canvasWidth, canvasHeight) * 0.05));
  const pad = Math.round(fontSize * 0.6);
  const svg = `<svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
  <text x="${canvasWidth - pad}" y="${canvasHeight - pad}" text-anchor="end"
        font-family="sans-serif" font-size="${fontSize}" fill="#ffffff" fill-opacity="0.65"
        stroke="#000000" stroke-opacity="0.35" stroke-width="1">${safe}</text>
</svg>`;
  return Buffer.from(svg);
}

/** sharp 引擎最小结构接口（避免 `any`；仅声明用到的能力） */
interface SharpPipeline {
  metadata(): Promise<{ width?: number; height?: number }>;
  resize(options: {
    width: number;
    height: number;
    fit: string;
    withoutEnlargement: boolean;
  }): SharpPipeline;
  composite(inputs: Array<{ input: Buffer; blend: string }>): SharpPipeline;
  toBuffer(): Promise<Buffer>;
}

/** sharp 工厂签名 */
type SharpFactory = (input: Buffer) => SharpPipeline;

/**
 * sharp 处理器：真实生成缩略图 + 文字水印。
 * 仅在环境可用 `sharp` 时被 `resolveImageProcessor()` 选中。
 */
export class SharpImageProcessor implements ImageProcessor {
  readonly name = "sharp";

  private readonly sharp: SharpFactory;

  constructor(sharp: SharpFactory) {
    this.sharp = sharp;
  }

  supports(mime: string | null): boolean {
    return isSupportedImageMime(mime);
  }

  async process(buffer: Buffer, options: ImageProcessOptions): Promise<ImageProcessOutput> {
    const image = this.sharp(buffer);
    const metadata = await image.metadata();
    const width = typeof metadata.width === "number" ? metadata.width : null;
    const height = typeof metadata.height === "number" ? metadata.height : null;

    const maxEdge = options.thumbnailMaxEdge ?? MEDIA_DEFAULT_THUMBNAIL_MAX_EDGE;
    let thumbnail: Buffer | null = null;
    let thumbnailWidth: number | null = null;
    let thumbnailHeight: number | null = null;
    if (width && height) {
      const fitted = fitDimensions(width, height, maxEdge);
      thumbnail = await this.sharp(buffer)
        .resize({
          width: fitted.width,
          height: fitted.height,
          fit: "inside",
          withoutEnlargement: true,
        })
        .toBuffer();
      thumbnailWidth = fitted.width;
      thumbnailHeight = fitted.height;
    }

    let watermarked: Buffer | null = null;
    const text = (options.watermarkText ?? "").trim();
    if (text && width && height) {
      watermarked = await this.sharp(buffer)
        .composite([{ input: buildWatermarkSvg(width, height, text), blend: "over" }])
        .toBuffer();
    }

    return {
      thumbnail,
      watermarked,
      width,
      height,
      thumbnailWidth,
      thumbnailHeight,
      engine: this.name,
    };
  }
}

/**
 * 解析可用图片处理器：优先 `sharp`（动态探测，缺库静默降级），否则透传。
 * 结果在模块内缓存（引擎解析只做一次）。
 */
export function resolveImageProcessor(): ImageProcessor {
  try {
    // 动态 require：仓库默认无 sharp，缺失时进入 catch 降级

    const sharp = require("sharp");
    if (sharp && typeof sharp === "function") {
      return new SharpImageProcessor(sharp);
    }
  } catch {
    // 无 sharp：降级透传（预期路径）
  }
  return new PassthroughImageProcessor();
}

/**
 * 图片处理服务：门面 + 降级兜底。
 *
 * 非图片 / 引擎不支持 → 空产出；引擎抛错 → 记警告并按「复用原图」降级（不阻断上传）。
 */
@Injectable()
export class ImageProcessingService {
  private readonly logger = new Logger(ImageProcessingService.name);
  private readonly processor: ImageProcessor;

  /**
   * @param processor 可选引擎（仅测试注入用；生产经 {@link resolveImageProcessor} 解析）。
   *   标 `@Optional()` 使 Nest DI 跳过该参数（其类型为接口，反射元数据为 Object，无法作为依赖解析）。
   */
  constructor(@Optional() processor?: ImageProcessor) {
    this.processor = processor ?? resolveImageProcessor();
  }

  /** 当前引擎名（可观测 / 单测断言） */
  get engineName(): string {
    return this.processor.name;
  }

  /** 处理图片（best-effort，绝不抛） */
  async process(buffer: Buffer, options: ImageProcessOptions): Promise<ImageProcessOutput> {
    const mime = typeof options.mimeType === "string" ? options.mimeType.toLowerCase() : null;
    if (!buffer || !isSupportedImageMime(mime) || !this.processor.supports(mime)) {
      return emptyOutput(this.processor.name);
    }
    try {
      return await this.processor.process(buffer, options);
    } catch (error) {
      this.logger.warn(`图片处理失败，降级为原图：${(error as Error)?.message ?? error}`);
      const dims = readImageDimensions(buffer);
      return {
        thumbnail: null,
        watermarked: null,
        width: dims?.width ?? null,
        height: dims?.height ?? null,
        thumbnailWidth: null,
        thumbnailHeight: null,
        engine: `${this.processor.name}:fallback`,
      };
    }
  }
}
