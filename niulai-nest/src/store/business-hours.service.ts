import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../common/prisma/prisma.service";
import { toBigInt } from "../common/prisma/prisma-ids";
import { RequestContext } from "../common/context/request-context";
import { ErrorCode } from "../common/enums/error-code.enum";
import { BusinessException } from "../common/exceptions/business.exception";
import { SaveBusinessHoursDto } from "./dto/save-business-hours.dto";

/**
 * 每周营业时段键位（周一~周日；与 PRD/前端约定的两字母小写 slug 口径）
 */
export const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

/** 墙钟时间 HH:mm（24 小时制） */
const WALL_CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 每天最多的时段段数（FR-3 口径） */
export const MAX_SEGMENTS_PER_DAY = 3;

/** 判定是否为普通对象（排除数组 / null / 原始值） */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

/** "HH:mm" → 当日分钟数（调用前须保证已通过 WALL_CLOCK_TIME_PATTERN 校验） */
function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * 结构化空模板：7 天键齐全、每天空数组。
 * GET 在门店从未配置（business_hours = "{}"）时返回该模板。
 */
export function buildEmptyWeeklyTemplate(): Record<WeekdayKey, unknown[]> {
  return {
    mon: [],
    tue: [],
    wed: [],
    thu: [],
    fri: [],
    sat: [],
    sun: [],
  };
}

/**
 * 把库内半结构化 weekly JSON 规整为「7 天键齐全」的模板形态：
 * 缺失键补空数组；非数组值（脏数据）同样回落空数组（fail-safe，读取口径从容）。
 */
export function normalizeWeekly(raw: unknown): Record<WeekdayKey, unknown[]> {
  const normalized = buildEmptyWeeklyTemplate();
  if (isPlainObject(raw)) {
    for (const key of WEEKDAY_KEYS) {
      const value = raw[key];
      if (Array.isArray(value)) {
        normalized[key] = value as unknown[];
      }
    }
  }
  return normalized;
}

/**
 * 每周营业时段整存整取校验（写侧严格口径）：
 *  - 必须是 plain object 且**恰好包含 7 天键**（多余键拒绝，白名单收敛）；
 *  - 每天是数组，最多 MAX_SEGMENTS_PER_DAY 段；
 *  - 每段是 `[open, close]` 二元组，"HH:mm" 格式且 close > open（不允许跨天/相等）。
 *
 * 非法一律抛 STORE_BUSINESS_HOURS_INVALID（A0436）。
 */
export function assertValidWeekly(raw: unknown): asserts raw is Record<WeekdayKey, unknown[]> {
  if (!isPlainObject(raw)) {
    throw new BusinessException(ErrorCode.STORE_BUSINESS_HOURS_INVALID);
  }
  // 白名单收敛：除 7 天键外的任何键（含大写/拼写变体）一律拒绝
  for (const key of Object.keys(raw)) {
    if (!(WEEKDAY_KEYS as readonly string[]).includes(key)) {
      throw new BusinessException(ErrorCode.STORE_BUSINESS_HOURS_INVALID);
    }
  }
  for (const key of WEEKDAY_KEYS) {
    const segments = raw[key];
    if (!Array.isArray(segments) || segments.length > MAX_SEGMENTS_PER_DAY) {
      throw new BusinessException(ErrorCode.STORE_BUSINESS_HOURS_INVALID);
    }
    for (const segment of segments) {
      if (
        !Array.isArray(segment) ||
        segment.length !== 2 ||
        typeof segment[0] !== "string" ||
        typeof segment[1] !== "string" ||
        !WALL_CLOCK_TIME_PATTERN.test(segment[0]) ||
        !WALL_CLOCK_TIME_PATTERN.test(segment[1]) ||
        toMinutes(segment[1]) <= toMinutes(segment[0])
      ) {
        throw new BusinessException(ErrorCode.STORE_BUSINESS_HOURS_INVALID);
      }
    }
  }
}

/**
 * 每周营业时段服务（P0-04-04 · FR-3）
 *
 * 数据落点：`store.business_hours`（JSONB，整存整取），不走乐观锁的独立表——
 * 与门店档案共用 `store.version` 乐观锁（PUT 必须携带 GET 返回的 version）。
 *
 * 契约口径（对齐 store.service）：
 *  - 门店归属走 `prisma.scoped.store.findFirst`（租户条件由扩展注入），非本租户
 *    或已软删 → STORE_NOT_FOUND（A0424）；
 *  - 乐观锁：update 以 `where: { id, version }` 提交，P2025 回查区分
 *    STORE_VERSION_CONFLICT（A0423）/ STORE_NOT_FOUND（A0424）。
 */
@Injectable()
export class BusinessHoursService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 查询每周营业时段（FR-3）
   *
   * 返回 7 天键齐全的规整模板（无配置 / 脏数据键回落空数组）+ 门店乐观锁版本号。
   */
  async getBusinessHours(storeId: string) {
    const store = await this.requireStore(storeId);
    return {
      storeId: store.id,
      businessHours: normalizeWeekly(store.businessHours),
      version: store.version,
    };
  }

  /**
   * 整存整取每周营业时段（FR-3，走 store.version 乐观锁）
   *
   * 先做整包结构校验（A0436），再以 `where: { id, version }` 提交；
   * 成功后返回规整后的时段与自增后的 version。
   */
  async saveBusinessHours(storeId: string, dto: SaveBusinessHoursDto) {
    const userId = RequestContext.getUserId();

    assertValidWeekly(dto.businessHours);

    try {
      const updated = await this.prisma.scoped.store.update({
        where: { id: storeId, version: dto.version, deletedAt: null },
        data: {
          businessHours: dto.businessHours as Prisma.InputJsonValue,
          updatedBy: toBigInt(userId),
          version: { increment: 1 },
        },
      });
      return {
        storeId: updated.id,
        businessHours: normalizeWeekly(updated.businessHours),
        version: updated.version,
      };
    } catch (error) {
      if ((error as { code?: string })?.code === "P2025") {
        // 版本不匹配 vs 记录不存在：回查区分，给出精确业务码（与 store.service 同口径）
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
