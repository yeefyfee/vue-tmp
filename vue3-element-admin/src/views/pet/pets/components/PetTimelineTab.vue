<template>
  <div class="pet-timeline">
    <!-- ── 工具条：筛选（交互瞬态，**不写地址栏**，避免整页重建）+ 补录入口 ── -->
    <div class="pet-timeline__toolbar">
      <div class="pet-timeline__filter" data-testid="pet-timeline-filter-type">
        <el-select
          v-model="filterEventType"
          class="pet-timeline__filter-item"
          clearable
          size="small"
          :placeholder="t('pet.timeline.filterTypePlaceholder')"
        >
          <el-option
            v-for="opt in eventTypeOptions"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>
      </div>

      <div class="pet-timeline__filter" data-testid="pet-timeline-filter-visible">
        <el-select
          v-model="filterVisibleToOwner"
          class="pet-timeline__filter-item"
          clearable
          size="small"
          :placeholder="t('pet.timeline.filterVisiblePlaceholder')"
        >
          <el-option :label="t('pet.timeline.ownerVisible')" value="true" />
          <el-option :label="t('pet.timeline.internalOnly')" value="false" />
        </el-select>
      </div>

      <!-- el-date-picker 不把未知属性透传到 DOM ⇒ 用一层容器承载自动化定位锚点 -->
      <div
        class="pet-timeline__filter pet-timeline__filter--range"
        data-testid="pet-timeline-filter-range"
      >
        <el-date-picker
          v-model="filterRange"
          class="pet-timeline__filter-item"
          type="daterange"
          size="small"
          value-format="YYYY-MM-DD"
          :start-placeholder="t('pet.timeline.filterStartPlaceholder')"
          :end-placeholder="t('pet.timeline.filterEndPlaceholder')"
        />
      </div>

      <el-button
        size="small"
        :disabled="!hasFilter"
        data-testid="pet-timeline-filter-reset"
        @click="resetFilters"
      >
        {{ t("pet.timeline.filterReset") }}
      </el-button>

      <div class="pet-timeline__toolbar-spacer" />

      <span v-if="loaded" class="pet-timeline__summary" data-testid="pet-timeline-summary">
        {{
          t("pet.timeline.summary", {
            total,
            loaded: events.length,
            days: dayGroups.length,
          })
        }}
      </span>

      <el-button
        v-hasPerm="'pet:timeline:create'"
        type="primary"
        size="small"
        data-testid="pet-timeline-create-btn"
        @click="openCreate"
      >
        {{ t("pet.timeline.actionCreate") }}
      </el-button>
    </div>

    <TableSkeleton v-if="loading && !loaded" :column-count="1" :row-count="5" />

    <DataState
      v-else-if="loadError"
      variant="error"
      :title="t('pet.timeline.loadError')"
      :description="loadError"
      :action-text="t('pet.timeline.retry')"
      @action="reload"
    />

    <DataState
      v-else-if="events.length === 0"
      variant="empty"
      :title="t('pet.timeline.empty')"
      :description="t('pet.timeline.emptyDesc')"
    />

    <template v-else>
      <!-- ── 按天分组（TR-6：同一天事件聚合为一张状态卡，避免碎片化）──────── -->
      <div class="pet-timeline__days">
        <section
          v-for="group in dayGroups"
          :key="group.dateKey || '__unknown__'"
          class="pet-timeline__day"
          data-testid="pet-timeline-day"
          :data-day="group.dateKey"
        >
          <header class="pet-timeline__day-head">
            <span class="pet-timeline__day-label" data-testid="pet-timeline-day-label">
              {{ dayLabel(group.dateKey) }}
            </span>
            <span class="pet-timeline__day-count">
              {{ t("pet.timeline.dayCount", { count: group.events.length }) }}
            </span>
            <div class="pet-timeline__day-chips">
              <el-tag
                v-for="chip in group.typeCounts"
                :key="chip.eventType"
                :type="timelineEventTagType(chip.eventType)"
                effect="plain"
                size="small"
              >
                {{ t(timelineEventTypeLabelKey(chip.eventType)) }}
                <span v-if="chip.count > 1" class="pet-timeline__chip-count">
                  ×{{ chip.count }}
                </span>
              </el-tag>
            </div>
          </header>

          <ul class="pet-timeline__events">
            <li
              v-for="event in group.events"
              :key="event.id"
              class="pet-timeline__event"
              data-testid="pet-timeline-event"
              :data-event-id="event.id"
            >
              <span class="pet-timeline__time">{{ eventTimeText(event.eventTime) }}</span>

              <el-tag :type="timelineEventTagType(event.eventType)" effect="plain" size="small">
                {{ t(timelineEventTypeLabelKey(event.eventType)) }}
              </el-tag>

              <el-tag
                v-if="isTimelineRevisionEvent(event)"
                type="warning"
                effect="dark"
                size="small"
                data-testid="pet-timeline-revision-tag"
              >
                {{ t("pet.timeline.revisionTag") }}
              </el-tag>

              <span v-if="event.eventName" class="pet-timeline__event-name">
                {{ event.eventName }}
              </span>

              <el-tag
                :type="event.visibleToOwner ? 'success' : 'info'"
                effect="plain"
                size="small"
                class="pet-timeline__visibility"
              >
                {{
                  event.visibleToOwner
                    ? t("pet.timeline.ownerVisible")
                    : t("pet.timeline.internalOnly")
                }}
              </el-tag>

              <p v-if="event.content" class="pet-timeline__content">{{ event.content }}</p>

              <div class="pet-timeline__meta">
                <span>{{ t("pet.timeline.actor") }}：{{ actorText(event) }}</span>
                <div class="pet-timeline__ops">
                  <el-button
                    link
                    type="primary"
                    size="small"
                    data-testid="pet-timeline-event-detail"
                    @click="openDetail(event)"
                  >
                    {{ t("pet.timeline.actionDetail") }}
                  </el-button>
                  <el-button
                    v-hasPerm="'pet:timeline:revise'"
                    link
                    type="warning"
                    size="small"
                    data-testid="pet-timeline-event-revise"
                    @click="openRevise(event)"
                  >
                    {{ t("pet.timeline.actionRevise") }}
                  </el-button>
                </div>
              </div>
            </li>
          </ul>
        </section>
      </div>

      <div class="pet-timeline__footer">
        <el-button v-if="hasMore" :loading="loading" text type="primary" @click="loadMore">
          {{ t("pet.timeline.loadMore") }}
        </el-button>
        <span v-else class="pet-timeline__nomore">{{ t("pet.timeline.noMore") }}</span>
      </div>
    </template>

    <PetTimelineEventDialog v-model="createVisible" :pet-id="petId" @saved="handleSaved" />
    <PetTimelineReviseDialog
      v-model="reviseVisible"
      :pet-id="petId"
      :event="reviseTarget"
      @saved="handleSaved"
    />

    <!-- 事件详情抽屉（480px，PRD《Web规范》§页面模式 1） -->
    <el-drawer
      v-model="detailVisible"
      :title="t('pet.timeline.detailTitle')"
      size="480px"
      data-testid="pet-timeline-detail-drawer"
    >
      <div v-if="detailEvent" class="pet-timeline__detail">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item :label="t('pet.timeline.detailId')">
            {{ detailEvent.id }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('pet.timeline.detailType')">
            <el-tag :type="timelineEventTagType(detailEvent.eventType)" effect="plain" size="small">
              {{ t(timelineEventTypeLabelKey(detailEvent.eventType)) }}
            </el-tag>
            <el-tag
              v-if="isTimelineRevisionEvent(detailEvent)"
              type="warning"
              effect="dark"
              size="small"
              class="pet-timeline__detail-tag"
            >
              {{ t("pet.timeline.revisionTag") }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item :label="t('pet.timeline.detailName')">
            {{ detailEvent.eventName ?? t("pet.value.unset") }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('pet.timeline.detailTime')">
            {{ detailEvent.eventTime }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('pet.timeline.detailContent')">
            {{ detailEvent.content ?? t("pet.value.unset") }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('pet.timeline.detailRef')">
            {{ refText(detailEvent) }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('pet.timeline.actor')">
            {{ actorText(detailEvent) }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('pet.timeline.detailVisibility')">
            {{
              detailEvent.visibleToOwner
                ? t("pet.timeline.ownerVisible")
                : t("pet.timeline.internalOnly")
            }}
          </el-descriptions-item>
        </el-descriptions>

        <div class="pet-timeline__detail-payload">
          <div class="pet-timeline__detail-payload-title">
            {{ t("pet.timeline.detailPayload") }}
          </div>
          <pre v-if="detailPayloadText" class="pet-timeline__pre">{{ detailPayloadText }}</pre>
          <span v-else class="pet-timeline__nomore">
            {{ t("pet.timeline.detailEmptyPayload") }}
          </span>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { TIMELINE_EVENT_TYPE_VALUES } from "@peluvida/shared";

import PetAPI from "@/api/pet";
import type { TimelineEventItem, TimelineQueryParams } from "@/api/pet";
import DataState from "@/components/DataState/DataState.vue";
import TableSkeleton from "@/components/DataState/TableSkeleton.vue";
import { isApiError } from "@/utils/request";
import {
  groupTimelineByDay,
  isTimelineRevisionEvent,
  timelineActorTypeLabelKey,
  timelineDayLabel,
  timelineEventTagType,
  timelineEventTypeLabelKey,
} from "@/utils/pet";
import PetTimelineEventDialog from "./PetTimelineEventDialog.vue";
import PetTimelineReviseDialog from "./PetTimelineReviseDialog.vue";

/**
 * 宠物档案 · Timeline 页签（MVP-WEB-05-01 基础事件流 → 05-04 组件化与聚合）
 *
 * 数据源 `GET /pets/:petId/timeline`（默认 `eventTime desc` + `id desc`）。PRD 性能约定：
 * Timeline 采用**增量分页，每次 30 条** ⇒ 首屏取 30 条，「加载更多」按页追加至 `total`。
 *
 * MVP-WEB-05-04 增量（对应 PRD《宠物管理》TR 条款）：
 *  - **TR-6 按天分组**：同一天的事件聚合为一张「状态卡」（日期头 + 当日事件类型摘要
 *    chips + 卡内事件行），避免碎片化时间线（{@link groupTimelineByDay}）；
 *  - **筛选**：事件类型 / 宠主可见性 / 事件时间闭区间（后端 DTO 原生支持）。筛选值属
 *    **交互瞬态**，只存组件内 `ref`，**不写地址栏**（写 query 会改 `route.fullPath` ⇒
 *    工作区整页重建，见 PITFALLS 95/122）；
 *  - **TR-4 冲正**：每条事件提供「冲正」入口（`pet:timeline:revise`），追加冲正事件、
 *    原事件不变；冲正事件以 `revisionTag` 醒目标识；
 *  - **TR-2 人工补录**：「补录事件」（`pet:timeline:create`）。
 *
 * 独立路由页 `pets/:petId/timeline` 复用本组件（见 `views/pet/pets/timeline.vue`）。
 */
defineOptions({ name: "PetTimelineTab", inheritAttrs: false });

const props = defineProps<{ petId: string }>();

const { t } = useI18n();

const PAGE_SIZE = 30;

// ── 筛选（交互瞬态，不写地址栏）─────────────────────────────────────────
const filterEventType = ref<number | undefined>(undefined);
const filterVisibleToOwner = ref<"true" | "false" | undefined>(undefined);
const filterRange = ref<[string, string] | null>(null);

const hasFilter = computed(
  () =>
    filterEventType.value !== undefined ||
    filterVisibleToOwner.value !== undefined ||
    (filterRange.value !== null && filterRange.value.length === 2)
);

const eventTypeOptions = computed(() =>
  TIMELINE_EVENT_TYPE_VALUES.map((value) => ({
    value,
    label: t(timelineEventTypeLabelKey(value)),
  }))
);

// ── 数据 ────────────────────────────────────────────────────────────────
const events = ref<TimelineEventItem[]>([]);
const total = ref(0);
const pageNum = ref(1);

const loading = ref(false);
const loaded = ref(false);
const loadError = ref("");

const hasMore = computed(() => events.value.length < total.value);

/** TR-6：按天分组（对**已加载**集合分组；加载更多后自动并入已有日期组） */
const dayGroups = computed(() => groupTimelineByDay(events.value));

function buildParams(page: number): TimelineQueryParams {
  const params: TimelineQueryParams = { pageNum: page, pageSize: PAGE_SIZE };
  if (filterEventType.value !== undefined && filterEventType.value !== null) {
    params.eventType = filterEventType.value;
  }
  if (filterVisibleToOwner.value !== undefined) {
    params.visibleToOwner = filterVisibleToOwner.value;
  }
  if (filterRange.value && filterRange.value.length === 2) {
    params.eventTimeStart = filterRange.value[0];
    params.eventTimeEnd = filterRange.value[1];
  }
  return params;
}

async function fetchPage(page: number, append: boolean): Promise<void> {
  loadError.value = "";
  loading.value = true;
  try {
    const data = await PetAPI.getTimeline(props.petId, buildParams(page));
    const list = data.list ?? [];
    events.value = append ? [...events.value, ...list] : list;
    total.value = data.total ?? list.length;
    pageNum.value = page;
  } catch (error) {
    loadError.value = isApiError(error) ? error.message : String(error ?? "");
    if (!append) {
      events.value = [];
      total.value = 0;
    }
  } finally {
    loading.value = false;
    loaded.value = true;
  }
}

function reload(): void {
  void fetchPage(1, false);
}

function loadMore(): void {
  void fetchPage(pageNum.value + 1, true);
}

function resetFilters(): void {
  filterEventType.value = undefined;
  filterVisibleToOwner.value = undefined;
  filterRange.value = null;
}

/** 筛选变化 ⇒ 重置到第 1 页重取（不做客户端过滤，保持与 total 同源） */
watch([filterEventType, filterVisibleToOwner, filterRange], () => {
  void fetchPage(1, false);
});

watch(
  () => props.petId,
  () => {
    resetFilters();
    void fetchPage(1, false);
  },
  { immediate: true }
);

// ── 展示换算 ────────────────────────────────────────────────────────────
/** 日历日 → 今天 / 昨天 / 前天 / `yyyy-MM-dd` */
function dayLabel(dateKey: string): string {
  return timelineDayLabel(
    dateKey,
    {
      today: t("time.today"),
      yesterday: t("time.yesterday"),
      beforeYesterday: t("time.beforeYesterday"),
    },
    new Date()
  );
}

/** 组内事件只展示时分（`yyyy-MM-dd HH:mm:ss` → `HH:mm`） */
function eventTimeText(value: unknown): string {
  const matched = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(value ?? ""));
  if (!matched) return String(value ?? "");
  return `${matched[4]}:${matched[5]}`;
}

function actorText(event: TimelineEventItem): string {
  const typeLabel = t(timelineActorTypeLabelKey(event.actorType));
  if (event.actorType === 2) return t("pet.timeline.systemActor");
  return event.operatorId ? `${typeLabel} #${event.operatorId}` : typeLabel;
}

function refText(event: TimelineEventItem): string {
  if (!event.refType && !event.refId) return t("pet.value.unset");
  return `${event.refType ?? "-"} / ${event.refId ?? "-"}`;
}

// ── 详情抽屉 ────────────────────────────────────────────────────────────
const detailVisible = ref(false);
const detailEvent = ref<TimelineEventItem | null>(null);

const detailPayloadText = computed(() => {
  const payload = detailEvent.value?.payload;
  if (payload === null || payload === undefined) return "";
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
});

async function openDetail(event: TimelineEventItem): Promise<void> {
  // 先用行数据即时渲染，再回源详情接口取权威完整视图（失败则保留行数据）
  detailEvent.value = event;
  detailVisible.value = true;
  try {
    detailEvent.value = await PetAPI.getTimelineEventDetail(props.petId, event.id);
  } catch {
    // 保留行数据
  }
}

// ── 补录 / 冲正 ─────────────────────────────────────────────────────────
const createVisible = ref(false);
const reviseVisible = ref(false);
const reviseTarget = ref<TimelineEventItem | null>(null);

function openCreate(): void {
  createVisible.value = true;
}

function openRevise(event: TimelineEventItem): void {
  reviseTarget.value = event;
  reviseVisible.value = true;
}

/** 写入成功 ⇒ 回第 1 页重取（新事件时间可能落在任意分组；保持 total 同步） */
function handleSaved(): void {
  void fetchPage(1, false);
}

defineExpose({ reload });
</script>

<style lang="scss" scoped>
.pet-timeline {
  display: flex;
  flex-direction: column;
  gap: 12px;

  &__toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  &__filter {
    width: 132px;

    &--range {
      width: 240px;
    }
  }

  &__filter-item {
    width: 100%;
  }

  &__toolbar-spacer {
    flex: 1;
    min-width: 0;
  }

  &__summary {
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }

  &__days {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  &__day {
    overflow: hidden;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 6px;

    &-head {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      padding: 8px 12px;
      background: var(--el-fill-color-light);
    }

    &-label {
      font-size: 13px;
      font-weight: 600;
      color: var(--el-text-color-primary);
    }

    &-count {
      font-size: 12px;
      color: var(--el-text-color-secondary);
    }

    &-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-left: auto;
    }
  }

  &__chip-count {
    font-size: 11px;
    opacity: 0.75;
  }

  &__events {
    padding: 0;
    margin: 0;
    list-style: none;
  }

  &__event {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    padding: 8px 12px;
    border-top: 1px solid var(--el-border-color-lighter);

    &:first-child {
      border-top: none;
    }
  }

  &__time {
    flex-shrink: 0;
    width: 40px;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: var(--el-text-color-secondary);
  }

  &__event-name {
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }

  &__visibility {
    margin-left: auto;
  }

  &__content {
    flex: 1 0 100%;
    margin: 0;
    font-size: 13px;
    line-height: 1.6;
    color: var(--el-text-color-regular);
    overflow-wrap: anywhere;
  }

  &__meta {
    display: flex;
    flex: 1 0 100%;
    gap: 8px;
    align-items: center;
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }

  &__ops {
    display: flex;
    gap: 8px;
    margin-left: auto;
  }

  &__footer {
    display: flex;
    justify-content: center;
    padding: 4px 0 8px;
  }

  &__nomore {
    font-size: 12px;
    color: var(--el-text-color-placeholder);
  }

  &__detail {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  &__detail-tag {
    margin-left: 6px;
  }

  &__detail-payload-title {
    margin-bottom: 4px;
    font-size: 13px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  &__pre {
    padding: 8px;
    margin: 0;
    overflow: auto;
    font-size: 12px;
    line-height: 1.5;
    background: var(--el-fill-color-light);
    border-radius: 4px;
  }
}
</style>
