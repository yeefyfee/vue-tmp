<template>
  <div class="workbench">
    <!-- 页头：问候 + 日期 + 快捷条（PRD《详细设计·经营工作台》第 4 条：四动作常驻顶部） -->
    <section class="workbench__top">
      <div class="workbench__intro">
        <h1 class="workbench__hello">{{ greetingText }}</h1>
        <p class="workbench__date">
          <span>{{ dateText }}</span>
          <span v-if="updatedAtText" class="workbench__updated">
            {{ t("dashboard.updatedAt", { time: updatedAtText }) }}
          </span>
          <el-tooltip :content="realtimeTip" placement="top" :show-after="120">
            <span class="workbench__live" :class="{ 'is-live': sseConnected }">
              <span class="workbench__live-dot" />
              {{ sseConnected ? t("dashboard.realtime.live") : t("dashboard.realtime.polling") }}
            </span>
          </el-tooltip>
        </p>
      </div>

      <div class="workbench__actions">
        <el-button
          v-for="action in QUICK_ACTIONS"
          :key="action.key"
          class="workbench__quick"
          @click="handleQuickAction"
        >
          <el-icon class="workbench__quick-icon"><component :is="action.icon" /></el-icon>
          <span>{{ t(action.labelKey) }}</span>
        </el-button>
        <el-tooltip :content="t('dashboard.refresh')" placement="top">
          <el-button
            class="workbench__refresh"
            :icon="Refresh"
            circle
            :loading="loading"
            @click="refresh()"
          />
        </el-tooltip>
      </div>
    </section>

    <!-- 整页错误态（PRD《Web规范》§空态/加载/错误态） -->
    <DataState
      v-if="loadError"
      variant="error"
      :title="t('dashboard.error.title')"
      :description="loadError"
      :action-text="t('dashboard.error.retry')"
      @action="refresh({ initial: true })"
    />

    <!-- 三列卡片布局（PRD：三秒看数、十秒看事） -->
    <div v-else class="workbench__grid">
      <!-- ① 今日数据 -->
      <section class="wb-card">
        <header class="wb-card__head">
          <h2 class="wb-card__title">{{ t("dashboard.today.title") }}</h2>
        </header>
        <div class="wb-card__body">
          <el-skeleton v-if="isFirstLoading" :rows="4" animated />
          <div v-else class="wb-stats">
            <article v-for="metric in todayMetrics" :key="metric.key" class="wb-stat">
              <div class="wb-stat__label">
                <span>{{ t(metric.labelKey) }}</span>
                <el-tooltip
                  v-if="metric.note"
                  :content="metric.note"
                  placement="top"
                  :show-after="120"
                >
                  <el-icon class="wb-stat__hint"><QuestionFilled /></el-icon>
                </el-tooltip>
              </div>
              <div class="wb-stat__value" :class="{ 'is-unavailable': !metric.available }">
                <span class="wb-stat__num">{{ metric.display }}</span>
                <span v-if="metric.unit" class="wb-stat__unit">{{ metric.unit }}</span>
              </div>
              <p v-if="!metric.available" class="wb-stat__pending">
                {{ t("dashboard.today.pendingModule") }}
              </p>
            </article>
          </div>
        </div>
      </section>

      <!-- ② 今天的工作 -->
      <section class="wb-card">
        <header class="wb-card__head">
          <h2 class="wb-card__title">{{ t("dashboard.work.title") }}</h2>
          <el-tooltip v-if="timelineNote" :content="timelineNote" placement="top" :show-after="120">
            <el-icon class="wb-card__hint"><QuestionFilled /></el-icon>
          </el-tooltip>
        </header>
        <div class="wb-card__body">
          <el-skeleton v-if="isFirstLoading" :rows="4" animated />
          <ul v-else-if="timelineItems.length" class="wb-timeline">
            <li
              v-for="(item, index) in timelineItems"
              :key="index"
              class="wb-timeline__item"
              :class="{ 'is-overdue': item.overdue }"
            >
              <span class="wb-timeline__time">{{ formatClock(item.time) }}</span>
              <span class="wb-timeline__dot" />
              <div class="wb-timeline__content">
                <p class="wb-timeline__title">{{ item.petName }} · {{ item.serviceName }}</p>
                <p class="wb-timeline__meta">{{ item.ownerName }}</p>
              </div>
            </li>
          </ul>
          <DataState
            v-else
            variant="empty"
            :title="t('dashboard.work.empty')"
            :description="timelineNote"
          />
        </div>
      </section>

      <!-- ③ 需要你处理 -->
      <section class="wb-card">
        <header class="wb-card__head">
          <h2 class="wb-card__title">{{ t("dashboard.todo.title") }}</h2>
          <span v-if="todoItems.length" class="wb-card__badge">{{ todoItems.length }}</span>
          <el-tooltip v-else-if="todosNote" :content="todosNote" placement="top" :show-after="120">
            <el-icon class="wb-card__hint"><QuestionFilled /></el-icon>
          </el-tooltip>
        </header>
        <div class="wb-card__body">
          <el-skeleton v-if="isFirstLoading" :rows="4" animated />
          <ul v-else-if="todoItems.length" class="wb-todos">
            <li
              v-for="todo in todoItems"
              :key="todo.key"
              class="wb-todos__item"
              :class="`is-${todo.severity}`"
            >
              <el-icon class="wb-todos__icon"><component :is="TODO_ICON" /></el-icon>
              <div class="wb-todos__content">
                <p class="wb-todos__title">
                  {{ t(`dashboard.todo.${todo.category}`) }} · {{ todo.petName }}
                </p>
                <p class="wb-todos__meta">{{ todoMeta(todo) }}</p>
              </div>
            </li>
          </ul>
          <DataState
            v-else
            variant="empty"
            :title="t('dashboard.todo.empty')"
            :description="todosNote"
          />
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: "Dashboard", inheritAttrs: false });

import {
  AlarmClock,
  Calendar,
  DocumentAdd,
  House,
  QuestionFilled,
  Refresh,
  Wallet,
} from "@element-plus/icons-vue";
import DashboardAPI from "@/api/dashboard";
import type { DashboardMetric, DashboardOverview, DashboardTodoItem } from "@/api/dashboard/types";
import { useSse } from "@/composables";
import { useUserStore } from "@/stores/user";

/**
 * 经营工作台（MVP-WEB-03-01 布局 / MVP-WEB-03-02 增量轮询 + 实时推送）
 *
 * 结构（PRD《页面功能》§5.2 +《详细设计·经营工作台》）：
 *  ① 今日数据卡（营业额 / 订单 / 在店宠物 / 待处理，逐项带口径 tooltip）
 *  ② 今天的工作卡（当日时间线，超时未开始高亮）
 *  ③ 需要你处理卡（按优先级排序的待办清单）
 *  ④ 快捷入口条（新建订单 / 新建预约 / 入住登记 / 收银，常驻页头）
 *
 * 数据接入（PRD《数据刷新策略》「页面打开时拉取一次，之后每 60 秒轮询增量；
 * 关键状态变化通过服务端推送即时刷新」）：
 *  - **打开拉一次** → `refresh({ initial: true })` 全量；
 *  - **60s 轮询增量** → 携带上次 `revision`，服务端指纹未变回 `changed:false`，不重渲染；
 *  - **推送即时刷新** → 订阅 SSE `dashboard` 事件（房态 / 健康档案写入触发，租户级定向），
 *    收到后立即增量刷新，**不整页重载**；
 *  - **节流**：keep-alive 下只在页面激活（`onActivated`）时轮询，标签页隐藏
 *    （`document.hidden`）时暂停轮询并抑制推送刷新，恢复可见即补一次刷新；
 *    同一时刻只允许一个在途请求，期间到达的刷新请求合并为一次尾随刷新。
 *
 * 🔴 `available: false` 的指标渲染 `--` 而非 `0` —— 数据源模块未上线时，
 * 「0」是错误信息（见 `api/dashboard/types.ts` 顶部说明）。
 */
const { t } = useI18n();
const userStore = useUserStore();
const sse = useSse();

/** 轮询周期（PRD：每 60 秒轮询增量） */
const POLL_INTERVAL_MS = 60_000;

const overview = ref<DashboardOverview | null>(null);
const loading = ref(false);
const loadError = ref("");
/** 上次拿到的数据指纹（增量轮询的 `since`） */
const revision = ref<string | null>(null);
/** 上次成功校时时刻（含 changed=false 的轮询），用于「更新于」展示 */
const lastCheckedAt = ref<number | null>(null);

/** 首屏骨架：只在「还没有任何数据」时展示，刷新时不闪烁 */
const isFirstLoading = computed(() => loading.value && overview.value === null);

/** SSE 实时通道连接状态（用于页头「实时 / 轮询中」指示） */
const sseConnected = computed(() => sse.isConnected.value);

/** 快捷动作（PRD 固定四项；目标页未上线，点击给出明确反馈而非静默失败） */
const QUICK_ACTIONS = [
  { key: "order", labelKey: "dashboard.quick.order", icon: DocumentAdd },
  { key: "booking", labelKey: "dashboard.quick.booking", icon: Calendar },
  { key: "checkin", labelKey: "dashboard.quick.checkin", icon: House },
  { key: "cashier", labelKey: "dashboard.quick.cashier", icon: Wallet },
] as const;

/** 待办图标（首期仅健康类待办） */
const TODO_ICON = AlarmClock;

const greetingText = computed(() => {
  const name = userStore.userInfo.nickname || userStore.userInfo.username || "";
  const hour = new Date().getHours();
  let key = "dashboard.greeting.night";
  if (hour >= 6 && hour < 8) key = "dashboard.greeting.morning";
  else if (hour >= 8 && hour < 12) key = "dashboard.greeting.forenoon";
  else if (hour >= 12 && hour < 18) key = "dashboard.greeting.afternoon";
  else if (hour >= 18 && hour < 24) key = "dashboard.greeting.evening";
  return name ? `${t(key)}，${name}` : t(key);
});

const dateText = computed(() => {
  const d = new Date();
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${weekdays[d.getDay()]}`;
});

/** 「更新于」：优先用最近一次校时时刻（轮询/推送），回退到本次读数生成时刻 */
const updatedAtText = computed(() => {
  const stamp =
    lastCheckedAt.value ?? (overview.value ? Date.parse(overview.value.generatedAt) : 0);
  if (!stamp) return "";
  const d = new Date(stamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
});

/** 实时状态提示（tooltip 文案） */
const realtimeTip = computed(() =>
  sseConnected.value ? t("dashboard.realtime.liveTip") : t("dashboard.realtime.pollingTip")
);

interface TodayMetricView {
  key: string;
  labelKey: string;
  display: string;
  unit: string;
  available: boolean;
  note: string;
}

/** 今日数据四格（晚到的指标渲染 `--` + 待接入提示） */
const todayMetrics = computed<TodayMetricView[]>(() => {
  const today = overview.value?.today;

  const build = (
    key: string,
    labelKey: string,
    metric: DashboardMetric | undefined,
    format?: (value: number) => { display: string; unit: string }
  ): TodayMetricView => {
    if (!metric || !metric.available || metric.value === null) {
      return {
        key,
        labelKey,
        display: "--",
        unit: "",
        available: false,
        note: metric?.note ?? "",
      };
    }
    const formatted = format ? format(metric.value) : { display: String(metric.value), unit: "" };
    return {
      key,
      labelKey,
      display: formatted.display,
      unit: formatted.unit,
      available: true,
      note: metric.note,
    };
  };

  return [
    build("revenue", "dashboard.today.revenue", today?.revenue, (value) => ({
      display: (value / 100).toFixed(2),
      unit: "元",
    })),
    build("orders", "dashboard.today.orders", today?.orderCount),
    build("boardingPets", "dashboard.today.boardingPets", today?.boardingPetCount),
    build("pending", "dashboard.today.pending", today?.pendingCount),
  ];
});

const timelineItems = computed(() => overview.value?.timeline.items ?? []);
const timelineNote = computed(() => overview.value?.timeline.note ?? "");
const todoItems = computed(() => overview.value?.todos.items ?? []);
const todosNote = computed(() => overview.value?.todos.note ?? "");

/** 时间线时刻：ISO 8601 → 本地 HH:mm */
function formatClock(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 完整时刻：ISO 8601 → 本地 MM-DD HH:mm（跨日待办用） */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${formatClock(iso)}`;
}

/**
 * 待办元信息行
 *
 * 按 `kind` 分支：健康类展示到期倒计时 + 到期日；转移审批类展示提交时刻。
 */
function todoMeta(todo: DashboardTodoItem): string {
  if (todo.kind === "transfer") {
    return todo.submittedAt
      ? t("dashboard.todo.submittedAt", { time: formatDateTime(todo.submittedAt) })
      : "";
  }
  const due = todo.dueInDays ?? 0;
  const dueText =
    due === 0
      ? t("dashboard.todo.dueToday")
      : due < 0
        ? t("dashboard.todo.overdueDays", { days: -due })
        : t("dashboard.todo.dueInDays", { days: due });
  return todo.dueDate ? `${dueText} · ${todo.dueDate}` : dueText;
}

/** 快捷动作：四项对应模块（订单 07 / 预约 06 / 寄养 09 / 收银 14）均未上线 */
function handleQuickAction(): void {
  ElMessage.info(t("dashboard.quick.comingSoon"));
}

/** 错误信息提取（请求层已统一提示，这里只取可读描述用于错误态展示） */
function resolveErrorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return t("dashboard.error.title");
}

// ── 实时刷新（MVP-WEB-03-02） ─────────────────────────────────────────────
let inFlight = false; // 是否有在途请求（合并并发刷新）
let pendingRefresh = false; // 在途期间的尾随刷新请求
let pollTimer: ReturnType<typeof setInterval> | null = null;
let sseUnsubscribe: (() => void) | null = null;
/** 页面是否处于激活态（keep-alive + 浏览器可见性） */
const isActive = ref(false);

/** 应用一次响应：changed=false 只更新指纹与校时时刻（不重渲染），true 才替换读数 */
function applyResponse(res: Awaited<ReturnType<typeof DashboardAPI.getOverview>>): void {
  revision.value = res.revision;
  lastCheckedAt.value = Date.now();
  if (res.changed) {
    overview.value = res;
  }
}

/**
 * 增量刷新
 * @param options.initial 首次拉取（不带 `since`，强制全量）
 */
async function refresh(options: { initial?: boolean } = {}): Promise<void> {
  if (inFlight) {
    pendingRefresh = true;
    return;
  }
  inFlight = true;
  if (options.initial || overview.value === null) loading.value = true;
  loadError.value = "";
  try {
    const res = await DashboardAPI.getOverview(
      options.initial ? undefined : { since: revision.value ?? undefined }
    );
    applyResponse(res);
  } catch (error) {
    loadError.value = resolveErrorText(error);
  } finally {
    inFlight = false;
    loading.value = false;
    if (pendingRefresh) {
      pendingRefresh = false;
      void refresh();
    }
  }
}

/** 启动 60s 轮询（激活且页面可见才发起请求） */
function startPolling(): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    if (document.visibilityState === "visible") void refresh();
  }, POLL_INTERVAL_MS);
}

/** 停止轮询（页面失活 / 卸载） */
function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/** 收到服务端推送：仅激活且可见时立即增量刷新（「处理后卡片实时刷新，不整页重载」） */
function handlePushRefresh(): void {
  if (!isActive.value || document.visibilityState !== "visible") return;
  void refresh();
}

/** 标签页可见性变化：恢复可见时补一次刷新（补上隐藏期间错过的推送/轮询） */
function handleVisibilityChange(): void {
  if (document.visibilityState === "visible" && isActive.value) void refresh();
}

onMounted(() => {
  // 复用全局 SSE 单例（setupSse 已 connect；此处幂等），订阅工作台变更事件
  sse.connect();
  sseUnsubscribe = sse.on("dashboard", handlePushRefresh);
  document.addEventListener("visibilitychange", handleVisibilityChange);
});

onActivated(() => {
  isActive.value = true;
  void refresh({ initial: overview.value === null });
  startPolling();
});

onDeactivated(() => {
  isActive.value = false;
  stopPolling();
});

onBeforeUnmount(() => {
  isActive.value = false;
  stopPolling();
  if (sseUnsubscribe) {
    sseUnsubscribe();
    sseUnsubscribe = null;
  }
  document.removeEventListener("visibilitychange", handleVisibilityChange);
});
</script>

<style lang="scss" scoped>
.workbench {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
}

/* ── 页头 ── */
.workbench__top {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
}

.workbench__intro {
  min-width: 220px;
}

.workbench__hello {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.workbench__date {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.workbench__updated {
  color: var(--el-text-color-placeholder);
}

/* 实时状态指示（MVP-WEB-03-02）：已连接推送=绿色「实时」，否则=灰色「轮询中」 */
.workbench__live {
  display: inline-flex;
  gap: 5px;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  cursor: help;
  background: var(--el-fill-color-light);
  border-radius: 10px;
}

.workbench__live-dot {
  width: 6px;
  height: 6px;
  background: var(--el-text-color-placeholder);
  border-radius: 50%;
}

.workbench__live.is-live {
  color: var(--el-color-success);
  background: var(--el-color-success-light-9);

  .workbench__live-dot {
    background: var(--el-color-success);
    box-shadow: 0 0 0 3px var(--el-color-success-light-8);
  }
}

.workbench__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.workbench__quick {
  height: 32px;
}

.workbench__quick-icon {
  margin-right: 4px;
}

/* ── 三列卡片网格（PRD：三秒看数、十秒看事） ── */
.workbench__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  align-items: start;

  /* PRD《Web规范》§断点：lg 1024-1279 两列 / md <1024 单列 */
  @media (width <= 1280px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @media (width <= 1024px) {
    grid-template-columns: minmax(0, 1fr);
  }
}

.wb-card {
  display: flex;
  flex-direction: column;
  min-height: 288px;
  overflow: hidden;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
}

.wb-card__head {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
  align-items: center;
  padding: 14px 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.wb-card__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.wb-card__hint {
  font-size: 14px;
  color: var(--el-text-color-placeholder);
  cursor: help;
}

.wb-card__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  background: var(--el-color-danger);
  border-radius: 10px;
}

.wb-card__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  padding: 12px 16px 16px;
  overflow: auto;
}

/* ── 今日数据 ── */
.wb-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.wb-stat {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  background: var(--el-fill-color-lighter);
  border-radius: 6px;
}

.wb-stat__label {
  display: flex;
  gap: 4px;
  align-items: center;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.wb-stat__hint {
  font-size: 13px;
  color: var(--el-text-color-placeholder);
  cursor: help;
}

.wb-stat__value {
  display: flex;
  gap: 4px;
  align-items: baseline;
  font-size: 24px;
  font-weight: 600;
  color: var(--el-text-color-primary);

  &.is-unavailable .wb-stat__num {
    color: var(--el-text-color-placeholder);
  }
}

.wb-stat__unit {
  font-size: 13px;
  font-weight: 400;
  color: var(--el-text-color-secondary);
}

.wb-stat__pending {
  margin: 0;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

/* ── 今天的工作 ── */
.wb-timeline {
  display: flex;
  flex-direction: column;
  padding: 0;
  margin: 0;
  list-style: none;
}

.wb-timeline__item {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 0;
  border-bottom: 1px dashed var(--el-border-color-lighter);

  &:last-child {
    border-bottom: none;
  }

  &.is-overdue .wb-timeline__title {
    color: var(--el-color-danger);
  }
}

.wb-timeline__time {
  flex-shrink: 0;
  width: 44px;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: var(--el-text-color-secondary);
}

.wb-timeline__dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  margin-top: 6px;
  background: var(--el-color-primary);
  border-radius: 50%;
}

.wb-timeline__content {
  min-width: 0;
}

.wb-timeline__title {
  margin: 0;
  font-size: 13px;
  color: var(--el-text-color-primary);
}

.wb-timeline__meta {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

/* ── 需要你处理 ── */
.wb-todos {
  display: flex;
  flex-direction: column;
  padding: 0;
  margin: 0;
  list-style: none;
}

.wb-todos__item {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px;
  margin-bottom: 8px;
  background: var(--el-fill-color-lighter);
  border-left: 3px solid var(--el-border-color);
  border-radius: 4px;

  &:last-child {
    margin-bottom: 0;
  }

  &.is-high {
    border-left-color: var(--el-color-danger);
  }

  &.is-medium {
    border-left-color: var(--el-color-warning);
  }

  &.is-low {
    border-left-color: var(--el-color-info);
  }
}

.wb-todos__icon {
  flex-shrink: 0;
  margin-top: 2px;
  font-size: 16px;
  color: var(--el-text-color-secondary);

  .is-high & {
    color: var(--el-color-danger);
  }

  .is-medium & {
    color: var(--el-color-warning);
  }
}

.wb-todos__content {
  min-width: 0;
}

.wb-todos__title {
  margin: 0;
  font-size: 13px;
  color: var(--el-text-color-primary);
}

.wb-todos__meta {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
