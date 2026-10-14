import { sniffMimeType, readImageDimensions, isSupportedImageMime } from "./media-image.util";

/**
 * 媒体图像元数据解析（P0-08-03）单测：魔数嗅探 + 尺寸探测（纯函数，无 IO）
 */
describe("media-image.util · 魔数嗅探与尺寸解析", () => {
  /** 构造一个含 IHDR 的 PNG 头（宽 @16 / 高 @20，big-endian） */
  function makePng(width: number, height: number): Buffer {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    Buffer.from([0x00, 0x00, 0x00, 0x0d]).copy(b, 8);
    Buffer.from("IHDR", "ascii").copy(b, 12);
    b.writeUInt32BE(width, 16);
    b.writeUInt32BE(height, 20);
    return b;
  }

  function makeGif(width: number, height: number): Buffer {
    const b = Buffer.alloc(16);
    b.write("GIF89a", 0, "ascii");
    b.writeUInt16LE(width, 6);
    b.writeUInt16LE(height, 8);
    return b;
  }

  function makeBmp(width: number, height: number): Buffer {
    const b = Buffer.alloc(30);
    b.write("BM", 0, "ascii");
    b.writeUInt32LE(width, 18);
    b.writeUInt32LE(height, 22);
    return b;
  }

  function makeWebpVp8x(width: number, height: number): Buffer {
    const b = Buffer.alloc(32);
    b.write("RIFF", 0, "ascii");
    b.write("WEBP", 8, "ascii");
    b.write("VP8X", 12, "ascii");
    const w = width - 1;
    const h = height - 1;
    b[24] = w & 0xff;
    b[25] = (w >> 8) & 0xff;
    b[26] = (w >> 16) & 0xff;
    b[27] = h & 0xff;
    b[28] = (h >> 8) & 0xff;
    b[29] = (h >> 16) & 0xff;
    return b;
  }

  function makeJpeg(width: number, height: number): Buffer {
    const b = Buffer.alloc(32);
    b[0] = 0xff;
    b[1] = 0xd8;
    // APP0 段：FF E0 + 长度(含自身 2 字节)=16 → 段占 2(标记) + 16 = 18 字节（偏移 2..19）
    b[2] = 0xff;
    b[3] = 0xe0;
    b.writeUInt16BE(16, 4);
    // SOF0：下一段起于偏移 20（FF C0 + 长度 + 精度 + 高 + 宽）
    b[20] = 0xff;
    b[21] = 0xc0;
    b.writeUInt16BE(17, 22);
    b[24] = 8; // 精度
    b.writeUInt16BE(height, 25);
    b.writeUInt16BE(width, 27);
    return b;
  }

  it("sniffMimeType：按魔数识别常见格式", () => {
    expect(sniffMimeType(makePng(1, 1))).toBe("image/png");
    expect(sniffMimeType(makeGif(1, 1))).toBe("image/gif");
    expect(sniffMimeType(makeBmp(1, 1))).toBe("image/bmp");
    expect(sniffMimeType(makeWebpVp8x(2, 2))).toBe("image/webp");
    expect(sniffMimeType(makeJpeg(2, 2))).toBe("image/jpeg");
    expect(sniffMimeType(Buffer.from("PK\u0003\u0004xxxxxxxx", "binary"))).toBeNull();
    expect(sniffMimeType(Buffer.alloc(0))).toBeNull();
    expect(sniffMimeType(null)).toBeNull();
  });

  it("readImageDimensions：PNG / GIF / BMP / WebP / JPEG", () => {
    expect(readImageDimensions(makePng(240, 320))).toEqual({ width: 240, height: 320 });
    expect(readImageDimensions(makeGif(120, 80))).toEqual({ width: 120, height: 80 });
    expect(readImageDimensions(makeBmp(500, 400))).toEqual({ width: 500, height: 400 });
    expect(readImageDimensions(makeWebpVp8x(321, 241))).toEqual({ width: 321, height: 241 });
    expect(readImageDimensions(makeJpeg(200, 100))).toEqual({ width: 200, height: 100 });
  });

  it("readImageDimensions：无法解析返回 null", () => {
    expect(
      readImageDimensions(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09]))
    ).toBeNull();
    expect(readImageDimensions(Buffer.alloc(0))).toBeNull();
    expect(readImageDimensions(null)).toBeNull();
  });

  it("isSupportedImageMime：大小写归一", () => {
    expect(isSupportedImageMime("image/png")).toBe(true);
    expect(isSupportedImageMime(" IMAGE/JPEG ")).toBe(true);
    expect(isSupportedImageMime("application/pdf")).toBe(false);
    expect(isSupportedImageMime(null)).toBe(false);
  });
});
