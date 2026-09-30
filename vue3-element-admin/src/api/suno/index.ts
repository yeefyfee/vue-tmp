import request from "@/utils/request";
import type { PageResult } from "@/api/common";
import type {
  MusicGenerateForm,
  MusicUploadForm,
  PostProcessForm,
  SoundGenerateForm,
  SubmitResult,
  SunoAssetItem,
  SunoAssetQueryParams,
  SunoBalance,
  SunoConfigInfo,
  SunoOverview,
  SunoPointsLogItem,
  SunoTaskDetail,
  SunoTaskItem,
  SunoTaskQueryParams,
} from "./types";

const SUNO_BASE_URL = "/api/v1/suno";

const SunoAPI = {
  // ---------------------------- 接入配置 ----------------------------

  /** 获取接入配置 */
  getConfig() {
    return request<unknown, SunoConfigInfo>({ url: `${SUNO_BASE_URL}/config`, method: "get" });
  },
  /** 更新接入配置 */
  updateConfig(data: { accessKey?: string; baseUrl?: string; remark?: string }) {
    return request({ url: `${SUNO_BASE_URL}/config`, method: "put", data });
  },

  // ---------------------------- 生成 ----------------------------

  /** 生成音乐（灵感/自定义/延长/翻唱） */
  generateMusic(data: MusicGenerateForm) {
    return request<unknown, SubmitResult>({
      url: `${SUNO_BASE_URL}/music/generate`,
      method: "post",
      data,
    });
  },
  /** 生成音效 */
  generateSound(data: SoundGenerateForm) {
    return request<unknown, SubmitResult>({
      url: `${SUNO_BASE_URL}/music/sound`,
      method: "post",
      data,
    });
  },
  /** 上传参考音频 */
  uploadMusic(data: MusicUploadForm) {
    return request<unknown, SubmitResult>({
      url: `${SUNO_BASE_URL}/music/upload`,
      method: "post",
      data,
    });
  },

  // ---------------------------- 查询 ----------------------------

  /** 查询单个任务 */
  queryTask(id: string) {
    return request<unknown, SunoTaskDetail>({
      url: `${SUNO_BASE_URL}/task`,
      method: "get",
      params: { id },
    });
  },
  /** 批量查询任务 */
  queryTasks(ids: string) {
    return request<unknown, SunoTaskDetail[]>({
      url: `${SUNO_BASE_URL}/tasks`,
      method: "get",
      params: { ids },
    });
  },
  /** 任务分页列表 */
  getTaskPage(queryParams?: SunoTaskQueryParams) {
    return request<unknown, PageResult<SunoTaskItem>>({
      url: `${SUNO_BASE_URL}/task/page`,
      method: "get",
      params: queryParams,
    });
  },
  /** 删除任务（多个以英文逗号分割） */
  deleteTasks(ids: string) {
    return request({ url: `${SUNO_BASE_URL}/task/${ids}`, method: "delete" });
  },

  // ---------------------------- 作品库 ----------------------------

  /** 作品分页列表 */
  getAssetPage(queryParams?: SunoAssetQueryParams) {
    return request<unknown, PageResult<SunoAssetItem>>({
      url: `${SUNO_BASE_URL}/asset/page`,
      method: "get",
      params: queryParams,
    });
  },
  /** 作品详情 */
  getAssetDetail(id: string) {
    return request<unknown, SunoAssetItem>({
      url: `${SUNO_BASE_URL}/asset/${id}`,
      method: "get",
    });
  },
  /** 收藏/取消收藏 */
  toggleLike(id: string) {
    return request<unknown, { isLiked: number }>({
      url: `${SUNO_BASE_URL}/asset/${id}/like`,
      method: "put",
    });
  },
  /** 删除作品 */
  deleteAssets(ids: string) {
    return request({ url: `${SUNO_BASE_URL}/asset/${ids}`, method: "delete" });
  },

  // ---------------------------- 后期处理 ----------------------------

  /**
   * 后期处理统一入口
   *
   * @param action whole-song / aligned-lyrics / upsample / video /
   *               download-wav / download-mp3 / download-m4a / crop / speed
   */
  postProcess(action: string, data: PostProcessForm) {
    return request<unknown, { taskIds: string[]; immediate: boolean; result?: unknown }>({
      url: `${SUNO_BASE_URL}/post/${action}`,
      method: "post",
      data,
    });
  },

  // ---------------------------- 积分与概览 ----------------------------

  /** 查询平台积分余额 */
  getBalance() {
    return request<unknown, SunoBalance>({
      url: `${SUNO_BASE_URL}/points/balance`,
      method: "get",
    });
  },
  /** 查询平台积分流水 */
  getPointsLogs(params?: { page?: number; limit?: number }) {
    return request<unknown, unknown>({
      url: `${SUNO_BASE_URL}/points/logs`,
      method: "get",
      params,
    });
  },
  /** 本地积分流水 */
  getLocalPointsLogs(queryParams?: SunoTaskQueryParams) {
    return request<unknown, PageResult<SunoPointsLogItem>>({
      url: `${SUNO_BASE_URL}/points/local`,
      method: "get",
      params: queryParams,
    });
  },
  /** 概览统计 */
  getOverview() {
    return request<unknown, SunoOverview>({
      url: `${SUNO_BASE_URL}/overview`,
      method: "get",
    });
  },
};

export default SunoAPI;

// 重导出类型
export * from "./types";
