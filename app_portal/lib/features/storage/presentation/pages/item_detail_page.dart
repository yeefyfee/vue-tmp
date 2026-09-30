import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/router/route_names.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../core/utils/formatters.dart';
import '../../../../shared/widgets/app_scaffold.dart';
import '../../../../shared/widgets/async_view.dart';
import '../../data/models/storage_item.dart';
import '../../providers/storage_provider.dart';
import '../widgets/item_card.dart';

/// 物品详情页
class ItemDetailPage extends ConsumerWidget {
  const ItemDetailPage({super.key, required this.itemId});

  final String itemId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final detailAsync = ref.watch(itemDetailProvider(itemId));

    return AppScaffold(
      title: '物品详情',
      actions: [
        detailAsync.maybeWhen(
          data: (item) => IconButton(
            tooltip: '编辑',
            icon: const Icon(Icons.edit_outlined, size: 20),
            onPressed: () => context.push(AppRoutes.storageItemFormOf(id: item.id)),
          ),
          orElse: () => const SizedBox.shrink(),
        ),
      ],
      body: AsyncView<StorageItem>(
        value: detailAsync,
        onRetry: () => ref.invalidate(itemDetailProvider(itemId)),
        builder: (item) => _DetailBody(item: item),
      ),
    );
  }
}

class _DetailBody extends ConsumerWidget {
  const _DetailBody({required this.item});

  final StorageItem item;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ListView(
      padding: const EdgeInsets.all(AppSpacing.pagePadding),
      children: [
        // --- 图片区 -------------------------------------------------------
        if (item.imageUrls.isNotEmpty)
          SizedBox(
            height: 200,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: item.imageUrls.length,
              separatorBuilder: (_, __) => const SizedBox(width: AppSpacing.sm),
              itemBuilder: (context, index) => ClipRRect(
                borderRadius: BorderRadius.circular(AppRadius.md),
                child: Image.network(
                  item.imageUrls[index],
                  width: 200,
                  height: 200,
                  fit: BoxFit.cover,
                  errorBuilder: (_, __, ___) => Container(
                    width: 200,
                    height: 200,
                    color: AppColors.primaryLight,
                    child: const Icon(Icons.broken_image_outlined,
                        color: AppColors.textTertiary),
                  ),
                ),
              ),
            ),
          )
        else
          Container(
            height: 160,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.primaryLight,
              borderRadius: BorderRadius.circular(AppRadius.md),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  item.name.isNotEmpty ? item.name.characters.first : '?',
                  style: const TextStyle(
                    fontSize: 48,
                    fontWeight: FontWeight.w600,
                    color: AppColors.primary,
                  ),
                ),
                const SizedBox(height: AppSpacing.xs),
                const Text(
                  '暂无图片',
                  style: TextStyle(fontSize: 12, color: AppColors.textTertiary),
                ),
              ],
            ),
          ),

        const SizedBox(height: AppSpacing.xl),

        // --- 名称与状态 ----------------------------------------------------
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Text(
                item.name,
                style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
              ),
            ),
            if (item.isArchived)
              const ColorTag(label: '已归档', color: AppColors.textTertiary, dense: true),
          ],
        ),

        if (item.categoryName != null) ...[
          const SizedBox(height: AppSpacing.sm),
          ColorTag(
            label: item.categoryName!,
            color: AppColors.primary,
            icon: Icons.folder_outlined,
            dense: true,
          ),
        ],

        if (item.tags.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.md),
          Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            children: item.tags
                .map((t) => ColorTag(label: t.name, color: parseHexColor(t.color), dense: true))
                .toList(),
          ),
        ],

        const SizedBox(height: AppSpacing.xl),

        // --- 数量快捷调整 ---------------------------------------------------
        _QuantityCard(item: item),

        const SizedBox(height: AppSpacing.lg),

        // --- 详细信息 -------------------------------------------------------
        const SectionHeader(title: '详细信息'),
        const SizedBox(height: AppSpacing.md),
        AppCard(
          padding: EdgeInsets.zero,
          child: Column(
            children: [
              _DetailRow(label: '数量', value: '${item.quantity}${item.unit ?? ''}'),
              if (item.price != null)
                _DetailRow(label: '单价', value: Formatters.money(item.price)),
              if (item.price != null)
                _DetailRow(
                  label: '总价值',
                  value: Formatters.money(item.price! * item.quantity),
                ),
              if (item.location?.isNotEmpty == true)
                _DetailRow(label: '存放位置', value: item.location!),
              if (item.purchaseDate != null)
                _DetailRow(label: '购置日期', value: Formatters.date(item.purchaseDate)),
              if (item.expireDate != null)
                _DetailRow(
                  label: '过期日期',
                  value: Formatters.date(item.expireDate),
                  valueColor: item.isExpired
                      ? AppColors.danger
                      : (item.isExpiringSoon ? AppColors.warning : null),
                  suffix: item.isExpired
                      ? '已过期'
                      : (item.isExpiringSoon ? '${item.daysUntilExpire} 天后' : null),
                ),
              if (item.createTime != null)
                _DetailRow(label: '创建时间', value: Formatters.dateTime(item.createTime)),
            ],
          ),
        ),

        if (item.remark?.isNotEmpty == true) ...[
          const SizedBox(height: AppSpacing.lg),
          const SectionHeader(title: '备注'),
          const SizedBox(height: AppSpacing.md),
          AppCard(
            child: Text(
              item.remark!,
              style: const TextStyle(fontSize: 14, height: 1.6),
            ),
          ),
        ],

        const SizedBox(height: AppSpacing.xxl),

        // --- 操作 -----------------------------------------------------------
        OutlinedButton.icon(
          onPressed: () => _toggleArchive(context, ref),
          icon: Icon(
            item.isArchived ? Icons.unarchive_outlined : Icons.archive_outlined,
            size: 18,
          ),
          label: Text(item.isArchived ? '恢复在库' : '归档'),
        ),
        const SizedBox(height: AppSpacing.md),
        OutlinedButton.icon(
          onPressed: () => _delete(context, ref),
          icon: const Icon(Icons.delete_outline, size: 18),
          label: const Text('删除物品'),
          style: OutlinedButton.styleFrom(
            foregroundColor: AppColors.danger,
            side: BorderSide(color: AppColors.danger.withValues(alpha: 0.3)),
          ),
        ),

        const SizedBox(height: AppSpacing.xl),
      ],
    );
  }

  Future<void> _toggleArchive(BuildContext context, WidgetRef ref) async {
    final nextStatus = item.isArchived ? 1 : 0;
    try {
      await ref.read(storageRepositoryProvider).toggleStatus(item.id, nextStatus);
      ref.invalidate(itemDetailProvider(item.id));
      ref.invalidate(storageOverviewProvider);
      ref.read(itemListControllerProvider.notifier).load();
      if (!context.mounted) return;
      _toast(context, nextStatus == 0 ? '已归档' : '已恢复在库');
    } catch (e) {
      if (!context.mounted) return;
      _toast(context, e.toString(), isError: true);
    }
  }

  Future<void> _delete(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('删除物品'),
        content: Text('确定删除「${item.name}」吗？删除后不可恢复。'),
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
      ref.invalidate(storageOverviewProvider);
      ref.read(itemListControllerProvider.notifier).load();
      if (!context.mounted) return;
      _toast(context, '已删除');
      context.pop();
    } catch (e) {
      if (!context.mounted) return;
      _toast(context, e.toString(), isError: true);
    }
  }

  void _toast(BuildContext context, String message, {bool isError = false}) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          backgroundColor: isError ? AppColors.danger : null,
        ),
      );
  }
}

/// 数量调整卡片
class _QuantityCard extends ConsumerWidget {
  const _QuantityCard({required this.item});

  final StorageItem item;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [AppColors.primary, AppColors.primaryDark],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(AppRadius.lg),
      ),
      child: Row(
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                '当前数量',
                style: TextStyle(fontSize: 12, color: Colors.white70),
              ),
              const SizedBox(height: AppSpacing.xs),
              Text(
                '${item.quantity}${item.unit ?? ''}',
                style: const TextStyle(
                  fontSize: 28,
                  fontWeight: FontWeight.w600,
                  color: Colors.white,
                  height: 1,
                ),
              ),
            ],
          ),
          const Spacer(),
          _RoundButton(
            icon: Icons.remove,
            onTap: item.quantity > 0 ? () => _change(context, ref, -1) : null,
          ),
          const SizedBox(width: AppSpacing.md),
          _RoundButton(icon: Icons.add, onTap: () => _change(context, ref, 1)),
        ],
      ),
    );
  }

  Future<void> _change(BuildContext context, WidgetRef ref, int delta) async {
    try {
      await ref.read(storageRepositoryProvider).changeQuantity(item.id, delta);
      ref.invalidate(itemDetailProvider(item.id));
      ref.invalidate(storageOverviewProvider);
      ref.read(itemListControllerProvider.notifier).load();
    } catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(e.toString()), backgroundColor: AppColors.danger));
    }
  }
}

class _RoundButton extends StatelessWidget {
  const _RoundButton({required this.icon, this.onTap});

  final IconData icon;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 40,
        height: 40,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: enabled ? 0.22 : 0.08),
          shape: BoxShape.circle,
        ),
        child: Icon(
          icon,
          size: 20,
          color: enabled ? Colors.white : Colors.white38,
        ),
      ),
    );
  }
}

/// 详情行
class _DetailRow extends StatelessWidget {
  const _DetailRow({
    required this.label,
    required this.value,
    this.valueColor,
    this.suffix,
  });

  final String label;
  final String value;
  final Color? valueColor;
  final String? suffix;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.lg,
        vertical: AppSpacing.md,
      ),
      child: Row(
        children: [
          Text(
            label,
            style: const TextStyle(fontSize: 14, color: AppColors.textSecondary),
          ),
          const Spacer(),
          Text(
            value,
            style: TextStyle(fontSize: 14, color: valueColor),
          ),
          if (suffix != null) ...[
            const SizedBox(width: AppSpacing.xs),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
              decoration: BoxDecoration(
                color: (valueColor ?? AppColors.primary).withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(AppRadius.xs),
              ),
              child: Text(
                suffix!,
                style: TextStyle(
                  fontSize: 10,
                  color: valueColor ?? AppColors.primary,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
