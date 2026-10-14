<template>
  <el-drawer
    v-model="visible"
    :title="t('booking.detail.title')"
    :size="drawerSize"
    :close-on-click-modal="false"
    destroy-on-close
    class="booking-detail"
    @closed="handleClosed"
  >
    <div v-loading="detailLoading" class="booking-detail__body">
      <DataState
        v-if="detailError"
        variant="error"
        :title="t('booking.empty.errorTitle')"
        :description="detailError"
        :action-text="t('booking.empty.errorRetry')"
        @action="loadDetail"
      />

      <template v-else-if="detail">
        <div class="booking-detail__card">
          <div class="booking-detail__card-row">
            <span class="booking-detail__no">{{ detail.bookingNo }}</span>
            <el-tag :type="bookingStatusTagType(detail.status)" size="small">
              {{ t(bookingStatusLabelKey(detail.status)) }}
            </el-tag>
          </div>
          <div class="booking-detail__card-row booking-detail__card-row--sub">
            <span>{{ bookingDateLabel(detail.bookingDate) }}</span>
            <span class="booking-detail__divider">·</span>
            <span>{{ bookingTimeRangeLabel(detail.startTime, detail.endTime) }}</span>
          </div>
        </div>

        <!-- 动作区（MVP-WEB-06-05）：**状态机 × 权限**双维度渲染 —— 非法状态下的按钮
             不出现（PRD《页面功能》验收要点），无权限的动作也不出现（§权限与视图 1）。
             判据全部来自 `@peluvida/shared`（`listBookingActionsFrom`）+ 权限码表，
             本组件不写任何状态机规则。 -->
        <div
          v-if="actions.length"
          class="booking-detail__actions"
          data-testid="booking-detail-actions"
        >
          <span class="booking-detail__actions-label">{{ t("booking.detail.actions") }}</span>
          <div class="booking-detail__actions-btns">
            <el-button
              v-for="action in actions"
              :key="action"
              size="small"
              :type="bookingActionButtonType(action)"
              :loading="pendingAction === action"
              :data-testid="`booking-action-${action}`"
              @click="handleAction(action)"
            >
              {{ t(bookingActionLabelKey(action)) }}
            </el-button>
          </div>
        </div>

        <!-- 确认被容量拒绝（30001）⇒ 明细 + 可替代时段（与 capacity-check 出参同形） -->
        <div v-if="conflict" class="booking-detail__feedback" data-testid="booking-detail-conflict">
          <el-alert
            type="warning"
            :closable="false"
            show-icon
            :title="t('booking.form.capacity.capacityUnavailable')"
          />
          <ul class="booking-detail__feedback-list">
            <li
              v-for="(item, index) in conflict.conflicts"
              :key="index"
              data-testid="booking-detail-conflict-item"
            >
              {{ describeConflict(item) }}
            </li>
          </ul>
          <el-button
            v-if="conflict.suggestions.length"
            type="primary"
            link
            size="small"
            data-testid="booking-detail-conflict-hint"
            @click="openRescheduleWithSuggestion"
          >
            {{ t("booking.cancel.suggestionHint") }}
          </el-button>
        </div>

        <!-- 取消档位结果（服务端裁定）⇒ 就地横幅（比一闪而过的 toast 更可读） -->
        <div v-if="feeRule" class="booking-detail__feedback" data-testid="booking-detail-fee">
          <el-alert
            :type="feeRule.chargeable ? 'warning' : 'success'"
            :closable="true"
            show-icon
            :title="t(bookingCancelFeeLabelKey(feeRule.policy))"
            @close="feeRule = null"
          >
            <div class="booking-detail__fee-desc" data-testid="booking-detail-fee-desc">
              {{
                t("booking.cancel.feeDetail", {
                  hours: feeRule.hoursBeforeStart,
                  cutoff: feeRule.cutoffHours,
                  tight: feeRule.tightWindowHours,
                })
              }}
            </div>
          </el-alert>
        </div>

        <el-descriptions
          :title="t('booking.detail.baseInfo')"
          :column="1"
          border
          size="small"
          class="booking-detail__desc"
        >
          <el-descriptions-item :label="t('booking.field.bookingNo')">
            {{ detail.bookingNo }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('booking.field.status')">
            <el-tag :type="bookingStatusTagType(detail.status)" size="small">
              {{ t(bookingStatusLabelKey(detail.status)) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item :label="t('booking.field.store')">
            {{ detail.storeName ?? t("booking.value.unset") }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('booking.field.customer')">
            {{ detail.customerName ?? t("booking.value.unset") }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('booking.field.pet')">
            {{ detail.petName ?? t("booking.value.unset") }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('booking.field.service')">
            {{ detail.serviceName ?? t("booking.value.unset") }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('booking.field.employee')">
            {{ detail.employeeName ?? t("booking.value.unset") }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('booking.field.room')">
            {{ detail.roomLabel ?? t("booking.value.unset") }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('booking.field.appointmentDate')">
            {{ bookingDateLabel(detail.bookingDate) }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('booking.field.timeRange')">
            {{ bookingTimeRangeLabel(detail.startTime, detail.endTime) }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('booking.field.remark')">
            {{ detail.remark || t("booking.value.unset") }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('booking.field.createdAt')">
            {{ formatTime(detail.createdAt) }}
          </el-descriptions-item>
        </el-descriptions>
      </template>
    </div>

    <template #footer>
      <el-button @click="visible = false">{{ t("booking.detail.close") }}</el-button>
    </template>
  </el-drawer>

  <!-- 改期 / 取消对话框：作为抽屉的**兄弟节点**（而非嵌在抽屉内部），避免被抽屉的
       层级与裁剪影响；两者 `append-to-body`，沿用「写操作 = 对话框」的既定范式 -->
  <BookingRescheduleDialog
    v-model="rescheduleVisible"
    :booking="detail"
    @success="handleDialogSuccess"
  />
  <BookingCancelDialog v-model="cancelVisible" :booking="detail" @success="handleDialogSuccess" />
</template>

<script setup lang="ts">
import { ElMessage, ElMessageBox } from "element-plus";

import BookingAPI from "@/api/booking";
import type {
  BookingAction,
  BookingCapacityCheckResult,
  BookingCapacityConflict,
  BookingItem,
  BookingTransitionPayload,
  BookingTransitionResult,
} from "@/api/booking";
import DataState from "@/components/DataState/DataState.vue";
import { DeviceEnum } from "@/enums";
import { useAppStore } from "@/stores";
import { hasPerm } from "@/utils/auth";
import {
  bookingActionButtonType,
  bookingActionLabelKey,
  bookingActionPermission,
  bookingActionsForStatus,
  bookingCancelFeeLabelKey,
  bookingDateLabel,
  bookingStatusLabelKey,
  bookingStatusTagType,
  bookingTimeRangeLabel,
  readBookingConflictDetails,
  readBookingTransitionDetails,
} from "@/utils/booking";
import { formatTableDateTime } from "@/utils/format";
import { ApiError, isApiError } from "@/utils/request";
import BookingCancelDialog from "./BookingCancelDialog.vue";
import BookingRescheduleDialog from "./BookingRescheduleDialog.vue";

/**
 * 预约详情抽屉（MVP-WEB-06-01 预约列表与状态展示；06-05 状态流转动作区）
 *
 * 规格来源：PRD《Web端页面清单》（路径 `bookings/:booking_id`，可见角色 超管 / 总部 /
 * 店长 / 前台 / 美容师 / 寄养员）+《预约管理》BR-1 状态机 +《Booking API》
 * `GET /bookings/:id` + 七个流转端点 +《Web规范》（§页面模式 1「详情一律用右侧抽屉
 * 呈现而非跳页，保留列表上下文」、§布局与栅格 2「右侧明细抽屉宽 480px」、
 * §空态/加载/错误态 1）+《页面功能》（预约日历：「点击卡片打开详情抽屉，内含确认、
 * 改期、开单、取消四个动作」）。
 *
 * 为什么不建独立路由：详情内容为**单页只读字段表**（12 个字段，无多页签 / 无长列表），
 * 未超出 480px 抽屉容量 —— 与「宠物档案」因 5 页签 + 长列表改走独立路由的情形不同
 * （见踩坑 123）。抽屉开关是**交互瞬态，不写地址栏**：工作区组件按 `route.fullPath`
 * 重建（踩坑 95），写 query 会在每次开合时整页重建并丢失列表筛选与滚动位置。
 *
 * 🔴 动作区（06-05）双判据：
 *  ① **状态机**：`bookingActionsForStatus` ⇒ shared `listBookingActionsFrom` ⇒
 *     `BOOKING_ACTION_META` ⇒ `BOOKING_STATUS_TRANSITIONS`（三者有模块加载期守卫，
 *     漂移即启动报错）—— 非法状态的按钮不渲染；
 *  ② **权限**：每个动作各有一个权限码（`booking:confirm` / `booking:checkin` /
 *     `booking:start` / `booking:complete` / `booking:reschedule` / `booking:cancel` /
 *     `booking:no-show`），无码不渲染 —— 避免出现「点了必然 403」的按钮。
 *
 * 流转结果的消费口径：**就地刷新**（服务端统一出参里已带流转后的 `booking`）——
 * 不补一次 `GET /bookings/:id`：多一次请求既撞 IP 限流（1s/10 次），也会读到流转后的
 * 新状态而与本动作的 `fromStatus` 对不上（后端注释同一口径）。
 * 改期时 `result.booking` 是**承担新时段的新单** ⇒ 本组件把抽屉切到新单（`activeId`），
 * 用户不需要去列表里再找一次。
 *
 * 展示口径：
 *  · 状态文案 / 语义色唯一取 `@peluvida/shared`（经 `utils/booking.ts` 派生），
 *    本组件不私写状态映射表；
 *  · 关联实体经服务端回查补齐，缺失时渲染 `booking.value.unset`（不渲染裸 UUID）；
 *  · 未上线字段直接不渲染（PRD《Web规范》§权限与视图 1），不渲染 0 值占位 ——
 *    「开单」（生成关联订单）即此列：订单域尚未建模，故**不渲染**该入口
 *    （PRD《页面功能》四个动作里的第四个），而不是渲染一个点不动的按钮。
 *
 * ⚠️ 边界：动作失败时请求层会按统一出口弹一次 toast（`ElMessage.error`），本组件
 * 额外为两类可**就地纠正**的失败补上下文面板 —— `30001` 容量冲突（明细 + 可替代时段）
 * 与 `30002` 的 `concurrent_modification`（提示刷新并重取详情）。二者不冲突：toast 说
 * 「发生了什么」，面板说「怎么办」。
 */
defineOptions({ name: "BookingDetailDrawer", inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    /** 抽屉可见性（v-model） */
    modelValue: boolean;
    /** 预约 ID（打开时必填） */
    bookingId?: string;
  }>(),
  { bookingId: "" }
);

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  /** 发生状态流转（父级据此重取列表 / 日历，保持与抽屉内容一致） */
  updated: [];
}>();

const { t } = useI18n();
const appStore = useAppStore();

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

/** 抽屉宽度：《Web规范》§布局与栅格 2（桌面 480px，md 及以下整页） */
const drawerSize = computed(() => (appStore.device === DeviceEnum.DESKTOP ? "480px" : "100%"));

const detail = ref<BookingItem | null>(null);
const detailLoading = ref(false);
const detailError = ref("");

/**
 * 当前展示的预约 id
 *
 * 初始 = 父级传入的 `bookingId`；改期成功后**切到新单**（承载新时段的单才是「当前单」，
 * 原单已进入 `rescheduled` 终态）。父级每次换 `bookingId` 时重置回传入值。
 */
const activeId = ref("");

/** 动作请求进行中的动作（按钮 loading，避免重复提交） */
const pendingAction = ref<BookingAction | null>(null);
/** 确认被容量拒绝的明细（30001） */
const conflict = ref<BookingCapacityCheckResult | null>(null);
/** 取消档位结果（服务端裁定，横幅展示） */
const feeRule = ref<BookingTransitionResult["feeRule"]>(null);

const rescheduleVisible = ref(false);
const cancelVisible = ref(false);

/**
 * 可执行动作（状态机 × 权限）
 *
 * 顺序沿用 `@peluvida/shared` 的 `BOOKING_ACTION_META` 声明顺序（主链路在前、
 * 负向终态在后），保证同一状态下按钮次序稳定。
 */
const actions = computed<BookingAction[]>(() =>
  bookingActionsForStatus(detail.value?.status, (action) =>
    hasPerm(bookingActionPermission(action))
  )
);

/** 拉取详情（错误态与重试共用同一入口） */
async function loadDetail(): Promise<void> {
  const id = activeId.value || props.bookingId;
  if (!id) return;
  detailLoading.value = true;
  detailError.value = "";
  try {
    detail.value = await BookingAPI.getDetail(id);
  } catch (error) {
    detail.value = null;
    detailError.value = isApiError(error) ? error.message : String(error ?? "");
  } finally {
    detailLoading.value = false;
  }
}

/** 时间列格式化（三天内相对表达，其余 `YYYY-MM-DD HH:mm`） */
function formatTime(value: unknown): string {
  return formatTableDateTime(value as string, {
    today: t("time.today"),
    yesterday: t("time.yesterday"),
    beforeYesterday: t("time.beforeYesterday"),
  });
}

/** 冲突文案（结构化事实 → i18n；与创建 / 改期表单共用 `booking.form.capacity.*`） */
function describeConflict(item: BookingCapacityConflict): string {
  if (item.rule === "pet_overlap") {
    return t("booking.form.capacity.conflictPet", { nos: item.bookingNos.join("、") });
  }
  if (item.resourceType === "employee") {
    return t("booking.form.capacity.conflictEmployee", {
      name: item.resourceName ?? "-",
      occupied: item.occupied ?? 0,
      limit: item.limit ?? 0,
    });
  }
  return t("booking.form.capacity.conflictRoom", {
    name: item.resourceName ?? "-",
    date: item.date ?? "-",
    occupied: item.occupied ?? 0,
    limit: item.limit ?? 0,
  });
}

/** 冲突建议时段 ⇒ 打开改期对话框（把「确认失败」变成「换个时段」的下一步动作） */
function openRescheduleWithSuggestion(): void {
  rescheduleVisible.value = true;
}

/**
 * 无表单动作（确认 / 到店登记 / 开始服务 / 完成服务 / 标记爽约）的元信息
 *
 * 一律先强确认再落库（PRD《交互规范》§错误预防与恢复：不可逆或跨状态的操作需二次确认）。
 * `call` 用箭头函数而非直接引用 `BookingAPI` 的方法：避免 `this` 绑定歧义与
 * `unbound-method` 静态检查告警。
 */
const SIMPLE_ACTIONS: Partial<
  Record<
    BookingAction,
    {
      titleKey: string;
      messageKey: string;
      call: (id: string, payload: BookingTransitionPayload) => Promise<BookingTransitionResult>;
    }
  >
> = {
  confirm: {
    titleKey: "booking.transition.confirmTitle",
    messageKey: "booking.transition.confirmMessage",
    call: (id, payload) => BookingAPI.confirmBooking(id, payload),
  },
  checkin: {
    titleKey: "booking.transition.checkinTitle",
    messageKey: "booking.transition.checkinMessage",
    call: (id, payload) => BookingAPI.checkinBooking(id, payload),
  },
  start: {
    titleKey: "booking.transition.startTitle",
    messageKey: "booking.transition.startMessage",
    call: (id, payload) => BookingAPI.startBooking(id, payload),
  },
  complete: {
    titleKey: "booking.transition.completeTitle",
    messageKey: "booking.transition.completeMessage",
    call: (id, payload) => BookingAPI.completeBooking(id, payload),
  },
  "no-show": {
    titleKey: "booking.transition.noShowTitle",
    messageKey: "booking.transition.noShowMessage",
    call: (id, payload) => BookingAPI.noShowBooking(id, payload),
  },
};

/** 流转成功后统一收口：就地换内容 + 通知父级刷新列表 */
function applyResult(result: BookingTransitionResult): void {
  detail.value = result.booking;
  activeId.value = result.booking.id;
  conflict.value = null;
  feeRule.value = result.feeRule;
}

/** 对话框（改期 / 取消）成功回调 */
function handleDialogSuccess(result: BookingTransitionResult): void {
  const isReschedule = result.action === "reschedule";
  ElMessage.success(
    isReschedule
      ? t("booking.reschedule.success", { no: result.booking.bookingNo })
      : t("booking.cancel.success")
  );
  applyResult(result);
}

/** 动作入口：表单类动作开对话框，其余走强确认后直接调用 */
async function handleAction(action: BookingAction): Promise<void> {
  if (!detail.value) return;
  if (action === "reschedule") {
    rescheduleVisible.value = true;
    return;
  }
  if (action === "cancel") {
    cancelVisible.value = true;
    return;
  }

  const meta = SIMPLE_ACTIONS[action];
  if (!meta) return;
  const booking = detail.value;
  try {
    await ElMessageBox.confirm(
      t(meta.messageKey, {
        no: booking.bookingNo,
        pet: booking.petName ?? t("booking.value.unset"),
      }),
      t(meta.titleKey),
      {
        confirmButtonText: t("booking.transition.submit"),
        cancelButtonText: t("booking.form.cancel"),
        type: action === "no-show" ? "warning" : "info",
      }
    );
  } catch {
    return;
  }

  pendingAction.value = action;
  try {
    const result = await meta.call(booking.id, { version: booking.version });
    ElMessage.success(
      t("booking.transition.success", { status: t(bookingStatusLabelKey(result.toStatus)) })
    );
    applyResult(result);
  } catch (error) {
    // 可**就地纠正**的两类失败补上下文；其余由请求层统一提示（见组件头注释）
    if (!isApiError(error)) return;
    const conflictDetails = readBookingConflictDetails((error as ApiError).payload);
    if (conflictDetails) {
      conflict.value = conflictDetails;
      return;
    }
    const details = readBookingTransitionDetails((error as ApiError).payload);
    if (details?.reason === "concurrent_modification") {
      // 并发被改：重取详情，让按钮与新状态对齐（而不是让用户对着一份过期快照重试）
      ElMessage.warning(t("booking.transition.staleRefresh"));
      void loadDetail();
    }
  } finally {
    pendingAction.value = null;
  }
}

watch(
  () => [props.modelValue, props.bookingId] as const,
  ([opened, bookingId]) => {
    if (!opened || !bookingId) return;
    activeId.value = bookingId;
    detail.value = null;
    conflict.value = null;
    feeRule.value = null;
    void loadDetail();
  },
  { immediate: true }
);

/** 关闭动画结束后清理（`destroy-on-close` 之外再兜一层，防止 keep-alive 下残留） */
function handleClosed(): void {
  detail.value = null;
  detailError.value = "";
  conflict.value = null;
  feeRule.value = null;
  rescheduleVisible.value = false;
  cancelVisible.value = false;
}
</script>

<style lang="scss" scoped>
.booking-detail {
  &__body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 160px;
  }

  &__card {
    padding: 12px 14px;
    background-color: var(--el-fill-color-light);
    border-radius: 6px;
  }

  &__card-row {
    display: flex;
    gap: 8px;
    align-items: center;

    &--sub {
      margin-top: 6px;
      font-size: 12px;
      color: var(--el-text-color-secondary);
    }
  }

  &__no {
    font-size: 16px;
    font-weight: 600;
  }

  &__divider {
    color: var(--el-text-color-placeholder);
  }

  &__actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  &__actions-label {
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }

  &__actions-btns {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  &__feedback {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  &__feedback-list {
    padding: 0;
    margin: 0;
    list-style: none;

    li {
      padding-left: 22px;
      font-size: 12px;
      line-height: 1.8;
      color: var(--el-color-warning);
    }
  }

  &__fee-desc {
    font-size: 12px;
  }

  &__desc {
    :deep(.el-descriptions__label) {
      width: 96px;
      white-space: nowrap;
    }
  }
}
</style>
