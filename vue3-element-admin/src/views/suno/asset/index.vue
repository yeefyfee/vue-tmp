<template>
  <div class="page-container">
    <el-card class="page-search" shadow="never">
      <el-form ref="queryFormRef" :model="params" :inline="true" label-suffix=":">
        <el-form-item label="标题" prop="keywords">
          <el-input
            v-model="params.keywords"
            placeholder="作品标题"
            clearable
            @keyup.enter="handleQuery()"
          />
        </el-form-item>

        <el-form-item label="类型" prop="assetType">
          <el-select v-model="params.assetType" clearable placeholder="全部" style="width: 130px">
            <el-option label="音乐" value="music" />
            <el-option label="音效" value="sound" />
            <el-option label="MV" value="video" />
          </el-select>
        </el-form-item>

        <el-form-item label="收藏" prop="isLiked">
          <el-select v-model="params.isLiked" clearable placeholder="全部" style="width: 110px">
            <el-option label="已收藏" :value="1" />
            <el-option label="未收藏" :value="0" />
          </el-select>
        </el-form-item>

        <el-form-item>
          <el-button type="primary" @click="handleQuery()">搜索</el-button>
          <el-button @click="handleResetQuery()">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card class="page-content" shadow="never">
      <div class="page-toolbar">
        <div class="page-toolbar__left">
          <el-button
            v-hasPerm="['suno:asset:delete']"
            type="danger"
            :disabled="!hasSelection"
            @click="handleDelete()"
          >
            删除
          </el-button>
          <span class="asset-count">共 {{ total }} 首作品</span>
        </div>
        <div class="page-toolbar__right">
          <el-radio-group v-model="viewMode" size="small">
            <el-radio-button value="card">卡片</el-radio-button>
            <el-radio-button value="table">列表</el-radio-button>
          </el-radio-group>
          <el-tooltip content="刷新" placement="top">
            <el-button class="page-icon-btn" @click="fetchData">
              <el-icon><Refresh /></el-icon>
            </el-button>
          </el-tooltip>
        </div>
      </div>

      <!-- 卡片视图 -->
      <div v-if="viewMode === 'card'" v-loading="loading" class="asset-grid">
        <el-empty v-if="!list.length" description="暂无作品" class="asset-empty" />
        <div v-for="item in list" :key="item.id" class="asset-card">
          <div class="asset-card__cover" @click="playAsset(item)">
            <el-image :src="item.imageUrl" fit="cover" class="asset-card__image">
              <template #error>
                <div class="asset-card__placeholder">
                  <el-icon :size="32"><Headset /></el-icon>
                </div>
              </template>
            </el-image>
            <div class="asset-card__play">
              <el-icon :size="26"><VideoPlay /></el-icon>
            </div>
            <el-tag v-if="item.assetType === 'sound'" class="asset-card__badge" size="small" type="warning">
              音效
            </el-tag>
          </div>
          <div class="asset-card__body">
            <div class="asset-card__title" :title="item.title">{{ item.title || "未命名作品" }}</div>
            <div class="asset-card__meta">
              <span>{{ formatDuration(item.duration) }}</span>
              <span v-if="item.tags" class="asset-card__tags" :title="item.tags">{{ item.tags }}</span>
            </div>
            <div class="asset-card__actions">
              <el-button
                type="primary"
                size="small"
                link
                @click="playAsset(item)"
              >
                播放
              </el-button>
              <el-button
                v-hasPerm="['suno:asset:post']"
                type="primary"
                size="small"
                link
                @click="openPostDialog(item)"
              >
                后期
              </el-button>
              <el-button
                v-hasPerm="['suno:asset:like']"
                type="warning"
                size="small"
                link
                @click="handleToggleLike(item)"
              >
                {{ item.isLiked === 1 ? "取消收藏" : "收藏" }}
              </el-button>
              <el-button
                v-hasPerm="['suno:asset:delete']"
                type="danger"
                size="small"
                link
                @click="handleDelete(item.id)"
              >
                删除
              </el-button>
            </div>
          </div>
        </div>
      </div>

      <!-- 列表视图 -->
      <div v-else class="page-table-wrapper">
        <el-table
          ref="dataTableRef"
          v-loading="loading"
          :data="list"
          class="page-table"
          border
          height="100%"
          @selection-change="handleSelectionChange"
        >
          <el-table-column type="selection" width="55" align="center" />
          <el-table-column label="标题" prop="title" min-width="180" show-overflow-tooltip>
            <template #default="scope">
              {{ scope.row.title || "未命名作品" }}
            </template>
          </el-table-column>
          <el-table-column label="类型" width="90" align="center">
            <template #default="scope">
              <el-tag size="small" effect="plain">{{ assetTypeLabel(scope.row.assetType) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="风格" prop="tags" min-width="150" show-overflow-tooltip />
          <el-table-column label="时长" width="90" align="center">
            <template #default="scope">
              {{ formatDuration(scope.row.duration) }}
            </template>
          </el-table-column>
          <el-table-column label="收藏" width="80" align="center">
            <template #default="scope">
              <el-icon v-if="scope.row.isLiked === 1" color="var(--el-color-warning)"><Star /></el-icon>
              <span v-else>-</span>
            </template>
          </el-table-column>
          <el-table-column label="创建时间" width="170" align="center" prop="createTime" />
          <el-table-column align="center" fixed="right" label="操作" width="210">
            <template #default="scope">
              <el-button type="primary" size="small" link @click="playAsset(scope.row as SunoAssetItem)">播放</el-button>
              <el-button
                v-hasPerm="['suno:asset:post']"
                type="primary"
                size="small"
                link
                @click="openPostDialog(scope.row as SunoAssetItem)"
              >
                后期
              </el-button>
              <el-button
                v-hasPerm="['suno:asset:like']"
                type="warning"
                size="small"
                link
                @click="handleToggleLike(scope.row as SunoAssetItem)"
              >
                {{ scope.row.isLiked === 1 ? "取消收藏" : "收藏" }}
              </el-button>
              <el-button
                v-hasPerm="['suno:asset:delete']"
                type="danger"
                size="small"
                link
                @click="handleDelete(scope.row.id as string)"
              >
                删除
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <pagination
        v-if="total > 0"
        v-model:total="total"
        v-model:page="params.pageNum"
        v-model:limit="params.pageSize"
        @pagination="fetchData"
      />
    </el-card>

    <!-- 播放器 -->
    <el-dialog
      v-model="player.visible"
      :title="player.title"
      width="480px"
      append-to-body
      @close="stopPlayer"
    >
      <div class="player">
        <el-image :src="player.imageUrl" fit="cover" class="player__cover">
          <template #error>
            <div class="asset-card__placeholder">
              <el-icon :size="40"><Headset /></el-icon>
            </div>
          </template>
        </el-image>
        <div class="player__meta">
          <div>{{ player.tags || "无风格标签" }}</div>
          <div class="player__duration">{{ formatDuration(player.duration) }}</div>
        </div>
        <audio ref="audioRef" :src="player.audioUrl" controls autoplay class="player__audio" />
        <div class="player__actions">
          <el-button
            v-if="player.audioUrl"
            type="primary"
            link
            @click="downloadByUrl(player.audioUrl, `${player.title}.mp3`)"
          >
            下载音频
          </el-button>
          <el-button
            v-hasPerm="['suno:asset:post']"
            type="primary"
            link
            @click="openPostDialog(player.asset!)"
          >
            后期处理
          </el-button>
        </div>
        <el-collapse v-if="player.lyrics" class="player__lyrics">
          <el-collapse-item title="查看歌词" name="lyrics">
            <pre class="player__lyrics-text">{{ player.lyrics }}</pre>
          </el-collapse-item>
        </el-collapse>
      </div>
    </el-dialog>

    <!-- 后期处理 -->
    <el-dialog v-model="postDialog.visible" title="后期处理" width="520px" append-to-body>
      <el-alert
        :title="`目标作品：${postDialog.assetTitle || '未命名作品'}`"
        type="info"
        :closable="false"
        class="post-alert"
      />
      <el-form label-width="110px">
        <el-form-item label="处理类型">
          <el-select v-model="postDialog.action" style="width: 100%">
            <el-option label="合成整首歌" value="whole-song" />
            <el-option label="Remaster 升采样" value="upsample" />
            <el-option label="转 WAV" value="download-wav" />
            <el-option label="转 MP3" value="download-mp3" />
            <el-option label="转 M4A" value="download-m4a" />
            <el-option label="裁剪" value="crop" />
            <el-option label="变速" value="speed" />
            <el-option label="歌词时间戳对齐" value="aligned-lyrics" />
            <el-option label="生成 MV" value="video" />
          </el-select>
        </el-form-item>

        <el-form-item v-if="postDialog.action === 'upsample'" label="目标模型">
          <el-input v-model="postDialog.form.modelName" placeholder="chirp-v4" />
        </el-form-item>

        <template v-if="postDialog.action === 'crop'">
          <el-form-item label="开始秒数">
            <el-input-number v-model="postDialog.form.startTime" :min="0" />
          </el-form-item>
          <el-form-item label="结束秒数">
            <el-input-number v-model="postDialog.form.endTime" :min="0" />
          </el-form-item>
        </template>

        <el-form-item v-if="postDialog.action === 'speed'" label="倍速">
          <el-input-number v-model="postDialog.form.speed" :min="0.5" :max="2" :step="0.1" />
          <span class="post-tip">0.5=慢放 2.0=加速</span>
        </el-form-item>

        <el-form-item v-if="postDialog.action === 'aligned-lyrics'" label="歌词内容">
          <el-input
            v-model="postDialog.form.lyrics"
            type="textarea"
            :rows="5"
            placeholder="粘贴歌词，用于生成时间戳"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button type="primary" :loading="postDialog.loading" @click="handlePostProcess">
          提交处理
        </el-button>
        <el-button @click="postDialog.visible = false">取消</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ElMessage, ElMessageBox, type FormInstance } from "element-plus";
import { Headset, Refresh, Star, VideoPlay } from "@element-plus/icons-vue";

import SunoAPI from "@/api/suno";
import type { PostProcessForm, SunoAssetItem, SunoAssetQueryParams } from "@/api/suno";
import { usePageTable, useTableSelection } from "@/composables";
import { downloadByUrl } from "@/utils/download";

defineOptions({
  name: "SunoAsset",
  inheritAttrs: false,
});

const queryFormRef = ref<FormInstance>();
const audioRef = ref<HTMLAudioElement | null>(null);

const viewMode = ref<"card" | "table">("card");

const { loading, list, total, params, fetchData, handleQuery, handleResetQuery } = usePageTable<
  SunoAssetItem,
  SunoAssetQueryParams
>({
  initialParams: {
    pageNum: 1,
    pageSize: 12,
    keywords: "",
    assetType: undefined,
    isLiked: undefined,
  },
  request: SunoAPI.getAssetPage,
  onBeforeReset: () => queryFormRef.value?.resetFields(),
});

const { selectedIds, hasSelection, handleSelectionChange } = useTableSelection<SunoAssetItem>();

const player = reactive<{
  visible: boolean;
  title: string;
  imageUrl: string;
  audioUrl: string;
  tags: string;
  lyrics: string;
  duration: number;
  asset?: SunoAssetItem;
}>({
  visible: false,
  title: "",
  imageUrl: "",
  audioUrl: "",
  tags: "",
  lyrics: "",
  duration: 0,
});

const postDialog = reactive<{
  visible: boolean;
  loading: boolean;
  action: string;
  assetTitle: string;
  form: PostProcessForm;
}>({
  visible: false,
  loading: false,
  action: "whole-song",
  assetTitle: "",
  form: {},
});

/** 资产类型文案 */
function assetTypeLabel(type: string): string {
  const map: Record<string, string> = { music: "音乐", sound: "音效", video: "MV" };
  return map[type] || type;
}

/** 秒数转 mm:ss */
function formatDuration(seconds?: number): string {
  if (!seconds) return "--:--";
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

/** 播放作品 */
function playAsset(item: SunoAssetItem): void {
  if (!item.audioUrl) {
    ElMessage.warning("该作品暂无音频地址");
    return;
  }
  Object.assign(player, {
    visible: true,
    title: item.title || "未命名作品",
    imageUrl: item.imageUrl || "",
    audioUrl: item.audioUrl,
    tags: item.tags || "",
    lyrics: item.lyrics || "",
    duration: item.duration,
    asset: item,
  });
}

/** 关闭播放器并停止播放 */
function stopPlayer(): void {
  if (audioRef.value) {
    audioRef.value.pause();
    audioRef.value.currentTime = 0;
  }
  player.visible = false;
}

/** 收藏/取消收藏 */
async function handleToggleLike(item: SunoAssetItem): Promise<void> {
  const isLiked = await SunoAPI.toggleLike(item.id);
  item.isLiked = isLiked.isLiked;
  ElMessage.success(isLiked.isLiked === 1 ? "已收藏" : "已取消收藏");
}

/** 删除作品 */
async function handleDelete(id?: string): Promise<void> {
  const deleteIds = id ?? selectedIds.value.join(",");
  if (!deleteIds) {
    ElMessage.warning("请勾选删除项");
    return;
  }
  try {
    await ElMessageBox.confirm("确认删除已选中的作品吗？", "警告", {
      confirmButtonText: "确定",
      cancelButtonText: "取消",
      type: "warning",
    });
  } catch {
    ElMessage.info("已取消删除");
    return;
  }

  loading.value = true;
  try {
    await SunoAPI.deleteAssets(deleteIds);
    ElMessage.success("删除成功");
    handleResetQuery();
  } finally {
    loading.value = false;
  }
}

/** 打开后期处理弹窗 */
function openPostDialog(item: SunoAssetItem): void {
  postDialog.action = "whole-song";
  postDialog.assetTitle = item.title || "";
  postDialog.form = {
    clipId: item.customId,
    sunoId: item.customId,
    modelName: "chirp-v4",
    startTime: 0,
    endTime: Math.round(item.duration || 60),
    speed: 1,
    lyrics: item.lyrics || "",
  };
  postDialog.visible = true;
}

/** 提交后期处理 */
async function handlePostProcess(): Promise<void> {
  postDialog.loading = true;
  try {
    const result = await SunoAPI.postProcess(postDialog.action, postDialog.form);
    if (result.immediate) {
      ElMessage.success("处理完成");
    } else {
      ElMessage.success(`已提交 ${result.taskIds.length} 个处理任务，请到任务中心查看进度`);
    }
    postDialog.visible = false;
  } finally {
    postDialog.loading = false;
  }
}

onMounted(() => {
  handleQuery();
});

onUnmounted(() => {
  stopPlayer();
});
</script>

<style scoped lang="scss">
.asset-count {
  margin-left: 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.asset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
  min-height: 200px;
}

.asset-empty {
  grid-column: 1 / -1;
}

.asset-card {
  overflow: hidden;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  transition: box-shadow 0.2s;

  &:hover {
    box-shadow: var(--el-box-shadow-light);
  }

  &__cover {
    position: relative;
    height: 140px;
    cursor: pointer;
  }

  &__image,
  &__placeholder {
    width: 100%;
    height: 100%;
  }

  &__placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--el-text-color-placeholder);
    background: var(--el-fill-color-light);
  }

  &__play {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    background: rgb(0 0 0 / 35%);
    opacity: 0;
    transition: opacity 0.2s;
  }

  &:hover &__play {
    opacity: 1;
  }

  &__badge {
    position: absolute;
    top: 8px;
    right: 8px;
  }

  &__body {
    padding: 10px 12px;
  }

  &__title {
    overflow: hidden;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__meta {
    display: flex;
    gap: 8px;
    margin-top: 4px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }

  &__tags {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 8px;
  }
}

.player {
  display: flex;
  flex-direction: column;
  gap: 12px;

  &__cover {
    width: 100%;
    height: 200px;
    border-radius: 8px;
  }

  &__meta {
    display: flex;
    justify-content: space-between;
    font-size: 13px;
    color: var(--el-text-color-secondary);
  }

  &__audio {
    width: 100%;
  }

  &__actions {
    display: flex;
    gap: 8px;
  }

  &__lyrics-text {
    max-height: 240px;
    overflow: auto;
    font-family: inherit;
    font-size: 13px;
    white-space: pre-wrap;
  }
}

.post-alert {
  margin-bottom: 16px;
}

.post-tip {
  margin-left: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
