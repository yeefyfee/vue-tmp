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
import { BatchDispatchConfigDto } from "./dto/batch-dispatch-config.dto";

/** 单店下发成功回执 */
export interface BatchDispatchSuccess {
  storeId: string;
  /** 下发后的乐观锁版本号（单店 version 自增 1） */
  version: number;
}

/** 单店下发失败回执（部分成功语义：失败不中断、不整体回滚） */
export interface BatchDispatchFailure {
  storeId: string;
  /** 业务码（A0424 门店不存在 / A0423 版本冲突 / B0001 系统异常） */
  code: string;
  reason: string;
}

/** 总部视角门店总览条目（FR-5 骨架摘要口径） */
export interface StoreOverviewItem {
  id: string;
  code: string;
  name: string;
  status: number;
  /** 结构化配置摘要（resolveStoreConfig 恒为完整六键，缺键回落平台默认） */
  config: StoreConfig;
  /** 全部日历例外日计数（未删除） */
  calendarExceptionCount: number;
  /** 未到来的例外日计数（date >= 今日 UTC 午夜；纯日期算术口径） */
  upcomingCalendarExceptionCount: number;
}

/**
 * 总部-门店两级管理服务（P0-04-06 · FR-5 骨架）
 *
 * Q15 决策口径：MVP 仅落 Tenant→Store 归属关系（store.tenant_id，数据层已存在）
 * + 门店 CRUD；「总部批量下发/统一管控」的深化（批量营业时间模板、审批流、
 * 事务性全量对账、按门店分组的差异化模板、异步任务化）全部推进 M3。
 * 本服务只提供骨架级两能力：总部视角总览 + 配置键批量下发。
 *
 * 🔴 M3 深化点（骨架刻意留白，勿在本轮补齐）：
 *  ① 下发范围仅限 store.config 配置键——营业时间模板/日历模板/类目模板的
 *     批量下发待 M3 统一设计（涉及模板实体与差异化覆盖语义）；
 *  ② 乐观锁为「读当前 version → CAS 写」的逐店提交，M3 应升级为客户端
 *     显式携带 per-store version 或服务端事务快照，避免 ABA 窗口；
 *  ③ 部分成功语义为「逐店独立提交、失败收集」，M3 若需全有或全无模式，
 *     应引入批次单（dispatch batch）实体与补偿机制；
 *  ④ 大规模门店（>100）应异步任务化 + 进度查询接口。
 *
 * 数据访问统一走 `prisma.scoped.*`（租户隔离扩展自动注入 tenantId 条件，
 * RLS 兜底）；归属一律以 `RequestContext.getTenantId()`（JWT payload）为锚点。
 */
@Injectable()
export class StoreHqService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 总部视角门店总览（FR-5 骨架）：租户级列出全部门店 + 每店摘要。
   *
   * 摘要口径：id / code / name / status / 结构化配置（完整六键）/
   * 日历例外计数（全量 + 未到来两口径）。
   */
  async getTenantOverview() {
    const stores = await this.prisma.scoped.store.findMany({
      where: { deletedAt: null },
      orderBy: [{ createdAt: "desc" }],
    });

    // 日历例外计数：按 storeId 分组在应用层完成（scoped 扩展不覆盖 groupBy，
    // 门店量级为个位数~两位数，一次 findMany 全量拉取无性能问题；M3 量级
    // 上来后再换 SQL 聚合）
    const calendarEntries = await this.prisma.scoped.storeCalendar.findMany({
      where: { deletedAt: null },
      select: { storeId: true, date: true },
    });

    // 「未到来」锚点：今日 UTC 午夜（DATE 列无时区语义，纯日期算术口径）
    const now = new Date();
    const todayUtcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

    const countByStore = new Map<string, number>();
    const upcomingByStore = new Map<string, number>();
    for (const entry of calendarEntries) {
      const storeId = String(entry.storeId);
      countByStore.set(storeId, (countByStore.get(storeId) ?? 0) + 1);
      if (entry.date.getTime() >= todayUtcMidnight) {
        upcomingByStore.set(storeId, (upcomingByStore.get(storeId) ?? 0) + 1);
      }
    }

    const items: StoreOverviewItem[] = stores.map((store) => ({
      id: store.id,
      code: store.code,
      name: store.name,
      status: store.status,
      config: resolveStoreConfig(store.config),
      calendarExceptionCount: countByStore.get(store.id) ?? 0,
      upcomingCalendarExceptionCount: upcomingByStore.get(store.id) ?? 0,
    }));

    return { items, total: items.length };
  }

  /**
   * 批量下发配置键子集（FR-5 骨架，部分成功语义）
   *
   * 流程：请求级校验（空 storeIds / 空 config → A0440；非法键/值 → A0437，
   * 请求级拒绝直接抛出，不进 failed 数组）→ 逐店「读当前 version → CAS 写」
   * → 单店失败收集进 failed（A0424 门店不存在 / A0423 版本冲突），不中断、
   * 不整体回滚。返回 `{ total, succeeded, failed }`。
   */
  async batchDispatchConfig(dto: BatchDispatchConfigDto) {
    const userId = RequestContext.getUserId();

    // 租户上下文只认 JWT（@RequireTenant 保证非空；直调场景 fail-closed）
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw new BusinessException(ErrorCode.TENANT_CONTEXT_MISSING);
    }

    // 请求级校验：非法即整体拒绝（不产生任何门店写入）
    const validatedConfig = this.assertDispatchPayload(dto);

    const succeeded: BatchDispatchSuccess[] = [];
    const failed: BatchDispatchFailure[] = [];

    for (const storeId of dto.storeIds) {
      try {
        const store = await this.prisma.scoped.store.findFirst({
          where: { id: storeId, deletedAt: null },
        });
        if (!store) {
          throw new BusinessException(ErrorCode.STORE_NOT_FOUND);
        }

        // M3 深化点②：读当前 version → CAS 写（单店乐观锁）；ABA 窗口由 P2025 兜底
        const merged: StoreConfig = {
          ...resolveStoreConfig(store.config),
          ...(validatedConfig as Partial<StoreConfig>),
        };

        try {
          const updated = await this.prisma.scoped.store.update({
            where: { id: storeId, version: store.version, deletedAt: null },
            data: {
              config: merged as unknown as Prisma.InputJsonValue,
              updatedBy: toBigInt(userId),
              version: { increment: 1 },
            },
          });
          succeeded.push({ storeId: updated.id, version: updated.version });
        } catch (error) {
          if ((error as { code?: string })?.code === "P2025") {
            // 版本不匹配 vs 记录不存在：回查区分，与 store.service 同口径
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
      } catch (error) {
        // 部分成功语义：单店失败仅收集，不中断后续门店、不回滚已成功门店
        failed.push({ storeId, ...this.resolveFailureReason(error) });
      }
    }

    return { total: dto.storeIds.length, succeeded, failed };
  }

  /**
   * 请求级载荷校验（写侧从严，与单店 PATCH 同一校验源）：
   *  - storeIds 为空 或 config 无任何键 → A0440（本轮新错误码）；
   *  - config 出现 STORE_CONFIG_KEYS 之外的键，或任一值未通过
   *    isValidStoreConfigValue → A0437（复用门店配置域错误码）。
   * 校验通过后返回按键位收窄的下发子集（仅含合法键）。
   */
  private assertDispatchPayload(
    dto: BatchDispatchConfigDto
  ): Partial<Record<StoreConfigKey, unknown>> {
    if (!Array.isArray(dto.storeIds) || dto.storeIds.length === 0) {
      throw new BusinessException(ErrorCode.STORE_BATCH_DISPATCH_INVALID);
    }
    const provided = dto.config ?? {};
    const keys = Object.keys(provided);
    if (keys.length === 0) {
      throw new BusinessException(ErrorCode.STORE_BATCH_DISPATCH_INVALID);
    }

    const validated: Partial<Record<StoreConfigKey, unknown>> = {};
    for (const key of keys) {
      if (!(STORE_CONFIG_KEYS as readonly string[]).includes(key)) {
        throw new BusinessException(ErrorCode.STORE_CONFIG_INVALID);
      }
      if (!isValidStoreConfigValue(key as StoreConfigKey, provided[key])) {
        throw new BusinessException(ErrorCode.STORE_CONFIG_INVALID);
      }
      validated[key as StoreConfigKey] = provided[key];
    }
    return validated;
  }

  /** 把逐店异常翻译为失败回执（业务异常取信封码；其余归 B0001 系统异常） */
  private resolveFailureReason(error: unknown): { code: string; reason: string } {
    if (error instanceof BusinessException) {
      const response = error.getResponse() as { code?: string; msg?: string };
      return {
        code: response.code ?? ErrorCode.SYSTEM_ERROR.code,
        reason: response.msg ?? ErrorCode.SYSTEM_ERROR.msg,
      };
    }
    return { code: ErrorCode.SYSTEM_ERROR.code, reason: "下发失败（系统异常）" };
  }
}
