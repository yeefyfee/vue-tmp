<template>
  <div class="pet-health">
    <!-- 疫苗 / 驱虫有效性（PRD BR-1「入住前校验疫苗在有效期内」的读侧呈现） -->
    <div class="pet-health__section">
      <div class="pet-health__section-title">{{ t("pet.health.summaryTitle") }}</div>

      <div class="pet-health__cards">
        <div
          v-for="item in validityItems"
          :key="item.recordType"
          class="pet-health__card"
          :class="`is-${item.state}`"
        >
          <div class="pet-health__card-head">
            <span class="pet-health__card-name">{{ item.recordName }}</span>
            <el-tag :type="item.tagType" effect="plain" size="small">{{ item.tagText }}</el-tag>
          </div>
          <div class="pet-health__card-body">
            <span v-if="item.state === 'none'" class="pet-health__card-desc">
              {{ t("pet.health.noRecord") }}
            </span>
            <template v-else>
              <span class="pet-health__card-desc">
                {{ t("pet.health.recordDate") }}：{{ item.recordDate ?? "-" }}
              </span>
              <span class="pet-health__card-desc">
                {{ t("pet.health.recordExpire") }}：{{ item.expireDate ?? "-" }}
              </span>
              <span class="pet-health__card-days">{{ item.daysText }}</span>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- 过敏源 / 长期用药 摘要（PRD《Web端 · 页面功能》健康页签点名的 4 类之二） -->
    <div class="pet-health__section">
      <div class="pet-health__section-title">{{ t("pet.health.profileTitle") }}</div>

      <div class="pet-health__cards">
        <div
          v-for="card in profileCards"
          :key="card.key"
          class="pet-health__card"
          :class="{ 'is-expired': card.highlight }"
          :data-testid="card.testid"
        >
          <div class="pet-health__card-head">
            <span class="pet-health__card-name">{{ t(card.titleKey) }}</span>
            <el-tag :type="card.count > 0 ? 'danger' : 'info'" effect="plain" size="small">
              {{ t("pet.health.profileCount", { count: card.count }) }}
            </el-tag>
          </div>
          <div class="pet-health__card-body">
            <span v-if="card.count === 0" class="pet-health__card-desc">
              {{ t("pet.health.profileEmpty") }}
            </span>
            <template v-else>
              <span v-for="(line, idx) in card.lines" :key="idx" class="pet-health__card-desc">
                · {{ line }}
              </span>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- 健康记录（读写：建档 / 更正 / 软删，MVP-WEB-05-02） -->
    <div class="pet-health__section">
      <div class="pet-health__section-head">
        <span class="pet-health__section-title">{{ t("pet.health.recordsTitle") }}</span>
        <div class="pet-health__actions">
          <el-select
            v-model="recordType"
            class="pet-health__filter"
            clearable
            size="small"
            :placeholder="t('pet.health.allTypes')"
            @change="handleFilterChange"
          >
            <el-option
              v-for="type in HEALTH_RECORD_TYPES"
              :key="type"
              :label="t(healthRecordTypeLabelKey(type))"
              :value="type"
            />
          </el-select>
          <el-button
            v-hasPerm="'pet:health:create'"
            type="primary"
            size="small"
            data-testid="pet-health-create-btn"
            @click="openCreate"
          >
            {{ t("pet.health.createBtn") }}
          </el-button>
        </div>
      </div>

      <el-alert
        v-if="loadError && records.length > 0"
        type="warning"
        :closable="false"
        show-icon
        class="pet-health__note"
        :title="loadError"
      />

      <TableSkeleton v-if="loading && !loaded" :column-count="6" :row-count="4" />

      <DataState
        v-else-if="loadError && records.length === 0"
        variant="error"
        :title="t('pet.health.loadError')"
        :description="loadError"
        :action-text="t('pet.timeline.retry')"
        @action="fetchAll"
      />

      <DataState
        v-else-if="records.length === 0"
        :variant="isFiltered ? 'filtered' : 'empty'"
        :title="isFiltered ? t('pet.health.recordsFiltered') : t('pet.health.recordsEmpty')"
      />

      <template v-else>
        <el-table v-loading="loading" :data="tableRows" size="small" border>
          <el-table-column :label="t('pet.health.recordType')" width="100" align="center">
            <template #default="{ row }">
              <el-tag effect="plain" size="small">
                {{ t(healthRecordTypeLabelKey(row.recordType)) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column
            :label="t('pet.health.recordDate')"
            prop="recordDate"
            width="120"
            align="center"
          >
            <template #default="{ row }">{{ row.recordDate?.slice(0, 10) ?? "-" }}</template>
          </el-table-column>
          <el-table-column
            :label="t('pet.health.recordExpire')"
            prop="expireDate"
            width="120"
            align="center"
          >
            <template #default="{ row }">{{ row.expireDate?.slice(0, 10) ?? "-" }}</template>
          </el-table-column>
          <!-- 到期倒计时（PRD 健康页签「疫苗记录含下次到期日倒计时」） -->
          <el-table-column :label="t('pet.health.countdown')" width="130" align="center">
            <template #default="{ row }">
              <el-tag
                v-if="row.countdown"
                :type="row.countdown.tagType"
                effect="plain"
                size="small"
              >
                {{ t(row.countdown.key, row.countdown.params) }}
              </el-tag>
              <span v-else class="pet-health__muted">-</span>
            </template>
          </el-table-column>
          <el-table-column :label="t('pet.health.recordContent')" prop="content" min-width="200">
            <template #default="{ row }">{{ row.content || "-" }}</template>
          </el-table-column>
          <el-table-column :label="t('table.actions')" width="130" align="center" fixed="right">
            <template #default="{ row }">
              <el-button
                v-hasPerm="'pet:health:update'"
                link
                type="primary"
                size="small"
                :data-testid="`pet-health-edit-${row.id}`"
                @click="openEdit(row as HealthRecordItem)"
              >
                {{ t("pet.health.correctBtn") }}
              </el-button>
              <el-button
                v-hasPerm="'pet:health:delete'"
                link
                type="danger"
                size="small"
                :data-testid="`pet-health-delete-${row.id}`"
                @click="handleDelete(row as HealthRecordItem)"
              >
                {{ t("pet.action.delete") }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>

        <pagination
          v-if="total > 0"
          v-model:total="total"
          v-model:page="pageNum"
          v-model:limit="pageSize"
          class="pet-health__pagination"
          @pagination="fetchRecords"
        />
      </template>
    </div>

    <PetHealthRecordDialog
      v-model="dialogVisible"
      :pet-id="petId"
      :record="editingRecord"
      @saved="handleSaved"
    />
  </div>
</template>

<script setup lang="ts">
import { ElMessage, ElMessageBox } from "element-plus";

import PetAPI, { HEALTH_RECORD_TYPES } from "@/api/pet";
import type { HealthRecordItem, HealthValidityResult } from "@/api/pet";
import DataState from "@/components/DataState/DataState.vue";
import TableSkeleton from "@/components/DataState/TableSkeleton.vue";
import { HealthRecordType } from "@/enums";
import { isApiError } from "@/utils/request";
import {
  daysLeftFromExpire,
  healthDaysLeftLabel,
  healthExpiryLevel,
  healthExpiryLevelTagType,
  healthRecordTypeLabelKey,
  isExpiringSoon,
} from "@/utils/pet";
import PetHealthRecordDialog from "./PetHealthRecordDialog.vue";

/**
 * 宠物档案 · 健康页签（MVP-WEB-05-01 只读 → **05-02 升级为可写完整健康档案**）
 *
 * 三块内容：
 *  ① 疫苗 / 驱虫有效性（数据由父页面 `GET /pets/:petId/health/validity` 拉取后下发，
 *     因为档案头部预警条也要用它，避免重复请求）；14 天内到期 / 已过期按 PRD
 *     《Web端 · 页面功能》「疫苗到期低于 14 天自动红色预警」着色；
 *  ② **过敏源 / 长期用药** 摘要卡（PRD 健康页签点名的 4 类之二；各自取
 *     `recordType=3` / `recordType=4` 的最近 5 条，独立小请求，不拖累主列表）；
 *  ③ 健康记录列表（读写）：建档 `POST` / 更正 `PUT`（`version` 乐观锁）/ 软删
 *     `DELETE`；新增「到期倒计时」列（PRD「疫苗记录含下次到期日倒计时」）。
 *
 * 边界（不越界）：`review_status`（宠主端上传默认 `pending`、前台确认后生效）——
 * PRD《宠物管理》健康记录字段全表有该列，但**库内无列**且宠主端（Mobile）未建，
 * 本期 Web 端无「待审核」数据来源 ⇒ **不渲染审核入口**（记为边界，见飞书备注）。
 */
defineOptions({ name: "PetHealthTab", inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    petId: string;
    /** 有效性判定（父页面下发；`null` = 尚未就绪） */
    validity?: HealthValidityResult | null;
  }>(),
  { validity: null }
);

const emit = defineEmits<{
  (e: "changed"): void;
}>();

const { t } = useI18n();

// ── 有效性卡片渲染 ──────────────────────────────────────────────────────
type ValidityState = "valid" | "warning" | "expired" | "none";

const validityItems = computed(() =>
  (props.validity?.items ?? []).map((item) => {
    let state: ValidityState;
    let tagType: "success" | "warning" | "danger" | "info";
    let tagText: string;
    if (!item.hasRecord) {
      state = "none";
      tagType = "info";
      tagText = t("pet.health.noRecord");
    } else if (!item.valid) {
      state = "expired";
      tagType = "danger";
      tagText = t("pet.health.invalid");
    } else if (isExpiringSoon(item.daysLeft)) {
      state = "warning";
      tagType = "warning";
      tagText = t("pet.health.valid");
    } else {
      state = "valid";
      tagType = "success";
      tagText = t("pet.health.valid");
    }

    let daysText = "";
    if (item.hasRecord && item.daysLeft !== null) {
      daysText =
        item.daysLeft >= 0
          ? t("pet.health.daysLeft", { days: item.daysLeft })
          : t("pet.health.expiredDays", { days: Math.abs(item.daysLeft) });
    }

    return {
      recordType: item.recordType,
      recordName: item.recordName,
      recordDate: item.recordDate ? String(item.recordDate).slice(0, 10) : null,
      expireDate: item.expireDate ? String(item.expireDate).slice(0, 10) : null,
      state,
      tagType,
      tagText,
      daysText,
    };
  })
);

// ── 过敏源 / 长期用药 摘要 ──────────────────────────────────────────────
const SUMMARY_SIZE = 5;
const allergyRecords = ref<HealthRecordItem[]>([]);
const medicationRecords = ref<HealthRecordItem[]>([]);

/** 摘要卡正文：取最近若干条的内容摘要（空内容不进列表，避免渲染空行） */
function summaryLines(list: HealthRecordItem[]): string[] {
  return list
    .map((record) => (record.content ?? "").trim())
    .filter((text) => text.length > 0)
    .slice(0, 3);
}

const profileCards = computed(() => [
  {
    key: "allergy",
    titleKey: "pet.healthRecordTypeValue.allergy",
    testid: "pet-health-allergy-card",
    count: allergyRecords.value.length,
    highlight: false,
    lines: summaryLines(allergyRecords.value),
  },
  {
    key: "medication",
    titleKey: "pet.healthRecordTypeValue.medication",
    testid: "pet-health-medication-card",
    count: medicationRecords.value.length,
    highlight: false,
    lines: summaryLines(medicationRecords.value),
  },
]);

async function fetchProfileSummaries(): Promise<void> {
  const [allergy, medication] = await Promise.all([
    PetAPI.getHealthRecords(props.petId, {
      recordType: HealthRecordType.ALLERGY,
      pageNum: 1,
      pageSize: SUMMARY_SIZE,
    }).catch(() => null),
    PetAPI.getHealthRecords(props.petId, {
      recordType: HealthRecordType.MEDICATION,
      pageNum: 1,
      pageSize: SUMMARY_SIZE,
    }).catch(() => null),
  ]);
  allergyRecords.value = allergy?.list ?? [];
  medicationRecords.value = medication?.list ?? [];
}

// ── 健康记录列表 ────────────────────────────────────────────────────────
const records = ref<HealthRecordItem[]>([]);
const total = ref(0);
const pageNum = ref(1);
const pageSize = ref(10);
const recordType = ref<number | undefined>(undefined);

const loading = ref(false);
const loaded = ref(false);
const loadError = ref("");

const isFiltered = computed(() => recordType.value !== undefined);

async function fetchRecords(): Promise<void> {
  loadError.value = "";
  loading.value = true;
  try {
    const data = await PetAPI.getHealthRecords(props.petId, {
      pageNum: pageNum.value,
      pageSize: pageSize.value,
      recordType: recordType.value,
    });
    records.value = data.list ?? [];
    total.value = data.total ?? 0;
  } catch (error) {
    loadError.value = isApiError(error) ? error.message : String(error ?? "");
    records.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
    loaded.value = true;
  }
}

function fetchAll(): void {
  void fetchRecords();
  void fetchProfileSummaries();
}

/**
 * 到期倒计时（仅对疫苗/驱虫等有到期日的行渲染；无到期日的行回落 `-`）
 *
 * 服务端只在 `validity` 与到期提醒端点下发 `daysLeft`，全量记录列表不携带该派生列
 * ⇒ 前端按「到期日 − 本地日历日」自行推导（`daysLeftFromExpire` 与后端同口径）。
 *
 * 以**行模型预计算**而非模板内调用函数：`el-table` 插槽的 `row` 是 `DefaultRow`，
 * 模板内多次调用会在 TS 收窄上失败（`Object is possibly null`），且重复计算。
 */
type Countdown = {
  key: string;
  params: Record<string, number>;
  tagType: "danger" | "warning" | "info";
} | null;

type HealthRecordRow = HealthRecordItem & { countdown: Countdown };

function countdownOf(row: HealthRecordItem): Countdown {
  const daysLeft = daysLeftFromExpire(row.expireDate);
  if (daysLeft === null) return null;
  const label = healthDaysLeftLabel(daysLeft);
  return {
    key: label.key,
    params: label.params,
    tagType: healthExpiryLevelTagType(healthExpiryLevel(daysLeft)),
  };
}

const tableRows = computed<HealthRecordRow[]>(() =>
  records.value.map((record) => ({ ...record, countdown: countdownOf(record) }))
);

function handleFilterChange(): void {
  pageNum.value = 1;
  void fetchRecords();
}

// ── 写路径：建档 / 更正 / 软删 ──────────────────────────────────────────
const dialogVisible = ref(false);
const editingRecord = ref<HealthRecordItem | null>(null);

function openCreate(): void {
  editingRecord.value = null;
  dialogVisible.value = true;
}

function openEdit(row: HealthRecordItem): void {
  editingRecord.value = row;
  dialogVisible.value = true;
}

function handleSaved(): void {
  fetchAll();
  emit("changed");
}

/**
 * 软删：**强确认**（PRD《Web规范》§三态纪律 + 04-02 既有范式 —— 破坏性动作必须
 * 二次确认并写明后果）。健康档案在临床语义上 append-only ⇒ 文案强调「删除后不可
 * 从界面恢复，仅保留数据库痕迹」，引导优先使用「更正」。
 */
async function handleDelete(row: HealthRecordItem): Promise<void> {
  const typeName = t(healthRecordTypeLabelKey(row.recordType));
  try {
    await ElMessageBox.confirm(
      t("pet.health.deleteConfirm", { type: typeName, date: row.recordDate?.slice(0, 10) ?? "-" }),
      t("pet.health.deleteTitle"),
      {
        type: "warning",
        confirmButtonText: t("pet.health.deleteConfirmBtn"),
        cancelButtonText: t("pet.form.cancel"),
        confirmButtonClass: "el-button--danger",
      }
    );
  } catch {
    return;
  }

  try {
    await PetAPI.deleteHealthRecord(props.petId, row.id);
    ElMessage.success(t("pet.health.deleteSuccess"));
    // 当前页删空后回退一页，避免停在空白页
    if (records.value.length === 1 && pageNum.value > 1) pageNum.value -= 1;
    fetchAll();
    emit("changed");
  } catch (error) {
    ElMessage.error(isApiError(error) ? error.message : String(error ?? ""));
  }
}

watch(
  () => props.petId,
  () => {
    pageNum.value = 1;
    fetchAll();
  },
  { immediate: true }
);

defineExpose({ reload: fetchAll });
</script>

<style lang="scss" scoped>
.pet-health {
  display: flex;
  flex-direction: column;
  gap: 20px;

  &__section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  &__section-head {
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
  }

  &__actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  &__section-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  &__cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 12px;
  }

  &__card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 14px;
    border: 1px solid var(--card-border);
    border-radius: var(--card-radius);

    &.is-warning {
      background: var(--el-color-warning-light-9);
      border-color: var(--el-color-warning-light-5);
    }

    &.is-expired {
      background: var(--el-color-danger-light-9);
      border-color: var(--el-color-danger-light-5);
    }
  }

  &__card-head {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
  }

  &__card-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  &__card-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  &__card-desc {
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 12px;
    color: var(--el-text-color-secondary);
    white-space: nowrap;
  }

  &__card-days {
    margin-top: 2px;
    font-size: 12px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  &__filter {
    width: 160px;
  }

  &__muted {
    color: var(--el-text-color-placeholder);
  }

  &__note {
    :deep(.el-alert__title) {
      font-size: 12px;
      line-height: 1.6;
    }
  }

  &__pagination {
    margin-top: 4px;
  }
}
</style>
