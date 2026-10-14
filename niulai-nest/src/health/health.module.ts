import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { RedisSharedModule } from "../common/redis/redis.module";

/**
 * 健康检查模块（P0-01-03）
 *
 * PrismaService 经全局 PrismaModule 注入；RedisService 需显式引入 RedisSharedModule。
 * 优雅关闭由 PrismaService（onModuleDestroy 断开连接）与 LiaoliaRedis（连接池销毁）
 * 的既有生命周期钩子承担，本模块不再重复实现。
 */
@Module({
  imports: [RedisSharedModule],
  controllers: [HealthController],
})
export class HealthModule {}
