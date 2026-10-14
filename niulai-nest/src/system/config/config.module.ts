import { Module } from "@nestjs/common";
import { ConfigController } from "./config.controller";
import { ConfigService } from "./config.service";
import { RedisSharedModule } from "../../common/redis/redis.module";

/**
 * 系统配置模块
 * 数据访问走全局 PrismaModule 暴露的 PrismaService（PEL-10c，已由 TypeORM 迁移至 Prisma）。
 */
@Module({
  imports: [RedisSharedModule],
  controllers: [ConfigController],
  providers: [ConfigService],
  exports: [ConfigService],
})
export class ConfigModule {}
