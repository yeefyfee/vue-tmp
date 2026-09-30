import { Body, Controller, Delete, Get, Param, Post, Put, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import { SunoService } from "./suno.service";
import { CurrentUser } from "@/common/decorators/current-user.decorator";
import { Permissions } from "@/common/decorators/auth.decorator";
import { MusicGenerateDto, MusicUploadDto, SoundGenerateDto } from "./dto/music-generate.dto";
import { PostProcessDto, SunoAssetQueryDto, SunoTaskQueryDto } from "./dto/suno-query.dto";

/**
 * Suno 音乐模块接口
 *
 * 所有接口以当前登录用户为数据边界；access_key 仅后端持有，
 * 前端通过本组接口代理调用平台能力。
 */
@ApiTags("30.Suno音乐")
@Controller("suno")
export class SunoController {
  constructor(private readonly sunoService: SunoService) {}

  // ---------------------------- 接入配置 ----------------------------

  @ApiOperation({ summary: "获取 Suno 接入配置" })
  @Get("config")
  @Permissions("suno:config:update")
  async getConfig() {
    return await this.sunoService.getConfig();
  }

  @ApiOperation({ summary: "更新 Suno 接入配置" })
  @Put("config")
  @Permissions("suno:config:update")
  async updateConfig(
    @CurrentUser("userId") userId: string,
    @Body() dto: { accessKey?: string; baseUrl?: string; remark?: string }
  ) {
    await this.sunoService.updateConfig(dto, userId);
    return { success: true };
  }

  // ---------------------------- 生成 ----------------------------

  @ApiOperation({ summary: "生成音乐（灵感/自定义/延长/翻唱）" })
  @Post("music/generate")
  @Permissions("suno:music:generate")
  async generateMusic(@CurrentUser("userId") userId: string, @Body() dto: MusicGenerateDto) {
    return await this.sunoService.submitGenerate(dto, userId);
  }

  @ApiOperation({ summary: "生成音效" })
  @Post("music/sound")
  @Permissions("suno:sound:generate")
  async generateSound(@CurrentUser("userId") userId: string, @Body() dto: SoundGenerateDto) {
    return await this.sunoService.submitSound(dto, userId);
  }

  @ApiOperation({ summary: "上传参考音频" })
  @Post("music/upload")
  @Permissions("suno:music:upload")
  async uploadMusic(@CurrentUser("userId") userId: string, @Body() dto: MusicUploadDto) {
    return await this.sunoService.submitUpload(dto, userId);
  }

  // ---------------------------- 查询 ----------------------------

  @ApiOperation({ summary: "查询单个任务" })
  @Get("task")
  @Permissions("suno:task:query")
  async queryTask(@CurrentUser("userId") userId: string, @Query("id") id: string) {
    return await this.sunoService.queryTask(id, userId);
  }

  @ApiOperation({ summary: "批量查询任务" })
  @Get("tasks")
  @Permissions("suno:task:query")
  async queryTasks(@CurrentUser("userId") userId: string, @Query("ids") ids: string) {
    return await this.sunoService.queryTasks(ids, userId);
  }

  @ApiOperation({ summary: "任务分页列表" })
  @Get("task/page")
  @Permissions("suno:task:list")
  async getTaskPage(@CurrentUser("userId") userId: string, @Query() query: SunoTaskQueryDto) {
    return await this.sunoService.getTaskPage(userId, query);
  }

  @ApiOperation({ summary: "删除任务" })
  @Delete("task/:ids")
  @Permissions("suno:task:delete")
  async deleteTasks(@CurrentUser("userId") userId: string, @Param("ids") ids: string) {
    await this.sunoService.deleteTasks(ids, userId);
    return { success: true };
  }

  // ---------------------------- 作品库 ----------------------------

  @ApiOperation({ summary: "作品分页列表" })
  @Get("asset/page")
  @Permissions("suno:asset:list")
  async getAssetPage(@CurrentUser("userId") userId: string, @Query() query: SunoAssetQueryDto) {
    return await this.sunoService.getAssetPage(userId, query);
  }

  @ApiOperation({ summary: "作品详情" })
  @Get("asset/:id")
  @Permissions("suno:asset:list")
  async getAssetDetail(@CurrentUser("userId") userId: string, @Param("id") id: string) {
    return await this.sunoService.getAssetDetail(id, userId);
  }

  @ApiOperation({ summary: "收藏/取消收藏作品" })
  @Put("asset/:id/like")
  @Permissions("suno:asset:like")
  async toggleLike(@CurrentUser("userId") userId: string, @Param("id") id: string) {
    const isLiked = await this.sunoService.toggleLike(id, userId);
    return { isLiked };
  }

  @ApiOperation({ summary: "删除作品" })
  @Delete("asset/:ids")
  @Permissions("suno:asset:delete")
  async deleteAssets(@CurrentUser("userId") userId: string, @Param("ids") ids: string) {
    await this.sunoService.deleteAssets(ids, userId);
    return { success: true };
  }

  // ---------------------------- 后期处理 ----------------------------

  @ApiOperation({ summary: "后期处理（合成/对齐/升采样/MV/下载/裁剪/变速）" })
  @Post("post/:action")
  @Permissions("suno:asset:post")
  async postProcess(
    @CurrentUser("userId") userId: string,
    @Param("action") action: string,
    @Body() dto: PostProcessDto
  ) {
    return await this.sunoService.postProcess(action, dto, userId);
  }

  // ---------------------------- 积分与概览 ----------------------------

  @ApiOperation({ summary: "查询平台积分余额" })
  @Get("points/balance")
  @Permissions("suno:asset:list")
  async getBalance(@CurrentUser("userId") userId: string) {
    return await this.sunoService.getBalance(userId);
  }

  @ApiOperation({ summary: "查询平台积分流水" })
  @Get("points/logs")
  @Permissions("suno:asset:list")
  async getPointsLogs(@Query("page") page: string, @Query("limit") limit: string) {
    return await this.sunoService.getPointsLogs({
      page: Number(page) || 1,
      limit: Number(limit) || 20,
    });
  }

  @ApiOperation({ summary: "本地积分流水" })
  @Get("points/local")
  @Permissions("suno:asset:list")
  async getLocalPointsLogs(
    @CurrentUser("userId") userId: string,
    @Query() query: SunoTaskQueryDto
  ) {
    return await this.sunoService.getLocalPointsLogs(userId, query);
  }

  @ApiOperation({ summary: "概览统计" })
  @Get("overview")
  async getOverview(@CurrentUser("userId") userId: string) {
    return await this.sunoService.getOverview(userId);
  }
}
