<template>
  <div class="page-container">
    <!-- 门店上下文条：日历归属「当前门店」，故先固定上下文再查看 -->
    <el-card class="page-search" shadow="never">
      <div class="store-calendar__bar">
        <div class="store-calendar__bar-left">
          <span class="store-calendar__bar-label">{{ t("storeCalendar.picker.label") }}</span>
          <el-tag v-if="currentStore" size="large" effect="plain" type="primary">
            {{ currentStore.name }}
          </el-tag>
          <span v-else class="store-calendar__bar-empty">
            {{ t("storeCalendar.picker.placeholder") }}
          </span>
        </div>

        <div class="store-calendar__bar-right">
          <el-tag v-if="storeId && !canUpdate" type="info" effect="plain">
            {{ t("storeCalendar.readonlyTip") }}
          </el-tag>
          <el-button :disabled="!storeId" :loading="loading" @click="reload">
            {{ t("storeCalendar.reload") }}
          </el-button>
          <el-dropdown
            v-if="isMultiStore"
            trigger="click"
            :disabled="switching"
            @command="handleSwitchStore"
          >
            <el-button :disabled="!storeId">
              {{ t("storeCalendar.picker.switch") }}
              <el-icon class="el-icon--right"><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item
                  v-for="item in organizations"
                  :key="item.id"
                  :command="item.id"
                  :disabled="item.id === storeId"
                >
                  {{ item.name }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <span v-else-if="storeId" class="store-calendar__bar-tip">
            {{ t("storeCalendar.picker.singleTip") }}
          </span>
        </div>
      </div>
    </el-card>

    <el-card class="page-content" shadow="never">
      <!-- 未选定门店：区分「账号下无门店」与「有门店但未选择」两种空态 -->
      <DataState
        v-if="!storeId"
        class="store-calendar__state"
        variant="empty"
        :title="emptyState.title"
        :description="emptyState.description"
      />

      <!-- 加载失败：给出可读原因 + 重试入口（PRD《交互规范》§操作反馈 1） -->
      <DataState
        v-else-if="loadError"
        class="store-calendar__state"
        variant="error"
        :title="t('storeCalendar.loadError.title')"
        :description="t('storeCalendar.loadError.desc')"
        :action-text="t('storeCalendar.loadError.retry')"
        @action="reload"
      />

      <!-- 骨架屏：形状对齐「月历 + 例外列表」真实结构 -->
      <div v-else-if="loading" class="store-calendar__skeleton" aria-busy="true">
        <div class="store-calendar__skeleton-grid">
          <span v-for="cell in 35" :key="cell" class="store-calendar__skeleton-cell" />
        </div>
        <div v-for="row in 3" :key="`r${row}`" class="store-calendar__skeleton-row">
          <span class="store-calendar__skeleton-bar" />
        </div>
      </div>

      <template v-else>
        <!-- 月份导航 + 主操作 -->
        <div class="store-calendar__head">
          <div class="store-calendar__toolbar">
            <div class="store-calendar__toolbar-left">
              <el-button-group>
                <el-button :aria-label="t('storeCalendar.month.prev')" @click="shiftBy(-1)">
                  <el-icon><ArrowLeft /></el-icon>
                </el-button>
                <el-button :aria-label="t('storeCalendar.month.next')" @click="shiftBy(1)">
                  <el-icon><ArrowRight /></el-icon>
                </el-button>
              </el-button-group>
              <span class="store-calendar__month-label">{{ monthLabel }}</span>
              <el-button @click="goCurrentMonth">{{ t("storeCalendar.month.current") }}</el-button>
            </div>

            <div class="store-calendar__toolbar-right">
              <el-tag type="info" effect="plain">
                {{ t("storeCalendar.summary", { count: entries.length }) }}
              </el-tag>
              <el-button
                v-hasPerm="'store:update'"
                type="primary"
                @click="openCreate(selectedDate || todayDate)"
              >
                {{ t("storeCalendar.action.create") }}
              </el-button>
            </div>
          </div>

          <!-- 图例：例外日以左侧色条区分 -->
          <div class="store-calendar__legend">
            <span class="store-calendar__legend-title">{{ t("storeCalendar.legend.title") }}</span>
            <span
              v-for="type in CALENDAR_ENTRY_TYPES"
              :key="type"
              class="store-calendar__legend-item"
            >
              <i class="store-calendar__legend-dot" :class="`is-${type}`" />
              {{ t(CALENDAR_TYPE_META[type].i18nKey) }}
            </span>
            <span class="store-calendar__legend-item is-tip">
              <i class="store-calendar__legend-dot is-exception" />
              {{ t("storeCalendar.legend.exception") }}
            </span>
          </div>
        </div>

        <div class="store-calendar__scroll">
          <h3 class="store-calendar__section-title">
            {{ t("storeCalendar.grid.title") }}
            <span class="store-calendar__section-tip">{{ t("storeCalendar.grid.tip") }}</span>
          </h3>

          <MonthCalendar
            class="store-calendar__grid"
            :cells="cells"
            :view-by-date="viewByDate"
            :entry-by-date="entryByDate"
            :selected-date="selectedDate"
            @select="handleSelectDay"
          />

          <h3 class="store-calendar__section-title">{{ t("storeCalendar.list.title") }}</h3>

          <el-table
            class="store-calendar__table"
            :data="entries"
            :empty-text="t('storeCalendar.list.empty')"
            border
          >
            <el-table-column
              prop="date"
              :label="t('storeCalendar.list.column.date')"
              min-width="130"
            >
              <template #default="{ row }">{{ entryDateKey(row as StoreCalendarEntry) }}</template>
            </el-table-column>
            <el-table-column
              prop="type"
              :label="t('storeCalendar.list.column.type')"
              min-width="120"
            >
              <template #default="{ row }">
                <el-tag
                  size="small"
                  :type="
                    CALENDAR_TYPE_META[normalizeType((row as StoreCalendarEntry).type)].tagType
                  "
                >
                  {{
                    t(CALENDAR_TYPE_META[normalizeType((row as StoreCalendarEntry).type)].i18nKey)
                  }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column
              prop="periods"
              :label="t('storeCalendar.list.column.periods')"
              min-width="150"
            >
              <template #default="{ row }">
                {{
                  periodsSummary(rowPeriods(row as StoreCalendarEntry)) ||
                  t("storeCalendar.list.noPeriods")
                }}
              </template>
            </el-table-column>
            <el-table-column
              prop="remark"
              :label="t('storeCalendar.list.column.remark')"
              min-width="180"
              show-overflow-tooltip
            >
              <template #default="{ row }">
                {{ (row as StoreCalendarEntry).remark || t("storeCalendar.list.noRemark") }}
              </template>
            </el-table-column>
            <el-table-column
              prop="createdAt"
              :label="t('storeCalendar.list.column.createdAt')"
              min-width="150"
            >
              <template #default="{ row }">
                {{ formatTime((row as StoreCalendarEntry).createdAt) }}
              </template>
            </el-table-column>
            <el-table-column
              :label="t('storeCalendar.list.column.action')"
              width="150"
              fixed="right"
            >
              <template #default="{ row }">
                <el-button
                  link
                  type="primary"
                  @click="openDay(entryDateKey(row as StoreCalendarEntry))"
                >
                  {{ t("storeCalendar.list.view") }}
                </el-button>
                <el-button
                  v-hasPerm="'store:update'"
                  link
                  type="danger"
                  @click="handleDelete(row as StoreCalendarEntry)"
                >
                  {{ t("storeCalendar.action.delete") }}
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </template>
    </el-card>

    <!-- 当日详情抽屉：展示该日营业状态 + 例外设置，并给出增删入口 -->
    <el-drawer
      v-model="dayDrawerVisible"
      :title="t('storeCalendar.day.title')"
      size="420px"
      append-to-body
    >
      <div v-if="selectedDay" class="day-panel">
        <div class="day-panel__date">{{ selectedDay.date }}</div>
        <el-tag :type="selectedDayDisplay.tagType" effect="plain">
          {{ t(selectedDayDisplay.statusKey) }}
        </el-tag>

        <el-descriptions class="day-panel__desc" :column="1" border>
          <el-descriptions-item :label="t('storeCalendar.day.sourceLabel')">
            {{ t(`storeCalendar.day.source.${selectedDay.source}`) }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('storeCalendar.day.periods')">
            {{ periodsSummary(selectedDay.periods) || t("storeCalendar.status.noPeriods") }}
          </el-descriptions-item>
          <template v-if="selectedEntry">
            <el-descriptions-item :label="t('storeCalendar.day.type')">
              <el-tag size="small" :type="CALENDAR_TYPE_META[selectedType].tagType">
                {{ t(CALENDAR_TYPE_META[selectedType].i18nKey) }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item :label="t('storeCalendar.day.remark')">
              {{ selectedEntry.remark || t("storeCalendar.list.noRemark") }}
            </el-descriptions-item>
            <el-descriptions-item :label="t('storeCalendar.day.createdAt')">
              {{ formatTime(selectedEntry.createdAt) }}
            </el-descriptions-item>
          </template>
        </el-descriptions>

        <el-alert
          v-if="!selectedEntry"
          class="day-panel__alert"
          type="info"
          :closable="false"
          show-icon
          :title="t('storeCalendar.day.noException')"
        />

        <div class="day-panel__actions">
          <el-button
            v-if="selectedEntry"
            v-hasPerm="'store:update'"
            type="danger"
            @click="handleDelete(selectedEntry)"
          >
            {{ t("storeCalendar.action.delete") }}
          </el-button>
          <el-button
            v-else
            v-hasPerm="'store:update'"
            type="primary"
            @click="openCreate(selectedDay.date)"
          >
            {{ t("storeCalendar.action.create") }}
          </el-button>
        </div>
      </div>
    </el-drawer>

    <CalendarEntryDialog
      v-model:visible="dialogVisible"
      :store-id="storeId"
      :default-date="dialogDate"
      @success="reload"
    />
  </div>
</template>

<script setup lang="ts">
import { ArrowDown, ArrowLeft, ArrowRight } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";

import StoreAPI from "@/api/store";
import type { CalendarViewDay, StoreCalendarEntry } from "@/api/store";
import DataState from "@/components/DataState/DataState.vue";
import { useStoreContextStore } from "@/stores";
import { hasPerm } from "@/utils/auth";
import { formatTableDateTime } from "@/utils/format";
import {
  CALENDAR_ENTRY_TYPES,
  CALENDAR_TYPE_META,
  buildMonthGrid,
  currentMonth,
  entriesByDate,
  entryDateKey,
  isValidMonth,
  parseMonth,
  periodsSummary,
  resolveDayDisplay,
  shiftMonth,
  todayLocalDate,
  viewDaysByDate,
} from "@/utils/store-calendar";
import MonthCalendar from "./components/MonthCalendar.vue";
import CalendarEntryDialog from "./components/CalendarEntryDialog.vue";

/**
 * 门店日历页（MVP-WEB-02-04 · 后端 P0-04-04 FR-3 日历部分 / P0-04-07 FR-6 聚合）
 *
 * 页面承载两类信息（均需先确定「当前门店」）：
 *  ① **整月逐日营业视图**：`GET /stores/:id/calendar-view?month=yyyy-MM`
 *     —— 周时段 + 日历例外聚合，**例外日优先**（type1/2 闭店、type3 特殊时段）；
 *  ② **日期级例外日历 CRUD**：`POST / GET / DELETE /stores/:id/calendar`
 *     —— 同店同日唯一（重复报 `A0438`），删除为软删（不存在报 `A0439`）。
 *
 * 关键口径：
 *  · 门店上下文**复用全局**（01-03 顶部切换器）——切换门店重签 token 并整页重载；
 *  · 本页**无整存整取与底部保存条**：例外日是「逐日即时提交」的 CRUD，
 *    故与 02-03 门店配置页分离为独立页（交互模型不同）；
 *  · 删除遵循 PRD《交互规范》§确认与撤销 1：**强确认**（输入例外日期才可执行），
 *    文案写明影响范围（该日恢复按每周营业时段计算）；
 *  · 只读账号（无 `store:update`）隐藏新增/删除入口（PRD：隐藏优于报错）；
 *  · `?month=` 与 `?date=` 双向同步，直链可还原。
 */
defineOptions({ name: "StoreCalendar" });

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const storeContext = useStoreContextStore();
const { activeStoreId, organizations, switching, isMultiStore } = storeToRefs(storeContext);

const storeId = computed(() => activeStoreId.value);

const currentStore = computed(
  () => organizations.value.find((item) => item.id === storeId.value) ?? null
);

const canUpdate = computed(() => hasPerm("store:update"));

const loading = ref(false);
const loadError = ref(false);

/** 查询月份（`yyyy-MM`；地址栏 `?month=` 优先，非法则回落本月） */
const month = ref<string>(resolveInitialMonth());

/** 逐日视图（月历主数据源） */
const days = ref<CalendarViewDay[]>([]);
/** 当月例外日列表（提供 entryId / 备注 / 创建时间） */
const entries = ref<StoreCalendarEntry[]>([]);

/** 当前选中日期（`yyyy-MM-dd`；空串表示未选中） */
const selectedDate = ref<string>(resolveInitialDate());

const dayDrawerVisible = ref(false);
const dialogVisible = ref(false);
const dialogDate = ref("");

const todayDate = todayLocalDate();

/** 已成功加载过的「门店 + 月份」组合（避免 watch 与 onMounted 重复拉取） */
const loadedKey = ref("");

/** 未选门店时的空态文案：区分「无门店可管」与「有门店但未选择」 */
const emptyState = computed(() =>
  organizations.value.length === 0
    ? {
        title: t("storeCalendar.picker.emptyOrgTitle"),
        description: t("storeCalendar.picker.emptyOrgDesc"),
      }
    : {
        title: t("storeCalendar.picker.noStoreTitle"),
        description: t("storeCalendar.picker.noStoreDesc"),
      }
);

/** 月历网格（周一为首列，含前后补位） */
const cells = computed(() => buildMonthGrid(month.value));

const viewByDate = computed(() => viewDaysByDate(days.value));
const entryByDate = computed(() => entriesByDate(entries.value));

/** 月份标题（如「2026 年 10 月」） */
const monthLabel = computed(() => {
  const parsed = parseMonth(month.value);
  if (!parsed) return month.value;
  return t("storeCalendar.month.label", { year: parsed.year, month: parsed.monthIndex + 1 });
});

/** 抽屉里展示的当日视图条目 */
const selectedDay = computed(() => viewByDate.value[selectedDate.value]);
const selectedDayDisplay = computed(() => resolveDayDisplay(selectedDay.value));
const selectedEntry = computed(() => entryByDate.value[selectedDate.value] ?? null);

/** 例外类型收敛到 1/2/3（后端契约保证，此处仅为索引安全） */
function normalizeType(type: unknown): 1 | 2 | 3 {
  const value = Number(type);
  return value === 2 ? 2 : value === 3 ? 3 : 1;
}

/** 列表项的类型（已收敛） */
const selectedType = computed(() => normalizeType(selectedEntry.value?.type));

/** 例外日的时段数组（仅 type=3 有值） */
function rowPeriods(row: StoreCalendarEntry): [string, string][] {
  if (normalizeType(row.type) !== 3) return [];
  if (!row.openTime || !row.closeTime) return [];
  return [[row.openTime, row.closeTime]];
}

/** 时间列展示（三天内相对表达，超出恒 `YYYY-MM-DD HH:mm`） */
function formatTime(value: string | null): string {
  if (!value) return t("storeCalendar.list.noRemark");
  return formatTableDateTime(value, {
    today: t("time.today"),
    yesterday: t("time.yesterday"),
    beforeYesterday: t("time.beforeYesterday"),
  });
}

function resolveInitialMonth(): string {
  const raw = route.query.month;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && isValidMonth(value) ? value : currentMonth();
}

function resolveInitialDate(): string {
  const raw = route.query.date;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

/**
 * 拉取当前门店 + 当前月份的日历数据
 *
 * 两接口并行：`calendar-view` 是月历主数据源，`calendar` 列表补足 entryId / 备注 /
 * 创建时间（视图接口刻意不返回这些，见 `types.ts` 说明）。
 */
async function loadAll(force = false): Promise<void> {
  const id = storeId.value;
  if (!id) return;
  const key = `${id}::${month.value}`;
  if (!force && loadedKey.value === key) return;

  loading.value = true;
  loadError.value = false;
  try {
    const [viewResult, listResult] = await Promise.all([
      StoreAPI.getCalendarView(id, month.value),
      StoreAPI.listCalendarEntries(id, month.value),
    ]);
    days.value = viewResult.days ?? [];
    entries.value = listResult.items ?? [];
    loadedKey.value = key;
  } catch {
    // 具体错误文案由请求层统一渲染；此处只切换到错误态给出重试入口
    loadError.value = true;
  } finally {
    loading.value = false;
  }
}

/** 强制重载（月份切换 / 增删后调用） */
async function reload(): Promise<void> {
  await loadAll(true);
}

/** 月份切换（`?month=` 同步由 watch(month) 负责） */
function shiftBy(delta: number): void {
  month.value = shiftMonth(month.value, delta);
  // 切换月份后清空选中日（原选中日可能不在新月份）
  selectedDate.value = "";
}

function goCurrentMonth(): void {
  month.value = currentMonth();
  selectedDate.value = "";
}

/** 点击某日 → 打开当日详情抽屉 */
function handleSelectDay(date: string): void {
  selectedDate.value = date;
  dayDrawerVisible.value = true;
}

/** 从例外列表「查看」进入（并同步选中日） */
function openDay(date: string): void {
  selectedDate.value = date;
  dayDrawerVisible.value = true;
}

function openCreate(date: string): void {
  dialogDate.value = date || todayDate;
  dialogVisible.value = true;
}

/**
 * 删除例外日（强确认：输入该例外日期才可执行）
 *
 * PRD《交互规范》：退款与删除类操作为强确认，且文案必须写明影响范围与对象数量。
 */
async function handleDelete(row: StoreCalendarEntry): Promise<void> {
  const date = entryDateKey(row);
  const storeName = currentStore.value?.name ?? "";
  const typeLabel = t(CALENDAR_TYPE_META[normalizeType(row.type)].i18nKey);

  try {
    const { value } = await ElMessageBox.prompt(
      t("storeCalendar.delete.confirmText", { store: storeName, date, type: typeLabel }),
      t("storeCalendar.delete.title"),
      {
        confirmButtonText: t("storeCalendar.action.delete"),
        cancelButtonText: t("storeCalendar.action.cancel"),
        inputPlaceholder: t("storeCalendar.delete.inputPlaceholder"),
        inputValidator: (input: string) => String(input ?? "").trim() === date,
        inputErrorMessage: t("storeCalendar.delete.mismatch"),
        type: "warning",
      }
    );
    if (String(value ?? "").trim() !== date) return;
  } catch {
    // 用户取消或输入不符（inputValidator 未通过时 MessageBox 以 reject 结束）
    return;
  }

  const id = storeId.value;
  if (!id) return;

  try {
    await StoreAPI.deleteCalendarEntry(id, row.id);
    ElMessage.success(t("storeCalendar.action.deleteSuccess", { date }));
    dayDrawerVisible.value = false;
    await reload();
  } catch {
    // A0439 记录不存在 / A0424 门店不存在：请求层已给出含「怎么办」的文案
    await reload();
  }
}

/**
 * 切换门店
 *
 * 走全局 `switchStore`：重签 access token 后整页重载，所有页面随即以新
 * store_id 重新拉取（《页面信息架构·视图个性化》#3）。
 */
async function handleSwitchStore(targetId: string): Promise<void> {
  if (!targetId || targetId === storeId.value) return;
  await storeContext.switchStore(targetId);
}

/**
 * 地址栏同步：**只写「查询月份」这一身份级状态**
 *
 * ⚠️ 为什么选中日不写入地址栏（踩坑 95）：布局用 `:key="route.fullPath"` 渲染工作区，
 * `route.fullPath` **包含 query** ⇒ 任何 `router.replace({ query })` 都会让本页**整组件重建**。
 * 若把「点击选中的日期」这种交互瞬态也写进 query，则点日期即触发重建：抽屉被关掉、
 * 对话框的 `@success` 回调仍绑在**已被 keep-alive 留存的旧实例**上，新实例拿不到刷新
 * 指令，表现就是「新增成功但月历/列表不更新」。
 * 因此约定：query 只承载可重新推导出来的页面身份（月份）；选中日属瞬态，只留在内存中。
 * `?date=` 仍作为**入口**被 `resolveInitialDate()` 识别（手工直链可用），但不再回写。
 */
function syncUrl(): void {
  const query: Record<string, string> = {};
  if (month.value !== currentMonth()) query.month = month.value;
  router.replace({ query }).then(
    () => undefined,
    () => undefined
  );
}

watch(month, syncUrl);

/** 门店或月份变化都要重拉 */
watch(
  [storeId, month],
  () => {
    if (storeId.value) void loadAll();
  },
  { immediate: true }
);

onMounted(async () => {
  await storeContext.loadOrganizations();
  // 门店列表可能在页面挂载后才返回（登录首屏），此处兜底触发一次加载
  if (storeId.value) void loadAll();
});
</script>

<style lang="scss" scoped>
.store-calendar {
  &__bar {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
  }

  &__bar-left {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  &__bar-label {
    font-size: 13px;
    color: var(--el-text-color-secondary);
  }

  &__bar-empty {
    font-size: 13px;
    color: var(--el-text-color-placeholder);
  }

  &__bar-right {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  &__bar-tip {
    font-size: 12px;
    color: var(--el-text-color-placeholder);
  }

  /* ⚠️ 内容卡 .el-card__body 是**三段式 grid**（page.scss：auto / minmax(0,1fr) / auto）
     所以正文只允许放 2~3 个直接子元素，且**只有第 2 个**落在 1fr 滚动行。
     直接把多个区块平铺进去，第 2 块会被丢进 1fr 行压扁成内边距（踩坑 96）——
     故此处固定为：head（工具栏+图例，auto）+ scroll（月历+列表，1fr 自滚动）。 */
  &__head {
    display: flex;
    flex: 0 0 auto;
    flex-direction: column;
    gap: 12px;
  }

  &__scroll {
    min-height: 0;
    padding-right: 4px;
    margin-top: 12px;
    overflow: auto;

    > :first-child {
      margin-top: 0;
    }
  }

  &__state {
    grid-row: 1 / -1;
    min-height: 0;
    overflow: auto;
  }

  &__toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
  }

  &__toolbar-left,
  &__toolbar-right {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  &__month-label {
    min-width: 120px;
    font-size: 15px;
    font-weight: 600;
    text-align: center;
  }

  &__legend {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    align-items: center;
    padding: 8px 12px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
    background: var(--el-fill-color-lighter);
    border-radius: 4px;
  }

  &__legend-title {
    font-weight: 600;
  }

  &__legend-item {
    display: inline-flex;
    gap: 6px;
    align-items: center;

    &.is-tip {
      color: var(--el-text-color-placeholder);
    }
  }

  &__legend-dot {
    width: 10px;
    height: 10px;
    border-radius: 2px;

    &.is-1 {
      background: var(--el-color-danger);
    }

    &.is-2 {
      background: var(--el-color-warning);
    }

    &.is-3 {
      background: var(--el-color-success);
    }

    &.is-exception {
      width: 3px;
      background: var(--el-color-warning);
    }
  }

  &__section-title {
    display: flex;
    gap: 8px;
    align-items: baseline;
    margin: 20px 0 12px;
    font-size: 15px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  &__section-tip {
    font-size: 12px;
    font-weight: 400;
    color: var(--el-text-color-placeholder);
  }

  &__table {
    margin-top: 4px;
  }

  &__skeleton {
    grid-row: 1 / -1;
    min-height: 0;
    overflow: auto;

    &-grid {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 16px;
    }

    &-cell {
      height: 84px;
      background: var(--el-fill-color-light);
      border-radius: 6px;
      animation: store-calendar-skeleton 1.4s ease-in-out infinite;
    }

    &-row {
      margin-bottom: 8px;
    }

    &-bar {
      display: block;
      height: 32px;
      background: var(--el-fill-color-light);
      border-radius: 4px;
      animation: store-calendar-skeleton 1.4s ease-in-out infinite;
    }
  }
}

.day-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;

  &__date {
    font-size: 18px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--el-text-color-primary);
  }

  &__desc {
    margin-top: 4px;
  }

  &__actions {
    display: flex;
    justify-content: flex-end;
    padding-top: 4px;
  }
}

@keyframes store-calendar-skeleton {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.5;
  }
}

@media (prefers-reduced-motion: reduce) {
  .store-calendar__skeleton-cell,
  .store-calendar__skeleton-bar {
    animation: none;
  }
}
</style>
