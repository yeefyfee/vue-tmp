import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/router/route_names.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../shared/widgets/app_scaffold.dart';
import '../../../../shared/widgets/async_view.dart';
import '../../data/models/item_query.dart';
import '../../data/models/storage_item.dart';
import '../../providers/storage_provider.dart';
import '../widgets/item_card.dart';

/// 物品列表页
///
/// 支持：关键词搜索（防抖）、分类筛选、标签筛选、状态切换、多选批量删除。
class ItemListPage extends ConsumerStatefulWidget {
  const ItemListPage({super.key, this.initialCategoryId, this.initialCategoryName});

  final String? initialCategoryId;
  final String? initialCategoryName;

  @override
  ConsumerState<ItemListPage> createState() => _ItemListPageState();
}

class _ItemListPageState extends ConsumerState<ItemListPage> {
  final _scrollCtrl = ScrollController();
  final _searchCtrl = TextEditingController();
  Timer? _debounce;

  bool _selectionMode = false;
  final Set<String> _selectedIds = {};

  @override
  void initState() {
    super.initState();

    // 应用初始筛选条件并加载
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (widget.initialCategoryId != null) {
        ref.read(itemQueryProvider.notifier).state =
            const ItemQuery().copyWith(categoryId: widget.initialCategoryId);
      }
      ref.read(itemListControllerProvider.notifier).load();
    });

    _scrollCtrl.addListener(_onScroll);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _scrollCtrl.dispose();
    _searchCtrl.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (!_scrollCtrl.hasClients) return;
    final threshold = _scrollCtrl.position.maxScrollExtent - 200;
    if (_scrollCtrl.position.pixels >= threshold) {
      ref.read(itemListControllerProvider.notifier).loadMore().catchError((_) {});
    }
  }

  /// 搜索防抖，避免每次输入都请求
  void _onSearchChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), () {
      final query = ref.read(itemQueryProvider);
      ref
          .read(itemListControllerProvider.notifier)
          .applyQuery(query.copyWith(keywords: value.trim()));
    });
  }

  void _exitSelection() {
    setState(() {
      _selectionMode = false;
      _selectedIds.clear();
    });
  }

  Future<void> _deleteSelected() async {
    if (_selectedIds.isEmpty) return;
    final count = _selectedIds.length;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('删除物品'),
        content: Text('确定删除选中的 $count 件物品吗？删除后不可恢复。'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('取消')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: AppColors.danger),
            child: const Text('删除'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    try {
      await ref.read(storageRepositoryProvider).deleteItems(_selectedIds.toList());
      if (!mounted) return;

      ref.read(itemListControllerProvider.notifier).removeLocally(_selectedIds.toList());
      ref.invalidate(storageOverviewProvider);
      _exitSelection();
      _toast('已删除 $count 件物品');
    } catch (e) {
      if (!mounted) return;
      _toast(e.toString(), isError: true);
    }
  }

  void _toast(String message, {bool isError = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          backgroundColor: isError ? AppColors.danger : null,
        ),
      );
  }

  @override
  Widget build(BuildContext context) {
    final listAsync = ref.watch(itemListControllerProvider);
    final query = ref.watch(itemQueryProvider);

    return AppScaffold(
      title: _selectionMode ? '已选 ${_selectedIds.length} 项' : (widget.initialCategoryName ?? '物品列表'),
      leading: _selectionMode
          ? IconButton(icon: const Icon(Icons.close), onPressed: _exitSelection)
          : null,
      actions: _selectionMode
          ? [
              IconButton(
                tooltip: '删除',
                icon: const Icon(Icons.delete_outline, size: 20),
                onPressed: _selectedIds.isEmpty ? null : _deleteSelected,
              ),
            ]
          : [
              IconButton(
                tooltip: '标签',
                icon: const Icon(Icons.sell_outlined, size: 20),
                onPressed: () => context.push(AppRoutes.storageTags),
              ),
              IconButton(
                tooltip: '分类',
                icon: const Icon(Icons.category_outlined, size: 20),
                onPressed: () => context.push(AppRoutes.storageCategories),
              ),
            ],
      body: Column(
        children: [
          // --- 搜索栏 ---------------------------------------------------
          if (!_selectionMode) _buildSearchBar(),

          // --- 筛选条 ---------------------------------------------------
          if (!_selectionMode) _buildFilterBar(query),

          const SizedBox(height: AppSpacing.sm),

          // --- 列表 -----------------------------------------------------
          Expanded(
            child: AsyncView<ItemListState>(
              value: listAsync,
              emptyCheck: (data) => data.items.isEmpty,
              emptyView: EmptyView(
                icon: Icons.inventory_2_outlined,
                title: '还没有物品',
                subtitle: query.keywords?.isNotEmpty == true
                    ? '没有找到匹配「${query.keywords}」的物品'
                    : '点击右下角按钮添加第一件物品',
                actionLabel: '添加物品',
                onAction: () => context.push(AppRoutes.storageItemFormOf()),
              ),
              onRetry: () => ref.read(itemListControllerProvider.notifier).load(),
              builder: (data) => RefreshIndicator(
                onRefresh: () => ref.read(itemListControllerProvider.notifier).refresh(),
                child: ListView.builder(
                  controller: _scrollCtrl,
                  padding: const EdgeInsets.fromLTRB(
                    AppSpacing.pagePadding,
                    AppSpacing.xs,
                    AppSpacing.pagePadding,
                    AppSpacing.xxl * 2,
                  ),
                  itemCount: data.items.length + (data.isLoadingMore ? 1 : 0),
                  itemBuilder: (context, index) {
                    if (index >= data.items.length) {
                      return const Padding(
                        padding: EdgeInsets.symmetric(vertical: AppSpacing.lg),
                        child: Center(
                          child: SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                        ),
                      );
                    }

                    final item = data.items[index];
                    return ItemCard(
                      item: item,
                      selectionMode: _selectionMode,
                      selected: _selectedIds.contains(item.id),
                      onSelectChanged: (selected) {
                        setState(() {
                          if (selected) {
                            _selectedIds.add(item.id);
                          } else {
                            _selectedIds.remove(item.id);
                          }
                        });
                      },
                      onTap: () => context.push(AppRoutes.storageItemDetailOf(item.id)),
                      onQuantityChanged: (delta) => _changeQuantity(item, delta),
                      onMore: () => _showItemActions(item),
                    );
                  },
                ),
              ),
            ),
          ),
        ],
      ),
      floatingActionButton: _selectionMode
          ? null
          : FloatingActionButton.extended(
              onPressed: () => context.push(AppRoutes.storageItemFormOf()),
              backgroundColor: AppColors.primary,
              foregroundColor: Colors.white,
              icon: const Icon(Icons.add, size: 20),
              label: const Text('添加'),
            ),
    );
  }

  /// 搜索栏
  Widget _buildSearchBar() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.pagePadding,
        AppSpacing.md,
        AppSpacing.pagePadding,
        AppSpacing.sm,
      ),
      child: TextField(
        controller: _searchCtrl,
        onChanged: _onSearchChanged,
        textInputAction: TextInputAction.search,
        decoration: InputDecoration(
          hintText: '搜索物品名称、备注或位置',
          prefixIcon: const Icon(Icons.search, size: 20),
          suffixIcon: _searchCtrl.text.isEmpty
              ? null
              : IconButton(
                  icon: const Icon(Icons.clear, size: 18),
                  onPressed: () {
                    _searchCtrl.clear();
                    _onSearchChanged('');
                  },
                ),
          contentPadding: const EdgeInsets.symmetric(vertical: 0, horizontal: AppSpacing.md),
          isDense: true,
        ),
      ),
    );
  }

  /// 筛选条：分类 / 标签 / 状态
  Widget _buildFilterBar(ItemQuery query) {
    final categoriesAsync = ref.watch(categoryOptionsProvider);
    final tagsAsync = ref.watch(tagListProvider);

    return SizedBox(
      height: 34,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.pagePadding),
        children: [
          // 状态切换
          _FilterChip(
            label: query.status == 1 ? '在库' : (query.status == 0 ? '已归档' : '全部'),
            active: query.status != null,
            icon: Icons.filter_alt_outlined,
            onTap: () => _pickStatus(query),
          ),

          // 分类
          ...categoriesAsync.maybeWhen(
            data: (list) => list.take(8).map(
                  (c) => _FilterChip(
                    label: c.name,
                    active: query.categoryId == c.id,
                    onTap: () {
                      final next = query.categoryId == c.id
                          ? query.copyWith(clearCategory: true)
                          : query.copyWith(categoryId: c.id);
                      ref.read(itemListControllerProvider.notifier).applyQuery(next);
                    },
                  ),
                ),
            orElse: () => const [],
          ),

          // 标签
          ...tagsAsync.maybeWhen(
            data: (list) => list.take(8).map(
                  (t) => _FilterChip(
                    label: t.name,
                    active: query.tagId == t.id,
                    onTap: () {
                      final next = query.tagId == t.id
                          ? query.copyWith(clearTag: true)
                          : query.copyWith(tagId: t.id);
                      ref.read(itemListControllerProvider.notifier).applyQuery(next);
                    },
                  ),
                ),
            orElse: () => const [],
          ),
        ],
      ),
    );
  }

  /// 状态选择
  Future<void> _pickStatus(ItemQuery query) async {
    final selected = await showModalBottomSheet<int?>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Padding(
              padding: EdgeInsets.all(AppSpacing.lg),
              child: Text('按状态筛选', style: TextStyle(fontWeight: FontWeight.w600)),
            ),
            ListTile(
              leading: const Icon(Icons.all_inclusive),
              title: const Text('全部'),
              onTap: () => Navigator.pop(ctx, -1),
            ),
            ListTile(
              leading: const Icon(Icons.check_circle_outline),
              title: const Text('在库'),
              onTap: () => Navigator.pop(ctx, 1),
            ),
            ListTile(
              leading: const Icon(Icons.archive_outlined),
              title: const Text('已归档'),
              onTap: () => Navigator.pop(ctx, 0),
            ),
            const SizedBox(height: AppSpacing.sm),
          ],
        ),
      ),
    );

    if (selected == null) return;
    final next = selected == -1
        ? query.copyWith(clearStatus: true)
        : query.copyWith(status: selected);
    await ref.read(itemListControllerProvider.notifier).applyQuery(next);
  }

  /// 调整数量
  Future<void> _changeQuantity(StorageItem item, int delta) async {
    try {
      await ref.read(storageRepositoryProvider).changeQuantity(item.id, delta);
      ref.read(itemListControllerProvider.notifier).updateLocally(item);
      ref.invalidate(storageOverviewProvider);
      // 重新拉取该物品以同步最新数量
      ref.invalidate(itemDetailProvider(item.id));
    } catch (e) {
      _toast(e.toString(), isError: true);
    }
  }

  /// 单项操作菜单
  Future<void> _showItemActions(StorageItem item) async {
    final action = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Text(
                item.name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
            ),
            ListTile(
              leading: const Icon(Icons.edit_outlined),
              title: const Text('编辑'),
              onTap: () => Navigator.pop(ctx, 'edit'),
            ),
            ListTile(
              leading: Icon(item.isArchived ? Icons.unarchive_outlined : Icons.archive_outlined),
              title: Text(item.isArchived ? '恢复在库' : '归档'),
              onTap: () => Navigator.pop(ctx, 'toggle'),
            ),
            ListTile(
              leading: const Icon(Icons.checklist, size: 22),
              title: const Text('批量选择'),
              onTap: () => Navigator.pop(ctx, 'select'),
            ),
            ListTile(
              leading: const Icon(Icons.delete_outline, color: AppColors.danger),
              title: const Text('删除', style: TextStyle(color: AppColors.danger)),
              onTap: () => Navigator.pop(ctx, 'delete'),
            ),
            const SizedBox(height: AppSpacing.sm),
          ],
        ),
      ),
    );

    if (!mounted || action == null) return;

    switch (action) {
      case 'edit':
        context.push(AppRoutes.storageItemFormOf(id: item.id));
      case 'toggle':
        await _toggleStatus(item);
      case 'select':
        setState(() {
          _selectionMode = true;
          _selectedIds.add(item.id);
        });
      case 'delete':
        await _deleteOne(item);
    }
  }

  Future<void> _toggleStatus(StorageItem item) async {
    final nextStatus = item.isArchived ? 1 : 0;
    try {
      await ref.read(storageRepositoryProvider).toggleStatus(item.id, nextStatus);
      ref.read(itemListControllerProvider.notifier).removeLocally([item.id]);
      ref.invalidate(storageOverviewProvider);
      _toast(nextStatus == 0 ? '已归档' : '已恢复在库');
    } catch (e) {
      _toast(e.toString(), isError: true);
    }
  }

  Future<void> _deleteOne(StorageItem item) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('删除物品'),
        content: Text('确定删除「${item.name}」吗？'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('取消')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: AppColors.danger),
            child: const Text('删除'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    try {
      await ref.read(storageRepositoryProvider).deleteItems([item.id]);
      ref.read(itemListControllerProvider.notifier).removeLocally([item.id]);
      ref.invalidate(storageOverviewProvider);
      _toast('已删除');
    } catch (e) {
      _toast(e.toString(), isError: true);
    }
  }
}

/// 筛选胶囊
class _FilterChip extends StatelessWidget {
  const _FilterChip({
    required this.label,
    required this.active,
    required this.onTap,
    this.icon,
  });

  final String label;
  final bool active;
  final VoidCallback onTap;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: AppSpacing.sm),
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: active ? AppColors.primary : Theme.of(context).cardTheme.color,
            borderRadius: BorderRadius.circular(AppRadius.pill),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[
                Icon(
                  icon,
                  size: 13,
                  color: active ? Colors.white : AppColors.textSecondary,
                ),
                const SizedBox(width: 3),
              ],
              Text(
                label,
                style: TextStyle(
                  fontSize: 12,
                  color: active ? Colors.white : AppColors.textSecondary,
                  fontWeight: active ? FontWeight.w500 : FontWeight.w400,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
