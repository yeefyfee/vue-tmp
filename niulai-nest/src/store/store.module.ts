import { Module } from "@nestjs/common";

import { StoreHqController } from "./store-hq.controller";
import { StoreHqService } from "./store-hq.service";
import { StoreController } from "./store.controller";
import { StoreService } from "./store.service";
import { BusinessHoursController } from "./business-hours.controller";
import { BusinessHoursService } from "./business-hours.service";
import { StoreCalendarService } from "./store-calendar.service";
import { StoreCalendarViewService } from "./store-calendar-view.service";
import { StoreConfigController } from "./store-config.controller";
import { StoreConfigService } from "./store-config.service";

/**
 * 门店域模块（P0-04-02 门店档案 / P0-04-04 营业时间与日历 / P0-04-05 门店配置 /
 * P0-04-06 总部-门店两级骨架 / P0-04-07 日历视图）
 *
 * 数据访问走全局 PrismaModule 暴露的 PrismaService（`prisma.scoped.store` /
 * `prisma.scoped.storeCalendar` 已由租户隔离 + 数据权限扩展链包裹，Store /
 * StoreCalendar 在 TENANT_SCOPED_MODELS 名单内）；租户上下文守卫
 * （TenantContextGuard）由全局 TenantModule（@Global）提供。
 *
 * 🔴 控制器注册顺序（路由匹配优先级）：StoreHqController 的静态段路由
 * （GET /stores/tenant-overview、POST /stores/batch-dispatch-config）必须
 * **先于** StoreController 的 `GET /stores/:id` 注册，否则静态段会被
 * `:id` 路径参数吞掉（"tenant-overview" 过不了 ParseUUIDPipe → 误报 400）。
 * Express 按注册顺序匹配，Nest 按 controllers 数组顺序注册，故此顺序不可调整。
 */
@Module({
  controllers: [
    StoreHqController, // 静态段路由必须最先注册（见类注释）
    StoreController,
    BusinessHoursController,
    StoreConfigController,
  ],
  providers: [
    StoreHqService,
    StoreService,
    BusinessHoursService,
    StoreCalendarService,
    StoreCalendarViewService,
    StoreConfigService,
  ],
  exports: [
    StoreHqService,
    StoreService,
    StoreConfigService,
    BusinessHoursService,
    StoreCalendarService,
    StoreCalendarViewService,
  ],
})
export class StoreModule {}
