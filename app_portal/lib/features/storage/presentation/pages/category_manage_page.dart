import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../shared/widgets/app_scaffold.dart';
import '../../../../shared/widgets/async_view.dart';
import '../../data/models/storage_category.dart';
import '../../providers/storage_provider.dart';
import '../widgets/item_card.dart';

/// 分类管理页
///
/// 支持新增、编辑、删除自己的分类；公共分类只读展示。
class CategoryManagePage extends ConsumerStatefulWidget {
  const CategoryManagePage({super.key});

  @override
  ConsumerState<CategoryManagePage> createState() => _CategoryManagePageState();
}

class _CategoryManagePageState extends ConsumerState<CategoryManagePage> {
  final _searchCtrl = TextEditingController();

  /// 分类列表（本地维护，避免每次操作整页重载）
  List<StorageCategory>? _categories;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final result = await ref.read(storageRepositoryProvider).fetchCategories();
      if (!mounted) return;
      setState(() {
        _categories = result.list;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _loading = false);
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

  /// 新增 / 编辑弹窗
  Future<void> _showForm({StorageCategory? category}) async {
    final nameCtrl = TextEditingController(text: category?.name ?? '');
    final remarkCtrl = TextEditingController(text: category?.remark ?? '');
    var color = category?.color ?? '#4F7CFF';
    final formKey = GlobalKey<FormState>();

    const presetColors = [
      '#4F7CFF',
      '#FF7A45',
      '#36CFC9',
      '#F759AB',
      '#52C41A',
      '#FAAD14',
      '#722ED1',
      '#13C2C2',
    ];

    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: Text(category == null ? '新增分类' : '编辑分类'),
          content: Form(
            key: formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                TextFormField(
                  controller: nameCtrl,
                  autofocus: true,
                  decoration: const InputDecoration(labelText: '分类名称 *'),
                  validator: (v) =>
                      (v == null || v.trim().isEmpty) ? '请输入分类名称' : null,
                ),
                const SizedBox(height: AppSpacing.md),
                TextFormField(
                  controller: remarkCtrl,
                  decoration: const InputDecoration(labelText: '备注'),
                ),
                const SizedBox(height: AppSpacing.lg),
                const Text(
                  '主题色',
                  style: TextStyle(fontSize: 13, color: AppColors.textSecondary),
                ),
                const SizedBox(height: AppSpacing.sm),
                Wrap(
                  spacing: AppSpacing.sm,
                  children: presetColors.map((hex) {
                    final selected = color == hex;
                    return GestureDetector(
                      onTap: () => setDialogState(() => color = hex),
                      child: Container(
                        width: 30,
                        height: 30,
                        decoration: BoxDecoration(
                          color: parseHexColor(hex),
                          shape: BoxShape.circle,
                          border: selected
                              ? Border.all(color: AppColors.textPrimary, width: 2)
                              : null,
                        ),
                        child: selected
                            ? const Icon(Icons.check, size: 16, color: Colors.white)
                            : null,
                      ),
                    );
                  }).toList(),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('取消'),
            ),
            TextButton(
              onPressed: () async {
                if (!formKey.currentState!.validate()) return;
                Navigator.pop(ctx, true);
              },
              child: const Text('保存'),
            ),
          ],
        ),
      ),
    );

    if (saved != true) return;

    try {
      final repo = ref.read(storageRepositoryProvider);
      final payload = {
        'name': nameCtrl.text.trim(),
        'remark': remarkCtrl.text.trim(),
        'color': color,
      };

      if (category == null) {
        await repo.createCategory(payload);
      } else {
        await repo.updateCategory(category.id, payload);
      }

      ref.invalidate(categoryOptionsProvider);
      ref.invalidate(storageOverviewProvider);
      await _load();
      _toast(category == null ? '已新增分类' : '已保存');
    } catch (e) {
      _toast(e.toString(), isError: true);
    }
  }

  Future<void> _delete(StorageCategory category) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('删除分类'),
        content: Text('确定删除「${category.name}」吗？'),
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
      await ref.read(storageRepositoryProvider).deleteCategories([category.id]);
      ref.invalidate(categoryOptionsProvider);
      ref.invalidate(storageOverviewProvider);
      await _load();
      _toast('已删除');
    } catch (e) {
      // 后端会校验分类下是否还有物品，此处直接提示
      _toast(e.toString(), isError: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final categories = _keyword.isEmpty
        ? _categories
        : _categories
            ?.where((c) => c.name.toLowerCase().contains(_keyword.toLowerCase()))
            .toList();

    return AppScaffold(
      title: '分类管理',
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.pagePadding,
              AppSpacing.md,
              AppSpacing.pagePadding,
              AppSpacing.sm,
            ),
            child: TextField(
              controller: _searchCtrl,
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(
                hintText: '搜索分类名称',
                prefixIcon: Icon(Icons.search, size: 20),
                isDense: true,
                contentPadding: EdgeInsets.symmetric(vertical: 0, horizontal: AppSpacing.md),
              ),
            ),
          ),
          Expanded(
            child: _loading
                ? const LoadingView()
                : (categories == null || categories.isEmpty)
                    ? EmptyView(
                        icon: Icons.category_outlined,
                        title: _keyword.isEmpty ? '还没有分类' : '没有匹配的分类',
                        subtitle: _keyword.isEmpty ? '点击右下角按钮创建第一个分类' : null,
                        actionLabel: _keyword.isEmpty ? '新增分类' : null,
                        onAction: _keyword.isEmpty ? () => _showForm() : null,
                      )
                    : RefreshIndicator(
                        onRefresh: _load,
                        child: ListView.builder(
                          padding: const EdgeInsets.fromLTRB(
                            AppSpacing.pagePadding,
                            AppSpacing.xs,
                            AppSpacing.pagePadding,
                            AppSpacing.xxl * 2,
                          ),
                          itemCount: categories.length,
                          itemBuilder: (context, index) {
                            final cat = categories[index];
                            final color = parseHexColor(cat.color);

                            return Container(
                              margin: const EdgeInsets.only(bottom: AppSpacing.sm),
                              decoration: BoxDecoration(
                                color: Theme.of(context).cardTheme.color,
                                borderRadius: BorderRadius.circular(AppRadius.md),
                              ),
                              child: ListTile(
                                contentPadding: const EdgeInsets.symmetric(
                                  horizontal: AppSpacing.lg,
                                  vertical: AppSpacing.xs,
                                ),
                                leading: Container(
                                  width: 42,
                                  height: 42,
                                  alignment: Alignment.center,
                                  decoration: BoxDecoration(
                                    color: color.withValues(alpha: 0.1),
                                    borderRadius: BorderRadius.circular(AppRadius.md),
                                  ),
                                  child: Icon(
                                    _iconOf(cat.icon),
                                    size: 20,
                                    color: color,
                                  ),
                                ),
                                title: Row(
                                  children: [
                                    Flexible(
                                      child: Text(
                                        cat.name,
                                        overflow: TextOverflow.ellipsis,
                                        style: const TextStyle(
                                          fontSize: 15,
                                          fontWeight: FontWeight.w500,
                                        ),
                                      ),
                                    ),
                                    if (cat.isPublic) ...[
                                      const SizedBox(width: AppSpacing.sm),
                                      const ColorTag(
                                        label: '公共',
                                        color: AppColors.textTertiary,
                                        dense: true,
                                      ),
                                    ],
                                  ],
                                ),
                                subtitle: Text(
                                  '${cat.itemCount} 件物品${cat.remark?.isNotEmpty == true ? ' · ${cat.remark}' : ''}',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    fontSize: 12,
                                    color: AppColors.textTertiary,
                                  ),
                                ),
                                trailing: cat.isPublic
                                    ? null
                                    : PopupMenuButton<String>(
                                        icon: const Icon(
                                          Icons.more_vert,
                                          size: 18,
                                          color: AppColors.textTertiary,
                                        ),
                                        onSelected: (action) {
                                          if (action == 'edit') {
                                            _showForm(category: cat);
                                          } else {
                                            _delete(cat);
                                          }
                                        },
                                        itemBuilder: (_) => const [
                                          PopupMenuItem(value: 'edit', child: Text('编辑')),
                                          PopupMenuItem(
                                            value: 'delete',
                                            child: Text(
                                              '删除',
                                              style: TextStyle(color: AppColors.danger),
                                            ),
                                          ),
                                        ],
                                      ),
                                onTap: cat.isPublic ? null : () => _showForm(category: cat),
                              ),
                            );
                          },
                        ),
                      ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showForm(),
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.add, size: 20),
        label: const Text('新增分类'),
      ),
    );
  }

  String get _keyword => _searchCtrl.text.trim();

  IconData _iconOf(String? key) {
    switch (key) {
      case 'devices':
        return Icons.devices_outlined;
      case 'checkroom':
        return Icons.checkroom_outlined;
      case 'menu_book':
        return Icons.menu_book_outlined;
      case 'restaurant':
        return Icons.restaurant_outlined;
      case 'medical_services':
        return Icons.medical_services_outlined;
      case 'home':
        return Icons.home_outlined;
      case 'handyman':
        return Icons.handyman_outlined;
      case 'more_horiz':
        return Icons.more_horiz;
      default:
        return Icons.folder_outlined;
    }
  }
}
