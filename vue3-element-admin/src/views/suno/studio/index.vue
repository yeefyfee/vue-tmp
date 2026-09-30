<template>
  <div class="page-container">
    <el-row :gutter="16" class="studio-row">
      <!-- 左侧：创作表单 -->
      <el-col :xs="24" :md="16">
        <el-card class="page-content" shadow="never">
          <template #header>
            <div class="flex-x-between">
              <span>创作台</span>
              <el-tooltip content="刷新余额" placement="top">
                <el-button class="page-icon-btn" @click="loadBalance">
                  <el-icon><Refresh /></el-icon>
                </el-button>
              </el-tooltip>
            </div>
          </template>

          <el-tabs v-model="activeMode" class="studio-tabs">
            <!-- 灵感模式 -->
            <el-tab-pane label="灵感模式" name="inspiration">
              <el-form
                ref="inspirationFormRef"
                :model="inspirationForm"
                :rules="inspirationRules"
                label-width="90px"
              >
                <el-form-item label="音乐描述" prop="gptDescriptionPrompt">
                  <el-input
                    v-model="inspirationForm.gptDescriptionPrompt"
                    type="textarea"
                    :rows="4"
                    maxlength="500"
                    show-word-limit
                    placeholder="例如：一首欢快的流行歌，关于夏天的美好回忆"
                  />
                </el-form-item>
                <el-form-item label="歌名" prop="title">
                  <el-input v-model="inspirationForm.title" placeholder="不填则由 AI 生成" clearable />
                </el-form-item>
                <el-form-item label="纯音乐">
                  <el-switch v-model="inspirationForm.makeInstrumental" />
                </el-form-item>
                <el-form-item label="模型版本">
                  <el-select v-model="inspirationForm.mv" style="width: 220px">
                    <el-option
                      v-for="item in SUNO_MODEL_OPTIONS"
                      :key="item.value"
                      :label="item.label"
                      :value="item.value"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item label="高级选项">
                  <div class="studio-advanced">
                    <el-checkbox v-model="inspirationForm.isMaxMode">MAX 模式（消耗双倍积分）</el-checkbox>
                    <div class="studio-slider">
                      <span>创意度</span>
                      <el-slider
                        v-model="inspirationForm.augCreativity"
                        :min="0"
                        :max="4"
                        :step="1"
                        show-stops
                        class="studio-slider__input"
                      />
                    </div>
                  </div>
                </el-form-item>
                <el-form-item>
                  <el-button
                    v-hasPerm="['suno:music:generate']"
                    type="primary"
                    :loading="submitting"
                    @click="handleGenerateInspiration"
                  >
                    开始生成
                  </el-button>
                  <span class="studio-tip">提交后每次生成 2 个版本，可在任务中心查看进度</span>
                </el-form-item>
              </el-form>
            </el-tab-pane>

            <!-- 自定义歌词 -->
            <el-tab-pane label="自定义歌词" name="custom">
              <el-form
                ref="customFormRef"
                :model="customForm"
                :rules="customRules"
                label-width="90px"
              >
                <el-form-item label="歌词" prop="prompt">
                  <el-input
                    v-model="customForm.prompt"
                    type="textarea"
                    :rows="8"
                    placeholder="支持 [Verse] / [Chorus] 等结构标记，回车换行"
                  />
                </el-form-item>
                <el-form-item label="风格标签" prop="tags">
                  <el-input
                    v-model="customForm.tags"
                    placeholder="例如：pop, acoustic, summer, female vocals"
                    clearable
                  />
                </el-form-item>
                <el-form-item label="歌名">
                  <el-input v-model="customForm.title" placeholder="歌名" clearable />
                </el-form-item>
                <el-form-item label="纯音乐">
                  <el-switch v-model="customForm.makeInstrumental" />
                </el-form-item>
                <el-form-item label="模型版本">
                  <el-select v-model="customForm.mv" style="width: 220px">
                    <el-option
                      v-for="item in SUNO_MODEL_OPTIONS"
                      :key="item.value"
                      :label="item.label"
                      :value="item.value"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item>
                  <el-button
                    v-hasPerm="['suno:music:generate']"
                    type="primary"
                    :loading="submitting"
                    @click="handleGenerateCustom"
                  >
                    开始生成
                  </el-button>
                </el-form-item>
              </el-form>
            </el-tab-pane>

            <!-- 延长模式 -->
            <el-tab-pane label="延长" name="extend">
              <el-form ref="extendFormRef" :model="extendForm" :rules="extendRules" label-width="110px">
                <el-form-item label="来源音乐" prop="continueClipId">
                  <el-select
                    v-model="extendForm.continueClipId"
                    filterable
                    placeholder="从我的作品中选择"
                    style="width: 100%"
                  >
                    <el-option
                      v-for="item in assetOptions"
                      :key="item.customId"
                      :label="item.title || item.customId"
                      :value="item.customId"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item label="歌名">
                  <el-input v-model="extendForm.title" placeholder="续写后的歌名" clearable />
                </el-form-item>
                <el-form-item label="模型版本">
                  <el-select v-model="extendForm.mv" style="width: 220px">
                    <el-option
                      v-for="item in SUNO_MODEL_OPTIONS"
                      :key="item.value"
                      :label="item.label"
                      :value="item.value"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item>
                  <el-button
                    v-hasPerm="['suno:music:generate']"
                    type="primary"
                    :loading="submitting"
                    @click="handleGenerateExtend"
                  >
                    提交延长
                  </el-button>
                </el-form-item>
              </el-form>
            </el-tab-pane>

            <!-- 翻唱模式 -->
            <el-tab-pane label="翻唱" name="cover">
              <el-form ref="coverFormRef" :model="coverForm" :rules="coverRules" label-width="110px">
                <el-form-item label="来源音乐" prop="coverClipId">
                  <el-select
                    v-model="coverForm.coverClipId"
                    filterable
                    placeholder="从我的作品中选择"
                    style="width: 100%"
                  >
                    <el-option
                      v-for="item in assetOptions"
                      :key="item.customId"
                      :label="item.title || item.customId"
                      :value="item.customId"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item label="新风格标签" prop="tags">
                  <el-input v-model="coverForm.tags" placeholder="例如：jazz, piano, male vocals" clearable />
                </el-form-item>
                <el-form-item label="歌名">
                  <el-input v-model="coverForm.title" placeholder="翻唱版歌名" clearable />
                </el-form-item>
                <el-form-item label="模型版本">
                  <el-select v-model="coverForm.mv" style="width: 220px">
                    <el-option
                      v-for="item in SUNO_MODEL_OPTIONS"
                      :key="item.value"
                      :label="item.label"
                      :value="item.value"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item>
                  <el-button
                    v-hasPerm="['suno:music:generate']"
                    type="primary"
                    :loading="submitting"
                    @click="handleGenerateCover"
                  >
                    提交翻唱
                  </el-button>
                </el-form-item>
              </el-form>
            </el-tab-pane>

            <!-- 音效 -->
            <el-tab-pane label="音效" name="sound">
              <el-form ref="soundFormRef" :model="soundForm" :rules="soundRules" label-width="90px">
                <el-form-item label="标题" prop="title">
                  <el-input v-model="soundForm.title" placeholder="例如：Rain" clearable />
                </el-form-item>
                <el-form-item label="音效风格" prop="tags">
                  <el-input v-model="soundForm.tags" placeholder="例如：rain" clearable />
                </el-form-item>
                <el-form-item label="模型">
                  <el-select v-model="soundForm.mv" style="width: 220px">
                    <el-option
                      v-for="item in SUNO_SOUND_MODEL_OPTIONS"
                      :key="item.value"
                      :label="item.label"
                      :value="item.value"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item label="BPM">
                  <el-input-number v-model="soundForm.tempo" :min="1" :max="300" />
                </el-form-item>
                <el-form-item label="音调">
                  <el-input v-model="soundForm.key" placeholder="例如：D" clearable style="width: 220px" />
                </el-form-item>
                <el-form-item label="循环">
                  <el-switch v-model="soundForm.loop" />
                </el-form-item>
                <el-form-item>
                  <el-button
                    v-hasPerm="['suno:sound:generate']"
                    type="primary"
                    :loading="submitting"
                    @click="handleGenerateSound"
                  >
                    生成音效
                  </el-button>
                </el-form-item>
              </el-form>
            </el-tab-pane>

            <!-- 上传参考 -->
            <el-tab-pane label="上传参考" name="upload">
              <el-form ref="uploadFormRef" :model="uploadForm" :rules="uploadRules" label-width="90px">
                <el-form-item label="音频地址" prop="audioUrl">
                  <el-input
                    v-model="uploadForm.audioUrl"
                    placeholder="音频文件的公开 URL，例如 https://example.com/song.mp3"
                    clearable
                  />
                </el-form-item>
                <el-form-item label="标题">
                  <el-input v-model="uploadForm.title" placeholder="参考音频标题" clearable />
                </el-form-item>
                <el-form-item>
                  <el-button
                    v-hasPerm="['suno:music:upload']"
                    type="primary"
                    :loading="submitting"
                    @click="handleUpload"
                  >
                    提交上传
                  </el-button>
                </el-form-item>
              </el-form>
            </el-tab-pane>
          </el-tabs>
        </el-card>
      </el-col>

      <!-- 右侧：概览 + 最近任务 -->
      <el-col :xs="24" :md="8">
        <el-card class="page-content studio-side" shadow="never">
          <template #header>
            <span>数据概览</span>
          </template>
          <div class="studio-balance">
            <div class="studio-balance__label">平台剩余积分</div>
            <div class="studio-balance__value">{{ balance.remainingPoints ?? "--" }}</div>
          </div>
          <el-row :gutter="8" class="studio-stats">
            <el-col :span="12">
              <div class="studio-stat">
                <div class="studio-stat__value">{{ overview.taskTotal }}</div>
                <div class="studio-stat__label">累计任务</div>
              </div>
            </el-col>
            <el-col :span="12">
              <div class="studio-stat">
                <div class="studio-stat__value studio-stat__value--running">
                  {{ overview.runningTotal }}
                </div>
                <div class="studio-stat__label">进行中</div>
              </div>
            </el-col>
            <el-col :span="12">
              <div class="studio-stat">
                <div class="studio-stat__value">{{ overview.assetTotal }}</div>
                <div class="studio-stat__label">作品数</div>
              </div>
            </el-col>
            <el-col :span="12">
              <div class="studio-stat">
                <div class="studio-stat__value">{{ overview.likedTotal }}</div>
                <div class="studio-stat__label">已收藏</div>
              </div>
            </el-col>
          </el-row>
        </el-card>

        <el-card class="page-content studio-side" shadow="never">
          <template #header>
            <div class="flex-x-between">
              <span>最近任务</span>
              <el-button type="primary" size="small" link @click="goTaskCenter">去任务中心</el-button>
            </div>
          </template>
          <el-empty v-if="!recentTasks.length" description="暂无任务" :image-size="60" />
          <div v-else class="studio-recent">
            <div v-for="task in recentTasks" :key="task.id" class="studio-recent__item">
              <div class="studio-recent__title">{{ task.title || "未命名" }}</div>
              <el-tag :type="statusTagType(task.status)" size="small">
                {{ statusLabel(task.status) }}
              </el-tag>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { ElMessage, type FormInstance, type FormRules } from "element-plus";
import { Refresh } from "@element-plus/icons-vue";

import SunoAPI from "@/api/suno";
import type {
  MusicGenerateForm,
  SoundGenerateForm,
  SunoAssetItem,
  SunoBalance,
  SunoOverview,
  SunoTaskItem,
  SunoTaskStatus,
} from "@/api/suno";
import { SUNO_MODEL_OPTIONS, SUNO_SOUND_MODEL_OPTIONS } from "@/api/suno";
import { useRouter } from "vue-router";

defineOptions({
  name: "SunoStudio",
  inheritAttrs: false,
});

const router = useRouter();

const activeMode = ref("inspiration");
const submitting = ref(false);

const inspirationFormRef = ref<FormInstance>();
const customFormRef = ref<FormInstance>();
const extendFormRef = ref<FormInstance>();
const coverFormRef = ref<FormInstance>();
const soundFormRef = ref<FormInstance>();
const uploadFormRef = ref<FormInstance>();

const balance = reactive<SunoBalance>({ remainingPoints: 0 });
const overview = reactive<SunoOverview>({
  taskTotal: 0,
  runningTotal: 0,
  assetTotal: 0,
  likedTotal: 0,
});
const recentTasks = ref<SunoTaskItem[]>([]);
const assetOptions = ref<SunoAssetItem[]>([]);

const DEFAULT_MV = "chirp-hawk";

const inspirationForm = reactive<MusicGenerateForm>({
  gptDescriptionPrompt: "",
  title: "",
  makeInstrumental: false,
  mv: DEFAULT_MV,
  isMaxMode: false,
  augCreativity: 2,
});

const customForm = reactive<MusicGenerateForm>({
  prompt: "",
  tags: "",
  title: "",
  makeInstrumental: false,
  mv: DEFAULT_MV,
});

const extendForm = reactive<MusicGenerateForm>({
  continueClipId: "",
  title: "",
  mv: DEFAULT_MV,
});

const coverForm = reactive<MusicGenerateForm>({
  coverClipId: "",
  tags: "",
  title: "",
  mv: DEFAULT_MV,
});

const soundForm = reactive<SoundGenerateForm>({
  title: "",
  tags: "",
  mv: "chirp-crow",
  loop: true,
});

const uploadForm = reactive({ audioUrl: "", title: "" });

const inspirationRules: FormRules = {
  gptDescriptionPrompt: [{ required: true, message: "请输入音乐描述", trigger: "blur" }],
};
const customRules: FormRules = {
  prompt: [{ required: true, message: "请输入歌词", trigger: "blur" }],
  tags: [{ required: true, message: "请输入风格标签", trigger: "blur" }],
};
const extendRules: FormRules = {
  continueClipId: [{ required: true, message: "请选择来源音乐", trigger: "change" }],
};
const coverRules: FormRules = {
  coverClipId: [{ required: true, message: "请选择来源音乐", trigger: "change" }],
  tags: [{ required: true, message: "请输入新风格标签", trigger: "blur" }],
};
const soundRules: FormRules = {
  title: [{ required: true, message: "请输入音效标题", trigger: "blur" }],
  tags: [{ required: true, message: "请输入音效风格", trigger: "blur" }],
};
const uploadRules: FormRules = {
  audioUrl: [
    { required: true, message: "请输入音频地址", trigger: "blur" },
    { pattern: /^https?:\/\//, message: "请输入以 http(s) 开头的公开地址", trigger: "blur" },
  ],
};

/** 状态标签样式 */
function statusTagType(status: SunoTaskStatus): "info" | "warning" | "success" | "danger" {
  const map: Record<string, "info" | "warning" | "success" | "danger"> = {
    pending: "info",
    processing: "warning",
    completed: "success",
    failed: "danger",
  };
  return map[status] || "info";
}

/** 状态文案 */
function statusLabel(status: SunoTaskStatus): string {
  const map: Record<string, string> = {
    pending: "排队中",
    processing: "生成中",
    completed: "已完成",
    failed: "已失败",
  };
  return map[status] || status;
}

/** 校验表单 */
async function validate(formRef: Ref<FormInstance | undefined>): Promise<boolean> {
  return await formRef.value!.validate().then(
    () => true,
    () => false
  );
}

/** 提交成功后统一处理 */
function afterSubmit(ids: string[]): void {
  ElMessage.success(`已提交 ${ids.length} 个生成任务，请到任务中心查看进度`);
  loadOverview();
  loadRecentTasks();
}

async function handleGenerateInspiration(): Promise<void> {
  if (!(await validate(inspirationFormRef))) return;
  submitting.value = true;
  try {
    const result = await SunoAPI.generateMusic({ ...inspirationForm, task: "generate" });
    afterSubmit(result.taskIds);
  } finally {
    submitting.value = false;
  }
}

async function handleGenerateCustom(): Promise<void> {
  if (!(await validate(customFormRef))) return;
  submitting.value = true;
  try {
    const result = await SunoAPI.generateMusic({ ...customForm, task: "generate" });
    afterSubmit(result.taskIds);
  } finally {
    submitting.value = false;
  }
}

async function handleGenerateExtend(): Promise<void> {
  if (!(await validate(extendFormRef))) return;
  submitting.value = true;
  try {
    const result = await SunoAPI.generateMusic({ ...extendForm, task: "extend" });
    afterSubmit(result.taskIds);
  } finally {
    submitting.value = false;
  }
}

async function handleGenerateCover(): Promise<void> {
  if (!(await validate(coverFormRef))) return;
  submitting.value = true;
  try {
    const result = await SunoAPI.generateMusic({ ...coverForm, task: "cover" });
    afterSubmit(result.taskIds);
  } finally {
    submitting.value = false;
  }
}

async function handleGenerateSound(): Promise<void> {
  if (!(await validate(soundFormRef))) return;
  submitting.value = true;
  try {
    const result = await SunoAPI.generateSound({ ...soundForm });
    afterSubmit(result.taskIds);
  } finally {
    submitting.value = false;
  }
}

async function handleUpload(): Promise<void> {
  if (!(await validate(uploadFormRef))) return;
  submitting.value = true;
  try {
    const result = await SunoAPI.uploadMusic({ ...uploadForm });
    afterSubmit(result.taskIds);
  } finally {
    submitting.value = false;
  }
}

/** 加载积分余额 */
async function loadBalance(): Promise<void> {
  try {
    const data = await SunoAPI.getBalance();
    Object.assign(balance, data);
  } catch {
    // 未配置密钥等场景静默处理，避免打断创作流程
  }
}

/** 加载概览统计 */
async function loadOverview(): Promise<void> {
  try {
    const data = await SunoAPI.getOverview();
    Object.assign(overview, data);
  } catch {
    /* 静默 */
  }
}

/** 加载最近任务 */
async function loadRecentTasks(): Promise<void> {
  try {
    const data = await SunoAPI.getTaskPage({ pageNum: 1, pageSize: 5 });
    recentTasks.value = data.list ?? [];
  } catch {
    /* 静默 */
  }
}

/** 加载作品选项，供延长/翻唱选择 */
async function loadAssetOptions(): Promise<void> {
  try {
    const data = await SunoAPI.getAssetPage({ pageNum: 1, pageSize: 100 });
    assetOptions.value = (data.list ?? []).filter((item) => !!item.customId);
  } catch {
    /* 静默 */
  }
}

function goTaskCenter(): void {
  router.push("/suno/task");
}

onMounted(() => {
  loadBalance();
  loadOverview();
  loadRecentTasks();
  loadAssetOptions();
});
</script>

<style scoped lang="scss">
.studio-row {
  align-items: flex-start;
}

.studio-side {
  & + & {
    margin-top: 16px;
  }
}

.studio-advanced {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.studio-slider {
  display: flex;
  align-items: center;
  gap: 12px;

  &__input {
    width: 220px;
  }
}

.studio-tip {
  margin-left: 12px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.studio-balance {
  padding: 12px 16px;
  margin-bottom: 12px;
  background: var(--el-fill-color-light);
  border-radius: 8px;

  &__label {
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }

  &__value {
    margin-top: 4px;
    font-size: 28px;
    font-weight: 600;
    color: var(--el-color-primary);
  }
}

.studio-stats {
  row-gap: 8px;
}

.studio-stat {
  padding: 10px;
  text-align: center;
  background: var(--el-fill-color-lighter);
  border-radius: 6px;

  &__value {
    font-size: 20px;
    font-weight: 600;

    &--running {
      color: var(--el-color-warning);
    }
  }

  &__label {
    margin-top: 2px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }
}

.studio-recent {
  display: flex;
  flex-direction: column;
  gap: 10px;

  &__item {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
