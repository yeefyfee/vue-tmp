import { Controller, Get, Query, UsePipes, ValidationPipe } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { LogService } from "./log.service";
import { LogQueryDto } from "./dto/log-query.dto";

/**
 * 日志接口控制器
 *
 * 🔒 全部接口鉴权（P0-02-08 评估期安全修复）：analytics 两个统计接口原挂 @Public
 * （旧模板遗留，匿名可读管理端访问统计 = 泄露系统负载与租户活动），
 * 前端调用点均在登录后的 Dashboard（axios 实例自动带 Bearer Token），移除无影响。
 */
@ApiTags("09.日志接口")
@Controller("logs")
export class LogController {
  constructor(private readonly logService: LogService) {}

  @ApiOperation({ summary: "日志分页列表" })
  @Get()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: false }))
  async getLogPage(@Query() query: LogQueryDto) {
    return await this.logService.getLogPage(query);
  }

  @ApiOperation({ summary: "访问趋势统计" })
  @Get("analytics/trend")
  async getVisitTrend(@Query("startDate") startDate: string, @Query("endDate") endDate: string) {
    return await this.logService.getVisitTrend(startDate, endDate);
  }

  @ApiOperation({ summary: "访问统计概览" })
  @Get("analytics/overview")
  async getVisitOverview() {
    return await this.logService.getVisitStats();
  }
}
