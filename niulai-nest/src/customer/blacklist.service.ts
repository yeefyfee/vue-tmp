import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { BlacklistStatus } from "@peluvida/shared";
import { PrismaService } from "../common/prisma/prisma.service";
import { toBigInt } from "../common/prisma/prisma-ids";
import { RequestContext } from "../common/context/request-context";
import { ErrorCode } from "../common/enums/error-code.enum";
import { BusinessException } from "../common/exceptions/business.exception";
import { CustomerErrorCode } from "./customer-error-codes";
import { CreateBlacklistDto } from "./dto/create-blacklist.dto";
import { QueryBlacklistDto } from "./dto/query-blacklist.dto";

/** 黑名单分页排序字段白名单（sortBy 合法域） */
const SORTABLE_FIELDS = ["createdAt", "updatedAt"] as const;
type SortableField = (typeof SORTABLE_FIELDS)[number];

/**
 * 黑名单服务（P0-05-05 · FR-4 门店/租户两级黑名单，硬拦截）
 *
 * 两级语义（blacklist.store_id）：
 *  - store_id IS NULL   → **租户级**黑名单：对该租户**所有门店**生效；
 *  - store_id = <uuid>  → **门店级**黑名单：仅对指定门店生效。
 *
 * 命中判定（{@link checkBlocked}）：调用方传入 storeId 时，租户级 OR 该门店级任一
 * 生效即拦截；未传 storeId 时仅租户级生效（门店级无法判定归属门店，保守放行——
 * 门店级拦截应由持有门店上下文的入口传入 storeId 精确判定）。
 *
 * 数据访问统一走 `prisma.scoped.blacklist`（租户隔离扩展自动注入 tenantId，RLS 兜底）；
 * 业务代码绝不从请求参数读取 tenantId——归属以 `RequestContext.getTenantId()` 为锚点。
 */
@Injectable()
export class BlacklistService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 拉黑客户（FR-4）。
   *
   * scope=store 时 storeId 必填且须为租户内有效门店（否则 A0524）；
   * scope=tenant 时忽略 storeId（落 NULL）。同范围已有**生效**记录 → A0525。
   */
  async addToBlacklist(customerId: string, dto: CreateBlacklistDto) {
    const userId = RequestContext.getUserId();
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw new BusinessException(ErrorCode.TENANT_CONTEXT_MISSING);
    }
    await this.assertCustomerExists(customerId);

    let storeId: string | null = null;
    if (dto.scope === "store") {
      if (!dto.storeId) {
        throw new BusinessException(CustomerErrorCode.BLACKLIST_SCOPE_INVALID);
      }
      await this.assertStoreExists(dto.storeId);
      storeId = dto.storeId;
    }

    // 同范围是否已在黑名单生效（未软删 + status=1）
    const duplicated = await this.prisma.scoped.blacklist.findFirst({
      where: { customerId, storeId, status: BlacklistStatus.ACTIVE, deletedAt: null },
      select: { id: true },
    });
    if (duplicated) {
      throw new BusinessException(CustomerErrorCode.CUSTOMER_BLACKLIST_DUPLICATED);
    }

    const data: Prisma.BlacklistUncheckedCreateInput = {
      tenantId: BigInt(tenantId),
      customerId,
      storeId,
      reason: dto.reason,
      status: BlacklistStatus.ACTIVE,
      operatorId: toBigInt(userId),
      createdBy: toBigInt(userId),
      updatedBy: toBigInt(userId),
    };
    return this.prisma.scoped.blacklist.create({ data });
  }

  /**
   * 解除黑名单（FR-4）：status 1→0（**保留行为记录，不物理删**）+ 写入解除原因
   * （`release_reason`，PRD BR-2「移出黑名单必须填写原因」）。
   *
   * 已解除（status=0）时**幂等返回原记录**且不覆盖首次解除原因（保留最早留痕）。
   * 解除时刻由 `updated_at` 承载，不另立列。
   */
  async releaseBlacklist(customerId: string, blacklistId: string, reason: string) {
    const userId = RequestContext.getUserId();
    const record = await this.prisma.scoped.blacklist.findFirst({
      where: { id: blacklistId, customerId, deletedAt: null },
    });
    if (!record) {
      throw new BusinessException(CustomerErrorCode.BLACKLIST_NOT_FOUND);
    }
    if (record.status === BlacklistStatus.RELEASED) {
      return record;
    }
    return this.prisma.scoped.blacklist.update({
      where: { id: blacklistId },
      data: {
        status: BlacklistStatus.RELEASED,
        releaseReason: reason,
        updatedBy: toBigInt(userId),
        version: { increment: 1 },
      },
    });
  }

  /**
   * 黑名单分页列表（FR-4）：scope（store/tenant）/ storeId / status 精确筛选，
   * 默认 createdAt desc。scope=tenant → storeId IS NULL；scope=store → storeId NOT NULL。
   */
  async getBlacklistPage(customerId: string, query: QueryBlacklistDto) {
    await this.assertCustomerExists(customerId);

    const pageNum = Number(query.pageNum) > 0 ? Number(query.pageNum) : 1;
    const pageSize = Number(query.pageSize) > 0 ? Number(query.pageSize) : 20;

    const where: Prisma.BlacklistWhereInput = { customerId, deletedAt: null };
    if (query.scope === "tenant") {
      where.storeId = null;
    } else if (query.scope === "store") {
      where.storeId = { not: null };
    }
    if (query.storeId) {
      where.storeId = query.storeId;
    }
    if (query.status !== undefined && query.status !== null) {
      where.status = query.status;
    }

    const sortBy = this.resolveSortField(query.sortBy);
    const order: Prisma.SortOrder = query.order?.toUpperCase() === "ASC" ? "asc" : "desc";

    const [list, total] = await Promise.all([
      this.prisma.scoped.blacklist.findMany({
        where,
        orderBy: { [sortBy]: order },
        skip: (pageNum - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.scoped.blacklist.count({ where }),
    ]);

    return {
      data: list,
      page: { pageNum, pageSize, total },
    };
  }

  /**
   * **硬拦截**（FR-4，可复用入口）：判定客户是否被黑名单拦截，命中即抛
   * `A0522`（客户已被列入黑名单）。
   *
   * @param customerId 客户 id（scoped：租户内）
   * @param storeId    可选门店上下文；提供时「租户级 OR 该门店级」任一命中即拦截，
   *                   未提供时仅租户级生效（门店级保守放行）
   */
  async checkBlocked(customerId: string, storeId?: string): Promise<void> {
    const where: Prisma.BlacklistWhereInput = {
      customerId,
      status: BlacklistStatus.ACTIVE,
      deletedAt: null,
      OR: [
        // 租户级黑名单：对该租户所有门店生效
        { storeId: null },
        // 门店级黑名单：仅指定门店生效（未传 storeId 时不加入该分支）
        ...(storeId ? [{ storeId }] : []),
      ],
    };
    const hit = await this.prisma.scoped.blacklist.findFirst({
      where,
      select: { id: true },
    });
    if (hit) {
      throw new BusinessException(CustomerErrorCode.CUSTOMER_BLACKLISTED);
    }
  }

  /** 客户存在性校验（scoped：租户内 + 未软删），不通过抛 A0510 */
  private async assertCustomerExists(customerId: string): Promise<void> {
    const customer = await this.prisma.scoped.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { id: true },
    });
    if (!customer) {
      throw new BusinessException(ErrorCode.CUSTOMER_NOT_FOUND);
    }
  }

  /** 门店存在性校验（scoped：租户内 + 未软删），不通过抛 A0524（黑名单范围不合法） */
  private async assertStoreExists(storeId: string): Promise<void> {
    const store = await this.prisma.scoped.store.findFirst({
      where: { id: storeId, deletedAt: null },
      select: { id: true },
    });
    if (!store) {
      throw new BusinessException(CustomerErrorCode.BLACKLIST_SCOPE_INVALID);
    }
  }

  /** 排序字段白名单解析，非法值回落 createdAt */
  private resolveSortField(sortBy?: string): SortableField {
    if (sortBy && (SORTABLE_FIELDS as readonly string[]).includes(sortBy)) {
      return sortBy as SortableField;
    }
    return "createdAt";
  }
}
