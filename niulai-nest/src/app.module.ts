import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";

import * as winston from "winston";
import "winston-daily-rotate-file";
import { WinstonModule } from "nest-winston";
import { RedisModule as LiaoliaRedisModule } from "@liaoliaots/nestjs-redis";

import { AuthModule } from "./auth/auth.module"; // 认证相关模块（隐式包含 User, Role, Menu, Dept）
import { RoleModule } from "./system/role/role.module"; // 角色模块（提供 RolePermService）
import { PrismaModule } from "./common/prisma/prisma.module"; // PeluVida 数据访问（PostgreSQL 16 + Prisma）
import { TenantModule } from "./tenant/tenant.module"; // 租户隔离基线（PEL-11，决策 A2）
import { HealthModule } from "./health/health.module"; // 健康检查（P0-01-03）
import { RedisSharedModule } from "./common/redis/redis.module";
import { DictModule } from "./system/dict/dict.module"; // 系统字典模块
import { ConfigModule as SystemConfigModule } from "./system/config/config.module"; // 系统配置模块
import { SseModule } from "./message/sse.module";
import { CodegenModule } from "./codegen/codegen.module";
import { FileModule } from "./file/file.module";
import { LogModule } from "./system/log/log.module";
import { AuditModule } from "./common/audit/audit.module"; // 审计日志模块（P0-02-08）：@Audit 自动轨 + AuditLogService 显式轨
import { DashboardModule } from "./dashboard/dashboard.module"; // 经营工作台（MVP-WEB-03-01）：首页总览聚合读数
import { StoreModule } from "./store/store.module"; // 门店档案模块（P0-04-02，业务域首个模块）
import { RoomModule } from "./room/room.module"; // 房间资源模块（P0-04-03，FR-2）
import { CustomerModule } from "./customer/customer.module"; // 客户域模块（P0-05-02 萌主档案 FR-1）
import { PetModule } from "./pet/pet.module"; // 宠物域模块（P0-06-02 宠物档案 FR-1）
import { BookingModule } from "./booking/booking.module"; // 预约模块（P0-08-05；MVP-WEB-06-01 预约列表与状态展示）
import { OrderModule } from "./order/order.module"; // 订单模块（MVP-WEB-07-01 订单列表）
import { QueueModule } from "./queue/queue.module"; // 队列基础设施（CROSS-11）：API 进程作为 producer，消费在 src/worker.ts
// PeluVida 基座（PEL-02/03）：已剥离业务模块 NoticeModule / StorageModule / SunoModule / GameModule
// 归档位置：D:/Warehouse/_peluvida_archive/20261004/（可直接移回恢复）

import { LoggerMiddleware } from "./common/middleware/logger.middleware";
import { RequestContextMiddleware } from "./common/middleware/request-context.middleware";
import { RateLimitMiddleware } from "./common/middleware/rate-limit.middleware";
import { traceContextFormat } from "./common/logger/trace-context.format";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { XRequestInterceptor } from "./common/interceptors/request.interceptor";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { RedisTokenAuthGuard } from "./auth/guards/redis-token.guard";

import jwtConfig from "./config/jwt.config";
import databaseConfig from "./config/database.config";
import ossConfig from "./config/oss.config";
import redisConfig from "./config/redis.config";
import { validateEnv } from "./config/env.validation";
import { DataScopeGuard } from "./common/guards/data-scope.guard";
import { PermissionGuard } from "./common/guards/permission.guard";
import { DataPermissionInterceptor } from "./common/interceptors/data-permission.interceptor";
import { AuditInterceptor } from "./common/audit/audit.interceptor";
import { IdempotencyInterceptor } from "./common/idempotency/idempotency.interceptor"; // 幂等拦截器（P0-07-01）：@Idempotent 元数据 opt-in，无标注直通

const envPath = `.env.${process.env.NODE_ENV || "dev"}`;

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env", envPath],
      load: [databaseConfig, redisConfig, ossConfig, jwtConfig],
      // CROSS-06：启动期环境变量校验（缺失/非法变量启动即报错，fail-fast）
      validate: validateEnv,
    }),
    // PeluVida 数据访问基线（PEL-10）：PostgreSQL 16 + Prisma
    // 注：TypeORM 已于 PEL-10 第③段完全摘除（含 typeorm.config.ts / 实体 / 插件 / 订阅器）
    PrismaModule,
    LiaoliaRedisModule.forRootAsync({
      useFactory: async (config: ConfigService) => {
        return {
          config: [
            {
              host: config.getOrThrow<string>("redis.host"),
              port: config.getOrThrow<number>("redis.port"),
              db: config.get<number>("redis.db") || 0,
              password: config.get<string>("redis.password"),
            },
          ],
        };
      },
      inject: [ConfigService],
    }),

    WinstonModule.forRoot({
      level: "debug",
      transports: [
        new winston.transports.DailyRotateFile({
          dirname: `logs`, // 日志保存的目录
          filename: "%DATE%.log", // 日志名称，占位符 %DATE% 取值为 datePattern 值。
          datePattern: "YYYY-MM-DD", // 日志轮换的频率，此处表示每天。
          zippedArchive: true, // 是否通过压缩的方式归档被轮换的日志文件。
          maxSize: "20m", // 设置日志文件的最大大小，m 表示 mb 。
          maxFiles: "7d", // 保留日志文件的最大天数，此处表示自动删除超过 7 天的日志文件。
          // 记录时添加时间戳信息
          format: winston.format.combine(
            winston.format.timestamp({
              format: "YYYY-MM-DD HH:mm:ss",
            }),
            // CROSS-14 结构化日志：自动注入 traceId / userId / tenantId（从 AsyncLocalStorage 读）
            traceContextFormat(),
            winston.format.json()
          ),
        }),
      ],
    }),
    AuthModule,
    RoleModule,
    TenantModule, // 租户隔离基线（PEL-11）：上下文 + @RequireTenant 守卫 + 扩展内核
    HealthModule, // 健康检查（P0-01-03）：/api/v1/health 探活 DB / Redis
    RedisSharedModule,
    DictModule,
    SystemConfigModule,
    SseModule,
    FileModule,
    CodegenModule,
    LogModule,
    AuditModule, // 审计日志（P0-02-08）：自动轨 @Audit 打点 + AuditLogService 显式轨
    DashboardModule, // 经营工作台（MVP-WEB-03-01）：登录后落地首页，只读聚合
    StoreModule, // 门店档案（P0-04-02）：业务域首个模块，范式基准
    RoomModule, // 房间资源（P0-04-03）：room CRUD + 房态查询
    CustomerModule, // 客户域（P0-05-02）：萌主档案 customer CRUD
    PetModule, // 宠物域（P0-06-02）：宠物档案 pet CRUD + 完整度评分
    BookingModule, // 预约域（P0-08-05）：预约列表 / 详情（MVP-WEB-06-01）
    OrderModule, // 订单域（MVP-WEB-07-01）：订单列表
    QueueModule.forRootAsync(), // 队列基础设施（CROSS-11）：producer 侧注入 QueueRegistry；消费端在独立入口 src/worker.ts
  ],
  controllers: [],
  providers: [
    JwtAuthGuard,
    RedisTokenAuthGuard,
    // 会话认证守卫：根据 SESSION_TYPE 选择 JWT 模式或 Redis 会话模式
    {
      provide: APP_GUARD,
      useFactory: (
        configService: ConfigService,
        jwtGuard: JwtAuthGuard,
        redisGuard: RedisTokenAuthGuard
      ) => {
        const sessionType = configService.get<string>("SESSION_TYPE") || "jwt";
        return sessionType === "redis-token" ? redisGuard : jwtGuard;
      },
      inject: [ConfigService, JwtAuthGuard, RedisTokenAuthGuard],
    },
    // 数据权限全局守卫
    {
      provide: APP_GUARD,
      useClass: DataScopeGuard,
    },
    // RBAC 权限全局守卫
    {
      provide: APP_GUARD,
      useClass: PermissionGuard,
    },
    // 应用http全局过滤器
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    // 应用拦截器
    {
      provide: APP_INTERCEPTOR,
      useClass: XRequestInterceptor,
    },
    // 数据权限拦截器 - 必须在 DataScopeGuard 之后执行
    {
      provide: APP_INTERCEPTOR,
      useClass: DataPermissionInterceptor,
    },
    // 审计拦截器 - @Audit 打点自动轨（P0-02-08）
    // 无 @Audit 元数据的路由直通；审计写入失败仅告警不阻断响应
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
    // 幂等拦截器 - @Idempotent 自动轨（P0-07-01）
    // 无 @Idempotent 元数据的路由直通（默认不全局启用，存量 E2E 行为不变）；
    // 置于响应封装拦截器（ResponseInterceptor，main.ts useGlobalInterceptors 追加）
    // 上游，故 next.handle() 发出的是最终信封，可原样缓存/回放。
    {
      provide: APP_INTERCEPTOR,
      useClass: IdempotencyInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // 请求上下文中间件必须在最前面，确保 AsyncLocalStorage 正确初始化
    consumer.apply(RequestContextMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL });
    consumer.apply(RateLimitMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL });
    consumer.apply(LoggerMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL });
  }
}
