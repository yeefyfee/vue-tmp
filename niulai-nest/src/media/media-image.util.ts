import type { MediaDimension } from "@peluvida/shared";

/**
 * 媒体 · 图像元数据解析纯函数（P0-08-03）
 *
 * 设计要点：
 *  - **零原生依赖**：仓库无 sharp / jimp 等原生图像库，故图像「尺寸探测」与
 *    「MIME 嗅探」以纯 JS 按魔数 / 文件头解析实现（PNG / JPEG / GIF / BMP / WebP），
 *    可离线单测、无 IO、无副作用；
 *  - 解析失败一律返回 `null`（调用方降级：不生成缩略图 / 不写尺寸），绝不抛异常。
 *
 * 说明：真正的水印 / 缩略图「像素改写」由 {@link ./media-image.service.ts} 的可插拔
 * 处理器承担（含 sharp 可选实现与无原生依赖的 passthrough 降级），本文件只做探测。
 */

/** 支持的图片 MIME（用于图像处理前置判断） */
export const SUPPORTED_IMAGE_MIMES: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/bmp",
];

/** 是否受支持的图片 MIME */
export function isSupportedImageMime(mime: string | null | undefined): boolean {
  if (typeof mime !== "string") return false;
  return SUPPORTED_IMAGE_MIMES.includes(mime.trim().toLowerCase());
}

/** 读取以 big-endian 的无符号整数 */
function readUIntBE(buf: Buffer, offset: number, bytes: number): number {
  let value = 0;
  for (let i = 0; i < bytes; i += 1) {
    value = value * 256 + buf[offset + i];
  }
  return value;
}

/** 读取以 little-endian 的无符号整数 */
function readUIntLE(buf: Buffer, offset: number, bytes: number): number {
  let value = 0;
  let multiplier = 1;
  for (let i = 0; i < bytes; i += 1) {
    value += buf[offset + i] * multiplier;
    multiplier *= 256;
  }
  return value;
}

/** 16 位标记（字节序尾），便于比对魔数 */
function bytesAt(buf: Buffer, offset: number, values: number[]): boolean {
  if (buf.length < offset + values.length) return false;
  return values.every((v, i) => buf[offset + i] === v);
}

function asciiEquals(buf: Buffer, offset: number, text: string): boolean {
  if (buf.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i += 1) {
    if (buf[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * 嗅探 MIME 类型（按魔数 / 文件头）。
 * 支持 image/png · image/jpeg · image/gif · image/webp · image/bmp · video/mp4 · application/pdf；
 * 无法识别返回 null。
 */
export function sniffMimeType(buffer: Buffer | null | undefined): string | null {
  if (!buffer || buffer.length < 4) return null;
  const b = buffer;
  // PNG
  if (bytesAt(b, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // JPEG
  if (bytesAt(b, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  // GIF
  if (asciiEquals(b, 0, "GIF87a") || asciiEquals(b, 0, "GIF89a")) return "image/gif";
  // BMP
  if (asciiEquals(b, 0, "BM")) return "image/bmp";
  // WebP
  if (asciiEquals(b, 0, "RIFF") && asciiEquals(b, 8, "WEBP")) return "image/webp";
  // MP4 (ftyp)
  if (b.length >= 12 && asciiEquals(b, 4, "ftyp")) return "video/mp4";
  // PDF
  if (asciiEquals(b, 0, "%PDF")) return "application/pdf";
  return null;
}

/**
 * 读取图片像素尺寸（宽 / 高）。
 *
 * 支持 PNG / JPEG / GIF / BMP / WebP（VP8 / VP8L / VP8X）。无法解析返回 null。
 * 纯函数、无 IO；用于写入 media.width / height 并驱动缩略图等比计算。
 */
export function readImageDimensions(buffer: Buffer | null | undefined): MediaDimension | null {
  if (!buffer || buffer.length < 10) return null;
  const b = buffer;

  // PNG：IHDR 位于固定偏移（宽 uint32BE @16 / 高 @20）
  if (bytesAt(b, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    if (b.length < 24) return null;
    const width = readUIntBE(b, 16, 4);
    const height = readUIntBE(b, 20, 4);
    return width > 0 && height > 0 ? { width, height } : null;
  }

  // GIF：宽 uint16LE @6 / 高 @8
  if (asciiEquals(b, 0, "GIF87a") || asciiEquals(b, 0, "GIF89a")) {
    const width = readUIntLE(b, 6, 2);
    const height = readUIntLE(b, 8, 2);
    return width > 0 && height > 0 ? { width, height } : null;
  }

  // BMP：宽 int32LE @18 / 高 @22（高度可能为负表示自顶向下，取绝对值）
  if (asciiEquals(b, 0, "BM")) {
    const width = Math.abs(readUIntLE(b, 18, 4));
    const height = Math.abs(readUIntLE(b, 22, 4));
    return width > 0 && height > 0 ? { width, height } : null;
  }

  // WebP：RIFF....WEBP + 子块
  if (asciiEquals(b, 0, "RIFF") && asciiEquals(b, 8, "WEBP")) {
    return readWebpDimensions(b);
  }

  // JPEG：扫描 SOF 段
  if (bytesAt(b, 0, [0xff, 0xd8])) {
    return readJpegDimensions(b);
  }

  return null;
}

/** JPEG：遍历段，命中 SOF0~SOF15（除 DHT/DAC/RST）即读出高/宽 */
function readJpegDimensions(b: Buffer): MediaDimension | null {
  let offset = 2;
  while (offset + 9 < b.length) {
    if (b[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = b[offset + 1];
    // 填充字节 0xFF
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // 无长度字段的标记
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const segLength = readUIntBE(b, offset + 2, 2);
    // SOF0~SOF15（排除 DHT=0xC4 / JPG=0xC8 / DAC=0xCC）
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = readUIntBE(b, offset + 5, 2);
      const width = readUIntBE(b, offset + 7, 2);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    // SOS 之后是熵编码数据，无可解析尺寸段
    if (marker === 0xda) return null;
    if (segLength < 2) return null;
    offset += 2 + segLength;
  }
  return null;
}

/** WebP：支持 VP8（有损）/ VP8L（无损）/ VP8X（扩展）三种子块 */
function readWebpDimensions(b: Buffer): MediaDimension | null {
  const chunk = b.length >= 16 ? b.toString("ascii", 12, 16) : "";
  if (chunk === "VP8X" && b.length >= 30) {
    // 24-bit LE canvas 尺寸，取值为 实际尺寸 - 1
    const width = 1 + readUIntLE(b, 24, 3);
    const height = 1 + readUIntLE(b, 27, 3);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (chunk === "VP8 " && b.length >= 30) {
    // VP8 有损：帧头 0x9d 0x01 0x2a，随后 16-bit LE 宽 / 高（低 14 位有效）
    const width = readUIntLE(b, 26, 2) & 0x3fff;
    const height = readUIntLE(b, 28, 2) & 0x3fff;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (chunk === "VP8L" && b.length >= 25) {
    // VP8L 无损：signature 0x2f，随后 14-bit 宽/高（减 1）
    if (b[20] !== 0x2f) return null;
    const bits = readUIntLE(b, 21, 4);
    const width = 1 + (bits & 0x3fff);
    const height = 1 + ((bits >> 14) & 0x3fff);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  return null;
}
