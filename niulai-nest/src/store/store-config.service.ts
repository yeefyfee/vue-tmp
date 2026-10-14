import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import {
  STORE_CONFIG_KEYS,
  isValidStoreConfigValue,
  resolveStoreConfig,
  type StoreConfig,
  type StoreConfigKey,
} from "@peluvida/shared";
import { PrismaService } from "../common/prisma/prisma.service";
import { toBigInt } from "../common/prisma/prisma-ids";
import { RequestContext } from "../common/context/request-context";
import { ErrorCode } from "../common/enums/error-code.enum";
import { BusinessException } from "../common/exceptions/business.exception";
import { UpdateStoreConfigDto } from "./dto/update-store-config.dto";

/**
 * 门店配置服务（P0-04-05 · FR-4）
 *
 * 数据落点：`store.config`（JSONB，门店级覆盖；平台默认值在 shared 包统一维护）。
 *
 * 读写口径：
 *  - GET：`resolveStoreConfig`（fail-safe）——config 为 NULL / 脏数据 → 全默认；
 *    非 NULL → 逐键合并默认值，恒返回完整六键结构；
 *  - PATCH：浅 merge 到现有配置上，**写侧从严**——请求键逐键走 shared
 *    `isValidStoreConfigValue` 校验（非法抛 A0437），合并结果整包回写；
 *  - 乐观锁：共用 `store.version`（PATCH 必须携带 GET 返回的 version），
 *    P2025 回查区分 A0423（版本冲突）/ A0424（门店不存在）。
 */
@Injectable()
export class StoreConfigService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 查询结构化配置（FR-4）：config 为 NULL 时合并平台默认值返回；
   * 非 NULL 时逐键合并默认值（缺失/非法键回落默认）。
   */
  async getStoreConfig(storeId: string) {
    const store = await this.requireStore(storeId);
    return {
      storeId: store.id,
      config: resolveStoreConfig(store.config),
      version: store.version,
    };
  }

  /**
   * 部分更新配置（FR-4，浅 merge + store.version 乐观锁）
   *
   * 校验顺序：请求键逐键严格校验（A0437）→ 合并 → `where: { id, version }`
   * 提交 → 返回合并后的完整配置与自增后的 version。
   */
  async updateStoreConfig(storeId: string, dto: UpdateStoreConfigDto) {
    const userId = RequestContext.getUserId();

    const store = await this.requireStore(storeId);

    // 写侧从严：请求里出现的键必须逐键合法（DTO 已声明式校验一层，
    // 这里对绕过 ValidationPipe 的直调场景再兜底，双保险）
    const provided = this.extractProvidedKeys(dto);
    for (const [key, value] of Object.entries(provided)) {
      if (!isValidStoreConfigValue(key as StoreConfigKey, value)) {
        throw new BusinessException(ErrorCode.STORE_CONFIG_INVALID);
      }
    }

    // 浅 merge：默认/存量配置打底，请求键覆盖（合并结果恒为完整六键；
    // provided 已逐键通过 isValidStoreConfigValue 校验，按键位收窄回 StoreConfig 形态）
    const merged: StoreConfig = {
      ...resolveStoreConfig(store.config),
      ...(provided as Partial<StoreConfig>),
    };

    try {
      const updated = await this.prisma.scoped.store.update({
        where: { id: storeId, version: dto.version, deletedAt: null },
        data: {
          config: merged as unknown as Prisma.InputJsonValue,
          updatedBy: toBigInt(userId),
          version: { increment: 1 },
        },
      });
      return {
        storeId: updated.id,
        config: resolveStoreConfig(updated.config),
        version: updated.version,
      };
    } catch (error) {
      if ((error as { code?: string })?.code === "P2025") {
        // 版本不匹配 vs 记录不存在：requireStore 已保证存在，P2025 只能是版本冲突，
        // 但仍按 store.service 同口径回查区分，避免竞态下误报
        const exists = await this.prisma.scoped.store.findFirst({
          where: { id: storeId, deletedAt: null },
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

  /** 从 DTO 收集「请求中出现」的配置键（undefined = 未提供，不进 merge） */
  private extractProvidedKeys(dto: UpdateStoreConfigDto): Partial<Record<StoreConfigKey, unknown>> {
    const provided: Partial<Record<StoreConfigKey, unknown>> = {};
    for (const key of STORE_CONFIG_KEYS) {
      const value = (dto as unknown as Record<string, unknown>)[key];
      if (value !== undefined) {
        provided[key] = value;
      }
    }
    return provided;
  }

  /** 门店归属校验（租户条件由 prisma.scoped 扩展注入）；非本租户/已软删 → A0424 */
  private async requireStore(storeId: string) {
    const store = await this.prisma.scoped.store.findFirst({
      where: { id: storeId, deletedAt: null },
    });
    if (!store) {
      throw new BusinessException(ErrorCode.STORE_NOT_FOUND);
    }
    return store;
  }
}
