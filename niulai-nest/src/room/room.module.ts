import { Module } from "@nestjs/common";

import { SseModule } from "../message/sse.module";
import { RoomController } from "./room.controller";
import { RoomService } from "./room.service";

/**
 * 房间资源模块（P0-04-03 · FR-2）
 *
 * 数据访问走全局 PrismaModule 暴露的 PrismaService（`prisma.scoped.room`
 * 已由租户隔离 + 数据权限扩展链包裹，Room 在 TENANT_SCOPED_MODELS 名单内）；
 * 租户上下文守卫（TenantContextGuard）由全局 TenantModule（@Global）提供。
 *
 * 引入 SseModule（MVP-WEB-03-02）：房态读写成功后推送工作台变更信号
 * （`SseService.sendDashboardChange`），使在线工作台即时刷新。
 */
@Module({
  imports: [SseModule],
  controllers: [RoomController],
  providers: [RoomService],
  exports: [RoomService],
})
export class RoomModule {}
