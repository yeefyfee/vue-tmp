<template>
  <div class="pet-weight">
    <div class="pet-weight__head">
      <span class="pet-weight__title">{{ t("pet.weight.title") }}</span>

      <div class="pet-weight__head-right">
        <el-tag
          v-if="alertCount > 0"
          type="danger"
          effect="light"
          size="small"
          data-testid="pet-weight-alert-count"
        >
          {{ t("pet.weight.alertCount", { count: alertCount }) }}
        </el-tag>
        <span v-if="latestKg" class="pet-weight__latest">
          {{ t("pet.weight.latest", { kg: latestKg }) }}
        </span>
        <el-button
          v-hasPerm="'pet:weight:create'"
          type="primary"
          size="small"
          data-testid="pet-weight-create-btn"
          @click="dialogVisible = true"
        >
          {{ t("pet.weight.createBtn") }}
        </el-button>
      </div>
    </div>

    <TableSkeleton v-if="loading && !loaded" :column-count="4" :row-count="4" />

    <DataState
      v-else-if="loadError"
      variant="error"
      :title="t('pet.weight.loadError')"
      :description="loadError"
      :action-text="t('pet.timeline.retry')"
      @action="reload"
    />

    <DataState
      v-else-if="points.length === 0"
      variant="empty"
      :title="t('pet.weight.empty')"
      :description="t('pet.weight.emptyDesc')"
    />

    <template v-else>
      <div class="pet-weight__chart" data-testid="pet-weight-chart">
        <ECharts :options="chartOptions" height="260px" />
      </div>

      <el-alert
        v-if="alertCount > 0"
        type="warning"
        :closable="false"
        show-icon
        class="pet-weight__alert"
        :title="t('pet.weight.alertHint')"
        data-testid="pet-weight-alert-hint"
      />

      <el-table :data="tableRows" size="small" class="pet-weight__table">
        <el-table-column
          :label="t('pet.weight.colDate')"
          prop="dateText"
          min-width="120"
          data-testid="pet-weight-col-date"
        />
        <el-table-column
          :label="t('pet.weight.colKg')"
          prop="kgText"
          min-width="100"
          data-testid="pet-weight-col-kg"
        >
          <template #default="{ row }">{{ row.kgText }} kg</template>
        </el-table-column>
        <el-table-column :label="t('pet.weight.colDelta')" min-width="150">
          <template #default="{ row }">
            <el-tag :type="row.deltaTagType" effect="plain" size="small">
              {{ t(row.deltaKey, row.deltaParams) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('table.actions')" width="90" align="right">
          <template #default="{ row }">
            <el-button
              v-hasPerm="'pet:weight:delete'"
              link
              type="danger"
              :data-testid="`pet-weight-delete-${row.id}`"
              @click="handleDelete(row as WeightRow)"
            >
              {{ t("pet.action.delete") }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </template>

    <PetWeightRecordDialog v-model="dialogVisible" :pet-id="petId" @saved="handleSaved" />
  </div>
</template>

<script setup lang="ts">
import { ElMessage, ElMessageBox } from "element-plus";

import PetAPI from "@/api/pet";
import type { WeightPoint } from "@/api/pet";
import DataState from "@/components/DataState/DataState.vue";
import TableSkeleton from "@/components/DataState/TableSkeleton.vue";
import ECharts from "@/components/ECharts/index.vue";
import { isApiError } from "@/utils/request";
import {
  formatWeightKg,
  isWeightDeltaAlert,
  toDayString,
  weightDeltaLabel,
  weightDeltaTagType,
} from "@/utils/pet";
import PetWeightRecordDialog from "./PetWeightRecordDialog.vue";

/**
 * 宠物档案 · 基本信息页签内的「体重曲线」区块（MVP-WEB-05-03 · FR-3）
 *
 * PRD《宠物管理》FR-3：「每次服务或入住称重记录，生成体重趋势图」⇒ 数据源
 * `GET /pets/:petId/weight-curve`（默认 `asc` 时间序列）；曲线以 ECharts 折线
 * 绘制，**环比异常点标红**，下方明细表可**记录 / 软删**体重。
 *
 * BR-4：「单次称重与上次记录差超过 15% 时，在下次服务前提示前台确认健康状态」
 * ⇒ 服务端在每点下发 `deltaAlert`（**唯一权威判据**），本组件以顶部 `el-tag` 计数 +
 * 警示条 + 打点标红 + 明细表 tag 着色**四处同源**呈现；录入对话框在 `deltaAlert` 为真
 * 时弹出强提示。（禁止表内改用本地阈值重算 —— 会把判据裂成两源：见 `weightDeltaTagType`）
 *
 * 边界：不新增路由（PRD《页面清单》只登记 `pets/:pet_id` 与 `pets/:pet_id/timeline`）
 * ⇒ 体重曲线作为档案页「基本信息」页签内的区块交付。
 */
defineOptions({ name: "PetWeightCurve", inheritAttrs: false });

const props = defineProps<{ petId: string }>();

const emit = defineEmits<{
  (e: "changed"): void;
}>();

const { t, te } = useI18n();

/** 明细表行：预计算派生列，避免模板内重复调用纯函数（也便于 el-table 的类型收窄） */
interface WeightRow extends WeightPoint {
  dateText: string;
  kgText: string;
  deltaKey: string;
  deltaParams: Record<string, number>;
  deltaTagType: "danger" | "info";
}

const points = ref<WeightPoint[]>([]);
const alertCount = ref(0);
const loading = ref(false);
const loaded = ref(false);
const loadError = ref("");
const dialogVisible = ref(false);

/** 明细表按**称重日倒序**（最新在上）展示；曲线仍按升序（时间序列）绘制 */
const tableRows = computed<WeightRow[]>(() =>
  [...points.value].reverse().map((point) => {
    const label = weightDeltaLabel(point.deltaPercent);
    return {
      ...point,
      dateText: toDayString(point.weighedAt),
      kgText: formatWeightKg(point.weightKg),
      deltaKey: label.key,
      deltaParams: label.params,
      deltaTagType: weightDeltaTagType(point.deltaAlert ?? point.deltaPercent),
    };
  })
);

/** 序列最新一点的体重（与后端「pet.weightKg 快照」同口径：按称重日取最新） */
const latestKg = computed(() => {
  const sorted = [...points.value].sort(
    (a, b) => new Date(a.weighedAt).getTime() - new Date(b.weighedAt).getTime()
  );
  const last = sorted[sorted.length - 1];
  return last ? formatWeightKg(last.weightKg) : "";
});

/**
 * 折线图配置（体重趋势 + 环比异常点标红）
 *
 * 颜色取 Element Plus 调色（`#409eff` 主色 / `#f56c6c` 危险色 / `#909399` 次要文字），
 * 明暗主题下对比度均达标，故不依赖 CSS 变量（ECharts 画布不解析 CSS var）。
 */
const chartOptions = computed(() => {
  const rows = points.value;
  const series = rows.map((point) => {
    // 与服务端 `deltaAlert` 同源，缺字段时回退本地阈值（避免图/表双源判据分裂）
    const alert = point.deltaAlert ?? isWeightDeltaAlert(point.deltaPercent);
    return {
      value: Number(point.weightKg),
      itemStyle: alert ? { color: "#f56c6c" } : undefined,
      symbolSize: alert ? 11 : 6,
    };
  });

  return {
    grid: { left: 54, right: 24, top: 28, bottom: 34 },
    tooltip: {
      trigger: "axis",
      formatter: (params: unknown) => {
        const list = Array.isArray(params) ? params : [params];
        const first = list[0] as { dataIndex?: number } | undefined;
        const index = first?.dataIndex ?? -1;
        const point = rows[index];
        if (!point) return "";
        const label = weightDeltaLabel(point.deltaPercent);
        const deltaText = te(label.key) ? t(label.key, label.params) : "";
        return [
          toDayString(point.weighedAt),
          `${t("pet.weight.colKg")}：${formatWeightKg(point.weightKg)} kg`,
          `${t("pet.weight.colDelta")}：${deltaText}`,
        ].join("<br/>");
      },
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: rows.map((point) => toDayString(point.weighedAt)),
      axisLabel: { fontSize: 11, color: "#909399" },
      axisLine: { lineStyle: { color: "rgba(144,147,153,0.35)" } },
    },
    yAxis: {
      type: "value",
      name: "kg",
      scale: true,
      axisLabel: { fontSize: 11, color: "#909399" },
      axisLine: { show: false },
      splitLine: { lineStyle: { color: "rgba(144,147,153,0.15)" } },
    },
    series: [
      {
        name: t("pet.weight.title"),
        type: "line",
        smooth: true,
        symbol: "circle",
        lineStyle: { width: 2, color: "#409eff" },
        itemStyle: { color: "#409eff" },
        areaStyle: { color: "rgba(64,158,255,0.1)" },
        data: series,
      },
    ],
  };
});

async function fetchCurve(): Promise<void> {
  loadError.value = "";
  loading.value = true;
  try {
    const data = await PetAPI.getWeightCurve(props.petId, { order: "asc", limit: 200 });
    points.value = data.points ?? [];
    alertCount.value = data.alertCount ?? 0;
  } catch (error) {
    loadError.value = isApiError(error) ? error.message : String(error ?? "");
    points.value = [];
    alertCount.value = 0;
  } finally {
    loading.value = false;
    loaded.value = true;
  }
}

function reload(): void {
  void fetchCurve();
}

/** 记录 / 软删成功后：重取曲线 + 通知父级刷新（档案头部与基础档案的体重快照会变） */
function handleSaved(): void {
  void fetchCurve();
  emit("changed");
}

async function handleDelete(row: WeightRow): Promise<void> {
  try {
    await ElMessageBox.confirm(
      t("pet.weight.deleteConfirm", { date: row.dateText, kg: row.kgText }),
      t("pet.weight.deleteTitle"),
      {
        type: "warning",
        confirmButtonText: t("pet.weight.deleteConfirmBtn"),
        cancelButtonText: t("pet.form.cancel"),
        confirmButtonClass: "el-button--danger",
      }
    );
  } catch {
    return;
  }

  try {
    await PetAPI.deleteWeight(props.petId, row.id);
    ElMessage.success(t("pet.weight.deleteSuccess"));
    await fetchCurve();
    emit("changed");
  } catch (error) {
    ElMessage.error(isApiError(error) ? error.message : String(error ?? ""));
  }
}

watch(
  () => props.petId,
  () => {
    void fetchCurve();
  },
  { immediate: true }
);

defineExpose({ reload });
</script>

<style lang="scss" scoped>
.pet-weight {
  display: flex;
  flex-direction: column;
  gap: 10px;

  &__head {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: baseline;
    justify-content: space-between;
  }

  &__title {
    font-size: 14px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  &__head-right {
    display: flex;
    gap: 10px;
    align-items: center;
  }

  &__latest {
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }

  &__chart {
    width: 100%;
  }

  &__alert {
    :deep(.el-alert__title) {
      font-size: 12px;
      line-height: 1.6;
    }
  }

  &__table {
    width: 100%;
  }
}
</style>
