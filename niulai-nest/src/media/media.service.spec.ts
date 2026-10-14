import { ImageProcessingService } from "./media-image.service";
import { MediaService, toMediaView } from "./media.service";
import { RequestContext } from "../common/context/request-context";
import type { PrismaService } from "../common/prisma/prisma.service";
import { QueryMediaDto } from "./dto/query-media.dto";

/**
 * 媒体服务（P0-08）单测：视图字符串化、列表筛选（含查询串布尔踩坑回归）、
 * 配额 / 状态 / 版本 / 缺文件等错误路径（mock Prisma，无 DB）。
 */
describe("media.service · 服务逻辑", () => {
  /** 构造最小 media 行 */
  function mediaRow(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: "11111111-1111-4111-8111-111111111111",
      tenantId: 1n,
      storeId: null,
      refType: "pet",
      refId: "pet-1",
      mediaType: 1,
      storageDriver: "local",
      bucket: null,
      objectKey: "media/pet/1/pet-1/x.png",
      url: "/media/pet/1/pet-1/x.png",
      thumbnailUrl: null,
      watermarked: false,
      mimeType: "image/png",
      fileSize: 12n,
      width: 10,
      height: 10,
      sort: 0,
      visibleToOwner: true,
      uploadStatus: 2,
      uploadedBy: null,
      confirmedAt: new Date("2026-10-08T00:00:00.000Z"),
      createdAt: new Date("2026-10-08T00:00:00.000Z"),
      updatedAt: new Date("2026-10-08T00:00:00.000Z"),
      version: 1,
      ...over,
    };
  }

  function build(prisma: unknown): MediaService {
    return new MediaService(prisma as PrismaService, new ImageProcessingService());
  }

  it("toMediaView：BigInt 字段字符串化（tenantId / fileSize / uploadedBy）", () => {
    const view = toMediaView(mediaRow({ fileSize: 2048n, uploadedBy: 7n }) as never);
    expect(view.tenantId).toBe("1");
    expect(view.fileSize).toBe("2048");
    expect(view.uploadedBy).toBe("7");
    expect(view.thumbnailUrl).toBeNull();
  });

  it("list：visibleToOwner=false 显式解析为布尔（查询串布尔踩坑回归）", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const prisma = {
      scoped: {
        media: {
          findMany: jest.fn(async (args: Record<string, unknown>) => {
            calls.push(args);
            return [];
          }),
          count: jest.fn(async () => 0),
        },
      },
    };
    const svc = build(prisma);
    const query = Object.assign(new QueryMediaDto(), {
      refType: "pet",
      refId: "pet-1",
      visibleToOwner: "false",
      page: 2,
      page_size: 5,
    });
    const result = await svc.list(query);

    const where = calls[0].where as Record<string, unknown>;
    expect(where.visibleToOwner).toBe(false);
    expect(where.refType).toBe("pet");
    expect(where.refId).toBe("pet-1");
    expect(result.page).toEqual({ page: 2, page_size: 5, total: 0 });
  });

  it("detail：不存在 → A0711", async () => {
    const prisma = {
      scoped: { media: { findFirst: jest.fn(async () => null) } },
    };
    await expect(
      build(prisma).detail("11111111-1111-4111-8111-111111111111")
    ).rejects.toMatchObject({
      response: { code: "A0711" },
    });
  });

  it("presign：图片配额已达 9 → A0712", async () => {
    const prisma = {
      scoped: {
        pet: { findFirst: jest.fn(async () => ({ id: "pet-1" })) },
        media: { count: jest.fn(async () => 9), create: jest.fn() },
      },
    };
    await RequestContext.run(async () => {
      RequestContext.setTenantId("1");
      await expect(
        build(prisma).presign({
          refType: "pet",
          refId: "pet-1",
          mimeType: "image/png",
        })
      ).rejects.toMatchObject({ response: { code: "A0712" } });
    });
  });

  it("presign：关联宠物不存在 → A0601", async () => {
    const prisma = {
      scoped: {
        pet: { findFirst: jest.fn(async () => null) },
        media: { count: jest.fn(async () => 0), create: jest.fn() },
      },
    };
    await RequestContext.run(async () => {
      RequestContext.setTenantId("1");
      await expect(
        build(prisma).presign({ refType: "pet", refId: "missing", mimeType: "image/png" })
      ).rejects.toMatchObject({ response: { code: "A0601" } });
    });
  });

  it("update：版本不一致 → A0715", async () => {
    const prisma = {
      scoped: {
        media: {
          findFirst: jest.fn(async () => mediaRow({ version: 3 })),
          update: jest.fn(),
        },
      },
    };
    await expect(
      build(prisma).update("11111111-1111-4111-8111-111111111111", {
        version: 1,
        visibleToOwner: false,
      })
    ).rejects.toMatchObject({ response: { code: "A0715" } });
  });

  it("confirm：已确认记录重复确认 → A0713", async () => {
    const prisma = {
      scoped: {
        media: {
          findFirst: jest.fn(async () => mediaRow({ uploadStatus: 2 })),
          update: jest.fn(),
        },
      },
    };
    await expect(
      build(prisma).confirm("11111111-1111-4111-8111-111111111111", {})
    ).rejects.toMatchObject({ response: { code: "A0713" } });
  });

  it("directUpload：缺少文件 → A0718", async () => {
    const prisma = { scoped: { media: {}, pet: {} } };
    await RequestContext.run(async () => {
      RequestContext.setTenantId("1");
      await expect(
        build(prisma).directUpload({ refType: "pet", refId: "pet-1" }, undefined as never)
      ).rejects.toMatchObject({ response: { code: "A0718" } });
    });
  });
});
