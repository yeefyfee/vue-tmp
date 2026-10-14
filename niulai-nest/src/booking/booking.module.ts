import { Module } from "@nestjs/common";

import { AuditModule } from "../common/audit/audit.module";
import { SseModule } from "../message/sse.module";
import { PetModule } from "../pet/pet.module";
import { BookingController } from "./booking.controller";
import { BookingService } from "./booking.service";

/**
 * 预约模块（P0-08-05；MVP-WEB-06-01 预约列表与状态展示）
 *
 * 数据访问走全局 PrismaModule 暴露的 PrismaService（`prisma.scoped.booking`
 * 已由租户隔离 + 数据权限扩展链包裹，Booking 在 TENANT_SCOPED_MODELS 名单内）；
 * 租户上下文守卫（TenantContextGuard）由全局 TenantModule（@Global）提供。
 *
 * 依赖引入（MVP-WEB-06-05 状态流转）：写操作要留下两类痕迹，各自有既定模块承载 ——
 *  · `AuditModule` → `AuditLogService`（显式轨：审计与状态写入**同事务**，
 *    失败即业务失败 —— PRD「每次流转写操作人与时间戳」的权威留痕）；
 *  · `PetModule` → `TimelineWriteService`（PRD 验收要点「预约关键动作全部写入宠物
 *    时间线」；时间线写入 SDK 的归属在宠物域，此处**复用而非复制**，
 *    避免出现第二套事件类型 / 可见性回落逻辑）。
 *
 * 依赖引入（MVP-WEB-06-06 通知派发）：
 *  · `SseModule` → `SseService`（状态流转后推送 SSE 信号：dashboard 刷新 + 通知事件）
 *
 * 只读端点（列表 / 详情 / 日历 / 冲突检测 / 容量预校验）不依赖上述三者。
 */
@Module({
  imports: [AuditModule, PetModule, SseModule],
  controllers: [BookingController],
  providers: [BookingService],
  exports: [BookingService],
})
export class BookingModule {}
