<template>
  <el-dialog
    v-model="visible"
    :title="t('booking.reschedule.title')"
    width="480px"
    append-to-body
    destroy-on-close
    data-testid="booking-reschedule-dialog"
    @closed="handleClosed"
  >
    <!-- 改期对象上下文：单号 + 宠物 + 原时段（用户要能确认「改的是哪一单」） -->
    <div
      v-if="booking"
      class="booking-reschedule__context"
      data-testid="booking-reschedule-context"
    >
      <span class="booking-reschedule__no">{{ booking.bookingNo }}</span>
      <span class="booking-reschedule__pet">{{ displayText(booking.petName) }}</span>
      <span class="booking-reschedule__old">
        {{ bookingDateLabel(booking.bookingDate) }}
        {{ bookingTimeRangeLabel(booking.startTime, booking.endTime) }}
      </span>
    </div>

    <el-form ref="formRef" :model="draft" :rules="rules" label-width="96px" label-position="right">
      <el-form-item :label="t('booking.reschedule.startAt')" prop="startAt">
        <div class="booking-reschedule__field" data-testid="booking-reschedule-start-at">
          <el-date-picker
            v-model="draft.startAt"
            type="datetime"
            format="YYYY-MM-DD HH:mm"
            value-format="YYYY-MM-DD HH:mm"
            :placeholder="t('booking.reschedule.startAtPlaceholder')"
            class="w-full"
          />
        </div>
      </el-form-item>

      <el-form-item :label="t('booking.reschedule.room')" prop="roomId">
        <div class="booking-reschedule__field" data-testid="booking-reschedule-room">
          <el-select
            v-model="draft.roomId"
            :placeholder="t('booking.reschedule.roomPlaceholder')"
            :loading="roomLoading"
            clearable
            class="w-full"
          >
            <el-option
              v-for="item in roomOptions"
              :key="item.id"
              :label="item.label"
              :value="item.id"
            />
          </el-select>
        </div>
      </el-form-item>

      <el-form-item :label="t('booking.reschedule.reason')" prop="reason">
        <el-input
          v-model="draft.reason"
          type="textarea"
          :rows="2"
          maxlength="255"
          show-word-limit
          :placeholder="t('booking.reschedule.reasonPlaceholder')"
          data-testid="booking-reschedule-reason"
        />
      </el-form-item>
    </el-form>

    <!-- 改期被容量拒绝（30001）：出参与 capacity-check 同形 ⇒ 复用 capacity.* 文案 -->
    <div
      v-if="conflictResult"
      class="booking-reschedule__conflict"
      data-testid="booking-reschedule-conflict"
    >
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        :title="t('booking.form.capacity.capacityUnavailable')"
      />
      <ul class="booking-reschedule__conflict-list">
        <li
          v-for="(item, index) in conflictResult.conflicts"
          :key="index"
          data-testid="booking-reschedule-conflict-item"
        >
          {{ describeConflict(item) }}
        </li>
      </ul>
      <div v-if="conflictResult.suggestions.length" class="booking-reschedule__suggestions">
        <span class="booking-reschedule__suggestions-label">
          {{ t("booking.form.capacity.suggestionsLabel") }}
        </span>
        <el-tag
          v-for="item in conflictResult.suggestions"
          :key="item.startAt"
          class="booking-reschedule__suggestion"
          type="info"
          effect="plain"
          data-testid="booking-reschedule-suggestion"
          @click="applySuggestion(item.startAt)"
        >
          {{ item.startAt.slice(5) }}
        </el-tag>
      </div>
    </div>

    <template #footer>
      <el-button data-testid="booking-reschedule-cancel" @click="visible = false">
        {{ t("booking.form.cancel") }}
      </el-button>
      <el-button
        type="primary"
        :loading="submitting"
        data-testid="booking-reschedule-submit"
        @click="handleSubmit"
      >
        {{ t("booking.reschedule.submit") }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { type FormInstance, type FormRules } from "element-plus";

import BookingAPI from "@/api/booking";
import type {
  BookingCapacityCheckResult,
  BookingCapacityConflict,
  BookingItem,
  BookingTransitionResult,
} from "@/api/booking";
import RoomAPI from "@/api/room";
import {
  bookingDateLabel,
  bookingTimeRangeLabel,
  bookingWallClock,
  readBookingConflictDetails,
} from "@/utils/booking";
import { ApiError, isApiError } from "@/utils/request";

/**
 * 预约改期对话框（MVP-WEB-06-05 · PRD《Booking API》`POST /bookings/:id/reschedule`）
 *
 * 契约要点：
 *  - 只允许换「时间」与「房间」——门店 / 宠物 / 客户 / 服务项 / 员工一律沿用原单
 *    （请求体里根本没有这些字段，给不出错的机会）；
 *  - `reason` 必填：服务端会把它追加进原单备注（`[改期] 原因`）并作为新单备注；
 *  - 省略 `roomId` ⇒ 服务端沿用原单房间（本表单「留空」即此语义）；
 *  - 省略 `durationMinutes` ⇒ 沿用原单**实际时长**（寄养跨天不会被压扁，故不提交时长）；
 *  - 带上详情里的 `version` ⇒ 参与服务端 CAS：期间被他人改过则 `30002`
 *    （`details.reason = concurrent_modification`），本组件提示刷新并就地重取详情。
 *
 * 🔴 容量判据的唯一裁定点在**服务端**：改期端点自身会重做容量校验（排除自身占用），
 * 冲突即 `30001`，`details` 与 `capacity-check` **同形** ⇒ 本组件直接把冲突面板
 * 渲染在对话框里（附可替代时段，点击回填后重试），**不**先发一次 `capacity-check`：
 *  · 一是演示/存量预约的 `serviceId` 为 NULL 而 `capacity-check` 的 `serviceId` 必填，
 *    预热校验会先撞 400；
 *  · 二是同一判据不留第二处来源（踩坑 126-bis）——服务端既然会在提交时裁定，
 *    前端再算一遍只会产出「预检说行、提交被拒」的不一致。
 */
defineOptions({ name: "BookingRescheduleDialog", inheritAttrs: false });

const props = defineProps<{
  /** 待改期的预约（打开时必填；关闭后由父组件保留引用不影响本组件） */
  booking: BookingItem | null;
}>();

const emit = defineEmits<{
  /** 改期成功（携带服务端统一出参，父级据此就地刷新抽屉与列表） */
  (e: "success", result: BookingTransitionResult): void;
}>();

const visible = defineModel("modelValue", {
  type: Boolean,
  required: true,
  default: false,
});

const { t } = useI18n();

const formRef = ref<FormInstance>();
const submitting = ref(false);

/** 改期被容量拒绝的结构化明细（`null` = 无 / 输入已变更作废） */
const conflictResult = ref<BookingCapacityCheckResult | null>(null);

const roomOptions = ref<Array<{ id: string; label: string }>>([]);
const roomLoading = ref(false);

const draft = reactive({
  startAt: "",
  roomId: "",
  reason: "",
});

const rules = computed<FormRules>(() => ({
  startAt: [
    { required: true, message: t("booking.reschedule.startAtRequired"), trigger: "change" },
  ],
  reason: [{ required: true, message: t("booking.reschedule.reasonRequired"), trigger: "blur" }],
}));

/** 关联实体展示文本（服务端回查缺失 ⇒ `未指定`，不渲染裸 UUID） */
function displayText(value: string | null | undefined): string {
  const text = value === undefined || value === null ? "" : String(value).trim();
  return text === "" ? t("booking.value.unset") : text;
}

/** 冲突文案（结构化事实 → i18n；与创建表单共用 `booking.form.capacity.*` 文案） */
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

/** 采纳建议时段：回填并清掉上一次结论（用户再点「确认改期」重新判定） */
function applySuggestion(startAt: string): void {
  draft.startAt = startAt;
  conflictResult.value = null;
}

/** 复位为新一次改期的起点（新时间默认沿用原时段，便于「只改日期」的操作） */
function resetDraft(): void {
  const booking = props.booking;
  draft.startAt = bookingWallClock(booking?.startTime);
  draft.roomId = booking?.roomId ?? "";
  draft.reason = "";
  conflictResult.value = null;
}

async function fetchRoomOptions(storeId: string): Promise<void> {
  roomLoading.value = true;
  try {
    const data = await RoomAPI.getPage({
      pageNum: 1,
      pageSize: 100,
      storeId,
      sortBy: "roomNo",
      order: "ASC",
    });
    roomOptions.value = (data.list ?? []).map((item) => ({
      id: item.id,
      label: item.name ?? item.roomNo,
    }));
  } catch {
    // 房间选项失败不阻断改期（留空即沿用原房间，服务端仍是唯一判据）
    roomOptions.value = [];
  } finally {
    roomLoading.value = false;
  }
}

watch(visible, (open) => {
  if (!open) return;
  resetDraft();
  nextTick(() => formRef.value?.clearValidate());
  const storeId = props.booking?.storeId;
  if (storeId) void fetchRoomOptions(storeId);
});

/** 关闭动效结束后复位（避免下次打开闪现上一次输入） */
function handleClosed(): void {
  formRef.value?.resetFields();
  resetDraft();
  roomOptions.value = [];
}

/** 参与判定的输入变更 ⇒ 上次冲突结论作废（不显示与当前输入不匹配的旧结论） */
watch(
  () => [draft.startAt, draft.roomId],
  () => {
    conflictResult.value = null;
  }
);

async function handleSubmit(): Promise<void> {
  if (!formRef.value || !props.booking) return;
  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;

  submitting.value = true;
  try {
    const result = await BookingAPI.rescheduleBooking(props.booking.id, {
      startAt: draft.startAt,
      // 空串归一为 undefined：留空 = 沿用原房间（踩坑 129-④）
      roomId: draft.roomId || undefined,
      reason: draft.reason.trim(),
      version: props.booking.version,
    });
    visible.value = false;
    emit("success", result);
  } catch (error) {
    const conflicts = isApiError(error)
      ? readBookingConflictDetails((error as ApiError).payload)
      : null;
    if (conflicts) {
      // 30001 容量冲突：就地展示明细 + 建议时段（对话框保持打开）
      conflictResult.value = conflicts;
      return;
    }
    // 其余错误（30002 非法流转 / 30003 超限 / A08xx 参数）由请求层统一提示
  } finally {
    submitting.value = false;
  }
}
</script>

<style lang="scss" scoped>
.booking-reschedule {
  &__context {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: baseline;
    padding: 8px 12px;
    margin-bottom: 12px;
    font-size: 12px;
    background-color: var(--el-fill-color-light);
    border-radius: 4px;
  }

  &__no {
    font-size: 13px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  &__old {
    color: var(--el-text-color-secondary);
  }

  &__field {
    width: 100%;
  }

  &__conflict {
    margin-top: 4px;
  }

  &__conflict-list {
    padding: 0;
    margin: 8px 0 0;
    list-style: none;

    li {
      padding-left: 22px;
      font-size: 12px;
      line-height: 1.8;
      color: var(--el-color-warning);
    }
  }

  &__suggestions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    margin-top: 8px;
  }

  &__suggestions-label {
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }

  &__suggestion {
    cursor: pointer;
  }
}
</style>
