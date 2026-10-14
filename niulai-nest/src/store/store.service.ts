import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../common/prisma/prisma.service";
import { toBigInt } from "../common/prisma/prisma-ids";
import { RequestContext } from "../common/context/request-context";
import { ErrorCode } from "../common/enums/error-code.enum";
import { BusinessException } from "../common/exceptions/business.exception";
import { endOfDay, parseWallClock } from "../common/utils/date.util";
import { CreateStoreDto } from "./dto/create-store.dto";
import { UpdateStoreDto } from "./dto/update-store.dto";
import { QueryStoreDto } from "./dto/query-store.dto";

/**
 * 排序字段白名单：sortBy 必须落在集合内，否则回落默认值。
 * 防止把任意字符串透传给 orderBy（既是防注入，也是防无索引全表排序）。
 */
const SORTABLE_FIELDS = ["createdAt", "code", "name", "status"] as const;
type SortableField = (typeof SORTABLE_FIELDS)[number];

/**
 * 门店档案服务（P0-04-02 · FR-1）
 *
 * 数据访问统一走 `prisma.scoped.store`（租户隔离扩展自动注入 tenantId 条件，
 * RLS 兜底）；**业务代码绝不从请求参数读取 tenantId**——创建/更新归属一律
 * 以 `RequestContext.getTenantId()`（JWT payload）为锚点。
 *
 * 契约口径（对齐系统域）：
 *  - 分页返回 `{ data, page: { pageNum, pageSize, total } }`，
 *    由全局 ResponseInterceptor 改写成 `list/total/page/page_size` 信封；
 *  - 软删（deletedAt = now），列表/详情/更新入口一律过滤 `deletedAt: null`；
 *  - 乐观锁：update 以 `where: { id, version }` 提交，不匹配抛 `STORE_VERSION_CONFLICT`。
 */
@Injectable()
export class StoreService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 创建门店（FR-1）
   *
   * code 租户内唯一（uk_store_tenant_code）：应用层先行查重给出友好业务码，
   * 并发兜底由唯一索引 + 全局 filter 完成。createdBy/updatedBy 从 ALS 上下文注入；
   * tenantId 显式取自上下文（扩展层会以上下文值恒定覆盖，双保险）。
   */
  async createStore(dto: CreateStoreDto) {
    const userId = RequestContext.getUserId();

    const duplicated = await this.prisma.scoped.store.findFirst({
      where: { code: dto.code, deletedAt: null },
      select: { id: true },
    });
    if (duplicated) {
      throw new BusinessException(ErrorCode.STORE_CODE_DUPLICATED);
    }

    // 租户归属只认上下文（@RequireTenant 保证非空；直调场景缺失时 fail-closed 拒绝，
    // 与租户扩展内核的拒绝语义一致——绝不静默落一条无归属/错归属的门店）
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw new BusinessException(ErrorCode.TENANT_CONTEXT_MISSING);
    }

    const data: Prisma.StoreCreateInput = {
      tenantId: BigInt(tenantId),
      code: dto.code,
      name: dto.name,
      type: dto.type ?? 1,
      province: dto.province,
      city: dto.city,
      district: dto.district,
      address: dto.address,
      longitude: dto.longitude,
      latitude: dto.latitude,
      phone: dto.phone,
      businessHours: (dto.businessHours ?? {}) as Prisma.InputJsonValue,
      ...(dto.config !== undefined ? { config: dto.config as Prisma.InputJsonValue } : {}),
      status: dto.status ?? 1,
      createdBy: toBigInt(userId),
      updatedBy: toBigInt(userId),
    };

    return await this.prisma.scoped.store.create({ data });
  }

  /**
   * 门店分页列表（FR-1）
   *
   * 筛选：code 前缀 / name 模糊 / status / createdAt 闭区间；
   * 排序：白名单字段 + ASC/DESC，默认 createdAt desc。
   */
  async getStorePage(query: QueryStoreDto) {
    const pageNum = Number(query.pageNum) > 0 ? Number(query.pageNum) : 1;
    const pageSize = Number(query.pageSize) > 0 ? Number(query.pageSize) : 20;

    const where: Prisma.StoreWhereInput = { deletedAt: null };
    if (query.code) {
      where.code = { startsWith: query.code };
    }
    if (query.name) {
      where.name = { contains: query.name };
    }
    if (query.status !== undefined && query.status !== null) {
      where.status = query.status;
    }
    if (query.createdAtStart || query.createdAtEnd) {
      // 时间处理铁律 4：区间端点一律走 date.util 按应用时区解析（禁止裸 new Date("…")
      // 依赖进程时区）。非法输入返回 null → 该端点不进 where 条件（不炸接口）。
      const gte = query.createdAtStart ? parseWallClock(query.createdAtStart) : null;
      const lte = query.createdAtEnd ? endOfDay(query.createdAtEnd) : null;
      where.createdAt = {
        ...(gte ? { gte } : {}),
        ...(lte ? { lte } : {}),
      };
    }

    const sortBy = this.resolveSortField(query.sortBy);
    const order: Prisma.SortOrder = query.order?.toUpperCase() === "ASC" ? "asc" : "desc";
    const orderBy: Prisma.StoreOrderByWithRelationInput = { [sortBy]: order };

    const [list, total] = await Promise.all([
      this.prisma.scoped.store.findMany({
        where,
        orderBy,
        skip: (pageNum - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.scoped.store.count({ where }),
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
   * 门店详情（FR-1）；已软删记录视为不存在
   */
  async getStoreDetail(id: string) {
    const store = await this.prisma.scoped.store.findFirst({
      where: { id, deletedAt: null },
    });
    if (!store) {
      throw new BusinessException(ErrorCode.STORE_NOT_FOUND);
    }
    return store;
  }

  /**
   * 更新门店（FR-1，乐观锁）
   *
   * `where: { id, version }`（extendedWhereUnique）一步完成「存在性 + 版本」校验；
   * P2025 时区分：记录不存在（含已软删）抛 STORE_NOT_FOUND，否则视为版本冲突。
   * 更新成功 version 自增（version: { increment: 1 }），updatedBy 从上下文注入。
   */
  async updateStore(id: string, dto: UpdateStoreDto) {
    const userId = RequestContext.getUserId();

    const data: Prisma.StoreUpdateInput = { updatedBy: toBigInt(userId) };
    if (dto.code !== undefined) data.code = dto.code;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.province !== undefined) data.province = dto.province;
    if (dto.city !== undefined) data.city = dto.city;
    if (dto.district !== undefined) data.district = dto.district;
    if (dto.address !== undefined) data.address = dto.address;
    if (dto.longitude !== undefined) data.longitude = dto.longitude;
    if (dto.latitude !== undefined) data.latitude = dto.latitude;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.businessHours !== undefined) {
      data.businessHours = dto.businessHours as Prisma.InputJsonValue;
    }
    if (dto.config !== undefined) data.config = dto.config as Prisma.InputJsonValue;
    if (dto.status !== undefined) data.status = dto.status;

    try {
      return await this.prisma.scoped.store.update({
        where: { id, version: dto.version, deletedAt: null },
        data: { ...data, version: { increment: 1 } },
      });
    } catch (error) {
      if ((error as { code?: string })?.code === "P2025") {
        // 版本不匹配 vs 记录不存在：回查区分，给出精确业务码
        const exists = await this.prisma.scoped.store.findFirst({
          where: { id, deletedAt: null },
          select: { id: true },
        });
        if (!exists) {
          throw new BusinessException(ErrorCode.STORE_NOT_FOUND);
        }
        throw new BusinessException(ErrorCode.STORE_VERSION_CONFLICT);
      }
      throw error;
    }
  }

  /**
   * 删除门店（FR-1，软删）：deletedAt = now；软删后列表/详情/更新均不可见
   */
  async softDeleteStore(id: string) {
    const userId = RequestContext.getUserId();

    const exists = await this.prisma.scoped.store.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!exists) {
      throw new BusinessException(ErrorCode.STORE_NOT_FOUND);
    }

    await this.prisma.scoped.store.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: toBigInt(userId) },
    });
    return true;
  }

  /** 排序字段白名单解析，非法值回落 createdAt */
  private resolveSortField(sortBy?: string): SortableField {
    if (sortBy && (SORTABLE_FIELDS as readonly string[]).includes(sortBy)) {
      return sortBy as SortableField;
    }
    return "createdAt";
  }
}
