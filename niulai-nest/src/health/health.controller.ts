import { Controller, Get, Res } from "@nestjs/common";
import type { Response } from "express";
import { SetMetadata } from "@nestjs/common";
import { Public } from "../common/decorators/auth.decorator";
import { PrismaService } from "../common/prisma/prisma.service";
import { RedisService } from "../common/redis/redis.service";

/**
 * 健康检查（P0-01-03）
 *
 * `GET /api/v1/health`：探测 DB（SELECT 1）与 Redis（PING）连通性，
 * 供 LB / 容器编排探针与运维使用：
 *  - 全部健康：200 `{ status: "ok", checks: { db: true, redis: true } }`；
 *  - 任一不可用：503，`checks` 标明各项结果，`errors` 携带失败原因（截断）。
 *
 * 实现口径：
 *  - `@Res` 直控状态码与响应体：探活失败是**基础设施状态**而非应用异常，
 *    不走全局异常过滤器（503 必须原样透出，不能被改写）；
 *  - `skipResponseTransform`：探针读取裸 JSON，不包统一信封；
 *  - 探活带 2s 超时（`Promise.race`）：依赖挂死时探针也必须按时返回；
 *  - `@Public()`：探针不带令牌。
 */
@Controller("health")
export class HealthController {
  /** 单项探活超时（毫秒） */
  private static readonly PROBE_TIMEOUT_MS = 2000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService
  ) {}

  @Public()
  @SetMetadata("skipResponseTransform", true)
  @Get()
  async check(@Res() res: Response): Promise<void> {
    const checks = { db: false, redis: false };
    const errors: Record<string, string> = {};

    const withTimeout = <T>(p: Promise<T>, label: string): Promise<T | null> => {
      let timer: ReturnType<typeof setTimeout>;
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          errors[label] = `timeout after ${HealthController.PROBE_TIMEOUT_MS}ms`;
          resolve(null);
        }, HealthController.PROBE_TIMEOUT_MS);
      });
      // race 胜出后清理 timer，避免进程 / 测试出现悬挂句柄
      return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
    };

    try {
      // race 超时返回 null（errors 已由 timer 写入原因），不得计为健康
      const result = await withTimeout(this.prisma.$queryRaw`SELECT 1`, "db");
      if (result !== null) checks.db = true;
    } catch (err) {
      errors.db = String((err as Error)?.message ?? err).slice(0, 200);
    }

    try {
      const pong = await withTimeout(this.redis.getClient().ping(), "redis");
      if (pong === "PONG") checks.redis = true;
      else if (!errors.redis) errors.redis = `unexpected ping result: ${String(pong)}`;
    } catch (err) {
      errors.redis = String((err as Error)?.message ?? err).slice(0, 200);
    }

    const healthy = checks.db && checks.redis;
    const status = healthy ? 200 : 503;
    const body = healthy ? { status: "ok", checks } : { status: "error", checks, errors };

    res.status(status).json(body);
  }
}
