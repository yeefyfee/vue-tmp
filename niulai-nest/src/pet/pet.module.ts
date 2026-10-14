import { Module } from "@nestjs/common";

import { RedisSharedModule } from "../common/redis/redis.module";
import { SseModule } from "../message/sse.module";
import { PetController } from "./pet.controller";
import { PetService } from "./pet.service";
import { PetTagController } from "./pet-tag.controller";
import { BehaviorTagController } from "./behavior-tag.controller";
import { BehaviorTagService } from "./behavior-tag.service";
import { BehaviorTagLinkageService } from "./behavior-tag-linkage.service";
import { HealthRecordController } from "./health-record.controller";
import { HealthRecordService } from "./health-record.service";
import { WeightController } from "./weight.controller";
import { WeightService } from "./weight.service";
import { HealthExpiryReminderService } from "./health-reminder.service";
import { TimelineController } from "./timeline.controller";
import { TimelineService } from "./timeline.service";
import { TimelineWriteService } from "./timeline-write.service";

/**
 * 宠物域模块（P0-06-02 宠物档案 FR-1 + P0-06-03 健康档案 FR-2 + P0-06-04 体重曲线 FR-3）
 *
 * 数据访问走全局 PrismaModule 暴露的 PrismaService（`prisma.scoped.pet` /
 * `healthRecord` / `weight` / `timelineEvent` / `petBehaviorTag` / `behaviorTag` /
 * `customer` / `store` 已由租户隔离 + 数据权限扩展链包裹，对应模型均在
 * TENANT_SCOPED_MODELS 名单内）；
 * 租户上下文守卫（TenantContextGuard）由全局 TenantModule（@Global）提供；
 * 队列注册表（QUEUE_REGISTRY）由全局 QueueModule（@Global）提供——到期提醒
 * 入队经其单一注册点（HealthExpiryReminderService 注入）。
 *
 * 暴露 HealthRecordService / WeightService / HealthExpiryReminderService 供
 * 后续域（如寄养入住疫苗校验、P0-06-06 时间线）或调度脚本复用。
 *
 * RedisService 需显式引入 RedisSharedModule（非 @Global，与 auth/health 模块同惯例），
 * 供 HealthExpiryReminderService 写到期提醒幂等键。
 *
 * 引入 SseModule（MVP-WEB-03-02）：健康档案写入成功后推送工作台变更信号，
 * 使在线工作台「待处理」卡即时刷新。
 */
@Module({
  imports: [RedisSharedModule, SseModule],
  controllers: [
    PetController,
    PetTagController,
    BehaviorTagController,
    HealthRecordController,
    WeightController,
    TimelineController,
  ],
  providers: [
    PetService,
    BehaviorTagService,
    BehaviorTagLinkageService,
    HealthRecordService,
    WeightService,
    HealthExpiryReminderService,
    TimelineWriteService,
    TimelineService,
  ],
  exports: [
    PetService,
    BehaviorTagService,
    BehaviorTagLinkageService,
    HealthRecordService,
    WeightService,
    HealthExpiryReminderService,
    TimelineWriteService,
    TimelineService,
  ],
})
export class PetModule {}
