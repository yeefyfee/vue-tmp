import { Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../common/prisma/prisma.service";
import { toBigInt } from "../common/prisma/prisma-ids";
import { RequestContext } from "../common/context/request-context";
import { ErrorCode } from "../common/enums/error-code.enum";
import { BusinessException } from "../common/exceptions/business.exception";
import { SseService } from "../message/sse.service";
import { CreateRoomDto } from "./dto/create-room.dto";
import { UpdateRoomDto } from "./dto/update-room.dto";
import { QueryRoomDto } from "./dto/query-room.dto";
import { UpdateRoomStatusDto } from "./dto/update-room-status.dto";

/**
 * 排序字段白名单：sortBy 必须落在集合内，否则回落默认值。
 * 防止把任意字符串透传给 orderBy（既是防注入，也是防无索引全表排序）。
 */
const SORTABLE_FIELDS = ["createdAt", "roomNo", "roomType", "status"] as const;
type SortableField = (typeof SORTABLE_FIELDS)[number];

/**
 * 房间资源服务（P0-04-03 · FR-2）
 *
 * 数据访问统一走 `prisma.scoped.room`（租户隔离扩展自动注入 tenantId 条件，
 * RLS 兜底）；**业务代码绝不从请求参数读取 tenantId**——创建/更新归属一律
 * 以 `RequestContext.getTenantId()`（JWT payload）为锚点。
 *
 * 契约口径（与门店档案 store 域同构）：
 *  - 分页返回 `{ data, page: { pageNum, pageSize, total } }`，
 *    由全局 ResponseInterceptor 改写成 `list/total/page/page_size` 信封；
 *  - 软删（deletedAt = now），列表/详情/更新入口一律过滤 `deletedAt: null`；
 *  - 乐观锁：update 以 `where: { id, version }` 提交，不匹配抛 `ROOM_VERSION_CONFLICT`。
 *
 * 房态口径：status 为运行时房态（1 空/2 在住/3 清扫/4 维护），1/2/3 由 stay
 * 状态机自动流转（后续任务）；本服务的人工写入口仅「维护切换」（4↔1），
 * 其他目标值拒绝（ROOM_STATUS_INVALID）。写操作日志暂不挂（log-module.enum 禁区）。
 */
@Injectable()
export class RoomService {
  constructor(
    private readonly prisma: PrismaService,
    // SSE 推送（MVP-WEB-03-02）：@Optional 保证单测直构签名不变；未注入则静默
    @Optional() private readonly sseService?: SseService
  ) {}

  /**
   * 通知工作台刷新（MVP-WEB-03-02）：房态读写会改变「在店宠物」等读数，
   * 推送租户级 dashboard 变更信号。最佳努力，失败不影响主流程。
   */
  private notifyDashboardChanged(reason: string): void {
    try {
      this.sseService?.sendDashboardChange(
        RequestContext.getTenantId(),
        reason,
        RequestContext.getStoreId()
      );
    } catch {
      // 推送失败不影响业务写入
    }
  }

  /**
   * 创建房间（FR-2）
   *
   * store_id 必填且须为本租户内未软删门店（prisma.scoped.store 校验）；
   * roomNo 同门店内唯一（uk_room_store_no）：应用层先行查重给出友好业务码，
   * 并发兜底由唯一索引 + 全局 filter 完成。createdBy/updatedBy 从 ALS 上下文注入。
   */
  async createRoom(dto: CreateRoomDto) {
    const userId = RequestContext.getUserId();

    // 租户归属只认上下文（@RequireTenant 保证非空；直调场景缺失时 fail-closed 拒绝）
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw new BusinessException(ErrorCode.TENANT_CONTEXT_MISSING);
    }

    const store = await this.prisma.scoped.store.findFirst({
      where: { id: dto.storeId, deletedAt: null },
      select: { id: true },
    });
    if (!store) {
      throw new BusinessException(ErrorCode.ROOM_STORE_INVALID);
    }

    const duplicated = await this.prisma.scoped.room.findFirst({
      where: { storeId: dto.storeId, roomNo: dto.roomNo, deletedAt: null },
      select: { id: true },
    });
    if (duplicated) {
      throw new BusinessException(ErrorCode.ROOM_NO_DUPLICATED);
    }

    const data: Prisma.RoomCreateInput = {
      tenantId: BigInt(tenantId),
      storeId: dto.storeId,
      roomNo: dto.roomNo,
      name: dto.name,
      roomType: dto.roomType ?? 1,
      capacity: dto.capacity ?? 1,
      ...(dto.allowPetSize !== undefined
        ? { allowPetSize: dto.allowPetSize as Prisma.InputJsonValue }
        : {}),
      createdBy: toBigInt(userId),
      updatedBy: toBigInt(userId),
    };

    const created = await this.prisma.scoped.room.create({ data });
    this.notifyDashboardChanged("room.created");
    return created;
  }

  /**
   * 房间分页列表（FR-2）
   *
   * 筛选：storeId / roomType / status / roomNo 前缀；
   * 排序：白名单字段 + ASC/DESC，默认 createdAt desc。
   */
  async getRoomPage(query: QueryRoomDto) {
    const pageNum = Number(query.pageNum) > 0 ? Number(query.pageNum) : 1;
    const pageSize = Number(query.pageSize) > 0 ? Number(query.pageSize) : 20;

    const where: Prisma.RoomWhereInput = { deletedAt: null };
    if (query.storeId) {
      where.storeId = query.storeId;
    }
    if (query.roomType !== undefined && query.roomType !== null) {
      where.roomType = query.roomType;
    }
    if (query.status !== undefined && query.status !== null) {
      where.status = query.status;
    }
    if (query.roomNo) {
      where.roomNo = { startsWith: query.roomNo };
    }

    const sortBy = this.resolveSortField(query.sortBy);
    const order: Prisma.SortOrder = query.order?.toUpperCase() === "ASC" ? "asc" : "desc";
    const orderBy: Prisma.RoomOrderByWithRelationInput = { [sortBy]: order };

    const [list, total] = await Promise.all([
      this.prisma.scoped.room.findMany({
        where,
        orderBy,
        skip: (pageNum - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.scoped.room.count({ where }),
    ]);

    return {
      data: list,
      page: {
        pageNum,
        pageSize,
        total,
      },
    };
  }

  /**
   * 房间详情（FR-2）；已软删记录视为不存在
   */
  async getRoomDetail(id: string) {
    const room = await this.prisma.scoped.room.findFirst({
      where: { id, deletedAt: null },
    });
    if (!room) {
      throw new BusinessException(ErrorCode.ROOM_NOT_FOUND);
    }
    return room;
  }

  /**
   * 更新房间（FR-2，乐观锁）
   *
   * storeId 不可跨店迁移；roomNo 变更时先取现有记录确定门店归属，
   * 再对同门店内新编号查重（排除自身）。乐观锁 `where: { id, version }`：
   * P2025 时回查区分记录不存在（含已软删）抛 ROOM_NOT_FOUND，否则视为版本冲突。
   */
  async updateRoom(id: string, dto: UpdateRoomDto) {
    const userId = RequestContext.getUserId();

    if (dto.roomNo !== undefined) {
      const existing = await this.prisma.scoped.room.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, storeId: true, roomNo: true },
      });
      if (!existing) {
        throw new BusinessException(ErrorCode.ROOM_NOT_FOUND);
      }
      if (dto.roomNo !== existing.roomNo) {
        const duplicated = await this.prisma.scoped.room.findFirst({
          where: {
            storeId: existing.storeId,
            roomNo: dto.roomNo,
            deletedAt: null,
            id: { not: id },
          },
          select: { id: true },
        });
        if (duplicated) {
          throw new BusinessException(ErrorCode.ROOM_NO_DUPLICATED);
        }
      }
    }

    const data: Prisma.RoomUpdateInput = { updatedBy: toBigInt(userId) };
    if (dto.roomNo !== undefined) data.roomNo = dto.roomNo;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.roomType !== undefined) data.roomType = dto.roomType;
    if (dto.capacity !== undefined) data.capacity = dto.capacity;
    if (dto.allowPetSize !== undefined) {
      data.allowPetSize = dto.allowPetSize as Prisma.InputJsonValue;
    }

    try {
      const updated = await this.prisma.scoped.room.update({
        where: { id, version: dto.version, deletedAt: null },
        data: { ...data, version: { increment: 1 } },
      });
      this.notifyDashboardChanged("room.updated");
      return updated;
    } catch (error) {
      if ((error as { code?: string })?.code === "P2025") {
        // 版本不匹配 vs 记录不存在：回查区分，给出精确业务码
        const exists = await this.prisma.scoped.room.findFirst({
          where: { id, deletedAt: null },
          select: { id: true },
        });
        if (!exists) {
          throw new BusinessException(ErrorCode.ROOM_NOT_FOUND);
        }
        throw new BusinessException(ErrorCode.ROOM_VERSION_CONFLICT);
      }
      throw error;
    }
  }

  /**
   * 删除房间（FR-2，软删）：deletedAt = now；软删后列表/详情/更新均不可见
   */
  async softDeleteRoom(id: string) {
    const userId = RequestContext.getUserId();

    const exists = await this.prisma.scoped.room.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!exists) {
      throw new BusinessException(ErrorCode.ROOM_NOT_FOUND);
    }

    await this.prisma.scoped.room.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: toBigInt(userId) },
    });
    this.notifyDashboardChanged("room.deleted");
    return true;
  }

  /**
   * 房态维护切换（FR-2）
   *
   * 人工写入口仅允许 1（空闲）↔ 4（维护中）：目标值为 2/3 等一律拒绝
   * （ROOM_STATUS_INVALID，A0433）——1/2/3 属于 stay 状态机职责（后续任务）。
   * 本端点不走乐观锁（单字段人工操作），version 不递增，与软删同口径。
   */
  async switchRoomStatus(id: string, dto: UpdateRoomStatusDto) {
    const userId = RequestContext.getUserId();

    if (dto.status !== 1 && dto.status !== 4) {
      throw new BusinessException(ErrorCode.ROOM_STATUS_INVALID);
    }

    const exists = await this.prisma.scoped.room.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!exists) {
      throw new BusinessException(ErrorCode.ROOM_NOT_FOUND);
    }

    await this.prisma.scoped.room.update({
      where: { id, deletedAt: null },
      data: { status: dto.status, updatedBy: toBigInt(userId) },
    });
    this.notifyDashboardChanged("room.status");
    return true;
  }

  /**
   * 房态看板数据源（MVP-WEB-09-01 用）
   *
   * 按 status（1~4 全量补零）分组统计 + 房间清单（roomNo/name/roomType/status）；
   * storeId 非本租户门店（或已软删）→ 404（ROOM_STORE_NOT_FOUND，A0435 口径）。
   */
  async getRoomAvailability(storeId: string) {
    const store = await this.prisma.scoped.store.findFirst({
      where: { id: storeId, deletedAt: null },
      select: { id: true },
    });
    if (!store) {
      throw new BusinessException(ErrorCode.ROOM_STORE_NOT_FOUND);
    }

    const [grouped, rooms] = await Promise.all([
      this.prisma.scoped.room.groupBy({
        by: ["status"],
        where: { storeId, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.scoped.room.findMany({
        where: { storeId, deletedAt: null },
        orderBy: [{ roomNo: "asc" }],
        select: { id: true, roomNo: true, name: true, roomType: true, status: true },
      }),
    ]);

    const countByStatus = new Map<number, number>(
      grouped.map((row) => [row.status, row._count._all])
    );
    const summary = [1, 2, 3, 4].map((status) => ({
      status,
      count: countByStatus.get(status) ?? 0,
    }));

    return {
      storeId,
      summary,
      rooms,
    };
  }

  /** 排序字段白名单解析，非法值回落 createdAt */
  private resolveSortField(sortBy?: string): SortableField {
    if (sortBy && (SORTABLE_FIELDS as readonly string[]).includes(sortBy)) {
      return sortBy as SortableField;
    }
    return "createdAt";
  }
}
