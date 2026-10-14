import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { toBigInt } from "../../common/prisma/prisma-ids";
import {
  endOfDay,
  enumerateDays,
  formatDateTimeInZone,
  getAppTimeZone,
  startOfDay,
  toDayString,
} from "../../common/utils/date.util";
import { LogQueryDto } from "./dto/log-query.dto";
import { LogPageDto } from "./dto/log-page.dto";
import { VisitTrendDto } from "./dto/visit-trend.dto";
import { VisitStatsDto } from "./dto/visit-stats.dto";
import { ActionTypeEnum, ActionTypeValue } from "../../common/enums/action-type.enum";
import { LogModuleEnum, LogModuleValue } from "../../common/enums/log-module.enum";
import { parseUserAgent } from "../../common/utils/user-agent.util";
import { LOG_COLUMN_LIMITS, clampLogText, resolveLogTitle } from "./log.util";

export interface ManualLogParams {
  /** 所属模块（原实现漏传，导致 module/title 为 NOT NULL 的插入依赖 MySQL 非严格模式，此处显式必填） */
  module: LogModuleValue;
  actionType: ActionTypeValue;
  /** 不传则按「模块label-操作label」自动生成 */
  title?: string;
  content?: string;
  operatorId: string | null;
  operatorName?: string;
  requestMethod: string;
  requestUri: string;
  ip?: string;
  userAgent?: string;
  status?: number;
  errorMsg?: string;
  executionTime?: number;
}

/**
 * `sortBy` 允许的字段：沿用历史入参的**下划线列名**，映射到 Prisma 字段名。
 * 使用白名单而非直接透传，避免排序字段被拼进 SQL。
 */
const SORT_FIELD_MAP: Record<string, keyof Prisma.SysLogOrderByWithRelationInput> = {
  create_time: "createTime",
  execution_time: "executionTime",
  action_type: "actionType",
  request_uri: "requestUri",
  request_method: "requestMethod",
  ip: "ip",
  status: "status",
};

/** 关键字检索覆盖的列（用户可见文本 + 请求信息 + 客户端信息） */
const KEYWORD_FIELDS = [
  "title",
  "content",
  "requestUri",
  "requestMethod",
  "province",
  "city",
  "browser",
  "os",
  "device",
  "errorMsg",
] as const;

/**
 * 日志服务
 */
@Injectable()
export class LogService {
  constructor(private readonly prisma: PrismaService) {}

  async getLogPage(query: LogQueryDto) {
    const { pageNum, pageSize, keywords, createTime, sortBy, order } = query;

    const pageNumSafe = Number(pageNum) > 0 ? Number(pageNum) : 1;
    const pageSizeSafe = Number(pageSize) > 0 ? Number(pageSize) : 20;

    const where: Prisma.SysLogWhereInput = {};
    const and: Prisma.SysLogWhereInput[] = [];

    if (keywords) {
      // MySQL 默认排序规则不区分大小写，PostgreSQL 的 LIKE 区分；
      // 用 insensitive 保持「搜 admin 能命中 Admin」的既有体验。
      and.push({
        OR: KEYWORD_FIELDS.map((field) => ({
          [field]: { contains: keywords, mode: "insensitive" as const },
        })),
      });
    }

    // 时间区间按**应用时区**的自然日解释，避免依赖进程时区
    const timeZone = getAppTimeZone();
    const startTime = createTime?.[0];
    const endTime = createTime?.[1];
    if (startTime) {
      const from = startOfDay(startTime, timeZone);
      if (from) and.push({ createTime: { gte: from } });
    }
    if (endTime) {
      const to = endOfDay(endTime, timeZone);
      if (to) and.push({ createTime: { lte: to } });
    }

    if (and.length) where.AND = and;

    const direction: Prisma.SortOrder = (order || "").toUpperCase() === "ASC" ? "asc" : "desc";
    const sortField = sortBy ? SORT_FIELD_MAP[sortBy] : undefined;
    const orderBy: Prisma.SysLogOrderByWithRelationInput = sortField
      ? { [sortField]: direction }
      : { createTime: "desc" };

    const [records, total] = await Promise.all([
      this.prisma.scoped.sysLog.findMany({
        where,
        orderBy,
        skip: (pageNumSafe - 1) * pageSizeSafe,
        take: pageSizeSafe,
      }),
      this.prisma.scoped.sysLog.count({ where }),
    ]);

    const list: LogPageDto[] = records.map((item) => ({
      id: item.id.toString(),
      module: item.module !== null ? LogModuleEnum.getLabel(item.module) : null,
      actionType: item.actionType !== null ? ActionTypeEnum.getLabel(item.actionType) : null,
      title: item.title,
      content: item.content,
      operatorId: item.operatorId !== null ? item.operatorId.toString() : null,
      operatorName: item.operatorName,
      status: item.status,
      requestUri: item.requestUri,
      requestMethod: item.requestMethod,
      ip: item.ip,
      region: [item.province, item.city].filter(Boolean).join(" ") || null,
      device: item.device,
      browser: item.browser,
      os: item.os,
      executionTime: item.executionTime,
      errorMsg: item.errorMsg,
      createTime: formatDateTimeInZone(item.createTime, timeZone),
    }));

    return {
      data: list,
      page: {
        pageNum: pageNumSafe,
        pageSize: pageSizeSafe,
        total,
      },
    };
  }

  async getVisitTrend(startDate: string, endDate: string): Promise<VisitTrendDto> {
    const timeZone = getAppTimeZone();
    const start = startOfDay(startDate, timeZone);
    const end = endOfDay(endDate, timeZone);
    if (!start || !end) {
      return { dates: [], pvList: [], uvList: [] };
    }

    const firstDay = toDayString(start, timeZone);
    const lastDay = toDayString(end, timeZone);
    if (!firstDay || !lastDay) {
      return { dates: [], pvList: [], uvList: [] };
    }
    const dates = enumerateDays(firstDay, lastDay);
    if (!dates.length) {
      return { dates: [], pvList: [], uvList: [] };
    }

    // 按天分组必须显式指定时区：timestamptz 直接 to_char 会按 UTC 日界切分，
    // 北京时间 07:00 的数据会被归到前一天（见 scripts/verify-datetime-semantics.mjs 契约 4）。
    const [pvRows, uvRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ day: string; count: number }>>`
        SELECT to_char(create_time AT TIME ZONE (${timeZone}::text), 'YYYY-MM-DD') AS day,
               COUNT(*)::int AS count
        FROM sys_log
        WHERE create_time >= ${start} AND create_time <= ${end}
        GROUP BY 1
      `,
      this.prisma.$queryRaw<Array<{ day: string; count: number }>>`
        SELECT to_char(create_time AT TIME ZONE (${timeZone}::text), 'YYYY-MM-DD') AS day,
               COUNT(DISTINCT ip)::int AS count
        FROM sys_log
        WHERE create_time >= ${start} AND create_time <= ${end}
        GROUP BY 1
      `,
    ]);

    const pvMap = new Map<string, number>();
    for (const row of pvRows) pvMap.set(row.day, Number(row.count) || 0);

    const uvMap = new Map<string, number>();
    for (const row of uvRows) uvMap.set(row.day, Number(row.count) || 0);

    return {
      dates,
      pvList: dates.map((d) => pvMap.get(d) ?? 0),
      uvList: dates.map((d) => uvMap.get(d) ?? 0),
    };
  }

  async getVisitStats(): Promise<VisitStatsDto> {
    const timeZone = getAppTimeZone();
    const now = new Date();
    const todayStart = startOfDay(now, timeZone);
    const todayEnd = endOfDay(now, timeZone);

    // UV 统计：按 IP 粗略统计（COUNT(DISTINCT) 会忽略 NULL，与旧实现一致）
    const uvSql = (withToday: boolean) =>
      withToday
        ? this.prisma.$queryRaw<Array<{ count: number }>>`
            SELECT COUNT(DISTINCT ip)::int AS count FROM sys_log
            WHERE create_time >= ${todayStart} AND create_time <= ${todayEnd}
          `
        : this.prisma.$queryRaw<Array<{ count: number }>>`
            SELECT COUNT(DISTINCT ip)::int AS count FROM sys_log
          `;

    const [todayUvRows, totalUvRows, todayPvCount, totalPvCount] = await Promise.all([
      uvSql(true),
      uvSql(false),
      this.prisma.sysLog.count({
        where: { createTime: { gte: todayStart ?? undefined, lte: todayEnd ?? undefined } },
      }),
      this.prisma.sysLog.count(),
    ]);

    const todayUvCount = Number(todayUvRows[0]?.count ?? 0);
    const totalUvCount = Number(totalUvRows[0]?.count ?? 0);

    const prevUvTotal = totalUvCount - todayUvCount;
    const prevPvTotal = totalPvCount - todayPvCount;

    const uvGrowthRate =
      prevUvTotal > 0 ? Number(((todayUvCount / prevUvTotal - 1) * 100).toFixed(2)) : null;
    const pvGrowthRate =
      prevPvTotal > 0 ? Number(((todayPvCount / prevPvTotal - 1) * 100).toFixed(2)) : null;

    return {
      todayUvCount,
      totalUvCount,
      uvGrowthRate,
      todayPvCount,
      totalPvCount,
      pvGrowthRate,
    };
  }

  /**
   * 手动记录日志（用于登录/登出等 Public 接口）
   * 拦截器无法从安全上下文获取 userId，需在业务逻辑中手动传入
   */
  async saveManualLog(params: ManualLogParams) {
    const { browser, os } = parseUserAgent(params.userAgent ?? "");

    await this.prisma.sysLog.create({
      data: {
        module: params.module,
        actionType: params.actionType,
        title: clampLogText(
          resolveLogTitle(params.module, params.actionType, params.title),
          LOG_COLUMN_LIMITS.title
        ) as string,
        content: params.content ?? null,
        requestMethod: clampLogText(params.requestMethod, LOG_COLUMN_LIMITS.requestMethod),
        requestUri: clampLogText(params.requestUri, LOG_COLUMN_LIMITS.requestUri),
        ip: clampLogText(params.ip, LOG_COLUMN_LIMITS.ip),
        province: null,
        city: null,
        device: clampLogText(os, LOG_COLUMN_LIMITS.device),
        os: clampLogText(os, LOG_COLUMN_LIMITS.os),
        browser: clampLogText(browser, LOG_COLUMN_LIMITS.browser),
        status: params.status ?? 1,
        errorMsg: clampLogText(params.errorMsg, LOG_COLUMN_LIMITS.errorMsg),
        executionTime: params.executionTime ?? 0,
        operatorId: toBigInt(params.operatorId),
        operatorName: clampLogText(params.operatorName, LOG_COLUMN_LIMITS.operatorName),
        createTime: new Date(),
      },
    });
  }
}
