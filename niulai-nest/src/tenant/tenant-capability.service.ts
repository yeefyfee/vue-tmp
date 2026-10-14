import { Injectable } from "@nestjs/common";

import { PrismaService } from "../common/prisma/prisma.service";
import { BusinessException } from "../common/exceptions/business.exception";
import { ErrorCode } from "../common/enums/error-code.enum";
import type { TenantCapability } from "@peluvida/shared";
import { tenantHasCapability } from "@peluvida/shared";

/**
 * 租户能力服务（P0-03-01，Q10 决策）
 *
 * 职责：把「租户是否具备某能力」的判断收敛到唯一入口。
 * 业务代码**只调用本服务判断能力开关**，禁止读 `plan` 字段做运行时分支。
 *
 * 口径：
 *  - `tenant` 是平台级根表（不受租户 RLS 过滤、不在 TENANT_SCOPED_MODELS），
 *    走 `prisma.tenant` 直连；
 *  - fail-closed：租户不存在 / 已停用 / 已逻辑删除 / flags 结构异常，
 *    一律视为不具备能力（与 A0302 上下文缺失同口径）。
 */
@Injectable()
export class TenantCapabilityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 按主键查**在业**租户（未逻辑删除且未停用）；不存在 / 停用返回 null。
   */
  async findActiveById(tenantId: string | bigint) {
    const id = typeof tenantId === "bigint" ? tenantId : BigInt(tenantId);
    return this.prisma.tenant.findFirst({
      where: { id, status: 1, deletedAt: null },
      select: { id: true, name: true, code: true, plan: true, featureFlags: true },
    });
  }

  /**
   * 判定租户是否具备某能力（fail-closed，只读不抛错）。
   */
  async hasCapability(tenantId: string | bigint, capability: TenantCapability): Promise<boolean> {
    try {
      const tenant = await this.findActiveById(tenantId);
      if (!tenant) return false;
      return tenantHasCapability(tenant.featureFlags, capability);
    } catch {
      // 查询异常（含非法 tenantId 格式）一律按不具备处理，不放大为 5xx
      return false;
    }
  }

  /**
   * 断言租户具备某能力，不具备抛 A0304（供业务方法入口 fail-closed 拦截）。
   */
  async requireCapability(tenantId: string | bigint, capability: TenantCapability): Promise<void> {
    const ok = await this.hasCapability(tenantId, capability);
    if (!ok) {
      throw new BusinessException(ErrorCode.TENANT_CAPABILITY_NOT_INCLUDED);
    }
  }
}
