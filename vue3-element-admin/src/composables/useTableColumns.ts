import { computed, ref, type ComputedRef, type Ref } from "vue";

import { STORAGE_KEYS } from "@/constants";
import { Storage } from "@/utils/storage";
import { useUserStoreHook } from "@/stores/user";

/**
 * 表格列配置（MVP-WEB-02-01 · 列表页通用能力）
 *
 * 依据 PRD《Web规范》§表格规范第 1 条：
 *   「列数超过 8 列必须提供列配置（显示、隐藏、顺序），用户偏好按账号持久化。」
 *
 * 口径：
 *  · **按账号持久化** —— 存储键含当前登录账号（`username`），同一浏览器多账号互不干扰，
 *    与 PRD《Web规范》§通用规则「列配置与筛选偏好在刷新后保留」一致；
 *  · **定义表是唯一事实来源** —— 持久化只存「顺序 + 可见性」，列的新增/删除/改名
 *    一律以传入的 columns 定义为准（避免历史快照与新版本列结构漂移）；
 *  · **主列不可隐藏**（`fixed: true`）—— 主名称列是「可点击进详情」的唯一入口，
 *    隐藏后将无法进入详情（PRD 表格规范第 2 条「必带列：主名称列」）；
 *  · 至少保留一列可见，禁止出现空表格（PRD 表格规范第 6 条「空表显示空态组件」）。
 */

/** 列定义（页面侧声明） */
export interface TableColumnDef {
  /** 列唯一键（与表格 `prop` 一致，持久化按此匹配） */
  key: string;
  /** 列标题（展示于列配置面板） */
  label: string;
  /** 默认是否显示，缺省 `true` */
  visible?: boolean;
  /** 是否固定显示、不可隐藏（主名称列 / 状态列等必带列） */
  fixed?: boolean;
}

/** 列的运行时状态 */
export interface TableColumnState {
  key: string;
  label: string;
  visible: boolean;
  fixed: boolean;
}

/** 持久化载荷（只存差异，不存快照） */
interface PersistedColumnState {
  /** 列顺序（key 数组） */
  order: string[];
  /** 被隐藏的列 key */
  hidden: string[];
}

export interface UseTableColumnsOptions {
  /**
   * 持久化命名空间
   *
   * 建议取路由 path（如 `stores`），保证「一个页面一份偏 好」；
   * 同页面多表格时追加子标识（如 `stores:hq`）。
   */
  namespace: string;
  /** 列定义（顺序 = 默认展示顺序） */
  columns: TableColumnDef[];
}

export interface UseTableColumnsReturn {
  /** 按当前顺序 + 可见性排列的列状态（全部列） */
  columnStates: Ref<TableColumnState[]>;
  /** 当前可见列（按顺序） */
  visibleColumns: ComputedRef<TableColumnState[]>;
  /** 是否发生过个性化（用于「重置」按钮的禁用态） */
  isCustomized: ComputedRef<boolean>;
  /** 切换某列显隐；返回是否成功（主列 / 最后一列会被拒绝） */
  toggle: (key: string) => boolean;
  /** 上移一列 */
  moveUp: (key: string) => void;
  /** 下移一列 */
  moveDown: (key: string) => void;
  /** 恢复默认列配置 */
  reset: () => void;
}

/** 当前账号标识（未登录 / 单测环境回落 `anonymous`） */
function resolveAccountKey(): string {
  try {
    return useUserStoreHook().userInfo?.username || "anonymous";
  } catch {
    return "anonymous";
  }
}

/**
 * 表格列配置组合式函数
 *
 * @example
 * ```ts
 * const { visibleColumns, toggle, moveUp, moveDown, reset, isCustomized } = useTableColumns({
 *   namespace: "stores",
 *   columns: [
 *     { key: "name", label: "门店名称", fixed: true },
 *     { key: "code", label: "门店编码" },
 *   ],
 * });
 * ```
 */
export function useTableColumns(options: UseTableColumnsOptions): UseTableColumnsReturn {
  const { namespace, columns } = options;

  const storageKey = `${STORAGE_KEYS.TABLE_COLUMNS}:${resolveAccountKey()}:${namespace}`;

  /** 默认列状态（定义表顺序） */
  const defaultStates = (): TableColumnState[] =>
    columns.map((column) => ({
      key: column.key,
      label: column.label,
      visible: column.visible !== false,
      fixed: column.fixed === true,
    }));

  const columnStates = ref<TableColumnState[]>(defaultStates());

  /** 读取持久化偏好并与定义表合并 */
  function restore(): void {
    const persisted = Storage.get<PersistedColumnState | null>(storageKey, null);
    const states = defaultStates();
    if (!persisted || !Array.isArray(persisted.order)) {
      columnStates.value = states;
      return;
    }

    const hidden = new Set(
      Array.isArray(persisted.hidden)
        ? persisted.hidden.filter((key) => typeof key === "string")
        : []
    );

    // 顺序：以持久化的 order 为准，定义表中新增的列按定义顺序追加到末尾
    const byKey = new Map(states.map((state) => [state.key, state]));
    const ordered: TableColumnState[] = [];
    persisted.order.forEach((key) => {
      const state = byKey.get(key);
      if (state) {
        ordered.push(state);
        byKey.delete(key);
      }
    });
    states.forEach((state) => {
      if (byKey.has(state.key)) ordered.push(state);
    });

    ordered.forEach((state) => {
      // 主列恒可见，忽略历史隐藏偏好
      state.visible = state.fixed ? true : !hidden.has(state.key);
    });

    columnStates.value = ensureNonEmpty(ordered);
  }

  /** 至少保留一列可见 */
  function ensureNonEmpty(states: TableColumnState[]): TableColumnState[] {
    if (states.some((state) => state.visible)) return states;
    const first = states[0];
    if (first) first.visible = true;
    return states;
  }

  /** 持久化当前偏好（仅存 order + hidden 差异） */
  function persist(): void {
    const payload: PersistedColumnState = {
      order: columnStates.value.map((state) => state.key),
      hidden: columnStates.value.filter((state) => !state.visible).map((state) => state.key),
    };
    Storage.set(storageKey, payload);
  }

  const visibleColumns = computed(() => columnStates.value.filter((state) => state.visible));

  const isCustomized = computed(() => {
    const defaults = defaultStates();
    const current = columnStates.value;
    if (current.length !== defaults.length) return true;
    return current.some((state, index) => {
      const base = defaults[index];
      return !base || base.key !== state.key || base.visible !== state.visible;
    });
  });

  /** 切换列显隐 */
  function toggle(key: string): boolean {
    const target = columnStates.value.find((state) => state.key === key);
    if (!target) return false;
    if (target.fixed) return false;

    if (target.visible && visibleColumns.value.length <= 1) return false;

    target.visible = !target.visible;
    persist();
    return true;
  }

  /** 交换相邻两列 */
  function swap(index: number, offset: number): void {
    const target = index + offset;
    const states = columnStates.value;
    if (index < 0 || target < 0 || index >= states.length || target >= states.length) return;
    const current = states[index];
    const other = states[target];
    states[index] = other;
    states[target] = current;
    persist();
  }

  /** 上移一列 */
  function moveUp(key: string): void {
    swap(
      columnStates.value.findIndex((state) => state.key === key),
      -1
    );
  }

  /** 下移一列 */
  function moveDown(key: string): void {
    swap(
      columnStates.value.findIndex((state) => state.key === key),
      1
    );
  }

  /** 恢复默认并清除持久化偏好 */
  function reset(): void {
    Storage.remove(storageKey);
    columnStates.value = defaultStates();
  }

  restore();

  return {
    columnStates,
    visibleColumns,
    isCustomized,
    toggle,
    moveUp,
    moveDown,
    reset,
  };
}
