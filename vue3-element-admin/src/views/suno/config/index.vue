<template>
  <div class="page-container">
    <el-row :gutter="16">
      <el-col :xs="24" :md="14">
        <el-card class="page-content" shadow="never">
          <template #header>
            <span>接入配置</span>
          </template>

          <el-alert type="info" :closable="false" class="config-alert">
            <template #title>
              access_key 由后端托管并代理转发，前端不接触明文。密钥可在
              <el-link
                type="primary"
                href="https://open.suno.cn/merchant/login"
                target="_blank"
                :underline="false"
              >
                Suno 商户后台
              </el-link>
              「API 密钥管理」中创建。
            </template>
          </el-alert>

          <el-form ref="configFormRef" :model="form" :rules="rules" label-width="110px">
            <el-form-item label="当前密钥">
              <el-input :model-value="config.accessKeyMasked || '未配置'" disabled />
              <el-tag
                :type="config.configured ? 'success' : 'danger'"
                size="small"
                class="config-status"
              >
                {{ config.configured ? "已配置" : "未配置" }}
              </el-tag>
            </el-form-item>

            <el-form-item label="接口地址" prop="baseUrl">
              <el-input v-model="form.baseUrl" placeholder="https://open.suno.cn" clearable />
            </el-form-item>

            <el-form-item label="新密钥" prop="accessKey">
              <el-input
                v-model="form.accessKey"
                type="password"
                show-password
                placeholder="留空表示不修改现有密钥"
                clearable
              />
            </el-form-item>

            <el-form-item label="备注">
              <el-input v-model="form.remark" placeholder="备注信息" clearable />
            </el-form-item>

            <el-form-item>
              <el-button
                v-hasPerm="['suno:config:update']"
                type="primary"
                :loading="saving"
                @click="handleSave"
              >
                保存配置
              </el-button>
              <el-button :loading="testing" @click="handleTest">测试连接</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>

      <el-col :xs="24" :md="10">
        <el-card class="page-content" shadow="never">
          <template #header>
            <div class="flex-x-between">
              <span>平台积分</span>
              <el-tooltip content="刷新" placement="top">
                <el-button class="page-icon-btn" @click="loadBalance">
                  <el-icon><Refresh /></el-icon>
                </el-button>
              </el-tooltip>
            </div>
          </template>
          <div class="balance-box">
            <div class="balance-box__label">剩余积分</div>
            <div class="balance-box__value">{{ balance.remainingPoints ?? "--" }}</div>
          </div>

          <el-divider content-position="left">本地流水</el-divider>
          <el-table :data="localLogs" size="small" max-height="320">
            <el-table-column label="时间" prop="createTime" width="160" />
            <el-table-column label="类型" width="100" align="center">
              <template #default="scope">
                {{ changeTypeLabel(scope.row.changeType) }}
              </template>
            </el-table-column>
            <el-table-column label="备注" prop="remark" show-overflow-tooltip />
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { ElMessage, type FormInstance, type FormRules } from "element-plus";
import { Refresh } from "@element-plus/icons-vue";

import SunoAPI from "@/api/suno";
import type { SunoBalance, SunoConfigInfo, SunoPointsLogItem } from "@/api/suno";

defineOptions({
  name: "SunoConfig",
  inheritAttrs: false,
});

const configFormRef = ref<FormInstance>();
const saving = ref(false);
const testing = ref(false);

const config = reactive<SunoConfigInfo>({
  baseUrl: "https://open.suno.cn",
  configured: false,
  accessKeyMasked: "",
  remark: "",
  status: 1,
});

const balance = reactive<SunoBalance>({ remainingPoints: 0 });
const localLogs = ref<SunoPointsLogItem[]>([]);

const form = reactive({
  accessKey: "",
  baseUrl: "https://open.suno.cn",
  remark: "",
});

const rules: FormRules = {
  baseUrl: [{ required: true, message: "请输入接口地址", trigger: "blur" }],
};

/** 变动类型文案 */
function changeTypeLabel(type: number): string {
  const map: Record<number, string> = { 1: "消耗", 2: "充值", 3: "快照", 4: "退还" };
  return map[type] || "-";
}

/** 加载接入配置 */
async function loadConfig(): Promise<void> {
  try {
    const data = await SunoAPI.getConfig();
    Object.assign(config, data);
    form.baseUrl = data.baseUrl || "https://open.suno.cn";
    form.remark = data.remark || "";
    form.accessKey = "";
  } catch {
    /* 静默 */
  }
}

/** 加载积分余额 */
async function loadBalance(): Promise<void> {
  try {
    const data = await SunoAPI.getBalance();
    Object.assign(balance, data);
  } catch {
    /* 静默 */
  }
}

/** 加载本地积分流水 */
async function loadLocalLogs(): Promise<void> {
  try {
    const data = await SunoAPI.getLocalPointsLogs({ pageNum: 1, pageSize: 20 });
    localLogs.value = data.list ?? [];
  } catch {
    /* 静默 */
  }
}

/** 保存配置 */
async function handleSave(): Promise<void> {
  const valid = await configFormRef.value?.validate().then(
    () => true,
    () => false
  );
  if (!valid) return;

  saving.value = true;
  try {
    await SunoAPI.updateConfig({ ...form });
    ElMessage.success("保存成功");
    await loadConfig();
  } finally {
    saving.value = false;
  }
}

/** 测试连接：通过查询余额验证密钥可用性 */
async function handleTest(): Promise<void> {
  testing.value = true;
  try {
    const data = await SunoAPI.getBalance();
    ElMessage.success(`连接正常，当前剩余积分 ${data.remainingPoints ?? 0}`);
  } catch {
    // 错误提示由请求拦截器统一处理
  } finally {
    testing.value = false;
  }
}

onMounted(() => {
  loadConfig();
  loadBalance();
  loadLocalLogs();
});
</script>

<style scoped lang="scss">
.config-alert {
  margin-bottom: 16px;
}

.config-status {
  margin-left: 8px;
}

.balance-box {
  padding: 16px;
  text-align: center;
  background: var(--el-fill-color-light);
  border-radius: 8px;

  &__label {
    font-size: 13px;
    color: var(--el-text-color-secondary);
  }

  &__value {
    margin-top: 6px;
    font-size: 32px;
    font-weight: 600;
    color: var(--el-color-primary);
  }
}
</style>
