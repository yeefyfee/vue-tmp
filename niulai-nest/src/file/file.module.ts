import { Module } from "@nestjs/common";
import { FileService } from "./file.service";
import { FileController } from "./file.controller";
import { MediaModule } from "../media/media.module";

/**
 * 文件模块（底层文件服务）。
 *
 * 装配说明（P0-08）：媒体域模块（MediaModule）经本模块引入 —— FileModule 已被
 * AppModule 导入，故 MediaModule 的控制器 / 提供者随本模块进入应用图（避免改动
 * 中央 app.module.ts）。文件域与媒体域同属「文件 / 附件」能力面，聚合挂载语义自洽。
 */
@Module({
  imports: [MediaModule],
  controllers: [FileController],
  providers: [FileService],
  exports: [FileService],
})
export class FileModule {}
