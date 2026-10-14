import type { PrismaService } from "../common/prisma/prisma.service";
import { RequestContext } from "../common/context/request-context";
import { BusinessException } from "../common/exceptions/business.exception";

import { RoomService } from "./room.service";
import type { CreateRoomDto } from "./dto/create-room.dto";
import { UpdateRoomDto } from "./dto/update-room.dto";
import { QueryRoomDto } from "./dto/query-room.dto";
import { UpdateRoomStatusDto } from "./dto/update-room-status.dto";

/**
 * 房间资源服务单测（P0-04-03）
 *
 * 覆盖：创建（上下文注入 + 伪造租户忽略 + 门店校验 + roomNo 重复）/
 * 分页（筛选、分页结构、排序白名单回落）/ 详情（存在与缺失）/
 * 更新（乐观锁成功、roomNo 变更重查唯一、版本冲突、记录缺失）/
 * 软删（置位 + 软删后不可见）/ 维护切换（1/4 放行、2/3 拒绝）/
 * availability（分组统计 + 门店无效 404）。
 * PrismaService 全 mock，经 `RequestContext.run` 提供 ALS 上下文（userId=1 / tenantId=1）。
 */
describe("RoomService（P0-04-03 房间资源）", () => {
  const roomDelegate = {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    groupBy: jest.fn(),
  };
  const storeDelegate = { findFirst: jest.fn() };

  const prismaMock = {
    scoped: { room: roomDelegate, store: storeDelegate },
  } as unknown as PrismaService;
  let service: RoomService;

  /** 在 ALS 上下文中执行（userId=1 / tenantId=1），对齐真实请求链路 */
  function withContext<T>(fn: () => Promise<T>): Promise<T> {
    return RequestContext.run(async () => {
      RequestContext.initUserContext({
        userId: "1",
        deptId: "1",
        deptTreePath: "0/1",
        dataScopes: [],
        roles: ["ROOT"],
        tenantId: "1",
      });
      return await fn();
    });
  }

  /** 断言业务异常信封 code（域错误码） */
  async function expectBusinessError(promise: Promise<unknown>, code: string) {
    try {
      await promise;
      throw new Error(`应当抛出业务异常 ${code}，但成功返回了`);
    } catch (error) {
      expect(error).toBeInstanceOf(BusinessException);
      expect((error as BusinessException).getResponse()).toMatchObject({ code });
    }
  }

  const baseCreateDto: CreateRoomDto = {
    storeId: "store-uuid-1",
    roomNo: "A03",
    name: "VIP 大床房",
    roomType: 5,
    capacity: 2,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RoomService(prismaMock);
  });

  it("创建房间：校验门店归属后注入 createdBy/updatedBy 与上下文 tenantId，默认值生效", async () => {
    storeDelegate.findFirst.mockResolvedValueOnce({ id: "store-uuid-1" });
    roomDelegate.findFirst.mockResolvedValueOnce(null);
    const created = { id: "uuid-1", ...baseCreateDto, tenantId: BigInt("1") };
    roomDelegate.create.mockResolvedValueOnce(created);

    const result = await withContext(() => service.createRoom(baseCreateDto));

    expect(result).toBe(created);
    // 门店校验走 scoped.store（租户内 + 未软删）
    expect(storeDelegate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "store-uuid-1", deletedAt: null },
      })
    );
    const args = roomDelegate.create.mock.calls[0][0];
    expect(args.data.createdBy).toBe(BigInt("1"));
    expect(args.data.updatedBy).toBe(BigInt("1"));
    expect(args.data.tenantId).toBe(BigInt("1"));
    expect(args.data.storeId).toBe("store-uuid-1");
    expect(args.data.roomNo).toBe("A03");
    expect(args.data.roomType).toBe(5);
    expect(args.data.capacity).toBe(2);
  });

  it("创建房间：未传 roomType/capacity 时回落默认值 1", async () => {
    storeDelegate.findFirst.mockResolvedValueOnce({ id: "store-uuid-1" });
    roomDelegate.findFirst.mockResolvedValueOnce(null);
    roomDelegate.create.mockResolvedValueOnce({ id: "uuid-1" });

    await withContext(() => service.createRoom({ storeId: "store-uuid-1", roomNo: "B01" }));

    const args = roomDelegate.create.mock.calls[0][0];
    expect(args.data.roomType).toBe(1);
    expect(args.data.capacity).toBe(1);
  });

  it("创建房间：请求参数伪造 tenantId=999 被忽略，归属恒为上下文租户 1", async () => {
    storeDelegate.findFirst.mockResolvedValueOnce({ id: "store-uuid-1" });
    roomDelegate.findFirst.mockResolvedValueOnce(null);
    roomDelegate.create.mockResolvedValueOnce({ id: "uuid-1" });

    // DTO 白名单不含 tenantId，即使恶意构造（模拟绕过 ValidationPipe 的直调）也只认 ALS 上下文
    const malicious = { ...baseCreateDto, tenantId: "999" } as unknown as CreateRoomDto;
    await withContext(() => service.createRoom(malicious));

    const args = roomDelegate.create.mock.calls[0][0];
    expect(args.data.tenantId).toBe(BigInt("1"));
    expect(args.data.tenantId).not.toBe(BigInt("999"));
  });

  it("创建房间：直调无租户上下文 → TENANT_CONTEXT_MISSING（fail-closed）", async () => {
    await expectBusinessError(service.createRoom(baseCreateDto), "A0302");
    expect(roomDelegate.create).not.toHaveBeenCalled();
  });

  it("创建房间：门店不存在（或已软删）→ ROOM_STORE_INVALID（A0434）", async () => {
    storeDelegate.findFirst.mockResolvedValueOnce(null);

    await expectBusinessError(
      withContext(() => service.createRoom(baseCreateDto)),
      "A0434"
    );
    expect(roomDelegate.create).not.toHaveBeenCalled();
  });

  it("创建房间：roomNo 同门店内重复 → ROOM_NO_DUPLICATED（A0431）", async () => {
    storeDelegate.findFirst.mockResolvedValueOnce({ id: "store-uuid-1" });
    roomDelegate.findFirst.mockResolvedValueOnce({ id: "uuid-existing" });

    await expectBusinessError(
      withContext(() => service.createRoom(baseCreateDto)),
      "A0431"
    );
    expect(roomDelegate.create).not.toHaveBeenCalled();
  });

  it("分页：默认条件与分页结构 { data, page }（deletedAt=null 恒过滤）", async () => {
    const row = { id: "uuid-1", roomNo: "A03", tenantId: BigInt("1") };
    roomDelegate.findMany.mockResolvedValueOnce([row]);
    roomDelegate.count.mockResolvedValueOnce(1);

    const result = await withContext(() => service.getRoomPage(new QueryRoomDto()));

    expect(result).toEqual({
      data: [row],
      page: { pageNum: 1, pageSize: 20, total: 1 },
    });
    const args = roomDelegate.findMany.mock.calls[0][0];
    expect(args.where.deletedAt).toBeNull();
    expect(args.skip).toBe(0);
    expect(args.take).toBe(20);
    expect(args.orderBy).toEqual({ createdAt: "desc" });
  });

  it("分页：storeId / roomType / status / roomNo 前缀组合 + 白名单排序 roomNo ASC", async () => {
    roomDelegate.findMany.mockResolvedValueOnce([]);
    roomDelegate.count.mockResolvedValueOnce(0);

    const query = new QueryRoomDto();
    query.storeId = "store-uuid-1";
    query.roomType = 3;
    query.status = 4;
    query.roomNo = "e2e-room";
    query.sortBy = "roomNo";
    query.order = "ASC";
    query.pageNum = 2;
    query.pageSize = 10;
    await withContext(() => service.getRoomPage(query));

    const args = roomDelegate.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      deletedAt: null,
      storeId: "store-uuid-1",
      roomType: 3,
      status: 4,
      roomNo: { startsWith: "e2e-room" },
    });
    expect(args.skip).toBe(10);
    expect(args.take).toBe(10);
    expect(args.orderBy).toEqual({ roomNo: "asc" });
  });

  it("分页：非法 sortBy 白名单回落 createdAt（防任意字段透传）", async () => {
    roomDelegate.findMany.mockResolvedValueOnce([]);
    roomDelegate.count.mockResolvedValueOnce(0);

    const query = new QueryRoomDto();
    query.sortBy = "tenantId; DROP TABLE room;--";
    await withContext(() => service.getRoomPage(query));

    const args = roomDelegate.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual({ createdAt: "desc" });
  });

  it("详情：存在则返回记录", async () => {
    const row = { id: "uuid-1", roomNo: "A03", tenantId: BigInt("1") };
    roomDelegate.findFirst.mockResolvedValueOnce(row);

    const result = await withContext(() => service.getRoomDetail("uuid-1"));

    expect(result).toBe(row);
    expect(roomDelegate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "uuid-1", deletedAt: null } })
    );
  });

  it("详情：不存在（或已软删）→ ROOM_NOT_FOUND（A0430）", async () => {
    roomDelegate.findFirst.mockResolvedValueOnce(null);

    await expectBusinessError(
      withContext(() => service.getRoomDetail("uuid-missing")),
      "A0430"
    );
  });

  it("更新：乐观锁命中则 version 自增并注入 updatedBy", async () => {
    const dto = new UpdateRoomDto();
    dto.version = 0;
    dto.name = "VIP 大床房（改造后）";
    dto.capacity = 3;

    const updated = { id: "uuid-1", name: dto.name, version: 1 };
    roomDelegate.update.mockResolvedValueOnce(updated);

    const result = await withContext(() => service.updateRoom("uuid-1", dto));

    expect(result).toBe(updated);
    const args = roomDelegate.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: "uuid-1", version: 0, deletedAt: null });
    expect(args.data.version).toEqual({ increment: 1 });
    expect(args.data.updatedBy).toBe(BigInt("1"));
    expect(args.data.name).toBe("VIP 大床房（改造后）");
    expect(args.data.capacity).toBe(3);
  });

  it("更新：roomNo 变更时对同门店重查唯一（排除自身）", async () => {
    const dto = new UpdateRoomDto();
    dto.version = 1;
    dto.roomNo = "B01";

    roomDelegate.findFirst
      // 取现有记录确定门店归属
      .mockResolvedValueOnce({ id: "uuid-1", storeId: "store-uuid-1", roomNo: "A03" })
      // 同门店查重：无冲突
      .mockResolvedValueOnce(null);
    roomDelegate.update.mockResolvedValueOnce({ id: "uuid-1", roomNo: "B01", version: 2 });

    await withContext(() => service.updateRoom("uuid-1", dto));

    const dupArgs = roomDelegate.findFirst.mock.calls[1][0];
    expect(dupArgs.where).toEqual({
      storeId: "store-uuid-1",
      roomNo: "B01",
      deletedAt: null,
      id: { not: "uuid-1" },
    });
    const updateArgs = roomDelegate.update.mock.calls[0][0];
    expect(updateArgs.data.roomNo).toBe("B01");
  });

  it("更新：roomNo 变更为同门店已占用编号 → ROOM_NO_DUPLICATED（A0431）", async () => {
    const dto = new UpdateRoomDto();
    dto.version = 1;
    dto.roomNo = "B02";

    roomDelegate.findFirst
      .mockResolvedValueOnce({ id: "uuid-1", storeId: "store-uuid-1", roomNo: "A03" })
      .mockResolvedValueOnce({ id: "uuid-other" });

    await expectBusinessError(
      withContext(() => service.updateRoom("uuid-1", dto)),
      "A0431"
    );
    expect(roomDelegate.update).not.toHaveBeenCalled();
  });

  it("更新：roomNo 未变化（传了相同值）不触发查重", async () => {
    const dto = new UpdateRoomDto();
    dto.version = 1;
    dto.roomNo = "A03";

    roomDelegate.findFirst.mockResolvedValueOnce({
      id: "uuid-1",
      storeId: "store-uuid-1",
      roomNo: "A03",
    });
    roomDelegate.update.mockResolvedValueOnce({ id: "uuid-1", roomNo: "A03", version: 2 });

    await withContext(() => service.updateRoom("uuid-1", dto));

    expect(roomDelegate.findFirst).toHaveBeenCalledTimes(1);
  });

  it("更新：version 不匹配 → ROOM_VERSION_CONFLICT（A0432）", async () => {
    const dto = new UpdateRoomDto();
    dto.version = 0;

    // Prisma P2025（Record to update not found）——但记录实际存在 → 版本冲突
    roomDelegate.update.mockRejectedValueOnce(
      Object.assign(new Error("Record to update not found."), { code: "P2025" })
    );
    roomDelegate.findFirst.mockResolvedValueOnce({ id: "uuid-1" });

    await expectBusinessError(
      withContext(() => service.updateRoom("uuid-1", dto)),
      "A0432"
    );
  });

  it("更新：记录不存在（含已软删）→ ROOM_NOT_FOUND（A0430），而非误报版本冲突", async () => {
    const dto = new UpdateRoomDto();
    dto.version = 3;

    roomDelegate.update.mockRejectedValueOnce(
      Object.assign(new Error("Record to update not found."), { code: "P2025" })
    );
    roomDelegate.findFirst.mockResolvedValueOnce(null);

    await expectBusinessError(
      withContext(() => service.updateRoom("uuid-missing", dto)),
      "A0430"
    );
  });

  it("软删：deletedAt 置位为当前时间，软删后详情不可见（A0430）", async () => {
    roomDelegate.findFirst
      // 软删前的存在性检查
      .mockResolvedValueOnce({ id: "uuid-1" })
      // 软删后的详情查询：查不到（deletedAt: null 过滤生效）
      .mockResolvedValueOnce(null);
    roomDelegate.update.mockResolvedValueOnce({ id: "uuid-1", deletedAt: new Date() });

    await withContext(() => service.softDeleteRoom("uuid-1"));

    const deleteArgs = roomDelegate.update.mock.calls[0][0];
    expect(deleteArgs.where).toEqual({ id: "uuid-1" });
    expect(deleteArgs.data.deletedAt).toBeInstanceOf(Date);
    expect(deleteArgs.data.updatedBy).toBe(BigInt("1"));

    await expectBusinessError(
      withContext(() => service.getRoomDetail("uuid-1")),
      "A0430"
    );
  });

  it("软删：记录不存在（或已软删）→ ROOM_NOT_FOUND（A0430）", async () => {
    roomDelegate.findFirst.mockResolvedValueOnce(null);

    await expectBusinessError(
      withContext(() => service.softDeleteRoom("uuid-missing")),
      "A0430"
    );
    expect(roomDelegate.update).not.toHaveBeenCalled();
  });

  it("维护切换：目标 4（维护）与 1（空闲恢复）均放行，注入 updatedBy", async () => {
    roomDelegate.findFirst.mockResolvedValue({ id: "uuid-1" });
    roomDelegate.update.mockResolvedValue({ id: "uuid-1", status: 4 });

    const toMaintenance = new UpdateRoomStatusDto();
    toMaintenance.status = 4;
    await withContext(() => service.switchRoomStatus("uuid-1", toMaintenance));
    expect(roomDelegate.update.mock.calls[0][0].data).toMatchObject({
      status: 4,
      updatedBy: BigInt("1"),
    });

    const backToAvailable = new UpdateRoomStatusDto();
    backToAvailable.status = 1;
    await withContext(() => service.switchRoomStatus("uuid-1", backToAvailable));
    expect(roomDelegate.update.mock.calls[1][0].data).toMatchObject({
      status: 1,
      updatedBy: BigInt("1"),
    });
    // 单字段人工操作不走乐观锁：where 只带 id + 未删过滤，version 不递增
    expect(roomDelegate.update.mock.calls[0][0].where).toEqual({ id: "uuid-1", deletedAt: null });
    expect(roomDelegate.update.mock.calls[0][0].data.version).toBeUndefined();
  });

  it("维护切换：目标 2/3 等非 1/4 值 → ROOM_STATUS_INVALID（A0433）", async () => {
    for (const invalid of [2, 3, 99]) {
      const dto = new UpdateRoomStatusDto();
      dto.status = invalid;
      await expectBusinessError(
        withContext(() => service.switchRoomStatus("uuid-1", dto)),
        "A0433"
      );
    }
    expect(roomDelegate.update).not.toHaveBeenCalled();
  });

  it("维护切换：房间不存在（或已软删）→ ROOM_NOT_FOUND（A0430）", async () => {
    roomDelegate.findFirst.mockResolvedValueOnce(null);
    const dto = new UpdateRoomStatusDto();
    dto.status = 4;

    await expectBusinessError(
      withContext(() => service.switchRoomStatus("uuid-missing", dto)),
      "A0430"
    );
    expect(roomDelegate.update).not.toHaveBeenCalled();
  });

  it("availability：按 status 全量分组统计（缺组补零）+ 房间清单按 roomNo 排序", async () => {
    storeDelegate.findFirst.mockResolvedValueOnce({ id: "store-uuid-1" });
    roomDelegate.groupBy.mockResolvedValueOnce([
      { status: 1, _count: { _all: 3 } },
      { status: 4, _count: { _all: 2 } },
    ]);
    const rooms = [
      { id: "uuid-1", roomNo: "A01", name: null, roomType: 1, status: 1 },
      { id: "uuid-2", roomNo: "A03", name: "VIP", roomType: 5, status: 4 },
    ];
    roomDelegate.findMany.mockResolvedValueOnce(rooms);

    const result = await withContext(() => service.getRoomAvailability("store-uuid-1"));

    expect(result).toEqual({
      storeId: "store-uuid-1",
      summary: [
        { status: 1, count: 3 },
        { status: 2, count: 0 },
        { status: 3, count: 0 },
        { status: 4, count: 2 },
      ],
      rooms,
    });
    expect(roomDelegate.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ["status"],
        where: { storeId: "store-uuid-1", deletedAt: null },
      })
    );
    const listArgs = roomDelegate.findMany.mock.calls[0][0];
    expect(listArgs.where).toEqual({ storeId: "store-uuid-1", deletedAt: null });
    expect(listArgs.orderBy).toEqual([{ roomNo: "asc" }]);
    expect(listArgs.select).toEqual({
      id: true,
      roomNo: true,
      name: true,
      roomType: true,
      status: true,
    });
  });

  it("availability：门店不存在（或已软删）→ ROOM_STORE_NOT_FOUND（A0435，404 口径）", async () => {
    storeDelegate.findFirst.mockResolvedValueOnce(null);

    await expectBusinessError(
      withContext(() => service.getRoomAvailability("store-missing")),
      "A0435"
    );
    expect(roomDelegate.groupBy).not.toHaveBeenCalled();
    expect(roomDelegate.findMany).not.toHaveBeenCalled();
  });
});
