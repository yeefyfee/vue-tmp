<template>
  <div class="page-container">
    <!-- 顶部：日期导航 + 视图切换 + 筛选（PRD《页面功能》预约日历「顶部提供日期导航、
         今日按钮、筛选（服务类型、员工、状态）」） -->
    <el-card class="page-search" shadow="never">
      <div class="cal-toolbar" data-testid="cal-toolbar">
        <div class="cal-toolbar__group">
          <el-tooltip :content="t('booking.calendar.navPrev')" placement="top">
            <el-button class="page-icon-btn" data-testid="cal-prev" @click="shiftDate(-1)">
              <el-icon><ArrowLeft /></el-icon>
            </el-button>
          </el-tooltip>
          <el-button data-testid="cal-today" @click="goToday">
            {{ t("booking.calendar.navToday") }}
          </el-button>
          <el-tooltip :content="t('booking.calendar.navNext')" placement="top">
            <el-button class="page-icon-btn" data-testid="cal-next" @click="shiftDate(1)">
              <el-icon><ArrowRight /></el-icon>
            </el-button>
          </el-tooltip>
          <span class="cal-toolbar__range" data-testid="cal-range">{{ rangeLabel }}</span>
        </div>

        <div class="cal-toolbar__group">
          <el-radio-group v-model="view" data-testid="cal-view-switch">
            <el-radio-button value="day">{{ t("booking.calendar.viewDay") }}</el-radio-button>
            <el-radio-button value="week">{{ t("booking.calendar.viewWeek") }}</el-radio-button>
            <el-radio-button value="resource">
              {{ t("booking.calendar.viewResource") }}
            </el-radio-button>
          </el-radio-group>
        </div>

        <div class="cal-toolbar__group cal-toolbar__filters">
          <div class="cal-field" data-testid="cal-store">
            <el-select
              v-model="storeId"
              :placeholder="t('booking.calendar.filterStore')"
              class="w-[200px]"
              @change="handleStoreChange"
            >
              <el-option
                v-for="store in storeOptions"
                :key="store.id"
                :label="store.name"
                :value="store.id"
              />
            </el-select>
          </div>

          <div class="cal-field" data-testid="cal-service-type">
            <el-select
              v-model="catType"
              :placeholder="t('booking.calendar.filterServiceType')"
              clearable
              class="w-[150px]"
            >
              <el-option
                v-for="option in serviceTypes"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </el-select>
          </div>

          <div class="cal-field" data-testid="cal-employee">
            <el-select
              v-model="employeeId"
              :placeholder="t('booking.calendar.filterEmployee')"
              clearable
              class="w-[150px]"
            >
              <el-option
                v-for="staff in staffOptions"
                :key="staff.id"
                :label="staff.name"
                :value="staff.id"
              />
            </el-select>
          </div>

          <div class="cal-field" data-testid="cal-status">
            <el-select
              v-model="status"
              :placeholder="t('booking.calendar.filterStatus')"
              clearable
              class="w-[140px]"
            >
              <el-option
                v-for="option in BOOKING_STATUS_OPTIONS"
                :key="option.value"
                :label="t(option.labelKey)"
                :value="option.value"
              />
            </el-select>
          </div>

          <el-tooltip :content="t('booking.calendar.refresh')" placement="top">
            <el-button class="page-icon-btn" data-testid="cal-refresh" @click="fetchCalendar">
              <el-icon><Refresh /></el-icon>
            </el-button>
          </el-tooltip>
        </div>
      </div>
    </el-card>

    <el-card class="page-content" shadow="never">
      <!-- 第 1 行（auto）：卡片配色图例 + 拖拽说明（PRD《页面功能》预约日历卡片状态配色） -->
      <div class="cal-legend" data-testid="cal-legend">
        <span class="cal-legend__title">{{ t("booking.calendar.legendTitle") }}</span>
        <span v-for="legend in LEGEND_ITEMS" :key="legend.status" class="cal-legend__item">
          <i class="cal-legend__dot" :class="`is-${legend.tone}`"></i>
          {{ t(legend.labelKey) }}
        </span>
        <span class="cal-legend__hint" data-testid="cal-drag-hint">
          {{ t("booking.calendar.dragHint") }}
        </span>
      </div>

      <!-- 第 2 行（1fr）：日历滚动区（三段式布局红线：正文只放 __head + __scroll） -->
      <div class="cal-scroll" data-testid="cal-scroll">
        <TableSkeleton v-if="showSkeleton" :column-count="4" :row-count="8" />

        <DataState
          v-else-if="loadError"
          variant="error"
          :title="t('booking.calendar.errorTitle')"
          :description="loadError"
          :action-text="t('booking.calendar.errorRetry')"
          @action="fetchCalendar"
        />

        <DataState
          v-else-if="!storeId"
          variant="empty"
          :title="t('booking.calendar.noStoreTitle')"
          :description="t('booking.calendar.noStoreDesc')"
        />

        <DataState
          v-else-if="items.length === 0"
          variant="empty"
          :title="t('booking.calendar.emptyTitle')"
          :description="t('booking.calendar.emptyDesc')"
        />

        <template v-else>
          <CalendarDayBoard
            v-if="view === 'day'"
            :lanes="dayLanes"
            :hover-key="hoverKey"
            :preview="preview"
            :dragging-id="draggingId"
            @dragstart="handleDragStart"
            @open="openDetail"
          />
          <CalendarTrackBoard
            v-else
            :groups="view === 'week' ? weekGroups : resourceGroups"
            :hover-key="hoverKey"
            :preview="preview"
            :dragging-id="draggingId"
            @dragstart="handleDragStart"
            @open="openDetail"
          />
        </template>
      </div>
    </el-card>

    <!-- 详情抽屉（复用 06-01；开关为交互瞬态，不写地址栏 —— 踩坑 95）。
         抽屉内的状态流转（06-05）落到 `updated` ⇒ 回源重取日历，保证视图与库一致。 -->
    <BookingDetailDrawer
      v-model="detailVisible"
      :booking-id="detailBookingId"
      @updated="handleDetailUpdated"
    />

    <!-- 拖拽幽灵（PRD「先本地预览」）：跟随指针，仅视觉反馈，落库前必过冲突检测 -->
    <div
      v-if="dragGhost"
      class="cal-ghost"
      data-testid="cal-drag-ghost"
      :style="{ left: `${dragGhost.x + 12}px`, top: `${dragGhost.y + 10}px` }"
    >
      {{ draggingBookingNo }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ElMessage } from "element-plus";
import { ArrowLeft, ArrowRight, Refresh } from "@element-plus/icons-vue";

import BookingAPI from "@/api/booking";
import type {
  BookingCalendarView,
  BookingConflictItem,
  BookingItem,
  BookingStaffOption,
} from "@/api/booking";
import RoomAPI from "@/api/room";
import StoreAPI from "@/api/store";
import DataState from "@/components/DataState/DataState.vue";
import TableSkeleton from "@/components/DataState/TableSkeleton.vue";
import BookingDetailDrawer from "@/views/booking/bookings/components/BookingDetailDrawer.vue";
import CalendarDayBoard from "./components/CalendarDayBoard.vue";
import CalendarTrackBoard from "./components/CalendarTrackBoard.vue";
import { useCalendarDrag } from "./components/useCalendarDrag";
import type { CalendarGroup, CalendarLane, CalendarPreview } from "./components/calendar-lane";
import {
  BOOKING_STATUS_OPTIONS,
  bookingCalendarTone,
  bookingClockLabel,
  bookingDateLabel,
  bookingDateSpan,
  bookingDurationMinutes,
  bookingMonthDayLabel,
  bookingShiftDay,
  bookingToday,
  bookingWeekdayIndex,
  type BookingCalendarTone,
} from "@/utils/booking";
import { hasPerm } from "@/utils/auth";
import { isApiError } from "@/utils/request";

/**
 * 预约日历（MVP-WEB-06-03 · PRD《页面功能》「预约日历」+《预约管理》FR-6）
 *
 * 规格来源：PRD《Web端页面清单》（路径 `bookings/calendar`，可见角色 超管 / 总部 /
 * 店长 / 前台 / 美容师 / 寄养员）+《页面功能》预约日历三视图 +《Web规范》
 * （§布局与栅格 3 三段式、§空态 / 加载 / 错误态、§权限与视图 1）。
 *
 * 三视图（PRD 原表）：
 *  1. **日视图**：纵轴时段（30 分钟粒度）、横轴资源（员工 + 未指派）⇒ `CalendarDayBoard`；
 *  2. **周视图**：纵轴日期、横轴时段概览 ⇒ `CalendarTrackBoard`（一个分组 × 7 根日期轨道）；
 *  3. **资源视图**：按美容师 / 房间分组 ⇒ `CalendarTrackBoard`（两个分组）。
 *
 * 拖拽改期：「先本地预览，落库前做冲突检测」（PRD）—— 本页用**指针拖拽 + 服务端
 * 冲突检测**实现前半段：拖到目标格 ⇒ 调 `POST /bookings/calendar/conflict-check` ⇒
 * 冲突则给出**结构化原因**（与哪张单、哪个资源冲突）并画红框预览，通过则画绿框预览。
 *
 * 🔴 **落库**：`handleDrop` 无冲突时调用 `landReschedule`（`POST /bookings/:id/reschedule`），
 * 原单置 `rescheduled` + 新单 `prev_booking_id` 互链 + 累计改期≥3 次店长二次确认。
 * 无论成败都回源重取日历，保证视图与库一致。
 *
 * 地址栏（§通用规则 2 可分享定位）：写 `storeId / date / view`（**身份级** —— 决定
 * 「看哪个门店哪一天的哪种视图」）+ 筛选项；`BookingDetailDrawer` 的开关与拖拽中的
 * 幽灵/预览是**交互瞬态**，一律不进 query（踩坑 95：query 即工作区组件缓存键）。
 */
defineOptions({ name: "BookingCalendar", inheritAttrs: false });

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

/* ─────────────────────────── 地址栏 ⇄ 状态 ─────────────────────────── */

const VIEW_VALUES: readonly BookingCalendarView[] = ["day", "week", "resource"];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function queryString(value: unknown): string | undefined {
  const text = Array.isArray(value) ? value[0] : value;
  return typeof text === "string" && text !== "" ? text : undefined;
}

/** 视图：非法 / 缺失回落 `day` */
function resolveView(value: unknown): BookingCalendarView {
  const text = queryString(value);
  return text && (VIEW_VALUES as readonly string[]).includes(text)
    ? (text as BookingCalendarView)
    : "day";
}

/** 日期：非法 / 缺失回落「今天」（`yyyy-MM-dd` 墙钟） */
function resolveDate(value: unknown): string {
  const text = queryString(value);
  return text && DATE_PATTERN.test(text) ? text : bookingToday();
}

/** 服务类型：只接受数字（值域由服务端 `serviceTypes` 派生，故不本地枚举） */
function resolveCatType(value: unknown): number | undefined {
  const text = queryString(value);
  const parsed = text ? Number(text) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** 状态：只接受值域内取值（`BOOKING_STATUS_OPTIONS` 是唯一来源） */
function resolveStatus(value: unknown): BookingItem["status"] | undefined {
  const text = queryString(value);
  return text && BOOKING_STATUS_OPTIONS.some((option) => option.value === text)
    ? (text as BookingItem["status"])
    : undefined;
}

const view = ref<BookingCalendarView>(resolveView(route.query.view));
const date = ref<string>(resolveDate(route.query.date));
const storeId = ref<string>(queryString(route.query.storeId) ?? "");
const employeeId = ref<string>(queryString(route.query.employeeId) ?? "");
const catType = ref<number | undefined>(resolveCatType(route.query.catType));
const status = ref<BookingItem["status"] | undefined>(resolveStatus(route.query.status));

/** 地址栏同步（重复导航被 vue-router 拒绝，静默忽略） */
function syncUrl(): Promise<void> {
  // 门店未就绪时不写地址栏（避免出现 `?storeId=` 这种「空身份」的分享链接）
  if (!storeId.value) return Promise.resolve();
  const query: Record<string, string> = {
    storeId: storeId.value,
    date: date.value,
    view: view.value,
  };
  if (employeeId.value) query.employeeId = employeeId.value;
  if (catType.value !== undefined) query.catType = String(catType.value);
  if (status.value) query.status = status.value;

  return router.replace({ path: route.path, query }).then(
    () => undefined,
    () => undefined
  );
}

/* ─────────────────────────── 数据 ─────────────────────────── */

const storeOptions = ref<Array<{ id: string; name: string }>>([]);
const staffOptions = ref<BookingStaffOption[]>([]);
const roomOptions = ref<Array<{ id: string; label: string }>>([]);
const serviceTypes = ref<Array<{ value: number; label: string }>>([]);

const items = ref<BookingItem[]>([]);
const loading = ref(false);
const loadError = ref("");
const hasLoaded = ref(false);
const showSkeleton = computed(() => loading.value && !hasLoaded.value);

/** 查询窗口：日 / 资源视图 = 当天；周视图 = 所在自然周（周一 ~ 周日） */
const rangeStart = computed(() => (view.value === "week" ? weekStartOf(date.value) : date.value));
const rangeEnd = computed(() =>
  view.value === "week" ? bookingShiftDay(rangeStart.value, 6) : date.value
);

/** 周一为一周之首（`getUTCDay` 周日 = 0） */
function weekStartOf(day: string): string {
  const index = bookingWeekdayIndex(day);
  if (index === null) return day;
  return bookingShiftDay(day, -((index + 6) % 7));
}

const rangeLabel = computed(() => {
  if (view.value !== "week") return date.value;
  return `${rangeStart.value} ~ ${rangeEnd.value}`;
});

/** 拉取日历（错误收口：可读原因 + 重试） */
async function fetchCalendar(): Promise<void> {
  if (!storeId.value) {
    items.value = [];
    hasLoaded.value = true;
    return;
  }
  loadError.value = "";
  loading.value = true;
  try {
    const result = await BookingAPI.getCalendar({
      storeId: storeId.value,
      dateStart: rangeStart.value,
      dateEnd: rangeEnd.value,
      employeeId: employeeId.value || undefined,
      catType: catType.value,
      status: status.value,
    });
    items.value = result.items ?? [];
    serviceTypes.value = result.serviceTypes ?? [];
  } catch (error) {
    items.value = [];
    loadError.value = isApiError(error) ? error.message : String(error ?? "");
  } finally {
    loading.value = false;
    hasLoaded.value = true;
  }
}

async function fetchStoreOptions(): Promise<void> {
  try {
    const data = await StoreAPI.getPage({
      pageNum: 1,
      pageSize: 100,
      sortBy: "createdAt",
      order: "ASC",
    });
    storeOptions.value = (data.list ?? []).map((item) => ({ id: item.id, name: item.name }));
  } catch {
    storeOptions.value = [];
  }
  // 未指定门店（首次进入）⇒ 回落首家门店，日历恒有确定的数据源
  if (!storeId.value && storeOptions.value.length > 0) {
    storeId.value = storeOptions.value[0].id;
  }
}

/** 门店选择变更（显式绑定 `@change`，避免用 watcher 触发首屏重复取数） */
function handleStoreChange(): void {
  employeeId.value = "";
  preview.value = null;
  void fetchStaffOptions();
  void fetchRoomOptions();
}

async function fetchStaffOptions(): Promise<void> {
  if (!storeId.value) {
    staffOptions.value = [];
    return;
  }
  try {
    staffOptions.value = await BookingAPI.getReferenceStaffs({ storeId: storeId.value });
  } catch {
    staffOptions.value = [];
  }
}

async function fetchRoomOptions(): Promise<void> {
  if (!storeId.value) {
    roomOptions.value = [];
    return;
  }
  try {
    const data = await RoomAPI.getPage({
      pageNum: 1,
      pageSize: 100,
      storeId: storeId.value,
      sortBy: "roomNo",
      order: "ASC",
    });
    roomOptions.value = (data.list ?? []).map((item) => ({
      id: item.id,
      label: item.name ?? item.roomNo,
    }));
  } catch {
    roomOptions.value = [];
  }
}

/* ─────────────────────────── 分桶（轨道） ─────────────────────────── */

/** 同一日历日的判断（按字符串分量，不构造 Date） */
function onDay(booking: BookingItem, day: string): boolean {
  return bookingDateLabel(booking.bookingDate) === day;
}

const dayLanes = computed<CalendarLane[]>(() => {
  const day = date.value;
  const staff = employeeId.value
    ? staffOptions.value.filter((item) => item.id === employeeId.value)
    : staffOptions.value;
  const lanes: CalendarLane[] = staff.map((item) => ({
    key: `emp:${item.id}`,
    label: item.name,
    date: day,
    employeeId: item.id,
    roomId: null,
    bookings: items.value.filter(
      (booking) => booking.employeeId === item.id && onDay(booking, day)
    ),
  }));
  // 「未指派」列：未指定员工的预约也要可见（否则排期会「丢单」）
  lanes.push({
    key: "emp:",
    label: t("booking.calendar.laneUnassigned"),
    date: day,
    employeeId: null,
    roomId: null,
    bookings: items.value.filter((booking) => !booking.employeeId && onDay(booking, day)),
  });
  return lanes;
});

const weekGroups = computed<CalendarGroup[]>(() => {
  const days = bookingDateSpan(rangeStart.value, rangeEnd.value);
  return [
    {
      key: "week",
      label: t("booking.calendar.groupDate"),
      lanes: days.map((day) => ({
        key: `day:${day}`,
        label: weekDayLabel(day),
        date: day,
        employeeId: null,
        roomId: null,
        bookings: items.value.filter((booking) => onDay(booking, day)),
      })),
    },
  ];
});

const resourceGroups = computed<CalendarGroup[]>(() => {
  const day = date.value;
  const staff = employeeId.value
    ? staffOptions.value.filter((item) => item.id === employeeId.value)
    : staffOptions.value;
  const employeeLanes: CalendarLane[] = [
    ...staff.map((item) => ({
      key: `emp:${item.id}`,
      label: item.name,
      date: day,
      employeeId: item.id,
      roomId: null,
      bookings: items.value.filter(
        (booking) => booking.employeeId === item.id && onDay(booking, day)
      ),
    })),
    {
      key: "emp:",
      label: t("booking.calendar.laneUnassigned"),
      date: day,
      employeeId: null,
      roomId: null,
      bookings: items.value.filter((booking) => !booking.employeeId && onDay(booking, day)),
    },
  ];
  const roomLanes: CalendarLane[] = roomOptions.value.map((room) => ({
    key: `room:${room.id}`,
    label: room.label,
    date: day,
    employeeId: null,
    roomId: room.id,
    bookings: items.value.filter((booking) => booking.roomId === room.id && onDay(booking, day)),
  }));
  return [
    { key: "employee", label: t("booking.calendar.groupEmployee"), lanes: employeeLanes },
    { key: "room", label: t("booking.calendar.groupRoom"), lanes: roomLanes },
  ];
});

/** 周视图行标签：`MM-DD 周X` */
function weekDayLabel(day: string): string {
  const index = bookingWeekdayIndex(day);
  const prefix = t("booking.calendar.weekdayPrefix");
  const names = [
    t("booking.calendar.weekSun"),
    t("booking.calendar.weekMon"),
    t("booking.calendar.weekTue"),
    t("booking.calendar.weekWed"),
    t("booking.calendar.weekThu"),
    t("booking.calendar.weekFri"),
    t("booking.calendar.weekSat"),
  ];
  const name = index === null ? "" : (names[index] ?? "");
  return `${bookingMonthDayLabel(day)} ${prefix}${name}`;
}

/* ─────────────────────────── 图例 ─────────────────────────── */

const LEGEND_ITEMS: ReadonlyArray<{
  status: BookingItem["status"];
  labelKey: string;
  tone: BookingCalendarTone;
}> = [
  {
    status: "pending",
    labelKey: "booking.value.statusPending",
    tone: bookingCalendarTone("pending"),
  },
  {
    status: "confirmed",
    labelKey: "booking.value.statusConfirmed",
    tone: bookingCalendarTone("confirmed"),
  },
  {
    status: "in_service",
    labelKey: "booking.value.statusInService",
    tone: bookingCalendarTone("in_service"),
  },
  {
    status: "completed",
    labelKey: "booking.value.statusCompleted",
    tone: bookingCalendarTone("completed"),
  },
  {
    status: "no_show",
    labelKey: "booking.value.statusNoShow",
    tone: bookingCalendarTone("no_show"),
  },
];

/* ─────────────────────────── 拖拽改期（预览 + 冲突检测） ─────────────────────────── */

const preview = ref<CalendarPreview | null>(null);

const drag = useCalendarDrag((booking, slot) => {
  void handleDrop(booking, slot);
});

const hoverKey = computed(() => drag.hover.value?.laneKey ?? null);
const draggingId = computed(() => drag.dragging.value?.id ?? null);
const dragGhost = computed(() => drag.ghost.value);
const draggingBookingNo = computed(() => drag.dragging.value?.bookingNo ?? "");

/**
 * 拖拽资格：仅 `confirmed` 状态且持有 `booking:reschedule` 权限的预约可拖
 *
 * 改期只能从 `confirmed` 发起（状态机裁定），其余状态拖拽无意义（后端会 30002 拒绝）。
 * 权限维度防止「拖了必然 403」的交互浪费。
 */
function canDragBooking(booking: BookingItem): boolean {
  return booking.status === "confirmed" && hasPerm("booking:reschedule");
}

function handleDragStart(event: MouseEvent, booking: BookingItem): void {
  if (!canDragBooking(booking)) return;
  preview.value = null;
  drag.start(event, booking);
}

/**
 * 落点处理：先冲突检测（只读），无冲突则落库改期
 */
async function handleDrop(
  booking: BookingItem,
  slot: {
    laneKey: string;
    date: string;
    minute: number;
    employeeId: string | null;
    roomId: string | null;
  } | null
): Promise<void> {
  if (!slot) {
    ElMessage.warning(t("booking.calendar.dragOutside"));
    return;
  }
  const slotDate = slot.date || date.value;
  const duration = bookingDurationMinutes(booking.startTime, booking.endTime) || 60;
  const startAt = `${slotDate} ${bookingClockLabel(slot.minute)}`;

  try {
    const result = await BookingAPI.checkConflict({
      storeId: storeId.value,
      petId: booking.petId,
      // 服务项可为空（06-01 的演示预约 service_id 为 NULL）⇒ 空则不带，后端跳过服务项校验
      serviceId: booking.serviceId ?? undefined,
      employeeId: slot.employeeId ?? undefined,
      roomId: slot.roomId ?? undefined,
      startAt,
      durationMinutes: duration,
      excludeBookingId: booking.id,
    });
    preview.value = {
      laneKey: slot.laneKey,
      minute: slot.minute,
      durationMinutes: duration,
      valid: !result.hasConflict,
    };
    if (result.hasConflict) {
      ElMessage.warning(
        t("booking.calendar.conflictTitle", { count: result.conflicts.length }) +
          " — " +
          describeConflicts(result.conflicts)
      );
    } else {
      // 无冲突 ⇒ 落库改期（06-05）：拖拽是「改期」的第二种入口
      await landReschedule(booking, startAt);
    }
  } catch {
    // 错误文案由请求层统一渲染；预览块不落地（避免呈现未经裁定的「可用」结论）
    preview.value = null;
  }
}

/**
 * 拖拽落点改期（MVP-WEB-06-05）
 *
 * 契约与详情抽屉的改期对话框**同一端点**（`POST /bookings/:id/reschedule`）：
 *  - 只换时间（拖拽不改房间）⇒ 不带 `roomId`，服务端沿用原单房间；
 *  - **不带 `durationMinutes`**：时长沿用服务端按本单实际时段算出的值
 *    （`durationOf(row)` = 真实 `end - start`）—— 本页的分钟差算法只按「同日 HH:mm」
 *    取值，跨天单会算错，故此处不把前端时长写进库（一处判据一处来源，踩坑 126-bis）；
 *  - 带 `version` ⇒ 参与服务端 CAS（拖拽时视图可能已经过期）；
 *  - `reason` 取本页文案：改期会把它写进原单备注与新单备注（业务数据，随操作者语言）。
 *
 * 无论成败都**回源重取**日历：失败往往是 `30001`（员工并发 / 房间逐日容量）或
 * `30002`（并发被改）—— 后者意味着当前视图已过期，必须对齐真实状态，而不是让用户
 * 对着一份旧快照反复拖。
 */
async function landReschedule(booking: BookingItem, startAt: string): Promise<void> {
  try {
    const result = await BookingAPI.rescheduleBooking(booking.id, {
      startAt,
      reason: t("booking.calendar.dragRescheduleReason"),
      version: booking.version,
    });
    ElMessage.success(t("booking.calendar.dragSuccess", { no: result.booking.bookingNo }));
  } catch {
    // 错误文案由请求层统一渲染（容量冲突 / 改期超限 / 状态非法）
  } finally {
    preview.value = null;
    await fetchCalendar();
  }
}

/** 详情抽屉内发生流转 ⇒ 回源重取日历 */
function handleDetailUpdated(): void {
  void fetchCalendar();
}

/** 冲突明细 → 可读原因（判据来自服务端下发的 `rule` / `resourceType`，前端只做文案映射） */
function describeConflicts(conflicts: BookingConflictItem[]): string {
  return conflicts
    .map((conflict) => {
      if (conflict.rule === "pet_overlap") {
        return t("booking.calendar.conflictPetOverlap", { no: conflict.bookingNo });
      }
      if (conflict.resourceType === "room") {
        return t("booking.calendar.conflictRoom", { no: conflict.bookingNo });
      }
      return t("booking.calendar.conflictEmployee", { no: conflict.bookingNo });
    })
    .join("；");
}

/* ─────────────────────────── 导航 / 筛选联动 ─────────────────────────── */

/** 日 / 周步长：日视图与资源视图按天，周视图按周 */
function shiftDate(direction: number): void {
  const step = view.value === "week" ? 7 : 1;
  date.value = bookingShiftDay(date.value, direction * step);
  preview.value = null;
}

function goToday(): void {
  date.value = bookingToday();
  preview.value = null;
}

watch([view, date], () => {
  preview.value = null;
});

/**
 * 唯一的取数触发点
 *
 * `immediate: true` ⇒ 首屏也走这一条路径（storeId 未就绪时 `fetchCalendar` 早退，
 * 待 `fetchStoreOptions` 补出首家门店后自动再触发一次），避免 onMounted 与 watcher
 * 各发一次请求。
 */
watch(
  [storeId, date, view, employeeId, catType, status],
  () => {
    void syncUrl();
    void fetchCalendar();
  },
  { immediate: true }
);

// 资源视图专门需要房间候选（进视图时补拉，避免首屏多一路请求）
watch(
  () => view.value,
  (next) => {
    if (next === "resource" && roomOptions.value.length === 0) void fetchRoomOptions();
  }
);

// 下拉清空归一（`el-select` 清空可能置空串 / null）：空串发给后端会撞 `@IsInt` / `@IsIn` 校验
watch(catType, (value) => {
  const raw = value as unknown;
  if (raw === "" || raw === null || raw === undefined) catType.value = undefined;
});

watch(status, (value) => {
  const raw = value as unknown;
  if (raw === "" || raw === null || raw === undefined) {
    status.value = undefined;
    return;
  }
  if (!BOOKING_STATUS_OPTIONS.some((option) => option.value === raw)) status.value = undefined;
});

watch(employeeId, (value) => {
  if (value === null || value === undefined) employeeId.value = "";
});

/* ─────────────────────────── 详情抽屉 ─────────────────────────── */

const detailVisible = ref(false);
const detailBookingId = ref("");

function openDetail(booking: BookingItem): void {
  detailBookingId.value = booking.id;
  detailVisible.value = true;
}

/* ─────────────────────────── 初始化 ─────────────────────────── */

onMounted(async () => {
  await fetchStoreOptions();
  await fetchStaffOptions();
  await fetchRoomOptions();
});

/* ─────────────────── keep-alive 激活期的地址栏对齐 ─────────────────── */

/**
 * 地址栏 → 内存态（返回是否发生实际变化）
 *
 * `storeId` 缺失时保留当前值（分享链接不带门店时不至于把已选门店清空）。
 */
function alignFromRoute(): boolean {
  const snapshot = (): string =>
    [
      view.value,
      date.value,
      storeId.value,
      employeeId.value,
      catType.value ?? "",
      status.value ?? "",
    ].join("|");
  const before = snapshot();
  view.value = resolveView(route.query.view);
  date.value = resolveDate(route.query.date);
  storeId.value = queryString(route.query.storeId) ?? storeId.value;
  employeeId.value = queryString(route.query.employeeId) ?? "";
  catType.value = resolveCatType(route.query.catType);
  status.value = resolveStatus(route.query.status);
  return before !== snapshot();
}

/**
 * 非首次激活：按地址栏对齐 + 回源刷新（踩坑 122 / 125）
 *
 * 工作区组件以 `route.fullPath` 为 keep-alive 缓存键 ⇒ 当 query 回到**用过的组合**
 * 时命中旧缓存实例，`setup` / `onMounted` 不重跑、内存态滞留，表现为「URL 已变而
 * 渲染未变」。本页的视图 / 日期 / 门店 / 筛选项全部是内存 ref，故必须在激活时按
 * 地址栏重对齐；对齐后若**无变化**说明命中的是同一身份组合（watcher 不会触发），
 * 此时补一次回源刷新即可 —— 两条路径互斥，不会造成首屏或激活期双请求。
 *
 * ⚠️ `onActivated` **首挂也会触发**（踩坑 125）⇒ 用 `activatedOnce` 挡掉首次，
 * 首屏取数仍由 `onMounted` + `immediate` watcher 负责。
 */
let activatedOnce = false;

onActivated(() => {
  if (!activatedOnce) {
    activatedOnce = true;
    return;
  }
  if (!alignFromRoute()) void fetchCalendar();
});
</script>

<style lang="scss" scoped>
.cal-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
}

.cal-toolbar__group {
  display: flex;
  gap: 8px;
  align-items: center;
}

.cal-toolbar__filters {
  flex-wrap: wrap;
}

.cal-toolbar__range {
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--el-text-color-primary);
}

.cal-field {
  width: auto;
}

.cal-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  align-items: center;
  margin-bottom: var(--page-gap);
  font-size: 12px;
  color: var(--el-text-color-regular);
}

.cal-legend__title {
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.cal-legend__item {
  display: inline-flex;
  gap: 5px;
  align-items: center;
}

.cal-legend__dot {
  width: 10px;
  height: 10px;
  border-radius: 2px;

  &.is-gray {
    background: #d1d5db;
  }
  &.is-blue {
    background: var(--peluvida-color-info);
  }
  &.is-green {
    background: var(--peluvida-color-success);
  }
  &.is-dark {
    background: #4b5563;
  }
  &.is-red {
    background: var(--peluvida-color-danger);
  }
  &.is-muted {
    background: #e5e7eb;
  }
}

.cal-legend__hint {
  margin-left: auto;
  color: var(--el-text-color-secondary);
}

/* 滚动区：作为内容卡 body 的第 2 个直接子元素落在 1fr 行 */
.cal-scroll {
  min-height: 0;
  overflow: auto;
}

.cal-ghost {
  position: fixed;
  z-index: 3000;
  padding: 2px 8px;
  font-size: 12px;
  color: #fff;
  pointer-events: none;
  background: var(--el-color-primary);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgb(0 0 0 / 20%);
}
</style>
