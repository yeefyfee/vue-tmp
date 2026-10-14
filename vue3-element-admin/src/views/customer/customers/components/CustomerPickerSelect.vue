<template>
  <el-select
    v-bind="$attrs"
    :model-value="modelValue"
    :placeholder="placeholder"
    :loading="loading"
    :disabled="disabled"
    filterable
    remote
    reserve-keyword
    clearable
    :remote-method="handleSearch"
    class="w-full"
    @update:model-value="handleSelect"
    @visible-change="handleVisibleChange"
  >
    <el-option v-for="item in visibleOptions" :key="item.id" :label="item.name" :value="item.id">
      <div class="customer-picker__option">
        <span class="customer-picker__name">{{ item.name }}</span>
        <span class="customer-picker__mobile">{{ item.mobile }}</span>
      </div>
    </el-option>

    <el-option
      v-if="!loading && visibleOptions.length === 0"
      disabled
      :label="noMatchText"
      value="__customer_picker_empty__"
    />
  </el-select>
</template>

<script setup lang="ts">
import CustomerAPI from "@/api/customer";
import type { CustomerItem } from "@/api/customer";

/**
 * 客户远程检索下拉（MVP-WEB-04-03 复用件）
 *
 * 用途：合并客户 / 发起宠物转移时选择「另一个客户」。列表接口为
 * `GET /customers`（`keyword` 同时模糊匹配姓名与手机号，OR 语义）。
 *
 * ⚠️ 两点刻意的工程约束：
 *  1. **防抖 + 同词短路**：后端有 IP 级限流（1s/10 次 ⇒ `A0502`，踩坑 113），
 *     `remote-method` 逐键触发会把限流打满，故 350ms 防抖 + 相同关键字不重复请求；
 *  2. **空串归一为 `undefined`**：`el-select` 清空可能置空串，而 `pageSize` 等
 *     入参为空串会触发 `@IsUUID` / `@Type(Number)` 类校验失败（踩坑 101），
 *     故对外一律吐出 `undefined`，并顺手清掉已选项缓存。
 *
 * 已选项在后续检索结果中可能缺席（重新输入关键字）⇒ 用 `selectedItem` 兜底渲染，
 * 避免回显成裸 UUID。
 */
defineOptions({
  name: "CustomerPickerSelect",
  inheritAttrs: false,
});

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    placeholder: string;
    /** 不可选的客户 id（如转移时的「当前主人」） */
    excludeIds?: string[];
    disabled?: boolean;
  }>(),
  {
    modelValue: undefined,
    excludeIds: () => [],
    disabled: false,
  }
);

const emit = defineEmits<{
  "update:modelValue": [value: string | undefined];
  /** 选中项（含姓名/手机号），供调用方渲染确认文案；清空时回 `null` */
  select: [item: CustomerItem | null];
}>();

const { t } = useI18n();

const loading = ref(false);
const remoteOptions = ref<CustomerItem[]>([]);
const selectedItem = ref<CustomerItem | null>(null);
const currentKeyword = ref("");

const noMatchText = computed(() => t("customer.merge.noMatch"));

const excludeSet = computed(() => new Set(props.excludeIds));

const visibleOptions = computed(() => {
  const base = remoteOptions.value.filter((item) => !excludeSet.value.has(item.id));
  const selected = selectedItem.value;
  if (selected && !excludeSet.value.has(selected.id) && !base.some((i) => i.id === selected.id)) {
    return [selected, ...base];
  }
  return base;
});

/** 回显兜底：外部把已选 id 传回来时（如打开合并对话框预置当前行）确保有标签 */
watch(
  () => props.modelValue,
  async (value) => {
    if (!value) {
      selectedItem.value = null;
      return;
    }
    if (selectedItem.value?.id === value) return;
    try {
      const detail = await CustomerAPI.getDetail(value);
      selectedItem.value = detail as unknown as CustomerItem;
    } catch {
      selectedItem.value = null;
    }
  },
  { immediate: true }
);

async function runSearch(keyword: string): Promise<void> {
  loading.value = true;
  try {
    const data = await CustomerAPI.getPage({
      pageNum: 1,
      pageSize: 20,
      sortBy: "createdAt",
      order: "DESC",
      keyword,
    });
    remoteOptions.value = data.list ?? [];
  } catch {
    // 检索失败不弹错（请求层已统一提示）；保留上一次结果避免闪空
  } finally {
    loading.value = false;
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function handleSearch(keyword: string): void {
  const text = String(keyword ?? "").trim();
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    if (text === currentKeyword.value) return;
    currentKeyword.value = text;
    void runSearch(text);
  }, 350);
}

/** 首次展开时预取一页，免去「必须打字才出选项」的空下拉 */
function handleVisibleChange(visible: boolean): void {
  if (!visible) return;
  if (remoteOptions.value.length > 0) return;
  void runSearch(currentKeyword.value);
}

function handleSelect(value: unknown): void {
  const text = typeof value === "string" ? value : "";
  if (text === "" || text === "__customer_picker_empty__") {
    selectedItem.value = null;
    emit("update:modelValue", undefined);
    emit("select", null);
    return;
  }
  const matched = remoteOptions.value.find((item) => item.id === text) ?? selectedItem.value;
  selectedItem.value = matched ?? null;
  emit("update:modelValue", text);
  emit("select", selectedItem.value);
}
</script>

<style lang="scss" scoped>
.customer-picker__option {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
}

.customer-picker__name {
  font-weight: 500;
}

.customer-picker__mobile {
  color: var(--el-text-color-secondary);
}
</style>
