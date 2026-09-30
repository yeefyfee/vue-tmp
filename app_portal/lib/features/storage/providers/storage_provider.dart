import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers/core_providers.dart';
import '../data/models/item_query.dart';
import '../data/models/storage_item.dart';
import '../data/storage_repository.dart';

/// 收纳数据源 Provider
final storageRepositoryProvider = Provider<StorageRepository>((ref) {
  return StorageRepository(ref.watch(apiClientProvider));
});

// -----------------------------------------------------------------------------
// 概览
// -----------------------------------------------------------------------------

final storageOverviewProvider = FutureProvider.autoDispose((ref) {
  return ref.watch(storageRepositoryProvider).fetchOverview();
});

// -----------------------------------------------------------------------------
// 分类 / 标签
// -----------------------------------------------------------------------------

/// 分类下拉选项
final categoryOptionsProvider = FutureProvider.autoDispose((ref) {
  return ref.watch(storageRepositoryProvider).fetchCategoryOptions();
});

/// 标签列表
final tagListProvider = FutureProvider.autoDispose((ref) {
  return ref.watch(storageRepositoryProvider).fetchTags();
});

// -----------------------------------------------------------------------------
// 物品列表
// -----------------------------------------------------------------------------

/// 当前查询条件
final itemQueryProvider = StateProvider.autoDispose<ItemQuery>((ref) {
  return const ItemQuery();
});

/// 物品列表控制器
///
/// 管理分页加载、下拉刷新、加载更多，并保留已加载数据避免滚动位置丢失。
class ItemListState {
  const ItemListState({
    this.items = const [],
    this.total = 0,
    this.isLoadingMore = false,
    this.hasMore = false,
  });

  final List<StorageItem> items;
  final int total;
  final bool isLoadingMore;
  final bool hasMore;

  ItemListState copyWith({
    List<StorageItem>? items,
    int? total,
    bool? isLoadingMore,
    bool? hasMore,
  }) {
    return ItemListState(
      items: items ?? this.items,
      total: total ?? this.total,
      isLoadingMore: isLoadingMore ?? this.isLoadingMore,
      hasMore: hasMore ?? this.hasMore,
    );
  }
}

class ItemListController extends StateNotifier<AsyncValue<ItemListState>> {
  ItemListController(this._repository, this._ref)
      : super(const AsyncValue.loading());

  final StorageRepository _repository;
  final Ref _ref;

  /// 加载首页数据
  Future<void> load() async {
    state = const AsyncValue.loading();
    try {
      final query = _ref.read(itemQueryProvider);
      final result = await _repository.fetchItems(query);
      state = AsyncValue.data(
        ItemListState(
          items: result.list,
          total: result.total,
          hasMore: result.hasMore,
        ),
      );
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }

  /// 下拉刷新（保留当前筛选条件）
  Future<void> refresh() async {
    try {
      final query = _ref.read(itemQueryProvider);
      final result = await _repository.fetchItems(query.copyWith(pageNum: 1));
      state = AsyncValue.data(
        ItemListState(
          items: result.list,
          total: result.total,
          hasMore: result.hasMore,
        ),
      );
    } catch (_) {
      // 刷新失败保留原数据，交由 UI 提示
      rethrow;
    }
  }

  /// 加载下一页
  Future<void> loadMore() async {
    final current = state.valueOrNull;
    if (current == null || !current.hasMore || current.isLoadingMore) return;

    state = AsyncValue.data(current.copyWith(isLoadingMore: true));

    try {
      final query = _ref.read(itemQueryProvider);
      final next = await _repository.fetchItems(
        query.copyWith(pageNum: query.pageNum + 1),
      );

      // 同步页码，保证下次 loadMore 取到正确的页
      _ref.read(itemQueryProvider.notifier).state =
          query.copyWith(pageNum: query.pageNum + 1);

      state = AsyncValue.data(
        ItemListState(
          items: [...current.items, ...next.list],
          total: next.total,
          hasMore: next.hasMore,
        ),
      );
    } catch (e, st) {
      state = AsyncValue.data(current.copyWith(isLoadingMore: false));
      Error.throwWithStackTrace(e, st);
    }
  }

  /// 更新筛选条件并重新加载
  Future<void> applyQuery(ItemQuery query) async {
    _ref.read(itemQueryProvider.notifier).state = query.copyWith(pageNum: 1);
    await load();
  }

  /// 删除物品后局部移除，避免整页重载
  void removeLocally(List<String> ids) {
    final current = state.valueOrNull;
    if (current == null) return;

    state = AsyncValue.data(
      current.copyWith(
        items: current.items.where((i) => !ids.contains(i.id)).toList(),
        total: (current.total - ids.length).clamp(0, 1 << 31),
      ),
    );
  }

  /// 局部更新单个物品（数量调整 / 归档后）
  void updateLocally(StorageItem item) {
    final current = state.valueOrNull;
    if (current == null) return;

    final next = current.items.map((i) => i.id == item.id ? item : i).toList();

    // 归档后若当前筛选为"在库"，则从列表移除
    final query = _ref.read(itemQueryProvider);
    final filtered = (query.status == 1 && item.status == 0)
        ? next.where((i) => i.id != item.id).toList()
        : next;

    state = AsyncValue.data(current.copyWith(items: filtered));
  }
}

final itemListControllerProvider =
    StateNotifierProvider.autoDispose<ItemListController, AsyncValue<ItemListState>>((ref) {
  return ItemListController(ref.watch(storageRepositoryProvider), ref);
});

// -----------------------------------------------------------------------------
// 物品详情
// -----------------------------------------------------------------------------

final itemDetailProvider = FutureProvider.autoDispose.family((ref, String id) {
  return ref.watch(storageRepositoryProvider).fetchItemDetail(id);
});
