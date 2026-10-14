import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  LocalStorageDriver,
  MemoryStorageDriver,
  S3StorageDriver,
  OssStorageDriver,
  createStorageDriver,
  normalizeDriverName,
  resolveMediaStorageConfig,
  type MediaStorageConfig,
} from "./media.storage";

/**
 * 媒体存储驱动（P0-08-02）单测：内存 / 本地驱动行为、工厂选择、配置解析、路径穿越防护。
 */
describe("media.storage · 存储驱动", () => {
  let tmpRoot: string;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "peluvida-media-spec-"));
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("normalizeDriverName：非法 / 缺失回落 local", () => {
    expect(normalizeDriverName("S3")).toBe("s3");
    expect(normalizeDriverName(" memory ")).toBe("memory");
    expect(normalizeDriverName("nope")).toBe("local");
    expect(normalizeDriverName(undefined)).toBe("local");
  });

  it("resolveMediaStorageConfig：读取 env 并归一", () => {
    const cfg = resolveMediaStorageConfig({
      MEDIA_STORAGE_DRIVER: "s3",
      MEDIA_S3_ENDPOINT: "http://localhost:9000",
      MEDIA_S3_BUCKET: "media-bucket",
      MEDIA_PUBLIC_BASE_URL: "https://cdn.example.com/",
    });
    expect(cfg.driver).toBe("s3");
    expect(cfg.s3.endpoint).toBe("http://localhost:9000");
    expect(cfg.s3.bucket).toBe("media-bucket");
    expect(cfg.s3.region).toBe("us-east-1");
    // 尾斜杠被裁剪
    expect(cfg.publicBaseUrl).toBe("https://cdn.example.com");

    const empty = resolveMediaStorageConfig({});
    expect(empty.driver).toBe("local");
    expect(empty.local.root).toContain("peluvida-media");
  });

  it("MemoryStorageDriver：落盘 / 读取 / 删除 / 公开 URL；预签名为 direct", async () => {
    const driver = new MemoryStorageDriver();
    expect(driver.driver).toBe("memory");
    const presigned = await driver.presignPut({ objectKey: "a/b.png", expiresIn: 60 });
    expect(presigned.uploadMode).toBe("direct");
    expect(presigned.uploadUrl).toBeNull();

    const stored = await driver.putObject("a/b.png", Buffer.from("hello"));
    expect(stored.url).toBe("memory://a/b.png");
    expect((await driver.readObject("a/b.png"))?.toString()).toBe("hello");
    expect(await driver.deleteObject("a/b.png")).toBe(true);
    expect(await driver.readObject("a/b.png")).toBeNull();
  });

  it("LocalStorageDriver：写入 / 读取 / 删除 + 相对 URL", async () => {
    const driver = new LocalStorageDriver(tmpRoot, "https://cdn.test");
    const stored = await driver.putObject("media/pet/1/x/1.png", Buffer.from("png-bytes"));
    expect(stored.url).toBe("https://cdn.test/media/pet/1/x/1.png");
    expect((await driver.readObject("media/pet/1/x/1.png"))?.toString()).toBe("png-bytes");
    expect(fs.existsSync(path.join(tmpRoot, "media/pet/1/x/1.png"))).toBe(true);
    expect(await driver.deleteObject("media/pet/1/x/1.png")).toBe(true);
    // 删除不存在文件返回 false（不抛）
    expect(await driver.deleteObject("media/pet/1/x/1.png")).toBe(false);
  });

  it("LocalStorageDriver：路径穿越被拒（MEDIA_STORAGE_UNAVAILABLE）", async () => {
    const driver = new LocalStorageDriver(tmpRoot, "");
    await expect(driver.putObject("../../evil.txt", Buffer.from("x"))).rejects.toMatchObject({
      response: { code: "A0717" },
    });
  });

  it("createStorageDriver：按配置选择实现", () => {
    const base: MediaStorageConfig = resolveMediaStorageConfig({});
    expect(createStorageDriver({ ...base, driver: "memory" })).toBeInstanceOf(MemoryStorageDriver);
    expect(createStorageDriver({ ...base, driver: "local" })).toBeInstanceOf(LocalStorageDriver);
    expect(createStorageDriver({ ...base, driver: "s3" })).toBeInstanceOf(S3StorageDriver);
    expect(createStorageDriver({ ...base, driver: "oss" })).toBeInstanceOf(OssStorageDriver);
  });

  it("S3StorageDriver：凭证缺失时预签名抛 MEDIA_STORAGE_UNAVAILABLE（不硬崩）", async () => {
    const driver = new S3StorageDriver(
      {
        endpoint: "",
        region: "us-east-1",
        accessKey: "",
        secretKey: "",
        bucket: "",
        forcePathStyle: true,
      },
      ""
    );
    await expect(driver.presignPut({ objectKey: "k", expiresIn: 60 })).rejects.toMatchObject({
      response: { code: "A0717" },
    });
  });
});
