<template>
  <div v-if="visible" class="pet-health-reminder" data-testid="pet-health-reminder-bar">
    <div class="pet-health-reminder__head">
      <span class="pet-health-reminder__title">
        <el-icon class="pet-health-reminder__icon"><Warning /></el-icon>
        {{ t("pet.healthReminder.title") }}
      </span>

      <span class="pet-health-reminder__counts">
        <el-tag v-if="summary.expired > 0" type="danger" effect="dark" size="small">
          {{ t("pet.healthReminder.expired") }} {{ summary.expired }}
        </el-tag>
        <el-tag v-if="summary.urgent > 0" type="warning" effect="dark" size="small">
          {{ t("pet.healthReminder.urgent", { days: urgentDays }) }} {{ summary.urgent }}
        </el-tag>
        <el-tag v-if="summary.soon > 0" type="info" effect="plain" size="small">
          {{ t("pet.healthReminder.soon") }} {{ summary.soon }}
        </el-tag>
      </span>

      <el-button
        link
        type="primary"
        size="small"
        data-testid="pet-health-reminder-toggle"
        @click="expanded = !expanded"
      >
        {{ expanded ? t("pet.healthReminder.collapse") : t("pet.healthReminder.expand") }}
      </el-button>
    </div>

    <div
      v-show="expanded"
      v-loading="loading"
      class="pet-health-reminder__list"
      data-testid="pet-health-reminder-list"
    >
      <el-table :data="items" size="small" border @row-click="handleRowClick">
        <el-table-column :label="t('pet.healthReminder.pet')" prop="petName" min-width="110">
          <template #default="{ row }">
            <span class="pet-health-reminder__pet">{{ row.petName || "-" }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('pet.healthReminder.petType')" width="80" align="center">
          <template #default="{ row }">{{ t(petTypeLabelKey(row.petType)) }}</template>
        </el-table-column>
        <el-table-column :label="t('pet.healthReminder.recordName')" width="90" align="center">
          <template #default="{ row }">
            <el-tag effect="plain" size="small">{{ row.recordName }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('pet.healthReminder.expireDate')" width="120" align="center">
          <template #default="{ row }">{{ row.expireDate?.slice(0, 10) ?? "-" }}</template>
        </el-table-column>
        <el-table-column :label="t('pet.healthReminder.left')" width="120" align="center">
          <template #default="{ row }">
            <el-tag :type="healthExpiryLevelTagType(row.level)" effect="plain" size="small">
              {{
                t(healthDaysLeftLabel(row.daysLeft).key, healthDaysLeftLabel(row.daysLeft).params)
              }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('pet.healthReminder.owner')" min-width="150">
          <template #default="{ row }">
            {{ formatOwner(row as HealthExpiryReminderItem) }}
          </template>
        </el-table-column>
      </el-table>

      <div v-if="total > items.length" class="pet-health-reminder__more">
        {{ t("pet.healthReminder.more", { count: total - items.length }) }}
      </div>
      <div v-else class="pet-health-reminder__more">
        {{ t("pet.healthReminder.hint") }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Warning } from "@element-plus/icons-vue";

import PetAPI from "@/api/pet";
import type { HealthExpiryReminderItem, HealthExpiryReminderSummary } from "@/api/pet";
import { healthDaysLeftLabel, healthExpiryLevelTagType, petTypeLabelKey } from "@/utils/pet";

/**
 * 健康到期提醒条（MVP-WEB-05-02）
 *
 * 挂在**宠物列表页顶部**（不新增页面路径，遵守 PRD《页面清单 · 清单维护规则》1）：
 * 数据源 `GET /pets/health-expiry-reminders`（租户级，**含已过期**）。
 *
 * 三档计数（已过期 / 14 天内 / 窗口内）恒为「窗口内全貌」——`summary` 不受
 * `level` 筛选影响（服务端口径），因此提醒条不随明细展开而漂移。
 *
 * 明细行点击 → 上抛 `navigate(petId)` 由页面跳 `/pets/:petId?tab=health`
 * （档案页健康页签，含该宠的疫苗/驱虫倒计时与全量记录）。
 *
 * 零命中时**整条不渲染**（PRD《Web规范》§权限与视图 1「未上线字段直接不渲染」的
 * 同源纪律：无待办不占位，不渲染 0 值）。
 */
defineOptions({ name: "PetHealthReminderBar", inheritAttrs: false });

const emit = defineEmits<{
  (e: "navigate", petId: string): void;
}>();

const { t } = useI18n();

/** 提醒窗口（天）：与后端 `HEALTH_REMINDER_WINDOW_DAYS` 同口径 */
const WINDOW_DAYS = 30;
/** 明细一次展示条数（超出部分以「其余 N 项」提示，完整清单在各自档案页） */
const PAGE_SIZE = 20;

const loading = ref(false);
const loaded = ref(false);
const expanded = ref(false);
const items = ref<HealthExpiryReminderItem[]>([]);
const total = ref(0);
const urgentDays = ref(14);
const summary = ref<HealthExpiryReminderSummary>({ expired: 0, urgent: 0, soon: 0 });

const visible = computed(() => total.value > 0);

async function fetchReminders(): Promise<void> {
  loading.value = true;
  try {
    const data = await PetAPI.getHealthExpiryReminders({
      windowDays: WINDOW_DAYS,
      pageNum: 1,
      pageSize: PAGE_SIZE,
    });
    items.value = data.items ?? [];
    total.value = data.total ?? 0;
    urgentDays.value = data.urgentDays ?? 14;
    summary.value = data.summary ?? { expired: 0, urgent: 0, soon: 0 };
    // 已过期属最高优先级 ⇒ 默认展开，别让前台漏看
    if (summary.value.expired > 0) expanded.value = true;
  } catch {
    // 提醒条是**增强信息**：失败静默降级为「不渲染」，不阻断列表主流程
    items.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
    loaded.value = true;
  }
}

/** 主人展示：「姓名（手机号）」；缺失回落「未登记」，不渲染裸 UUID */
function formatOwner(row: HealthExpiryReminderItem): string {
  if (!row.ownerName && !row.ownerMobile) return t("pet.value.unset");
  return row.ownerMobile ? `${row.ownerName ?? ""}（${row.ownerMobile}）` : (row.ownerName ?? "");
}

function handleRowClick(row: HealthExpiryReminderItem): void {
  if (row.petId) emit("navigate", row.petId);
}

// 组件自持数据 ⇒ 挂载即取数（父页 `onActivated` 只在**非首次**激活时回调 `reload`，
// 若不自取则冷加载 `/pets` 时提醒条恒不渲染 —— keep-alive 首激活不触发父回调）。
onMounted(fetchReminders);

defineExpose({ reload: fetchReminders, loaded });
</script>

<style lang="scss" scoped>
.pet-health-reminder {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 14px;
  margin-bottom: 12px;
  background: var(--el-color-danger-light-9);
  border: 1px solid var(--el-color-danger-light-5);
  border-radius: var(--card-radius);

  &__head {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }

  &__title {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    font-size: 13px;
    font-weight: 600;
    color: var(--el-color-danger);
  }

  &__icon {
    font-size: 14px;
  }

  &__counts {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  &__list {
    min-height: 40px;
  }

  &__pet {
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  &__more {
    margin-top: 6px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }
}
</style>
