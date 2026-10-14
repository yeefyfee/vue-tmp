import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import {
  CUSTOMER_LIFECYCLE_VALUES,
  CUSTOMER_SOURCE_OPTIONS,
  type CustomerLifecycle,
  type EnumOption,
  type CustomerSource,
} from "@peluvida/shared";
import { PrismaService } from "../common/prisma/prisma.service";
import { toBigInt } from "../common/prisma/prisma-ids";
import { RequestContext } from "../common/context/request-context";
import { ErrorCode } from "../common/enums/error-code.enum";
import { BusinessException } from "../common/exceptions/business.exception";
import { endOfDay, parseWallClock } from "../common/utils/date.util";
import { CreateCustomerDto } from "./dto/create-customer.dto";
import { UpdateCustomerDto } from "./dto/update-customer.dto";
import { QueryCustomerDto } from "./dto/query-customer.dto";

/**
 * 排序字段白名单：sortBy 必须落在集合内，否则回落默认值。
 * 防止把任意字符串透传给 orderBy（既是防注入，也是防无索引全表排序）。
 */
const SORTABLE_FIELDS = ["createdAt", "name", "mobile"] as const;
type SortableField = (typeof SORTABLE_FIELDS)[number];

/**
 * 萌主档案服务（P0-05-02 · FR-1）
 *
 * 数据访问统一走 `prisma.scoped.customer`（租户隔离扩展自动注入 tenantId 条件，
 * RLS 兜底）；**业务代码绝不从请求参数读取 tenantId**——创建/更新归属一律
 * 以 `RequestContext.getTenantId()`（JWT payload）为锚点。
 *
 * 契约口径（对齐门店域 store 范式）：
 *  - 分页返回 `{ data, page: { pageNum, pageSize, total } }`，
 *    由全局 ResponseInterceptor 改写成 `list/total/page/page_size` 信封；
 *  - 软删（deletedAt = now），列表/详情/更新入口一律过滤 `deletedAt: null`；
 *  - 乐观锁：update 以 `where: { id, version }` 提交，不匹配抛 `CUSTOMER_VERSION_CONFLICT`；
 *  - 手机号租户内唯一（部分唯一索引 uk_customer_tenant_mobile，软删释放）：
 *    应用层 findFirst 查重给友好业务码 A0501，并发兜底由部分唯一索引 + P2002
 *    捕获完成（索引 Prisma schema 无法表达，见迁移 20261007114800 注释）。
 */
@Injectable()
export class CustomerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 创建萌主档案（FR-1）
   *
   * mobile 租户内唯一：应用层先行查重给出友好业务码 A0501，并发兜底由
   * 部分唯一索引 + P2002 捕获完成。storeId 提供时校验租户内归属（A0512）；
   * createdBy/updatedBy 从 ALS 上下文注入；tenantId 显式取自上下文（扩展层
   * 会以上下文值恒定覆盖，双保险）。
   */
  async createCustomer(dto: CreateCustomerDto) {
    const userId = RequestContext.getUserId();

    // 手机号查重走 scoped（租户内 + 未软删；部分唯一索引同口径，软删不占用）
    const duplicated = await this.prisma.scoped.customer.findFirst({
      where: { mobile: dto.mobile, deletedAt: null },
      select: { id: true },
    });
    if (duplicated) {
      throw new BusinessException(ErrorCode.CUSTOMER_MOBILE_DUPLICATED);
    }

    // 租户归属只认上下文（@RequireTenant 保证非空；直调场景缺失时 fail-closed 拒绝，
    // 与租户扩展内核的拒绝语义一致——绝不静默落一条无归属/错归属的客户）
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw new BusinessException(ErrorCode.TENANT_CONTEXT_MISSING);
    }

    // 归属门店校验：仅在显式传入 storeId 时校验租户内存在且未软删
    if (dto.storeId) {
      await this.assertStoreExists(dto.storeId);
    }

    const data: Prisma.CustomerCreateInput = {
      tenantId: BigInt(tenantId),
      storeId: dto.storeId ?? null,
      name: dto.name,
      mobile: dto.mobile,
      gender: dto.gender,
      birthday: dto.birthday ? new Date(`${dto.birthday}T00:00:00.000Z`) : null,
      source: dto.source,
      remark: dto.remark,
      createdBy: toBigInt(userId),
      updatedBy: toBigInt(userId),
    };

    try {
      return await this.prisma.scoped.customer.create({ data });
    } catch (error) {
      // 并发兜底：应用层查重与写入之间有竞态窗口，撞部分唯一索引时统一转 A0501
      if ((error as { code?: string })?.code === "P2002") {
        throw new BusinessException(ErrorCode.CUSTOMER_MOBILE_DUPLICATED);
      }
      throw error;
    }
  }

  /**
   * 萌主档案分页列表（FR-1）
   *
   * 筛选：keyword（姓名 **或** 手机号模糊，OR 语义）/ mobile 精确 / name 模糊 /
   * storeId 精确 / createdAt 闭区间；
   * 排序：白名单字段 + ASC/DESC，默认 createdAt desc。
   */
  async getCustomerPage(query: QueryCustomerDto) {
    const pageNum = Number(query.pageNum) > 0 ? Number(query.pageNum) : 1;
    const pageSize = Number(query.pageSize) > 0 ? Number(query.pageSize) : 20;

    const where: Prisma.CustomerWhereInput = { deletedAt: null };
    if (query.keyword) {
      // PRD《Customer API》验收要点：「列表 keyword 同时命中姓名与手机号」——
      // 单个搜索框跨两列，故为 OR（与下方 name / mobile 的独立筛选是 AND 关系）。
      where.OR = [{ name: { contains: query.keyword } }, { mobile: { contains: query.keyword } }];
    }
    if (query.mobile) {
      where.mobile = query.mobile;
    }
    if (query.name) {
      where.name = { contains: query.name };
    }
    if (query.storeId) {
      where.storeId = query.storeId;
    }
    if (query.lifecycle !== undefined && query.lifecycle !== null) {
      // P0-05-06 FR-6：生命周期分层精确筛选（走 idx_customer_tenant_lifecycle）
      where.lifecycle = query.lifecycle;
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
    const orderBy: Prisma.CustomerOrderByWithRelationInput = { [sortBy]: order };

    const [list, total] = await Promise.all([
      this.prisma.scoped.customer.findMany({
        where,
        orderBy,
        skip: (pageNum - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.scoped.customer.count({ where }),
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
   * 萌主档案详情（FR-1）；已软删记录视为不存在
   */
  async getCustomerDetail(id: string) {
    const customer = await this.prisma.scoped.customer.findFirst({
      where: { id, deletedAt: null },
    });
    if (!customer) {
      throw new BusinessException(ErrorCode.CUSTOMER_NOT_FOUND);
    }
    return customer;
  }

  /**
   * 更新萌主档案（FR-1，乐观锁）
   *
   * `where: { id, version }`（extendedWhereUnique）一步完成「存在性 + 版本」校验；
   * P2025 时区分：记录不存在（含已软删）抛 CUSTOMER_NOT_FOUND，否则视为版本冲突。
   * mobile 变更时先行查重（排除自身），P2002 并发兜底同创建口径；
   * storeId 变更时校验归属门店（A0512）。更新成功 version 自增，updatedBy 从上下文注入。
   */
  async updateCustomer(id: string, dto: UpdateCustomerDto) {
    const userId = RequestContext.getUserId();

    const data: Prisma.CustomerUpdateInput = { updatedBy: toBigInt(userId) };
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.storeId !== undefined) {
      if (dto.storeId) {
        await this.assertStoreExists(dto.storeId);
      }
      data.storeId = dto.storeId;
    }
    if (dto.gender !== undefined) data.gender = dto.gender;
    if (dto.birthday !== undefined) {
      data.birthday = dto.birthday ? new Date(`${dto.birthday}T00:00:00.000Z`) : null;
    }
    if (dto.source !== undefined) data.source = dto.source;
    if (dto.lifecycle !== undefined) data.lifecycle = dto.lifecycle;
    if (dto.remark !== undefined) data.remark = dto.remark;

    // 手机号变更：与创建同口径查重（scoped 查询已注入租户条件），排除自身
    if (dto.mobile !== undefined) {
      const duplicated = await this.prisma.scoped.customer.findFirst({
        where: { mobile: dto.mobile, deletedAt: null, id: { not: id } },
        select: { id: true },
      });
      if (duplicated) {
        throw new BusinessException(ErrorCode.CUSTOMER_MOBILE_DUPLICATED);
      }
      data.mobile = dto.mobile;
    }

    try {
      return await this.prisma.scoped.customer.update({
        where: { id, version: dto.version, deletedAt: null },
        data: { ...data, version: { increment: 1 } },
      });
    } catch (error) {
      if ((error as { code?: string })?.code === "P2025") {
        // 版本不匹配 vs 记录不存在：回查区分，给出精确业务码
        const exists = await this.prisma.scoped.customer.findFirst({
          where: { id, deletedAt: null },
          select: { id: true },
        });
        if (!exists) {
          throw new BusinessException(ErrorCode.CUSTOMER_NOT_FOUND);
        }
        throw new BusinessException(ErrorCode.CUSTOMER_VERSION_CONFLICT);
      }
      // 并发兜底：查重与写入之间的竞态窗口撞部分唯一索引 → A0501
      if ((error as { code?: string })?.code === "P2002") {
        throw new BusinessException(ErrorCode.CUSTOMER_MOBILE_DUPLICATED);
      }
      throw error;
    }
  }

  /**
   * 删除萌主档案（FR-1，软删）：deletedAt = now；软删后列表/详情/更新均不可见，
   * 手机号被部分唯一索引释放（同租户可重新建档）
   */
  async softDeleteCustomer(id: string) {
    const userId = RequestContext.getUserId();

    const exists = await this.prisma.scoped.customer.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!exists) {
      throw new BusinessException(ErrorCode.CUSTOMER_NOT_FOUND);
    }

    await this.prisma.scoped.customer.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: toBigInt(userId) },
    });
    return true;
  }

  /**
   * 客户来源选项（P0-05-06 · FR-5）：返回来源枚举的 `{value,label}` 列表，
   * 供前端建档 / 筛选下拉直接消费（唯一值域来源为 @peluvida/shared CustomerSource）。
   */
  getSourceOptions(): readonly EnumOption<CustomerSource>[] {
    return CUSTOMER_SOURCE_OPTIONS;
  }

  /**
   * 客户分层分布统计（MVP-WEB-04-04 · FR-6 展示侧）
   *
   * 口径（**全量租户分布**）：固定过滤「未软删」，**刻意不叠加列表筛选条件** ——
   * 分层分布是「钻取入口」而非「当前结果分布」：若跟随筛选，一旦选中某一层，
   * 其余各层必然归零，分布语义即崩塌（前端据此把分布条设计为可点击筛选）。
   *
   * 实现：`groupBy(['lifecycle'])` 命中 `idx_customer_tenant_lifecycle`；
   * 结果按 `CUSTOMER_LIFECYCLE_VALUES` **补零**后返回，保证前端 4 个分层块
   * 数量稳定（不因某层无数据而少一块、导致布局与占比基准跳动）。
   *
   * 越界说明：PRD BR-6 的「按累计消费 / 无消费天数自动打标」依赖尚未建模的
   * Order / 会员体系，本期 `lifecycle` 以档案字段为准，本端点只做**真实分布聚合**，
   * 不臆造自动分层规则的计算结果。
   */
  async getLifecycleStats(): Promise<{
    total: number;
    items: Array<{ lifecycle: CustomerLifecycle; count: number }>;
  }> {
    const rows = await this.prisma.scoped.customer.groupBy({
      by: ["lifecycle"],
      where: { deletedAt: null },
      _count: { _all: true },
    });

    const counts = new Map<number, number>(rows.map((row) => [row.lifecycle, row._count._all]));

    const items = CUSTOMER_LIFECYCLE_VALUES.map((lifecycle) => ({
      lifecycle,
      count: counts.get(lifecycle) ?? 0,
    }));

    return {
      total: items.reduce((sum, item) => sum + item.count, 0),
      items,
    };
  }

  /** 归属门店存在性校验（scoped：租户内 + 未软删），不通过抛 A0512 */
  private async assertStoreExists(storeId: string): Promise<void> {
    const store = await this.prisma.scoped.store.findFirst({
      where: { id: storeId, deletedAt: null },
      select: { id: true },
    });
    if (!store) {
      throw new BusinessException(ErrorCode.CUSTOMER_STORE_INVALID);
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
