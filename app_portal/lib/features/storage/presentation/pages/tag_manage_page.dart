import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../shared/widgets/app_scaffold.dart';
import '../../../../shared/widgets/async_view.dart';
import '../../data/models/storage_category.dart';
import '../../providers/storage_provider.dart';
import '../widgets/item_card.dart';

/// 标签管理页
class TagManagePage extends ConsumerStatefulWidget {
  const TagManagePage({super.key});

  @override
  ConsumerState<TagManagePage> createState() => _TagManagePageState();
}

class _TagManagePageState extends ConsumerState<TagManagePage> {
  List<StorageTag>? _tags;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final tags = await ref.read(storageRepositoryProvider).fetchTags();
      if (!mounted) return;
      setState(() {
        _tags = tags;
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

  Future<void> _showForm({StorageTag? tag}) async {
    final nameCtrl = TextEditingController(text: tag?.name ?? '');
    var color = tag?.color ?? '#4F7CFF';
    final formKey = GlobalKey<FormState>();

    const presetColors = [
      '#4F7CFF',
      '#52C41A',
      '#FAAD14',
      '#FF4D4F',
      '#8C8C8C',
      '#722ED1',
      '#13C2C2',
      '#F759AB',
    ];

    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: Text(tag == null ? '新增标签' : '编辑标签'),
          content: Form(
            key: formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                TextFormField(
                  controller: nameCtrl,
                  autofocus: true,
                  decoration: const InputDecoration(labelText: '标签名称 *'),
                  validator: (v) => (v == null || v.trim().isEmpty) ? '请输入标签名称' : null,
                ),
                const SizedBox(height: AppSpacing.lg),
                const Text(
                  '标签颜色',
                  style: TextStyle(fontSize: 13, color: AppColors.textSecondary),
                ),
                const SizedBox(height: AppSpacing.sm),
                Wrap(
                  spacing: AppSpacing.sm,
                  runSpacing: AppSpacing.sm,
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
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('取消')),
            TextButton(
              onPressed: () {
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
      final payload = {'name': nameCtrl.text.trim(), 'color': color};

      if (tag == null) {
        await repo.createTag(payload);
      } else {
        await repo.updateTag(tag.id, payload);
      }

      ref.invalidate(tagListProvider);
      await _load();
      _toast(tag == null ? '已新增标签' : '已保存');
    } catch (e) {
      _toast(e.toString(), isError: true);
    }
  }

  Future<void> _delete(StorageTag tag) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('删除标签'),
        content: Text('确定删除「${tag.name}」吗？关联的物品不会被删除。'),
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
      await ref.read(storageRepositoryProvider).deleteTags([tag.id]);
      ref.invalidate(tagListProvider);
      await _load();
      _toast('已删除');
    } catch (e) {
      _toast(e.toString(), isError: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final tags = _tags;

    return AppScaffold(
      title: '标签管理',
      body: _loading
          ? const LoadingView()
          : (tags == null || tags.isEmpty)
              ? EmptyView(
                  icon: Icons.sell_outlined,
                  title: '还没有标签',
                  subtitle: '标签可以跨分类标记物品，例如「常用」「易碎」',
                  actionLabel: '新增标签',
                  onAction: () => _showForm(),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.builder(
                    padding: const EdgeInsets.fromLTRB(
                      AppSpacing.pagePadding,
                      AppSpacing.lg,
                      AppSpacing.pagePadding,
                      AppSpacing.xxl * 2,
                    ),
                    itemCount: tags.length,
                    itemBuilder: (context, index) {
                      final tag = tags[index];
                      final color = parseHexColor(tag.color);

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
                            child: Icon(Icons.sell_outlined, size: 20, color: color),
                          ),
                          title: Row(
                            children: [
                              Flexible(
                                child: Text(
                                  tag.name,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    fontSize: 15,
                                    fontWeight: FontWeight.w500,
                                  ),
                                ),
                              ),
                              if (tag.isPublic) ...[
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
                            '${tag.itemCount} 件物品',
                            style: const TextStyle(
                              fontSize: 12,
                              color: AppColors.textTertiary,
                            ),
                          ),
                          trailing: tag.isPublic
                              ? null
                              : PopupMenuButton<String>(
                                  icon: const Icon(
                                    Icons.more_vert,
                                    size: 18,
                                    color: AppColors.textTertiary,
                                  ),
                                  onSelected: (action) {
                                    if (action == 'edit') {
                                      _showForm(tag: tag);
                                    } else {
                                      _delete(tag);
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
                        ),
                      );
                    },
                  ),
                ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showForm(),
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.add, size: 20),
        label: const Text('新增标签'),
      ),
    );
  }
}
