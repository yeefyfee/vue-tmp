import { Injectable } from "@nestjs/common";
import { Prisma, type PetTransferRequest } from "@prisma/client";

import { PrismaService } from "../common/prisma/prisma.service";
import { toBigInt } from "../common/prisma/prisma-ids";
import { RequestContext } from "../common/context/request-context";
import { ErrorCode } from "../common/enums/error-code.enum";
import { BusinessException } from "../common/exceptions/business.exception";
import { endOfDay, parseWallClock } from "../common/utils/date.util";
import { CreateTransferDto } from "./dto/create-transfer.dto";
import { RejectTransferDto } from "./dto/reject-transfer.dto";
import { QueryTransferDto } from "./dto/query-transfer.dto";

/**
 * 转移申请状态机（pet_transfer_request.status；SmallInt）。
 * 合法跃迁：1 待审批 → 2 已通过 / 3 已拒绝 / 4 已撤销（终态不可再流转）。
 */
export const PetTransferStatus = {
  /** 待审批 */
  PENDING: 1,
  /** 已通过（归属已变更） */
  APPROVED: 2,
  /** 已拒绝 */
  REJECTED: 3,
  /** 已撤销 */
  CANCELLED: 4,
} as const;
export type PetTransferStatus = (typeof PetTransferStatus)[keyof typeof PetTransferStatus];

/**
 * 转移申请列表行（`PetTransferRequest` + 服务端补齐的展示字段）
 *
 * `petName` / `petType` / `fromCustomerName` / `toCustomerName` 为**回查**值，
 * 关联实体缺失（历史脏数据 / 已物理清理）时为 `null`，前端须有兜底文案。
 */
export interface PetTransferListItem extends PetTransferRequest {
  readonly petName: string | null;
  readonly petType: number | null;
  readonly fromCustomerName: string | null;
  readonly toCustomerName: string | null;
}

/** 排序字段白名单：sortBy 必须落在集合内，否则回落默认值（防注入 / 防无索引排序） */
const SORTABLE_FIELDS = ["createdAt"] as const;
type SortableField = (typeof SORTABLE_FIELDS)[number];

/**
 * 宠物转移申请服务（P0-05-03 · FR-2 多宠物归属，转移需审批）
 *
 * 核心不变式：
 *  1. **未审批不可变更归属** —— 发起申请只落一行 status=1，**不动** pet.ownerCustomerId
 *     与 customer_pet 关联；仅「审批通过」在**同一事务内**完成归属变更；
 *  2. **同一 pet 同时仅一条 pending 申请** —— 应用层查重（A0515）+
 *     部分唯一索引 uk_pet_transfer_request_pending（WHERE status=1）并发兜底；
 *  3. **审批并发安全** —— 审批以「申请行 status=1 + version」乐观锁推进状态，
 *     并二次校验宠物现行主人仍等于发起时快照（fromCustomerId），任一不符即拒绝，
 *     防止并发双批 / 申请期间归属被他人改动导致错改。
 *
 * 数据访问统一走 `prisma.scoped.*`（租户隔离扩展自动注入 tenantId，RLS 兜底）；
 * 业务代码绝不从请求参数读取 tenantId——归属以 `RequestContext.getTenantId()` 为锚点。
 */
@Injectable()
export class PetTransferService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 发起宠物转移申请（FR-2）。
   *
   * 校验：宠物属当前租户（A0601）→ 目标客户≠当前主人（A0518）→ 目标客户同租户有效
   * （A0517）→ 该宠物无在途申请（A0515）。通过后落一行 status=1（待审批），
   * **此处不改变任何归属**。并发撞部分唯一索引 → P2002 兜底转 A0515。
   */
  async createTransfer(petId: string, dto: CreateTransferDto) {
    const userId = RequestContext.getUserId();
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw new BusinessException(ErrorCode.TENANT_CONTEXT_MISSING);
    }

    const pet = await this.prisma.scoped.pet.findFirst({
      where: { id: petId, deletedAt: null },
      select: { id: true, ownerCustomerId: true },
    });
    if (!pet) {
      throw new BusinessException(ErrorCode.PET_NOT_FOUND);
    }
    const fromCustomerId = pet.ownerCustomerId;

    if (dto.toCustomerId === fromCustomerId) {
      throw new BusinessException(ErrorCode.PET_TRANSFER_SELF);
    }
    await this.assertCustomerExists(dto.toCustomerId);

    const pending = await this.prisma.scoped.petTransferRequest.findFirst({
      where: { petId, status: PetTransferStatus.PENDING, deletedAt: null },
      select: { id: true },
    });
    if (pending) {
      throw new BusinessException(ErrorCode.PET_TRANSFER_ALREADY_PENDING);
    }

    const data: Prisma.PetTransferRequestUncheckedCreateInput = {
      tenantId: BigInt(tenantId),
      petId,
      fromCustomerId,
      toCustomerId: dto.toCustomerId,
      status: PetTransferStatus.PENDING,
      reason: dto.reason ?? null,
      appliedBy: toBigInt(userId),
      createdBy: toBigInt(userId),
      updatedBy: toBigInt(userId),
    };

    try {
      return await this.prisma.scoped.petTransferRequest.create({ data });
    } catch (error) {
      // 并发兜底：查重与写入之间的竞态窗口撞部分唯一索引 → A0515
      if ((error as { code?: string })?.code === "P2002") {
        throw new BusinessException(ErrorCode.PET_TRANSFER_ALREADY_PENDING);
      }
      throw error;
    }
  }

  /**
   * 审批通过转移申请（FR-2）。
   *
   * **事务内**：推进申请 status=1→2（乐观锁 version + status）→ 改 pet.ownerCustomerId
   * = 目标客户 → 旧客户关联软删 + 新客户关联建立。任一前置校验（申请存在 / 状态 /
   * 归属快照一致）不满足即拒绝并回滚。并发双批由乐观锁拦截（P2025 → A0516）。
   */
  async approveTransfer(id: string) {
    const userId = RequestContext.getUserId();
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw new BusinessException(ErrorCode.TENANT_CONTEXT_MISSING);
    }

    try {
      return await this.prisma.scoped.$transaction(async (tx) => {
        const request = await tx.petTransferRequest.findFirst({
          where: { id, deletedAt: null },
        });
        if (!request) {
          throw new BusinessException(ErrorCode.PET_TRANSFER_NOT_FOUND);
        }
        if (request.status !== PetTransferStatus.PENDING) {
          throw new BusinessException(ErrorCode.PET_TRANSFER_STATUS_INVALID);
        }

        const pet = await tx.pet.findFirst({
          where: { id: request.petId, deletedAt: null },
          select: { id: true, name: true, petType: true, ownerCustomerId: true },
        });
        if (!pet) {
          throw new BusinessException(ErrorCode.PET_NOT_FOUND);
        }
        // 归属快照校验：申请期间主档归属若已变，则本申请失效（防错改）
        if (pet.ownerCustomerId !== request.fromCustomerId) {
          throw new BusinessException(ErrorCode.PET_TRANSFER_STATUS_INVALID);
        }

        const now = new Date();
        const approved = await tx.petTransferRequest.update({
          where: { id, version: request.version, status: PetTransferStatus.PENDING },
          data: {
            status: PetTransferStatus.APPROVED,
            approvedBy: toBigInt(userId),
            approvedAt: now,
            version: { increment: 1 },
            updatedBy: toBigInt(userId),
          },
        });

        // 归属变更（唯一合法通道）：新主人仍受 scoped 隔离（租户内）
        await tx.pet.update({
          where: { id: request.petId, ownerCustomerId: request.fromCustomerId, deletedAt: null },
          data: {
            ownerCustomerId: request.toCustomerId,
            version: { increment: 1 },
            updatedBy: toBigInt(userId),
          },
        });

        // 关联迁移：旧客户关联软删（保留历史），新客户关联建立（若已存在则复用）
        await tx.customerPet.updateMany({
          where: { customerId: request.fromCustomerId, petId: request.petId, deletedAt: null },
          data: { deletedAt: now, updatedBy: toBigInt(userId) },
        });
        const existingTo = await tx.customerPet.findFirst({
          where: { customerId: request.toCustomerId, petId: request.petId, deletedAt: null },
          select: { id: true },
        });
        if (!existingTo) {
          const activeCount = await tx.customerPet.count({
            where: { customerId: request.toCustomerId, deletedAt: null },
          });
          await tx.customerPet.create({
            data: {
              tenantId: BigInt(tenantId),
              customerId: request.toCustomerId,
              petId: request.petId,
              petName: pet.name,
              petType: pet.petType,
              isPrimary: activeCount === 0,
              createdBy: toBigInt(userId),
              updatedBy: toBigInt(userId),
            },
          });
        }

        return approved;
      });
    } catch (error) {
      if (error instanceof BusinessException) {
        throw error;
      }
      // 并发双批：申请状态已被他人推进，乐观锁 where 不匹配 → P2025
      if ((error as { code?: string })?.code === "P2025") {
        throw new BusinessException(ErrorCode.PET_TRANSFER_STATUS_INVALID);
      }
      throw error;
    }
  }

  /** 拒绝转移申请（FR-2）：status 1→3，记录拒绝理由；不改变归属 */
  async rejectTransfer(id: string, dto: RejectTransferDto) {
    const userId = RequestContext.getUserId();
    const request = await this.prisma.scoped.petTransferRequest.findFirst({
      where: { id, deletedAt: null },
    });
    if (!request) {
      throw new BusinessException(ErrorCode.PET_TRANSFER_NOT_FOUND);
    }
    if (request.status !== PetTransferStatus.PENDING) {
      throw new BusinessException(ErrorCode.PET_TRANSFER_STATUS_INVALID);
    }

    try {
      return await this.prisma.scoped.petTransferRequest.update({
        where: { id, version: request.version, status: PetTransferStatus.PENDING },
        data: {
          status: PetTransferStatus.REJECTED,
          rejectReason: dto.rejectReason,
          version: { increment: 1 },
          updatedBy: toBigInt(userId),
        },
      });
    } catch (error) {
      if ((error as { code?: string })?.code === "P2025") {
        throw new BusinessException(ErrorCode.PET_TRANSFER_STATUS_INVALID);
      }
      throw error;
    }
  }

  /**
   * 撤销转移申请（FR-2）：status 1→4，不改变归属。
   * 撤销为「申请人自助」语义：非申请人本人且非 ROOT 角色 → 403 A0300。
   */
  async cancelTransfer(id: string) {
    const userId = RequestContext.getUserId();
    const request = await this.prisma.scoped.petTransferRequest.findFirst({
      where: { id, deletedAt: null },
    });
    if (!request) {
      throw new BusinessException(ErrorCode.PET_TRANSFER_NOT_FOUND);
    }
    if (request.status !== PetTransferStatus.PENDING) {
      throw new BusinessException(ErrorCode.PET_TRANSFER_STATUS_INVALID);
    }

    const applicantId = request.appliedBy;
    if (applicantId !== null && applicantId !== toBigInt(userId) && !this.isRoot()) {
      throw new BusinessException(ErrorCode.ACCESS_PERMISSION_EXCEPTION);
    }

    try {
      return await this.prisma.scoped.petTransferRequest.update({
        where: { id, version: request.version, status: PetTransferStatus.PENDING },
        data: {
          status: PetTransferStatus.CANCELLED,
          version: { increment: 1 },
          updatedBy: toBigInt(userId),
        },
      });
    } catch (error) {
      if ((error as { code?: string })?.code === "P2002") {
        throw new BusinessException(ErrorCode.PET_TRANSFER_STATUS_INVALID);
      }
      if ((error as { code?: string })?.code === "P2025") {
        throw new BusinessException(ErrorCode.PET_TRANSFER_STATUS_INVALID);
      }
      throw error;
    }
  }

  /**
   * 转移申请分页列表（FR-2）：status / petId 精确筛选，createdAt 区间；
   * 排序白名单（sortBy 合法域：createdAt），默认 createdAt desc。
   */
  async getTransferPage(query: QueryTransferDto) {
    const pageNum = Number(query.pageNum) > 0 ? Number(query.pageNum) : 1;
    const pageSize = Number(query.pageSize) > 0 ? Number(query.pageSize) : 20;

    const where: Prisma.PetTransferRequestWhereInput = { deletedAt: null };
    if (query.status !== undefined && query.status !== null) {
      where.status = query.status;
    }
    if (query.petId) {
      where.petId = query.petId;
    }
    if (query.createdAtStart || query.createdAtEnd) {
      // 时间处理铁律 4：区间端点一律走 date.util 按应用时区解析（禁止裸 new Date）
      const gte = query.createdAtStart ? parseWallClock(query.createdAtStart) : null;
      const lte = query.createdAtEnd ? endOfDay(query.createdAtEnd) : null;
      where.createdAt = {
        ...(gte ? { gte } : {}),
        ...(lte ? { lte } : {}),
      } as Prisma.DateTimeFilter;
    }

    const sortBy = this.resolveSortField(query.sortBy);
    const order: Prisma.SortOrder = query.order?.toUpperCase() === "ASC" ? "asc" : "desc";
    const orderBy: Prisma.PetTransferRequestOrderByWithRelationInput = { [sortBy]: order };

    const [list, total] = await Promise.all([
      this.prisma.scoped.petTransferRequest.findMany({
        where,
        orderBy,
        skip: (pageNum - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.scoped.petTransferRequest.count({ where }),
    ]);

    return {
      data: await this.attachDisplayFields(list),
      page: {
        pageNum,
        pageSize,
        total,
      },
    };
  }

  /**
   * 补齐列表展示字段（宠物名/类型 + 转出·转入客户名）。
   *
   * 为什么不改表：`pet_transfer_request` 只存 id 快照（无冗余列），而审批队列必须
   * 让审批人看清「转的是哪只宠物、从谁转给谁」——故在服务端**批量**回查（两次 `in`
   * 查询，非 N+1），保持既有 `{ data, page }` 出参形态不变（纯增量字段）。
   *
   * ⚠️ 名称回查**不过滤** `deletedAt`：转出方可能在申请后已被合并归档（软删），
   * 若按未删过滤会丢名字、让历史申请变成一串 UUID。
   */
  private async attachDisplayFields(rows: PetTransferRequest[]): Promise<PetTransferListItem[]> {
    if (rows.length === 0) return [];

    const petIds = [...new Set(rows.map((row) => row.petId))];
    const customerIds = [...new Set(rows.flatMap((row) => [row.fromCustomerId, row.toCustomerId]))];

    const [pets, customers] = await Promise.all([
      this.prisma.scoped.pet.findMany({
        where: { id: { in: petIds } },
        select: { id: true, name: true, petType: true },
      }),
      this.prisma.scoped.customer.findMany({
        where: { id: { in: customerIds } },
        select: { id: true, name: true },
      }),
    ]);

    const petMap = new Map(pets.map((pet) => [pet.id, pet]));
    const customerMap = new Map(customers.map((customer) => [customer.id, customer.name]));

    return rows.map((row) => ({
      ...row,
      petName: petMap.get(row.petId)?.name ?? null,
      petType: petMap.get(row.petId)?.petType ?? null,
      fromCustomerName: customerMap.get(row.fromCustomerId) ?? null,
      toCustomerName: customerMap.get(row.toCustomerId) ?? null,
    }));
  }

  /** 目标客户存在性校验（scoped：租户内 + 未软删），不通过抛 A0517 */
  private async assertCustomerExists(customerId: string): Promise<void> {
    const customer = await this.prisma.scoped.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { id: true },
    });
    if (!customer) {
      throw new BusinessException(ErrorCode.PET_TRANSFER_TARGET_INVALID);
    }
  }

  /** 是否超级管理员（ROOT 角色直放） */
  private isRoot(): boolean {
    if (RequestContext.isRoot()) return true;
    const roles = RequestContext.getCurrentUser()?.roles ?? [];
    return roles.includes("ROOT");
  }

  /** 排序字段白名单解析，非法值回落 createdAt */
  private resolveSortField(sortBy?: string): SortableField {
    if (sortBy && (SORTABLE_FIELDS as readonly string[]).includes(sortBy)) {
      return sortBy as SortableField;
    }
    return "createdAt";
  }
}
