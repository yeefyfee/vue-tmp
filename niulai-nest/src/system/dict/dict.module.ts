import { Module } from "@nestjs/common";
import { DictService } from "./dict.service";
import { DictController } from "./dict.controller";
import { RedisSharedModule } from "../../common/redis/redis.module";
import { SseModule } from "../../message/sse.module";

/**
 * 字典模块
 *
 * 已切到 Prisma：移除 `TypeOrmModule.forFeature([SysDict, SysDictItem])`。
 * `PrismaModule` 是 `@Global`，无需在模块内 import。
 */
@Module({
  imports: [RedisSharedModule, SseModule],
  controllers: [DictController],
  providers: [DictService],
  exports: [DictService],
})
export class DictModule {}
