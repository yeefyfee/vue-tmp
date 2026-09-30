import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { SunoController } from "./suno.controller";
import { SunoService } from "./suno.service";
import { SunoConfig } from "./entities/suno-config.entity";
import { SunoTask } from "./entities/suno-task.entity";
import { SunoAsset } from "./entities/suno-asset.entity";
import { SunoPointsLog } from "./entities/suno-points-log.entity";

/**
 * Suno 音乐模块
 *
 * 独立业务域：密钥托管在后端，前端经代理调用平台能力。
 */
@Module({
  imports: [TypeOrmModule.forFeature([SunoConfig, SunoTask, SunoAsset, SunoPointsLog])],
  controllers: [SunoController],
  providers: [SunoService],
  exports: [SunoService],
})
export class SunoModule {}
