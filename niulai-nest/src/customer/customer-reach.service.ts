import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import {
  isChannelReachable,
  resolveCustomerReachPreference,
  type CustomerReachPreference,
} from "@peluvida/shared";
import { PrismaService } from "../common/prisma/prisma.service";
import { toBigInt } from "../common/prisma/prisma-ids";
import { RequestContext } from "../common/context/request-context";
import { ErrorCode } from "../common/enums/error-code.enum";
import { BusinessException } from "../common/exceptions/business.exception";
import {
  endOfDay,
  formatDateTimeInZone,
  getAppTimeZone,
  parseWallClock,
} from "../common/utils/date.util";
import { BlacklistService } from "./blacklist.service";
import { CustomerErrorCode } from "./customer-error-codes";
import { CreateReachLogDto } from "./dto/create-reach-log.dto";
import { QueryReachLogDto } from "./dto/query-reach-log.dto";
import { UpdateReachPreferenceDto } from "./dto/update-reach-preference.dto";

/**
 * 触达域服务（P0-05-04 · FR-3 触达渠道与偏好）
 *
 * 职责：
 *  - 记录实测触达（reach_log，append-only：仅本服务提供 create + 分页读，无改删）；
 *  - 客户触达偏好（customer.reach_preferences JSONB；GET 兜底默认 / PUT 整存整取）。
 *
 * 管道纪律（在 createReachLog 内串联）：
 *  1. 客户存在性（scoped，A0510）→
 *  2. **硬拦截**：BlacklistService.checkBlocked（黑名单命中 → A0522）→
 *  3. **偏好**：渠道被拒 / 不在白名单 → A0527 →
 *  4. 落库（tenantId 取上下文，操作人从上下文注入）。
 *
 * 数据访问统一走 `prisma.scoped.*`（租户隔离扩展自动注入 tenantId，RLS 兜底）。
 */
@Injectable()
export class CustomerReachService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blacklistService: BlacklistService
  ) {}

  /**
   * 记录一次实测触达（FR-3）。
   *
   * 黑名单为**硬拦截**（A0522），触达偏好为**尊重客户意愿**的软拦截（A0527）——
   * 二者都在落库前判定，命中即拒且不落库。
   */
  async createReachLog(customerId: string, dto: CreateReachLogDto) {
    const userId = RequestContext.getUserId();
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw new BusinessException(ErrorCode.TENANT_CONTEXT_MISSING);
    }

    const customer = await this.loadCustomer(customerId);

    // ① 硬拦截：客户已被列入黑名单（租户级 / 当前门店级）
    await this.blacklistService.checkBlocked(customerId, RequestContext.getStoreId() ?? undefined);

    // ② 偏好：渠道被明确拒收 / 不在允许白名单内 → 尊重偏好拒绝本次触达
    const preference = resolveCustomerReachPreference(customer.reachPreferences);
    if (!isChannelReachable(dto.channel, preference)) {
      throw new BusinessException(CustomerErrorCode.CUSTOMER_REACH_CHANNEL_REJECTED);
    }

    // ③ 触达时间：走 date.util 按应用时区解析（禁止裸 new Date(字符串) 依赖进程时区）；
    //    未提供则取当前时刻（库列亦有 DEFAULT CURRENT_TIMESTAMP 兜底）
    const reachedAt = dto.reachedAt ? parseWallClock(dto.reachedAt) : new Date();

    const data: Prisma.ReachLogUncheckedCreateInput = {
      tenantId: BigInt(tenantId),
      customerId,
      channel: dto.channel,
      template: dto.template ?? null,
      content: dto.content ?? null,
      result: dto.result ?? null,
      reachedAt: reachedAt ?? new Date(),
      operatorId: toBigInt(userId),
      createdBy: toBigInt(userId),
      updatedBy: toBigInt(userId),
    };
    return this.prisma.scoped.reachLog.create({ data });
  }

  /**
   * 触达历史分页（FR-3）：channel / result 精确筛选 + reachedAt 时间**闭区间**
   * （区间端点走 date.util 按应用时区解析）；排序白名单（reachedAt/createdAt），默认 reachedAt desc。
   */
  async listReachLogs(customerId: string, query: QueryReachLogDto) {
    await this.loadCustomer(customerId);

    const pageNum = Number(query.pageNum) > 0 ? Number(query.pageNum) : 1;
    const pageSize = Number(query.pageSize) > 0 ? Number(query.pageSize) : 20;

    const where: Prisma.ReachLogWhereInput = { customerId, deletedAt: null };
    if (query.channel !== undefined && query.channel !== null) {
      where.channel = query.channel;
    }
    if (query.result !== undefined && query.result !== null) {
      where.result = query.result;
    }
    if (query.reachedAtStart || query.reachedAtEnd) {
      const gte = query.reachedAtStart ? parseWallClock(query.reachedAtStart) : null;
      const lte = query.reachedAtEnd ? endOfDay(query.reachedAtEnd) : null;
      where.reachedAt = {
        ...(gte ? { gte } : {}),
        ...(lte ? { lte } : {}),
      } as Prisma.DateTimeFilter;
    }

    const order: Prisma.SortOrder = query.order?.toUpperCase() === "ASC" ? "asc" : "desc";

    const [list, total] = await Promise.all([
      this.prisma.scoped.reachLog.findMany({
        where,
        orderBy: { reachedAt: order },
        skip: (pageNum - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.scoped.reachLog.count({ where }),
    ]);

    return {
      data: list,
      page: { pageNum, pageSize, total },
    };
  }

  /** 读取客户触达偏好（FR-3）：DB 值经归一兜底默认后返回 */
  async getReachPreference(customerId: string): Promise<CustomerReachPreference> {
    const customer = await this.loadCustomer(customerId);
    return resolveCustomerReachPreference(customer.reachPreferences);
  }

  /**
   * 设置客户触达偏好（FR-3，PUT 整存整取）：请求即目标全量，
   * 归一后整体覆写 `customer.reach_preferences`，回读并经响应层返回归一结果。
   */
  async updateReachPreference(
    customerId: string,
    dto: UpdateReachPreferenceDto
  ): Promise<CustomerReachPreference> {
    const userId = RequestContext.getUserId();
    await this.loadCustomer(customerId);

    const preference = resolveCustomerReachPreference(dto);
    await this.prisma.scoped.customer.update({
      where: { id: customerId },
      data: {
        reachPreferences: preference as unknown as Prisma.InputJsonValue,
        updatedBy: toBigInt(userId),
        version: { increment: 1 },
      },
    });
    return preference;
  }

  /**
   * 当前时刻是否落在免打扰时段（FR-3）：按应用时区取 HH:mm，跨夜（start>end）正确判定。
   * 供外呼 / 定时触达在派发前判活；触达记录接口（createReachLog）为**实测留痕**，
   * 不据此外呼拒绝（免打扰为触达策略，非留痕约束）。
   */
  isWithinDoNotDisturb(preference: CustomerReachPreference): boolean {
    const dnd = preference.doNotDisturb;
    if (!dnd.enabled) return false;
    const now = formatDateTimeInZone(new Date(), getAppTimeZone())?.slice(11, 16);
    if (!now) return false;
    const { start, end } = dnd;
    if (start === end) return true; // 起止相同 = 全天免打扰
    if (start < end) return now >= start && now < end;
    return now >= start || now < end; // 跨夜
  }

  /** 加载客户（scoped：租户内 + 未软删），缺失抛 A0510；返回含触达偏好列 */
  private async loadCustomer(customerId: string) {
    const customer = await this.prisma.scoped.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { id: true, reachPreferences: true },
    });
    if (!customer) {
      throw new BusinessException(ErrorCode.CUSTOMER_NOT_FOUND);
    }
    return customer;
  }
}
