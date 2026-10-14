import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";
import { dataScopeExtension } from "./data-scope.extension";
import { tenantScopeExtension, tenantIdToBigInt } from "../../tenant/prisma/tenant-scope.extension";

/**
 * 业务代码统一使用的「带租户隔离 + 数据权限」客户端类型。
 *
 * 链式挂载（CROSS-09）：**租户隔离在外层、数据权限在内层** —— 两类条件
 * 在同一次查询上叠加（先按租户收敛，再按部门/本人收敛），互不干扰。
 * 基础客户端 `this` 保留原样，供系统级操作（日志、字典、codegen 等）使用。
 */
function extendBusinessScopes<T extends PrismaClient>(base: T) {
  return base.$extends(tenantScopeExtension).$extends(dataScopeExtension);
}
type BusinessScopedClient = ReturnType<typeof extendBusinessScopes<PrismaClient>>;

/**
 * Prisma 数据访问服务（PEL-10）
 *
 * Prisma 7 起，客户端不再内置 Rust 查询引擎，必须显式传入 **driver adapter**；
 * 这里使用 `@prisma/adapter-pg` 复用已安装的 `pg` 驱动。
 *
 * 生命周期：
 *  - onModuleInit：主动建立连接并做一次 `SELECT 1` 探活，让「数据库不可达」
 *    在启动阶段就暴露，而不是等到第一个请求才 500。
 *  - onModuleDestroy：优雅断开，避免热重载 / 容器滚动时连接泄漏。
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  /** 当前连接的目标库名，仅用于启动日志与排障 */
  private readonly databaseName: string;

  /**
   * **带租户隔离 + 数据权限的客户端** —— 业务代码统一用这个。
   *
   * 链式扩展视图：`tenantScopeExtension`（CROSS-09，名单内模型自动注入租户条件，
   * 名单外纯透传）→ `dataScopeExtension`（PEL-10c，数据范围 where 注入）。
   */
  readonly scoped: BusinessScopedClient;

  constructor(config: ConfigService) {
    const connectionString = config.getOrThrow<string>("database.url");
    const logging = config.get<boolean>("database.logging");

    super({
      adapter: new PrismaPg({ connectionString }),
      log: logging
        ? [
            { emit: "stdout", level: "query" },
            { emit: "stdout", level: "warn" },
            { emit: "stdout", level: "error" },
          ]
        : [
            { emit: "stdout", level: "warn" },
            { emit: "stdout", level: "error" },
          ],
    });

    this.databaseName = config.get<string>("database.database") ?? "unknown";
    this.scoped = extendBusinessScopes(this);
  }

  /**
   * **RLS 兜底的 GUC 写入侧**（CROSS-09）：在事务内设置 `app.tenant_id`（SET LOCAL 语义）
   * 后执行回调，事务结束自动还原，连接归还池无残留。
   *
   * 适用场景：raw SQL 逃生通道、批处理脚本等绕过 Prisma 扩展条件的操作——
   * 带上 `tenant_id` 列的表（经 `app_enable_tenant_rls()` 启用 RLS）在此事务内
   * 由 PostgreSQL 策略强制过滤；普通业务查询无需使用（扩展层已自动注入）。
   *
   * @param tenantId 租户 ID（bigint 形态字符串）；非法即抛错（fail-closed）
   */
  async withTenantContext<T>(
    tenantId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>
  ): Promise<T> {
    const parsed = tenantIdToBigInt(tenantId);
    if (parsed === null) {
      throw new Error("[Prisma] withTenantContext：租户 ID 缺失或非法（须为 bigint 形态字符串）");
    }
    return this.$transaction(async (tx) => {
      // set_config(..., is_local := true) 等价 SET LOCAL（工具语句不支持参数绑定，走函数形式）
      await tx.$executeRaw(Prisma.sql`SELECT set_config('app.tenant_id', ${String(parsed)}, true)`);
      return fn(tx);
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    // 启动即探活：连不上就快速失败，不留到运行期
    const rows = await this.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`;
    if (rows[0]?.ok !== 1) {
      throw new Error("[Prisma] 数据库探活失败：SELECT 1 未返回预期结果");
    }
    this.logger.log(`Prisma 已连接 PostgreSQL：${this.databaseName}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
