import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import {
  TENANT_CAPABILITY_KEYS,
  TENANT_PLAN_PRESETS,
  tenantHasCapability,
  type TenantCapability,
  type TenantFeatureFlags,
} from "@peluvida/shared";

import { PrismaService } from "../common/prisma/prisma.service";
import { toBigInt } from "../common/prisma/prisma-ids";
import { RequestContext } from "../common/context/request-context";
import { ErrorCode } from "../common/enums/error-code.enum";
import { BusinessException } from "../common/exceptions/business.exception";
import { QueryTenantDto } from "./dto/query-tenant.dto";
import { UpdateTenantDto } from "./dto/update-tenant.dto";

/**
 * 排序字段白名单：sortBy 必须落在集合内，否则回落默认值
 * （防注入 + 防无索引全表排序，与 StoreService 同口径）。
 */
const SORTABLE_FIELDS = ["createdAt", "code", "name", "status", "plan"] as const;
type SortableField = (typeof SORTABLE_FIELDS)[number];

/** 能力开关逐键布尔值（前端门控渲染用：键齐全，未配置键恒为 false） */
export type TenantCapabilityMap = Record<TenantCapability, boolean>;

/**
 * 租户管理服务（P0-03-04）
 *
 * 数据访问口径：`tenant` 是**平台级根表**（不套 uuid、不受租户 RLS、
 * 不在 TENANT_SCOPED_MODELS），平台侧接口直接走 `prisma.tenant`——
 * 与 `TenantCapabilityService` 同源；租户侧 `current` 接口同样直连根表
 * （读自己的档案不涉及跨租户数据，RLS 不适用）。
 *
 * 门控契约（验收链）：
 *  - PATCH plan 且未显式带 featureFlags → feature_flags 整体覆写为套餐预设；
 *  - 租户侧 GET /tenants/current 逐键回抛生效能力开关；
 *  - 业务模块继续只消费 `TenantCapabilityService.requireCapability`（A0304），
 *    本服务不改任何业务模块。
 *
 * 停用语义（status=0）：
 *  - `current` 接口 fail-closed 抛 A0303（与能力判断 `findActiveById` 同口径）；
 *  - 登录链路暂不校验租户状态（auth 只查 sys_user.status，本轮禁改 src/auth/**），
 *    详见任务报告遗留项。
 */
@Injectable()
export class TenantManagementService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 租户侧：当前租户档案 + 生效能力开关清单
   *
   * fail-closed：租户不存在 / 已逻辑删除 / 已停用 → A0303（与能力判断口径一致，
   * 停用租户不回抛任何能力开关，前端门控渲染自然全部关闭）。
   */
  async getCurrentTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: this.parseTenantId(tenantId), deletedAt: null },
      select: { id: true, name: true, code: true, status: true, plan: true, featureFlags: true },
    });

    if (!tenant || tenant.status !== 1) {
      throw new BusinessException(ErrorCode.TENANT_NOT_FOUND);
    }

    return {
      ...tenant,
      capabilities: this.buildCapabilityMap(tenant.featureFlags),
    };
  }

  /**
   * 平台侧：租户分页列表（code 前缀 / name 模糊 / status / plan 筛选）。
   * 返回 `{ data, page }`，由全局 ResponseInterceptor 改写成 A4 信封。
   */
  async getTenantPage(query: QueryTenantDto) {
    const pageNum = Number(query.pageNum) > 0 ? Number(query.pageNum) : 1;
    const pageSize = Number(query.pageSize) > 0 ? Number(query.pageSize) : 20;

    const where: Prisma.TenantWhereInput = { deletedAt: null };
    if (query.code) {
      where.code = { startsWith: query.code };
    }
    if (query.name) {
      where.name = { contains: query.name };
    }
    if (query.status !== undefined && query.status !== null) {
      where.status = query.status;
    }
    if (query.plan) {
      where.plan = query.plan;
    }

    const sortBy = this.resolveSortField(query.sortBy);
    const order: Prisma.SortOrder = query.order?.toUpperCase() === "ASC" ? "asc" : "desc";
    const orderBy: Prisma.TenantOrderByWithRelationInput = { [sortBy]: order };

    const [list, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        orderBy,
        skip: (pageNum - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          name: true,
          code: true,
          status: true,
          plan: true,
          featureFlags: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.tenant.count({ where }),
    ]);

    return {
      data: list,
      page: { pageNum, pageSize, total },
    };
  }

  /**
   * 平台侧：租户详情（已逻辑删除视为不存在 → A0303）
   */
  async getTenantDetail(id: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: this.parseTenantId(id), deletedAt: null },
    });
    if (!tenant) {
      throw new BusinessException(ErrorCode.TENANT_NOT_FOUND);
    }
    return tenant;
  }

  /**
   * 平台侧：更新租户（name/status/plan/featureFlags）
   *
   * plan → feature_flags 同步裁决（验收链核心）：
   *  1. 带 plan、不带 featureFlags → flags 整体覆写为该套餐预设；
   *  2. 带 plan、也显式带 featureFlags → 以请求值覆盖预设（平台定制）；
   *  3. 只带 featureFlags → 精修开关，plan 不动。
   *
   * feature_flags 是能力判断的**唯一运行时真源**（Q10），因此这里必须整包覆写、
   * 不做浅 merge——避免套餐降级后残留高阶能力键造成越权放行。
   */
  async updateTenant(id: string, dto: UpdateTenantDto) {
    const operatorId = RequestContext.getUserId();

    const existing = await this.prisma.tenant.findFirst({
      where: { id: this.parseTenantId(id), deletedAt: null },
      select: { id: true },
    });
    if (!existing) {
      throw new BusinessException(ErrorCode.TENANT_NOT_FOUND);
    }

    const data: Prisma.TenantUpdateInput = { updatedBy: toBigInt(operatorId) };
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.status !== undefined) data.status = dto.status;

    if (dto.plan !== undefined) {
      data.plan = dto.plan;
      if (dto.featureFlags !== undefined) {
        // 显式覆盖优先于套餐预设（平台定制开关随 plan 变更一并提交）
        data.featureFlags = this.normalizeFeatureFlags(dto.featureFlags) as Prisma.InputJsonValue;
      } else {
        data.featureFlags = TENANT_PLAN_PRESETS[
          dto.plan as keyof typeof TENANT_PLAN_PRESETS
        ] as Prisma.InputJsonValue;
      }
    } else if (dto.featureFlags !== undefined) {
      data.featureFlags = this.normalizeFeatureFlags(dto.featureFlags) as Prisma.InputJsonValue;
    }

    const updated = await this.prisma.tenant.update({
      where: { id: existing.id },
      data: { ...data, version: { increment: 1 } },
      select: {
        id: true,
        name: true,
        code: true,
        status: true,
        plan: true,
        featureFlags: true,
        version: true,
        updatedAt: true,
      },
    });

    return {
      ...updated,
      capabilities: this.buildCapabilityMap(updated.featureFlags),
    };
  }

  /**
   * 逐键布尔化能力开关（fail-closed：未配置 / 非布尔 true 一律 false），
   * 复用 shared 纯函数 `tenantHasCapability`，与运行时门控口径完全一致。
   */
  private buildCapabilityMap(flags: unknown): TenantCapabilityMap {
    const map = {} as TenantCapabilityMap;
    for (const key of TENANT_CAPABILITY_KEYS) {
      map[key] = tenantHasCapability(flags, key);
    }
    return map;
  }

  /**
   * 请求侧 featureFlags 白名单校验：键必须 ∈ TENANT_CAPABILITY_KEYS、
   * 值必须是布尔；非法键/值 → A0402（防御未知能力键污染运行时判断）。
   */
  private normalizeFeatureFlags(flags: Record<string, unknown>): TenantFeatureFlags {
    const normalized: TenantFeatureFlags = {};
    for (const [key, value] of Object.entries(flags)) {
      if (
        !(TENANT_CAPABILITY_KEYS as readonly string[]).includes(key) ||
        typeof value !== "boolean"
      ) {
        throw new BusinessException(ErrorCode.INVALID_USER_INPUT);
      }
      normalized[key as TenantCapability] = value;
    }
    return normalized;
  }

  /** 排序字段白名单解析，非法值回落 createdAt */
  private resolveSortField(sortBy?: string): SortableField {
    if (sortBy && (SORTABLE_FIELDS as readonly string[]).includes(sortBy)) {
      return sortBy as SortableField;
    }
    return "createdAt";
  }

  /**
   * 租户主键解析：BigInt 根表主键只接受纯数字字符串；
   * 非法格式（uuid / 负数 / 表达式注入）→ A0402，不透传数据库。
   */
  private parseTenantId(id: string): bigint {
    if (!/^\d+$/.test(id)) {
      throw new BusinessException(ErrorCode.INVALID_USER_INPUT);
    }
    return BigInt(id);
  }
}
