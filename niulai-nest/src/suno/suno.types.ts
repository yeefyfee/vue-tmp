/**
 * Suno 模块通用类型与接口契约
 *
 * 与开放平台文档一一对应，供 service/controller 复用。
 */

/** 生成音乐：灵感模式 / 自定义歌词 */
export interface MusicGenerateParams {
  /** 灵感模式描述（与 prompt 二选一） */
  gptDescriptionPrompt?: string;
  /** 自定义歌词 */
  prompt?: string;
  /** 风格标签 */
  tags?: string;
  /** 是否纯音乐 */
  makeInstrumental?: boolean;
  /** 模型版本 */
  mv?: string;
  /** 歌名 */
  title?: string;
  /** 是否为延长任务 */
  task?: string;
  /** 延长来源音乐ID */
  continueClipId?: string;
  /** 翻唱来源音乐ID */
  coverClipId?: string;
  /** MAX 模式（消耗双倍积分） */
  isMaxMode?: boolean;
  /** 创意度 0-4 */
  augCreativity?: number;
}

/** 生成音效 */
export interface SoundGenerateParams {
  title?: string;
  tags?: string;
  mv?: string;
  tempo?: number;
  key?: string;
  loop?: boolean;
}

/** 提交类接口的统一返回 */
export interface SunoSubmitResult {
  /** 平台任务ID列表（通常为 2 个） */
  task_ids?: Array<number | string>;
  /** 部分接口返回单个 task_id */
  task_id?: number | string;
  /** 音效类接口可能返回的其他字段 */
  [key: string]: unknown;
}

/** 任务结果中的文件信息 */
export interface SunoFileInfo {
  mp3Url?: string;
  cosUrl?: string;
  duration?: number;
  [key: string]: unknown;
}

/** 任务结果 */
export interface SunoTaskResult {
  custom_id?: string;
  fileInfo?: SunoFileInfo;
  errormsg?: string;
  /** 完整歌曲信息的 JSON 字符串 */
  extend?: string;
  [key: string]: unknown;
}

/** 任务详情 */
export interface SunoTaskDetail {
  task_id?: number | string;
  status?: string;
  points_refunded?: boolean;
  result?: SunoTaskResult;
  [key: string]: unknown;
}

/** 积分余额 */
export interface SunoBalance {
  remaining_points?: number;
  [key: string]: unknown;
}

/** 积分流水条目 */
export interface SunoPointsLogItem {
  id?: number | string;
  type?: number;
  points?: number;
  createTime?: string;
  [key: string]: unknown;
}

/** 任务状态常量 */
export const SUNO_TASK_STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;

/** 任务类型常量 */
export const SUNO_TASK_TYPE = {
  GENERATE: "generate",
  SOUND: "sound",
  EXTEND: "extend",
  COVER: "cover",
  UPLOAD: "upload",
  WHOLE_SONG: "whole-song",
  ALIGNED_LYRICS: "aligned-lyrics",
  UPSAMPLE: "upsample",
  VIDEO: "video",
  DOWNLOAD_WAV: "download-wav",
  DOWNLOAD_MP3: "download-mp3",
  DOWNLOAD_M4A: "download-m4a",
  CROP: "crop",
  SPEED: "speed",
} as const;

/** 后期处理接口路径与任务类型映射 */
export const SUNO_POST_PROCESS_ROUTES: Record<string, string> = {
  "whole-song": "whole-song",
  "aligned-lyrics": "aligned-lyrics",
  upsample: "upsample",
  video: "video",
  "download-wav": "download-wav",
  "download-mp3": "download-mp3",
  "download-m4a": "download-m4a",
  crop: "crop",
  speed: "speed",
};
