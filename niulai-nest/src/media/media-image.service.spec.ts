import {
  ImageProcessingService,
  PassthroughImageProcessor,
  resolveImageProcessor,
  type ImageProcessOptions,
  type ImageProcessOutput,
  type ImageProcessor,
} from "./media-image.service";

/**
 * 媒体图片处理服务（P0-08-03）单测。
 *
 * 环境无 sharp → 默认引擎为 passthrough；覆盖「非图片空产出 / 图片尺寸探测 /
 * 引擎异常降级不阻断」三类行为。
 */
describe("media-image.service · 图片处理（可降级）", () => {
  function makePng(width: number, height: number): Buffer {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    Buffer.from([0x00, 0x00, 0x00, 0x0d]).copy(b, 8);
    Buffer.from("IHDR", "ascii").copy(b, 12);
    b.writeUInt32BE(width, 16);
    b.writeUInt32BE(height, 20);
    return b;
  }

  it("resolveImageProcessor：无 sharp 时降级为 passthrough", () => {
    expect(resolveImageProcessor()).toBeInstanceOf(PassthroughImageProcessor);
    expect(resolveImageProcessor().name).toBe("passthrough");
  });

  it("PassthroughImageProcessor：探测尺寸，不产出缩略图 / 水印", async () => {
    const svc = new ImageProcessingService(new PassthroughImageProcessor());
    expect(svc.engineName).toBe("passthrough");

    const out = await svc.process(makePng(1000, 500), {
      mimeType: "image/png",
      watermarkText: "PeluVida",
    });
    expect(out.width).toBe(1000);
    expect(out.height).toBe(500);
    expect(out.thumbnail).toBeNull();
    expect(out.watermarked).toBeNull();
    expect(out.engine).toBe("passthrough");
  });

  it("非图片 / 不支持 → 空产出", async () => {
    const svc = new ImageProcessingService(new PassthroughImageProcessor());
    const out = await svc.process(Buffer.from("pdf"), { mimeType: "application/pdf" });
    expect(out).toMatchObject({ thumbnail: null, watermarked: null, width: null, height: null });
  });

  it("引擎抛错 → 降级为原图（不阻断上传），engine 带 fallback 后缀", async () => {
    const throwing: ImageProcessor = {
      name: "boom",
      supports: () => true,
      process: async (): Promise<ImageProcessOutput> => {
        throw new Error("boom");
      },
    };
    const svc = new ImageProcessingService(throwing);
    const out = await svc.process(makePng(40, 20), {
      mimeType: "image/png",
    } as ImageProcessOptions);
    expect(out.thumbnail).toBeNull();
    expect(out.watermarked).toBeNull();
    expect(out.width).toBe(40);
    expect(out.height).toBe(20);
    expect(out.engine).toBe("boom:fallback");
  });
});
