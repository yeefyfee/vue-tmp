import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";

import { SunoClient } from "./suno.client";
import { SunoConfig } from "./entities/suno-config.entity";
import { SunoTask } from "./entities/suno-task.entity";
import { SunoAsset } from "./entities/suno-asset.entity";
import { SunoPointsLog } from "./entities/suno-points-log.entity";

import { MusicGenerateDto, MusicUploadDto, SoundGenerateDto } from "./dto/music-generate.dto";
import { PostProcessDto, SunoAssetQueryDto, SunoTaskQueryDto } from "./dto/suno-query.dto";

import { BusinessException } from "@/common/exceptions/business.exception";
import {
  SUNO_POST_PROCESS_ROUTES,
  SUNO_TASK_STATUS,
  SUNO_TASK_TYPE,
  type SunoBalance,
  type SunoSubmitResult,
  type SunoTaskDetail,
} from "./suno.types";

/** 默认接入地址 */
const DEFAULT_BASE_URL = "https://open.suno.cn";
/** 密钥配置键 */
const ACCESS_KEY_CONFIG = "SUNO_ACCESS_KEY";

/**
 * Suno 音乐服务
 *
 * 数据隔离：任务与作品均以 ownerId 为边界，用户只能看到自己的数据。
 * 密钥托管：access_key 存于 suno_config，仅后端读取并代理转发。
 */
@Injectable()
export class SunoService {
  private readonly logger = new Logger(SunoService.name);

  constructor(
    @InjectRepository(SunoConfig)
    private readonly configRepo: Repository<SunoConfig>,
    @InjectRepository(SunoTask)
    private readonly taskRepo: Repository<SunoTask>,
    @InjectRepository(SunoAsset)
    private readonly assetRepo: Repository<SunoAsset>,
    @InjectRepository(SunoPointsLog)
    private readonly pointsRepo: Repository<SunoPointsLog>
  ) {}

  // ==========================================================================
  // 接入配置
  // ==========================================================================

  /**
   * 读取接入配置（密钥不落日志、不回传前端明文）
   */
  async getConfig() {
    const config = await this.configRepo.findOne({
      where: { configKey: ACCESS_KEY_CONFIG, isDeleted: 0 },
    });
    const key = config?.configValue || "";
    return {
      baseUrl: config?.baseUrl || DEFAULT_BASE_URL,
      configured: !!key && key !== "your-access-key-here",
      accessKeyMasked: key ? this.maskKey(key) : "",
      remark: config?.remark || "",
      status: config?.status ?? 1,
    };
  }

  /** 更新接入配置 */
  async updateConfig(data: { accessKey?: string; baseUrl?: string; remark?: string }, userId: string) {
    let config = await this.configRepo.findOne({
      where: { configKey: ACCESS_KEY_CONFIG, isDeleted: 0 },
    });

    if (!config) {
      config = this.configRepo.create({
        configKey: ACCESS_KEY_CONFIG,
        configName: "Suno 接入密钥",
        createBy: userId,
        createTime: new Date(),
        isDeleted: 0,
      });
    }

    // 仅在传入非空密钥时覆盖，避免前端回显掩码把密钥冲掉
    if (data.accessKey) config.configValue = data.accessKey.trim();
    if (data.baseUrl !== undefined) config.baseUrl = data.baseUrl?.trim() || DEFAULT_BASE_URL;
    if (data.remark !== undefined) config.remark = data.remark;
    config.updateBy = userId;
    config.updateTime = new Date();

    await this.configRepo.save(config);
    return true;
  }

  /** 密钥脱敏展示：保留首尾各 4 位 */
  private maskKey(key: string): string {
    if (key.length <= 8) return "********";
    return `${key.slice(0, 4)}********${key.slice(-4)}`;
  }

  /** 构建平台客户端（每次调用前取最新密钥） */
  private async createClient(): Promise<SunoClient> {
    const config = await this.configRepo.findOne({
      where: { configKey: ACCESS_KEY_CONFIG, isDeleted: 0 },
    });
    const accessKey = config?.configValue?.trim();
    if (!accessKey || accessKey === "your-access-key-here") {
      throw new BusinessException("尚未配置 Suno 接入密钥，请先前往「接入配置」完成设置");
    }
    return new SunoClient(config.baseUrl?.trim() || DEFAULT_BASE_URL, accessKey);
  }

  // ==========================================================================
  // 生成：音乐 / 音效 / 延长 / 翻唱
  // ==========================================================================

  /**
   * 提交生成任务
   *
   * 统一入口，按 dto.task 区分 generate / extend / cover / sound。
   */
  async submitGenerate(dto: MusicGenerateDto, userId: string) {
    const client = await this.createClient();
    const taskType = dto.task || SUNO_TASK_TYPE.GENERATE;

    const payload = this.buildMusicPayload(dto, taskType);
    const result = await client.post<SunoSubmitResult>("/api/v1/music/generate", payload);

    return await this.persistSubmitted(result, {
      taskType,
      bizCategory: "music",
      title: dto.title,
      prompt: dto.prompt,
      tags: dto.tags,
      mv: dto.mv,
      gptDescriptionPrompt: dto.gptDescriptionPrompt,
      makeInstrumental: dto.makeInstrumental ? 1 : 0,
      isMaxMode: dto.isMaxMode ? 1 : 0,
      augCreativity: dto.augCreativity,
      parentCustomId: dto.continueClipId || dto.coverClipId,
      requestParams: payload,
      ownerId: userId,
    });
  }

  /** 组装音乐生成请求体（camelCase 转平台 snake_case） */
  private buildMusicPayload(dto: MusicGenerateDto, taskType: string): Record<string, unknown> {
    const payload: Record<string, unknown> = {};

    if (taskType === SUNO_TASK_TYPE.EXTEND) {
      payload.task = "extend";
      if (!dto.continueClipId) throw new BusinessException("延长模式需要提供来源音乐ID");
      payload.continue_clip_id = dto.continueClipId;
    } else if (taskType === SUNO_TASK_TYPE.COVER) {
      payload.task = "cover";
      if (!dto.coverClipId) throw new BusinessException("翻唱模式需要提供来源音乐ID");
      payload.cover_clip_id = dto.coverClipId;
      if (dto.tags) payload.tags = dto.tags;
    } else {
      if (!dto.prompt && !dto.gptDescriptionPrompt) {
        throw new BusinessException("请填写歌词或灵感描述");
      }
      if (dto.gptDescriptionPrompt) payload.gpt_description_prompt = dto.gptDescriptionPrompt;
      if (dto.prompt) payload.prompt = dto.prompt;
      if (dto.tags) payload.tags = dto.tags;
      payload.make_instrumental = !!dto.makeInstrumental;
    }

    if (dto.mv) payload.mv = dto.mv;
    if (dto.title) payload.title = dto.title;

    // MAX 模式与创意度通过 metadata 下发，其值为布尔/数字，直接透传
    const metadata: Record<string, unknown> = {};
    if (dto.isMaxMode) metadata.is_max_mode = true;
    if (dto.augCreativity !== undefined && dto.augCreativity !== null) {
      metadata.control_sliders = { aug_creativity: dto.augCreativity };
    }
    if (Object.keys(metadata).length) payload.metadata = metadata;

    return payload;
  }

  /** 提交音效生成任务 */
  async submitSound(dto: SoundGenerateDto, userId: string) {
    const client = await this.createClient();

    const payload: Record<string, unknown> = {};
    if (dto.title) payload.title = dto.title;
    if (dto.tags) payload.tags = dto.tags;
    payload.mv = dto.mv || "chirp-crow";
    if (dto.tempo !== undefined && dto.tempo !== null) payload.tempo = dto.tempo;
    if (dto.key) payload.key = dto.key;
    if (dto.loop !== undefined) payload.loop = dto.loop;

    const result = await client.post<SunoSubmitResult>("/api/v1/music/sound", payload);

    return await this.persistSubmitted(result, {
      taskType: SUNO_TASK_TYPE.SOUND,
      bizCategory: "sound",
      title: dto.title,
      tags: dto.tags,
      mv: String(payload.mv),
      makeInstrumental: 1,
      requestParams: payload,
      ownerId: userId,
    });
  }

  /** 提交上传参考音频任务 */
  async submitUpload(dto: MusicUploadDto, userId: string) {
    const client = await this.createClient();
    const payload = { audio_url: dto.audioUrl };
    const result = await client.post<SunoSubmitResult>("/api/v1/music/upload", payload);

    return await this.persistSubmitted(result, {
      taskType: SUNO_TASK_TYPE.UPLOAD,
      bizCategory: "music",
      title: dto.title || "参考音频",
      requestParams: payload,
      ownerId: userId,
    });
  }

  /**
   * 落库平台提交结果
   *
   * 平台通常返回 2 个 task_id（2 个版本），逐条写入任务表并共享批次号。
   */
  private async persistSubmitted(
    result: SunoSubmitResult,
    meta: {
      taskType: string;
      bizCategory: string;
      title?: string;
      prompt?: string;
      tags?: string;
      mv?: string;
      gptDescriptionPrompt?: string;
      makeInstrumental?: number;
      isMaxMode?: number;
      augCreativity?: number;
      parentCustomId?: string;
      requestParams?: Record<string, unknown>;
      ownerId: string;
    }
  ) {
    const taskIds = this.extractTaskIds(result);
    if (!taskIds.length) {
      this.logger.warn(`Suno 提交成功但未返回 task_id: ${JSON.stringify(result)}`);
      throw new BusinessException("Suno 未返回任务ID，请稍后在任务中心确认");
    }

    const batchNo = this.generateBatchNo();
    const now = new Date();

    const tasks = taskIds.map((taskId) => {
      const task = new SunoTask();
      task.batchNo = batchNo;
      task.taskId = taskId;
      task.taskType = meta.taskType;
      task.bizCategory = meta.bizCategory;
      task.title = meta.title || null;
      task.prompt = meta.prompt || null;
      task.tags = meta.tags || null;
      task.mv = meta.mv || null;
      task.gptDescriptionPrompt = meta.gptDescriptionPrompt || null;
      task.makeInstrumental = meta.makeInstrumental ?? 0;
      task.isMaxMode = meta.isMaxMode ?? 0;
      task.augCreativity = meta.augCreativity ?? null;
      task.parentCustomId = meta.parentCustomId || null;
      task.requestParams = meta.requestParams || null;
      task.status = SUNO_TASK_STATUS.PENDING;
      task.pointsRefunded = 0;
      task.ownerId = meta.ownerId;
      task.createBy = meta.ownerId;
      task.createTime = now;
      task.updateTime = now;
      task.isDeleted = 0;
      return task;
    });

    await this.taskRepo.save(tasks);

    return {
      batchNo,
      taskIds,
      taskType: meta.taskType,
    };
  }

  /** 从平台返回中提取任务ID列表 */
  private extractTaskIds(result: SunoSubmitResult): string[] {
    const raw = result?.task_ids ?? (result?.task_id !== undefined ? [result.task_id] : []);
    if (!Array.isArray(raw)) return [];
    return raw.filter((id) => id !== undefined && id !== null).map((id) => String(id));
  }

  /** 生成批次号：时间戳 + 4 位随机数 */
  private generateBatchNo(): string {
    const ts = Date.now().toString();
    const rand = Math.floor(1000 + Math.random() * 9000).toString();
    return `${ts}${rand}`;
  }

  // ==========================================================================
  // 查询与轮询
  // ==========================================================================

  /**
   * 轮询单个任务并落库结果
   *
   * 前端拿平台 task_id 调用，后端代查后同步状态与作品资产。
   */
  async queryTask(taskId: string, userId: string) {
    const client = await this.createClient();
    const detail = await client.get<SunoTaskDetail>("/api/v1/music/task", { id: taskId });
    await this.syncTaskDetail(taskId, detail, userId);
    return detail;
  }

  /** 批量查询（前端等待 2 个版本时使用） */
  async queryTasks(ids: string, userId: string) {
    const client = await this.createClient();
    const list = await client.get<SunoTaskDetail[]>("/api/v1/music/tasks", { ids });
    const results = Array.isArray(list) ? list : [];
    for (const item of results) {
      const tid = String(item?.task_id ?? "");
      if (tid) await this.syncTaskDetail(tid, item, userId);
    }
    return results;
  }

  /**
   * 同步平台任务状态到本地，并在完成时落作品资产
   */
  private async syncTaskDetail(taskId: string, detail: SunoTaskDetail, userId: string) {
    const task = await this.taskRepo.findOne({
      where: { taskId: taskId.toString(), ownerId: userId, isDeleted: 0 },
    });
    if (!task) return;

    const status = detail?.status || SUNO_TASK_STATUS.PENDING;
    const result = detail?.result || {};

    task.status = status;
    task.errormsg = result?.errormsg || null;
    task.pointsRefunded = detail?.points_refunded ? 1 : 0;
    if (result?.custom_id) task.customId = result.custom_id;
    task.updateTime = new Date();
    await this.taskRepo.save(task);

    if (status === SUNO_TASK_STATUS.COMPLETED && result?.custom_id) {
      await this.upsertAsset(task, result);
    }
  }

  /**
   * 写入/更新作品资产
   *
   * 以 (ownerId, customId) 为唯一键，重复轮询不会产生脏数据。
   */
  private async upsertAsset(task: SunoTask, result: SunoTaskDetail["result"]) {
    if (!result?.custom_id) return;

    const audioUrl = result.fileInfo?.mp3Url || null;
    const imageUrl = result.fileInfo?.cosUrl || null;
    const duration = Number(result.fileInfo?.duration) || 0;
    const lyrics = this.extractLyrics(result);

    let asset = await this.assetRepo.findOne({
      where: { ownerId: task.ownerId, customId: result.custom_id, isDeleted: 0 },
    });

    if (!asset) {
      asset = this.assetRepo.create({
        ownerId: task.ownerId,
        customId: result.custom_id,
        createBy: task.ownerId,
        createTime: new Date(),
        isDeleted: 0,
      });
    }

    asset.taskPk = task.id;
    asset.title = task.title || asset.title || "未命名作品";
    asset.audioUrl = audioUrl ?? asset.audioUrl;
    asset.imageUrl = imageUrl ?? asset.imageUrl;
    asset.duration = duration || asset.duration;
    asset.tags = task.tags ?? asset.tags;
    asset.lyrics = lyrics ?? asset.lyrics;
    asset.mv = task.mv ?? asset.mv;
    asset.assetType = task.bizCategory === "sound" ? "sound" : "music";
    asset.isInstrumental = task.makeInstrumental;
    asset.updateTime = new Date();

    await this.assetRepo.save(asset);
  }

  /** 从 extend 字段提取歌词（该字段为 JSON 字符串） */
  private extractLyrics(result: SunoTaskDetail["result"]): string | null {
    const raw = result?.extend;
    if (!raw || typeof raw !== "string") return null;
    try {
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      const matched =
        list.find((item: Record<string, unknown>) => item?.id === result?.custom_id) || list[0];
      const lyric = matched?.lyric || matched?.lyrics || matched?.metadata?.lyric;
      return typeof lyric === "string" ? lyric : null;
    } catch {
      return null;
    }
  }

  // ==========================================================================
  // 任务分页
  // ==========================================================================

  async getTaskPage(userId: string, query: SunoTaskQueryDto) {
    const pageNum = Number(query.pageNum) > 0 ? Number(query.pageNum) : 1;
    const pageSize = Number(query.pageSize) > 0 ? Number(query.pageSize) : 10;

    const qb = this.taskRepo
      .createQueryBuilder("t")
      .where("t.ownerId = :userId", { userId: userId.toString() })
      .andWhere("t.isDeleted = 0");

    if (query.keywords) qb.andWhere("t.title LIKE :keywords", { keywords: `%${query.keywords}%` });
    if (query.status) qb.andWhere("t.status = :status", { status: query.status });
    if (query.taskType) qb.andWhere("t.taskType = :taskType", { taskType: query.taskType });
    if (query.bizCategory) qb.andWhere("t.bizCategory = :bizCategory", { bizCategory: query.bizCategory });

    qb.orderBy("t.createTime", "DESC");

    const [list, total] = await qb
      .skip((pageNum - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return { data: list, page: { pageNum, pageSize, total } };
  }

  /** 删除任务（逻辑删除，仅限本人） */
  async deleteTasks(ids: string, userId: string) {
    const idList = (ids || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    if (!idList.length) throw new BusinessException("请选择要删除的任务");
    await this.taskRepo.update({ id: In(idList), ownerId: userId }, { isDeleted: 1 });
    return true;
  }

  // ==========================================================================
  // 作品库
  // ==========================================================================

  async getAssetPage(userId: string, query: SunoAssetQueryDto) {
    const pageNum = Number(query.pageNum) > 0 ? Number(query.pageNum) : 1;
    const pageSize = Number(query.pageSize) > 0 ? Number(query.pageSize) : 12;

    const qb = this.assetRepo
      .createQueryBuilder("a")
      .where("a.ownerId = :userId", { userId: userId.toString() })
      .andWhere("a.isDeleted = 0");

    if (query.keywords) qb.andWhere("a.title LIKE :keywords", { keywords: `%${query.keywords}%` });
    if (query.assetType) qb.andWhere("a.assetType = :assetType", { assetType: query.assetType });
    if (query.isLiked !== undefined && query.isLiked !== null) {
      qb.andWhere("a.isLiked = :isLiked", { isLiked: Number(query.isLiked) });
    }

    qb.orderBy("a.createTime", "DESC");

    const [list, total] = await qb
      .skip((pageNum - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return { data: list, page: { pageNum, pageSize, total } };
  }

  async getAssetDetail(id: string, userId: string) {
    const asset = await this.assetRepo.findOne({
      where: { id: id.toString(), ownerId: userId, isDeleted: 0 },
    });
    if (!asset) throw new BusinessException("作品不存在或无权访问");
    return asset;
  }

  /** 切换收藏状态 */
  async toggleLike(id: string, userId: string) {
    const asset = await this.assetRepo.findOne({
      where: { id: id.toString(), ownerId: userId, isDeleted: 0 },
    });
    if (!asset) throw new BusinessException("作品不存在或无权访问");
    asset.isLiked = asset.isLiked === 1 ? 0 : 1;
    asset.updateTime = new Date();
    await this.assetRepo.save(asset);
    return asset.isLiked;
  }

  /** 删除作品（逻辑删除） */
  async deleteAssets(ids: string, userId: string) {
    const idList = (ids || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    if (!idList.length) throw new BusinessException("请选择要删除的作品");
    await this.assetRepo.update({ id: In(idList), ownerId: userId }, { isDeleted: 1 });
    return true;
  }

  // ==========================================================================
  // 后期处理（9 个接口）
  // ==========================================================================

  /**
   * 统一的后期处理入口
   *
   * @param action 处理动作，见 SUNO_POST_PROCESS_ROUTES
   */
  async postProcess(action: string, dto: PostProcessDto, userId: string) {
    if (!SUNO_POST_PROCESS_ROUTES[action]) {
      throw new BusinessException(`不支持的后期处理类型：${action}`);
    }

    const client = await this.createClient();
    const payload = this.buildPostPayload(action, dto);
    const result = await client.post<SunoSubmitResult>(`/api/v1/music/${action}`, payload);

    const asset = dto.clipId || dto.sunoId
      ? await this.assetRepo.findOne({
          where: { customId: dto.clipId || dto.sunoId, ownerId: userId, isDeleted: 0 },
        })
      : null;

    // 部分接口（如歌词对齐）直接返回结果而非任务
    const taskIds = this.extractTaskIds(result);
    if (!taskIds.length) {
      return { taskIds: [], immediate: true, result, assetTitle: asset?.title };
    }

    const persisted = await this.persistSubmitted(result, {
      taskType: action,
      bizCategory: "post",
      title: `${asset?.title || "作品"}·${action}`,
      parentCustomId: dto.clipId || dto.sunoId,
      requestParams: payload,
      ownerId: userId,
    });

    return { ...persisted, immediate: false, assetTitle: asset?.title };
  }

  /** 组装后期处理请求体 */
  private buildPostPayload(action: string, dto: PostProcessDto): Record<string, unknown> {
    const payload: Record<string, unknown> = {};

    switch (action) {
      case "whole-song":
        if (!dto.clipId) throw new BusinessException("请指定要合成的音乐ID");
        payload.clip_id = dto.clipId;
        break;
      case "aligned-lyrics":
        if (!dto.lyrics || !(dto.sunoId || dto.clipId)) {
          throw new BusinessException("歌词对齐需要提供歌词与音乐ID");
        }
        payload.lyrics = dto.lyrics;
        payload.suno_id = dto.sunoId || dto.clipId;
        break;
      case "upsample":
        if (!dto.clipId) throw new BusinessException("请指定要升采样的音乐ID");
        payload.clip_id = dto.clipId;
        payload.model_name = dto.modelName || "chirp-v4";
        break;
      case "video":
        if (dto.taskId === undefined || dto.taskId === null) {
          throw new BusinessException("生成 MV 需要提供数字任务ID");
        }
        payload.task_id = dto.taskId;
        payload.suno_id = dto.sunoId || dto.clipId;
        break;
      case "download-wav":
      case "download-mp3":
      case "download-m4a":
        if (dto.taskId !== undefined && dto.taskId !== null) payload.task_id = dto.taskId;
        payload.suno_id = dto.sunoId || dto.clipId;
        break;
      case "crop":
        if (!dto.clipId) throw new BusinessException("请指定要裁剪的音乐ID");
        payload.clip_id = dto.clipId;
        payload.start_time = dto.startTime ?? 0;
        payload.end_time = dto.endTime ?? 0;
        break;
      case "speed":
        if (!dto.clipId) throw new BusinessException("请指定要变速的音乐ID");
        payload.clip_id = dto.clipId;
        payload.speed = dto.speed ?? 1;
        break;
    }

    return payload;
  }

  // ==========================================================================
  // 积分
  // ==========================================================================

  /** 查询平台积分余额，并同步一条余额快照流水 */
  async getBalance(userId: string) {
    const client = await this.createClient();
    const balance = await client.get<SunoBalance>("/api/v1/points/balance");
    const remaining = Number(balance?.remaining_points) || 0;

    const log = new SunoPointsLog();
    log.ownerId = userId;
    log.bizType = "balance-snapshot";
    log.points = 0;
    log.changeType = 3;
    log.balance = remaining;
    log.remark = "查询积分余额";
    log.createBy = userId;
    log.createTime = new Date();
    log.updateTime = new Date();
    log.isDeleted = 0;
    await this.pointsRepo.save(log);

    return { remainingPoints: remaining, raw: balance };
  }

  /** 查询平台积分流水 */
  async getPointsLogs(query: { page?: number; limit?: number }) {
    const client = await this.createClient();
    const page = Number(query.page) > 0 ? Number(query.page) : 1;
    const limit = Number(query.limit) > 0 ? Number(query.limit) : 20;
    const data = await client.get<unknown>("/api/v1/points/logs", { page, limit });
    return data;
  }

  /** 本地积分流水（成本核算） */
  async getLocalPointsLogs(userId: string, query: SunoTaskQueryDto) {
    const pageNum = Number(query.pageNum) > 0 ? Number(query.pageNum) : 1;
    const pageSize = Number(query.pageSize) > 0 ? Number(query.pageSize) : 20;

    const [list, total] = await this.pointsRepo.findAndCount({
      where: { ownerId: userId.toString(), isDeleted: 0 },
      order: { createTime: "DESC" },
      skip: (pageNum - 1) * pageSize,
      take: pageSize,
    });

    return { data: list, page: { pageNum, pageSize, total } };
  }

  /** 仪表盘统计：任务/作品/积分概览 */
  async getOverview(userId: string) {
    const [taskTotal, runningTotal, assetTotal, likedTotal] = await Promise.all([
      this.taskRepo.count({ where: { ownerId: userId.toString(), isDeleted: 0 } }),
      this.taskRepo.count({
        where: [
          { ownerId: userId.toString(), status: SUNO_TASK_STATUS.PENDING, isDeleted: 0 },
          { ownerId: userId.toString(), status: SUNO_TASK_STATUS.PROCESSING, isDeleted: 0 },
        ],
      }),
      this.assetRepo.count({ where: { ownerId: userId.toString(), isDeleted: 0 } }),
      this.assetRepo.count({ where: { ownerId: userId.toString(), isLiked: 1, isDeleted: 0 } }),
    ]);

    return { taskTotal, runningTotal, assetTotal, likedTotal };
  }
}
