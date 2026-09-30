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

        <el-form-item label="状态" prop="status">
          <el-select v-model="params.status" clearable placeholder="全部" style="width: 130px">
            <el-option
              v-for="item in SUNO_TASK_STATUS_OPTIONS"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="类型" prop="taskType">
          <el-select v-model="params.taskType" clearable placeholder="全部" style="width: 150px">
            <el-option
              v-for="item in SUNO_TASK_TYPE_OPTIONS"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
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
            v-hasPerm="['suno:task:query']"
            type="primary"
            :disabled="!runningIds.length || polling"
            :loading="polling"
            @click="refreshRunning"
          >
            {{ polling ? "刷新中..." : "刷新进行中任务" }}
          </el-button>
          <el-button
            v-hasPerm="['suno:task:delete']"
            type="danger"
            :disabled="!hasSelection"
            @click="handleDelete()"
          >
            删除
          </el-button>
          <el-tag v-if="autoPolling" type="success" effect="plain" size="small">
            自动轮询中（{{ autoPollCountdown }}s）
          </el-tag>
        </div>
        <div class="page-toolbar__right">
          <el-switch
            v-model="autoPolling"
            active-text="自动轮询"
            inline-prompt
            @change="toggleAutoPoll"
          />
          <el-tooltip content="刷新" placement="top">
            <el-button class="page-icon-btn" @click="fetchData">
              <el-icon><Refresh /></el-icon>
            </el-button>
          </el-tooltip>
        </div>
      </div>

      <div class="page-table-wrapper">
        <el-table
          ref="dataTableRef"
          v-loading="loading"
          :data="list"
          class="page-table"
          border
          height="100%"
          highlight-current-row
          @selection-change="handleSelectionChange"
        >
          <el-table-column type="selection" width="55" align="center" />
          <el-table-column type="index" label="序号" width="60" />
          <el-table-column label="标题" prop="title" min-width="180" show-overflow-tooltip>
            <template #default="scope">
              {{ scope.row.title || "未命名作品" }}
            </template>
          </el-table-column>
          <el-table-column label="类型" prop="taskType" width="120" align="center">
            <template #default="scope">
              <el-tag size="small" effect="plain">{{ taskTypeLabel(scope.row.taskType) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="模型" prop="mv" width="130" align="center" />
          <el-table-column label="平台任务ID" prop="taskId" width="110" align="center" />
          <el-table-column label="状态" width="140" align="center">
            <template #default="scope">
              <el-tag :type="statusTagType(scope.row.status)" size="small">
                {{ statusLabel(scope.row.status) }}
              </el-tag>
              <div v-if="scope.row.pointsRefunded === 1" class="task-refund">已退积分</div>
            </template>
          </el-table-column>
          <el-table-column label="失败原因" prop="errormsg" min-width="160" show-overflow-tooltip>
            <template #default="scope">
              {{ scope.row.errormsg || "-" }}
            </template>
          </el-table-column>
          <el-table-column label="提交时间" width="170" align="center">
            <template #default="scope">
              {{ scope.row.createTime || "-" }}
            </template>
          </el-table-column>
          <el-table-column align="center" fixed="right" label="操作" width="170">
            <template #default="scope">
              <el-button
                v-hasPerm="['suno:task:query']"
                type="primary"
                size="small"
                link
                :disabled="isFinished(scope.row.status)"
                @click="handleQueryOne(scope.row as SunoTaskItem)"
              >
                查询
              </el-button>
              <el-button v-if="scope.row.customId" type="primary" size="small" link @click="goAsset">
                查看作品
              </el-button>
              <el-button
                v-hasPerm="['suno:task:delete']"
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
  </div>
</template>

<script setup lang="ts">
import { ElMessage, ElMessageBox, type FormInstance } from "element-plus";
import { Refresh } from "@element-plus/icons-vue";

import SunoAPI from "@/api/suno";
import type { SunoTaskItem, SunoTaskQueryParams, SunoTaskStatus } from "@/api/suno";
import { SUNO_TASK_STATUS_OPTIONS, SUNO_TASK_TYPE_OPTIONS } from "@/api/suno";
import { usePageTable, useTableSelection } from "@/composables";
import { useRouter } from "vue-router";

defineOptions({
  name: "SunoTask",
  inheritAttrs: false,
});

const router = useRouter();
const queryFormRef = ref<FormInstance>();

/** 自动轮询间隔（秒） */
const POLL_INTERVAL = 10;

const { loading, list, total, params, fetchData, handleQuery, handleResetQuery } = usePageTable<
  SunoTaskItem,
  SunoTaskQueryParams
>({
  initialParams: {
    pageNum: 1,
    pageSize: 10,
    keywords: "",
    status: undefined,
    taskType: undefined,
  },
  request: SunoAPI.getTaskPage,
  onBeforeReset: () => queryFormRef.value?.resetFields(),
});

const { selectedIds, hasSelection, handleSelectionChange } = useTableSelection<SunoTaskItem>();

const polling = ref(false);
const autoPolling = ref(false);
const autoPollCountdown = ref(POLL_INTERVAL);
let autoPollTimer: ReturnType<typeof setInterval> | null = null;
let countdownTimer: ReturnType<typeof setInterval> | null = null;

/** 进行中的任务ID（平台 task_id） */
const runningIds = computed(() =>
  list.value
    .filter((item) => !isFinished(item.status) && item.taskId)
    .map((item) => String(item.taskId))
);

/** 是否已结束（完成或失败） */
function isFinished(status: SunoTaskStatus): boolean {
  return status === "completed" || status === "failed";
}

/** 状态标签类型 */
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
  return SUNO_TASK_STATUS_OPTIONS.find((item) => item.value === status)?.label || status;
}

/** 任务类型文案 */
function taskTypeLabel(type: string): string {
  return SUNO_TASK_TYPE_OPTIONS.find((item) => item.value === type)?.label || type;
}

/** 查询单个任务 */
async function handleQueryOne(row: SunoTaskItem): Promise<void> {
  if (!row.taskId) {
    ElMessage.warning("该任务没有平台任务ID，无法查询");
    return;
  }
  loading.value = true;
  try {
    const detail = await SunoAPI.queryTask(String(row.taskId));
    renderQueryResult(detail.status, detail.result?.errormsg);
    fetchData();
  } finally {
    loading.value = false;
  }
}

/** 批量刷新进行中的任务 */
async function refreshRunning(): Promise<void> {
  if (!runningIds.value.length) {
    ElMessage.info("当前没有进行中的任务");
    return;
  }
  polling.value = true;
  try {
    const results = await SunoAPI.queryTasks(runningIds.value.join(","));
    const finished = (results || []).filter((item) => isFinished(item.status as SunoTaskStatus));
    if (finished.length) {
      ElMessage.success(`已更新 ${finished.length} 个任务状态`);
    } else {
      ElMessage.info("任务仍在生成中，请稍候");
    }
    fetchData();
  } finally {
    polling.value = false;
  }
}

/** 渲染查询结果提示 */
function renderQueryResult(status?: string, errormsg?: string): void {
  if (status === "completed") {
    ElMessage.success("任务已完成，作品已入库");
  } else if (status === "failed") {
    ElMessage.error(`任务失败：${errormsg || "未知原因"}`);
  } else {
    ElMessage.info(`任务状态：${statusLabel(status as SunoTaskStatus)}`);
  }
}

/** 开关自动轮询 */
function toggleAutoPoll(value: string | number | boolean): void {
  if (value) {
    startAutoPoll();
  } else {
    stopAutoPoll();
  }
}

/** 启动自动轮询：每 10s 拉取一次进行中任务 */
function startAutoPoll(): void {
  stopAutoPoll();
  autoPollCountdown.value = POLL_INTERVAL;

  countdownTimer = setInterval(() => {
    autoPollCountdown.value -= 1;
    if (autoPollCountdown.value <= 0) autoPollCountdown.value = POLL_INTERVAL;
  }, 1000);

  autoPollTimer = setInterval(() => {
    // 页面数据为空或没有进行中任务时跳过本次请求
    if (runningIds.value.length && !polling.value) {
      refreshRunning();
    }
  }, POLL_INTERVAL * 1000);
}

/** 停止自动轮询并清理定时器 */
function stopAutoPoll(): void {
  if (autoPollTimer) {
    clearInterval(autoPollTimer);
    autoPollTimer = null;
  }
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

/** 删除任务 */
async function handleDelete(id?: string): Promise<void> {
  const deleteIds = id ?? selectedIds.value.join(",");
  if (!deleteIds) {
    ElMessage.warning("请勾选删除项");
    return;
  }
  try {
    await ElMessageBox.confirm("确认删除已选中的任务记录吗？", "警告", {
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
    await SunoAPI.deleteTasks(deleteIds);
    ElMessage.success("删除成功");
    handleResetQuery();
  } finally {
    loading.value = false;
  }
}

function goAsset(): void {
  router.push("/suno/asset");
}

onMounted(() => {
  handleQuery();
});

onUnmounted(() => {
  stopAutoPoll();
});
</script>

<style scoped lang="scss">
.task-refund {
  margin-top: 2px;
  font-size: 12px;
  color: var(--el-color-success);
}
</style>
