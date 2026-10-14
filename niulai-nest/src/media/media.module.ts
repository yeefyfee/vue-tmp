import { Module } from "@nestjs/common";

import { MediaController } from "./media.controller";
import { MediaService } from "./media.service";
import { ImageProcessingService } from "./media-image.service";

/**
 * 媒体 / 附件模块（P0-08）
 *
 * 数据访问走全局 PrismaModule 暴露的 PrismaService（`prisma.scoped.media` 已由租户隔离
 * 扩展链包裹，Media 已在 TENANT_SCOPED_MODELS 名单内）；租户上下文守卫（TenantContextGuard）
 * 由全局 TenantModule（@Global）提供。
 *
 * 存储驱动（local / memory / s3 / oss）与凭证由 env 决定（见 media.storage.ts），
 * 不引入 ConfigModule 依赖（自解析 env，保持模块自包含）。
 *
 * 装配：本模块经 FileModule 引入（FileModule 已被 AppModule 导入）——避免改动中央
 * app.module.ts；媒体域与文件域同属「文件 / 附件」能力面，聚合挂载语义自洽。
 */
@Module({
  controllers: [MediaController],
  providers: [MediaService, ImageProcessingService],
  exports: [MediaService],
})
export class MediaModule {}
