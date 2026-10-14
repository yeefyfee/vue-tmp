import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { LogService } from "./log.service";
import { LogController } from "./log.controller";
import { LoggingInterceptor } from "./logging.interceptor";

@Module({
  // PrismaService 由全局 PrismaModule 提供，无需再导入 TypeOrmModule.forFeature
  controllers: [LogController],
  providers: [
    LogService,
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
  exports: [LogService],
})
export class LogModule {}
