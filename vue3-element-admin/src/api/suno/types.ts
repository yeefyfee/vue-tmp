/**
 * Suno 音乐模块类型定义
 *
 * 与后端 /api/v1/suno/* 接口对齐。
 */

import type { BaseQueryParams } from "@/api/common";

/** 生成任务类型 */
export type SunoTaskType =
  | "generate"
  | "sound"
  | "extend"
  | "cover"
  | "upload"
  | "whole-song"
  | "aligned-lyrics"
  | "upsample"
  | "video"
  | "download-wav"
  | "download-mp3"
  | "download-m4a"
  | "crop"
  | "speed";

/** 任务状态 */
export type SunoTaskStatus = "pending" | "processing" | "completed" | "failed";

/** 业务分类 */
export type SunoBizCategory = "music" | "sound" | "post";

/** 生成音乐请求 */
export interface MusicGenerateForm {
  /** 任务类型（缺省 generate，可选 extend/cover） */
  task?: "generate" | "extend" | "cover";
  /** 歌名 */
  title?: string;
  /** 灵感模式描述 */
  gptDescriptionPrompt?: string;
  /** 自定义歌词 */
  prompt?: string;
  /** 风格标签 */
  tags?: string;
  /** 是否纯音乐 */
  makeInstrumental?: boolean;
  /** 模型版本 */
  mv?: string;
  /** 延长来源音乐ID */
  continueClipId?: string;
  /** 翻唱来源音乐ID */
  coverClipId?: string;
  /** MAX 模式 */
  isMaxMode?: boolean;
  /** 创意度 0-4 */
  augCreativity?: number;
}

/** 生成音效请求 */
export interface SoundGenerateForm {
  title?: string;
  tags?: string;
  mv?: string;
  tempo?: number;
  key?: string;
  loop?: boolean;
}

/** 上传参考音频请求 */
export interface MusicUploadForm {
  audioUrl: string;
  title?: string;
}

/** 提交结果 */
export interface SubmitResult {
  batchNo: string;
  taskIds: string[];
  taskType: SunoTaskType;
}

/** 任务实体 */
export interface SunoTaskItem {
  id: string;
  batchNo: string;
  taskId?: string;
  customId?: string;
  parentCustomId?: string;
  taskType: SunoTaskType;
  bizCategory: SunoBizCategory;
  title?: string;
  prompt?: string;
  tags?: string;
  mv?: string;
  gptDescriptionPrompt?: string;
  makeInstrumental: number;
  isMaxMode: number;
  augCreativity?: number;
  status: SunoTaskStatus;
  errormsg?: string;
  pointsRefunded: number;
  createTime?: string;
  updateTime?: string;
}

/** 任务查询参数 */
export interface SunoTaskQueryParams extends BaseQueryParams {
  keywords?: string;
  status?: string;
  taskType?: string;
  bizCategory?: string;
}

/** 平台任务结果中的文件信息 */
export interface SunoFileInfo {
  mp3Url?: string;
  cosUrl?: string;
  duration?: number;
}

/** 平台任务结果 */
export interface SunoTaskResult {
  custom_id?: string;
  fileInfo?: SunoFileInfo;
  errormsg?: string;
  extend?: string;
}

/** 平台任务详情 */
export interface SunoTaskDetail {
  task_id?: number | string;
  status?: SunoTaskStatus;
  points_refunded?: boolean;
  result?: SunoTaskResult;
}

/** 作品资产 */
export interface SunoAssetItem {
  id: string;
  taskPk?: string;
  customId: string;
  title?: string;
  imageUrl?: string;
  audioUrl?: string;
  videoUrl?: string;
  duration: number;
  tags?: string;
  lyrics?: string;
  mv?: string;
  assetType: "music" | "sound" | "video";
  isInstrumental: number;
  isLiked: number;
  createTime?: string;
  updateTime?: string;
}

/** 作品查询参数 */
export interface SunoAssetQueryParams extends BaseQueryParams {
  keywords?: string;
  assetType?: string;
  isLiked?: number;
}

/** 后期处理请求 */
export interface PostProcessForm {
  clipId?: string;
  sunoId?: string;
  taskId?: number;
  lyrics?: string;
  modelName?: string;
  startTime?: number;
  endTime?: number;
  speed?: number;
}

/** 接入配置 */
export interface SunoConfigInfo {
  baseUrl: string;
  configured: boolean;
  accessKeyMasked: string;
  remark: string;
  status: number;
}

/** 积分余额 */
export interface SunoBalance {
  remainingPoints: number;
}

/** 本地积分流水 */
export interface SunoPointsLogItem {
  id: string;
  ownerId: string;
  bizId?: string;
  bizType?: string;
  points: number;
  changeType: number;
  balance?: number;
  remark?: string;
  createTime?: string;
}

/** 概览统计 */
export interface SunoOverview {
  taskTotal: number;
  runningTotal: number;
  assetTotal: number;
  likedTotal: number;
}

/** 任务状态选项（供下拉与标签渲染） */
export const SUNO_TASK_STATUS_OPTIONS = [
  { value: "pending", label: "排队中", type: "info" },
  { value: "processing", label: "生成中", type: "warning" },
  { value: "completed", label: "已完成", type: "success" },
  { value: "failed", label: "已失败", type: "danger" },
] as const;

/** 任务类型选项 */
export const SUNO_TASK_TYPE_OPTIONS = [
  { value: "generate", label: "生成音乐" },
  { value: "sound", label: "生成音效" },
  { value: "extend", label: "延长" },
  { value: "cover", label: "翻唱" },
  { value: "upload", label: "上传参考" },
  { value: "whole-song", label: "合成整首" },
  { value: "aligned-lyrics", label: "歌词对齐" },
  { value: "upsample", label: "Remaster" },
  { value: "video", label: "生成MV" },
  { value: "download-wav", label: "转WAV" },
  { value: "download-mp3", label: "转MP3" },
  { value: "download-m4a", label: "转M4A" },
  { value: "crop", label: "裁剪" },
  { value: "speed", label: "变速" },
] as const;

/** 模型版本选项 */
export const SUNO_MODEL_OPTIONS = [
  { value: "chirp-hawk", label: "Suno V6" },
  { value: "chirp-hawk-wild", label: "Suno V6-wild" },
  { value: "chirp-goose", label: "Suno V6-mini" },
] as const;

/** 音效模型选项 */
export const SUNO_SOUND_MODEL_OPTIONS = [
  { value: "chirp-crow", label: "音效模型" },
  { value: "chirp-fenix", label: "音效模型 Plus" },
] as const;
