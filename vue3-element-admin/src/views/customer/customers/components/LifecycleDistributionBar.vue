<!--
 * 客户分层分布条（MVP-WEB-04-04 · FR-6 展示侧）
 *
 * 职责：把 `GET /customers/lifecycle-stats`（全量租户口径）渲染为 4 个可点击分层块，
 * 点击即写 `params.lifecycle` 完成「钻取筛选」；右上「分层规则」气泡解释各层判定口径。
 *
 * 设计约束：
 *  · **只做展示 + 事件上抛**，不持有请求、不改地址栏（数据与筛选归调用方页面）；
 *  · 分布口径**固定为全量**（不随列表筛选变化）—— 组件刻意不接收筛选态用于计算，
 *    只接收 `activeLifecycle` 做选中高亮，避免「选中一层后其余层归零」的语义崩塌；
 *  · 分层顺序恒定取 `LIFECYCLE_ORDER`（不依赖服务端数组顺序），服务端补零后
 *    4 块数量稳定、占比基准不跳动。
 *  · 文案全部走 i18n（`customer.lifecycleDistribution.*` / `customer.lifecycleRules.*`）。
-->
<template>
  <div class="lifecycle-bar" data-testid="lifecycle-bar">
    <div class="lifecycle-bar__head">
      <span class="lifecycle-bar__title">{{ t("customer.lifecycleDistribution.title") }}</span>

      <el-tooltip
        :content="t('customer.lifecycleDistribution.scope')"
        placement="top"
        :show-after="120"
      >
        <span class="lifecycle-bar__scope" data-testid="lifecycle-scope">
          {{ t("customer.lifecycleDistribution.scope") }}
        </span>
      </el-tooltip>

      <!-- 分层规则口径说明（PRD BR-6；与工作台「指标口径悬浮说明」同范式，此处内容较长用气泡） -->
      <el-popover placement="bottom-end" :width="400" trigger="click">
        <template #reference>
          <el-button
            class="lifecycle-bar__rules"
            type="primary"
            link
            data-testid="lifecycle-rules-btn"
          >
            <el-icon><QuestionFilled /></el-icon>
            <span>{{ t("customer.lifecycleRules.button") }}</span>
          </el-button>
        </template>

        <div class="lifecycle-rules" data-testid="lifecycle-rules-panel">
          <p class="lifecycle-rules__title">{{ t("customer.lifecycleRules.title") }}</p>
          <p class="lifecycle-rules__intro">{{ t("customer.lifecycleRules.intro") }}</p>

          <ul class="lifecycle-rules__list">
            <li
              v-for="rule in RULES"
              :key="rule.lifecycle"
              class="lifecycle-rules__item"
              :data-testid="`lifecycle-rule-${rule.lifecycle}`"
            >
              <el-tag :type="rule.tagType" size="small" effect="plain">
                {{ t(rule.labelKey) }}
              </el-tag>
              <span class="lifecycle-rules__desc">{{ t(rule.descKey) }}</span>
            </li>
          </ul>

          <p class="lifecycle-rules__note">{{ t("customer.lifecycleRules.threshold") }}</p>
          <p class="lifecycle-rules__note">{{ t("customer.lifecycleRules.boundary") }}</p>
        </div>
      </el-popover>
    </div>

    <div class="lifecycle-bar__items">
      <button
        v-for="segment in segments"
        :key="segment.lifecycle"
        type="button"
        class="lifecycle-chip"
        :class="{ 'is-active': segment.lifecycle === activeLifecycle }"
        :data-testid="`lifecycle-chip-${segment.lifecycle}`"
        :title="`${t('customer.lifecycleDistribution.count', { count: segment.count })}（${t(
          'customer.lifecycleDistribution.ratio',
          { ratio: segment.ratio }
        )}） · ${t('customer.lifecycleDistribution.drillHint')}`"
        @click="emit('select', segment.lifecycle)"
      >
        <span class="lifecycle-chip__name">{{ t(segment.labelKey) }}</span>
        <span class="lifecycle-chip__count">{{ segment.count }}</span>
        <span class="lifecycle-chip__ratio">{{ segment.ratio }}%</span>
        <span class="lifecycle-chip__bar">
          <i :class="`is-${segment.key}`" :style="{ width: `${segment.ratio}%` }" />
        </span>
      </button>
    </div>

    <div v-if="activeLifecycle !== undefined" class="lifecycle-bar__active">
      <span class="lifecycle-bar__active-text" data-testid="lifecycle-active-hint">
        {{ t("customer.lifecycleDistribution.selected", { name: activeName }) }}
      </span>
      <el-button
        type="primary"
        link
        size="small"
        data-testid="lifecycle-clear"
        @click="emit('clear')"
      >
        {{ t("customer.lifecycleDistribution.clear") }}
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { QuestionFilled } from "@element-plus/icons-vue";

import type { CustomerLifecycleStats } from "@/api/customer";
import { CustomerLifecycle } from "@/enums";

const props = defineProps<{
  /** 分层分布统计（服务端已按值域补零） */
  stats: CustomerLifecycleStats;
  /** 当前生效的分层筛选值（`undefined` = 未按分层筛选） */
  activeLifecycle?: number;
}>();

const emit = defineEmits<{
  /** 点击某分层 → 调用方写 `params.lifecycle` 并查询 */
  select: [lifecycle: number];
  /** 清除分层筛选 */
  clear: [];
}>();

const { t } = useI18n();

/**
 * 分层展示元信息（顺序 = 展示顺序；`labelKey` 复用客户域既有分层文案，避免重复维护）
 *
 * `tagType` 与列表列的分层标签配色保持一致（新客=主色、活跃=成功、沉睡=警告、流失=危险）。
 */
const LIFECYCLE_META: Record<
  number,
  {
    key: string;
    labelKey: string;
    descKey: string;
    tagType: "primary" | "success" | "warning" | "danger";
  }
> = {
  [CustomerLifecycle.NEW]: {
    key: "new",
    labelKey: "customer.value.lifecycleNew",
    descKey: "customer.lifecycleRules.descNew",
    tagType: "primary",
  },
  [CustomerLifecycle.ACTIVE]: {
    key: "active",
    labelKey: "customer.value.lifecycleActive",
    descKey: "customer.lifecycleRules.descActive",
    tagType: "success",
  },
  [CustomerLifecycle.DORMANT]: {
    key: "dormant",
    labelKey: "customer.value.lifecycleDormant",
    descKey: "customer.lifecycleRules.descDormant",
    tagType: "warning",
  },
  [CustomerLifecycle.LOST]: {
    key: "lost",
    labelKey: "customer.value.lifecycleLost",
    descKey: "customer.lifecycleRules.descLost",
    tagType: "danger",
  },
};

/** 恒定展示顺序（不依赖服务端数组顺序） */
const LIFECYCLE_ORDER: readonly number[] = Object.keys(LIFECYCLE_META).map(Number);

/** 规则说明列表 */
const RULES = LIFECYCLE_ORDER.map((lifecycle) => ({ lifecycle, ...LIFECYCLE_META[lifecycle] }));

/** 由 `stats.items` 构建「值 → 数量」索引（缺层容错为 0） */
const countMap = computed(() => {
  const map = new Map<number, number>();
  for (const item of props.stats.items ?? []) map.set(item.lifecycle, item.count);
  return map;
});

/**
 * 分层块视图模型
 *
 * `ratio` 取一位小数（`count / total`）：total 为 0 时占比恒为 0，不产生 NaN。
 */
const segments = computed(() =>
  LIFECYCLE_ORDER.map((lifecycle) => {
    const count = countMap.value.get(lifecycle) ?? 0;
    const total = props.stats.total ?? 0;
    return {
      lifecycle,
      key: LIFECYCLE_META[lifecycle].key,
      labelKey: LIFECYCLE_META[lifecycle].labelKey,
      count,
      ratio: total > 0 ? ((count / total) * 100).toFixed(1) : "0.0",
    };
  })
);

/** 当前筛选分层的展示名（选中提示用） */
const activeName = computed(() => {
  if (props.activeLifecycle === undefined) return "";
  const meta = LIFECYCLE_META[props.activeLifecycle];
  return meta ? t(meta.labelKey) : "";
});
</script>

<style lang="scss" scoped>
.lifecycle-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  align-items: center;
  padding-top: 12px;
  margin-top: 12px;
  border-top: 1px dashed var(--el-border-color-lighter);

  &__head {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  &__title {
    font-size: 13px;
    font-weight: 500;
    color: var(--el-text-color-regular);
  }

  &__scope {
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }

  &__rules {
    padding: 0;
    font-size: 12px;
  }

  &__items {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  &__active {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }
}

.lifecycle-chip {
  display: flex;
  gap: 6px;
  align-items: center;
  min-width: 104px;
  padding: 4px 10px;
  font: inherit;
  font-size: 12px;
  color: var(--el-text-color-regular);
  cursor: pointer;
  background: var(--el-fill-color-blank);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  transition:
    border-color 0.15s,
    background-color 0.15s;

  &:hover {
    border-color: var(--el-color-primary-light-5);
  }

  &.is-active {
    background: var(--el-color-primary-light-9);
    border-color: var(--el-color-primary);
  }

  &__name {
    color: var(--el-text-color-secondary);
  }

  &__count {
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  &__ratio {
    color: var(--el-text-color-placeholder);
  }

  &__bar {
    position: relative;
    display: block;
    flex: 1 1 auto;
    width: 36px;
    min-width: 36px;
    height: 4px;
    overflow: hidden;
    background: var(--el-fill-color);

    i {
      display: block;
      height: 100%;
      background: var(--el-color-primary);

      &.is-active {
        background: var(--el-color-success);
      }

      &.is-dormant {
        background: var(--el-color-warning);
      }

      &.is-lost {
        background: var(--el-color-danger);
      }
    }
  }
}

.lifecycle-rules {
  &__title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  &__intro {
    margin: 6px 0 10px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }

  &__list {
    padding: 0;
    margin: 0;
    list-style: none;
  }

  &__item {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 6px;
    font-size: 12px;
  }

  &__desc {
    color: var(--el-text-color-regular);
  }

  &__note {
    margin: 6px 0 0;
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }
}
</style>
