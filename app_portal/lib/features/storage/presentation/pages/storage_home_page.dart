import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/router/route_names.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../core/utils/formatters.dart';
import '../../../../shared/widgets/app_scaffold.dart';
import '../../../../shared/widgets/async_view.dart';
import '../../data/models/storage_category.dart';
import '../../providers/storage_provider.dart';

/// 物品收纳首页
///
/// 展示概览统计 + 分类快捷入口 + 全部物品列表入口。
class StorageHomePage extends ConsumerWidget {
  const StorageHomePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final overviewAsync = ref.watch(storageOverviewProvider);

    return AppScaffold(
      title: '物品收纳',
      actions: [
        IconButton(
          tooltip: '标签管理',
          icon: const Icon(Icons.sell_outlined, size: 20),
          onPressed: () => context.push(AppRoutes.storageTags),
        ),
        IconButton(
          tooltip: '分类管理',
          icon: const Icon(Icons.category_outlined, size: 20),
          onPressed: () => context.push(AppRoutes.storageCategories),
        ),
      ],
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(storageOverviewProvider);
          ref.invalidate(categoryOptionsProvider);
          await ref.read(storageOverviewProvider.future);
        },
        child: ListView(
          padding: const EdgeInsets.all(AppSpacing.pagePadding),
          children: [
            // --- 概览卡片 -------------------------------------------------
            overviewAsync.when(
              loading: () => const _OverviewSkeleton(),
              error: (e, _) => _OverviewError(
                onRetry: () => ref.invalidate(storageOverviewProvider),
              ),
              data: (overview) => _OverviewCard(
                itemCount: overview.itemCount,
                totalQuantity: overview.totalQuantity,
                categoryCount: overview.categoryCount,
                totalValue: overview.totalValue,
                expiringSoonCount: overview.expiringSoonCount,
              ),
            ),

            const SizedBox(height: AppSpacing.xl),

            // --- 分类快捷入口 ---------------------------------------------
            SectionHeader(
              title: '分类',
              trailing: TextButton(
                onPressed: () => context.push(AppRoutes.storageCategories),
                child: const Text('管理', style: TextStyle(fontSize: 13)),
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            const _CategoryShortcuts(),

            const SizedBox(height: AppSpacing.xl),

            // --- 全部物品入口 ---------------------------------------------
            SectionHeader(
              title: '我的物品',
              trailing: TextButton(
                onPressed: () => context.push(AppRoutes.storageItems),
                child: const Text('查看全部', style: TextStyle(fontSize: 13)),
              ),
            ),
            const SizedBox(height: AppSpacing.md),

            AppCard(
              onTap: () => context.push(AppRoutes.storageItems),
              child: const Row(
                children: [
                  Icon(Icons.inventory_2_outlined, size: 22, color: AppColors.primary),
                  SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('全部物品', style: TextStyle(fontSize: 15)),
                        SizedBox(height: 2),
                        Text(
                          '搜索、筛选、批量管理你的物品',
                          style: TextStyle(fontSize: 12, color: AppColors.textTertiary),
                        ),
                      ],
                    ),
                  ),
                  Icon(Icons.chevron_right, size: 20, color: AppColors.textTertiary),
                ],
              ),
            ),
          ],
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push(AppRoutes.storageItemFormOf()),
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.add, size: 20),
        label: const Text('添加物品'),
      ),
    );
  }
}

/// 概览卡片
class _OverviewCard extends StatelessWidget {
  const _OverviewCard({
    required this.itemCount,
    required this.totalQuantity,
    required this.categoryCount,
    required this.totalValue,
    required this.expiringSoonCount,
  });

  final int itemCount;
  final int totalQuantity;
  final int categoryCount;
  final double totalValue;
  final int expiringSoonCount;

  @override
  Widget build(BuildContext context) {
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
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.inventory_2_outlined, size: 18, color: Colors.white70),
              const SizedBox(width: AppSpacing.sm),
              const Text(
                '物品概览',
                style: TextStyle(fontSize: 14, color: Colors.white70),
              ),
              const Spacer(),
              if (expiringSoonCount > 0)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(AppRadius.pill),
                  ),
                  child: Text(
                    '$expiringSoonCount 件临期',
                    style: const TextStyle(fontSize: 11, color: Colors.white),
                  ),
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.lg),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                '$itemCount',
                style: const TextStyle(
                  fontSize: 34,
                  fontWeight: FontWeight.w600,
                  color: Colors.white,
                  height: 1,
                ),
              ),
              const SizedBox(width: 6),
              const Padding(
                padding: EdgeInsets.only(bottom: 4),
                child: Text('件物品', style: TextStyle(fontSize: 13, color: Colors.white70)),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.lg),
          const Divider(height: 1, color: Colors.white24),
          const SizedBox(height: AppSpacing.md),
          Row(
            children: [
              _OverviewMetric(label: '数量合计', value: '$totalQuantity'),
              _OverviewMetric(label: '分类数', value: '$categoryCount'),
              _OverviewMetric(label: '总价值', value: Formatters.money(totalValue)),
            ],
          ),
        ],
      ),
    );
  }
}

class _OverviewMetric extends StatelessWidget {
  const _OverviewMetric({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w600,
              color: Colors.white,
            ),
          ),
          const SizedBox(height: 2),
          Text(label, style: const TextStyle(fontSize: 11, color: Colors.white60)),
        ],
      ),
    );
  }
}

/// 分类快捷入口（横向滚动）
class _CategoryShortcuts extends ConsumerWidget {
  const _CategoryShortcuts();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final categoriesAsync = ref.watch(categoryOptionsProvider);

    return SizedBox(
      height: 92,
      child: AsyncView<List<StorageCategory>>(
        value: categoriesAsync,
        loading: const SizedBox(
          height: 92,
          child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
        ),
        emptyCheck: (data) => data.isEmpty,
        emptyView: const _NoCategoryHint(),
        onRetry: () => ref.invalidate(categoryOptionsProvider),
        builder: (categories) => ListView.separated(
          scrollDirection: Axis.horizontal,
          itemCount: categories.length,
          separatorBuilder: (_, __) => const SizedBox(width: AppSpacing.md),
          itemBuilder: (context, index) {
            final cat = categories[index];
            final color = _parseColor(cat.color);

            return InkWell(
              onTap: () => context.push(
                AppRoutes.storageItems,
                extra: {'categoryId': cat.id, 'categoryName': cat.name},
              ),
              borderRadius: BorderRadius.circular(AppRadius.md),
              child: SizedBox(
                width: 72,
                child: Column(
                  children: [
                    Container(
                      width: 50,
                      height: 50,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: color.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(AppRadius.md),
                      ),
                      child: Icon(_parseIcon(cat.icon), size: 24, color: color),
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    Text(
                      cat.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      textAlign: TextAlign.center,
                      style: const TextStyle(fontSize: 12),
                    ),
                    Text(
                      '${cat.itemCount}',
                      style: const TextStyle(fontSize: 10, color: AppColors.textTertiary),
                    ),
                  ],
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}

class _NoCategoryHint extends StatelessWidget {
  const _NoCategoryHint();

  @override
  Widget build(BuildContext context) {
    return const SizedBox(
      height: 92,
      child: Center(
        child: Text(
          '暂无分类，点击右上角添加',
          style: TextStyle(fontSize: 13, color: AppColors.textTertiary),
        ),
      ),
    );  }
}

class _OverviewSkeleton extends StatelessWidget {
  const _OverviewSkeleton();

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 168,
      decoration: BoxDecoration(
        color: AppColors.primaryLight,
        borderRadius: BorderRadius.circular(AppRadius.lg),
      ),
      child: const Center(
        child: SizedBox(
          width: 24,
          height: 24,
          child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.primary),
        ),
      ),
    );
  }
}

class _OverviewError extends StatelessWidget {
  const _OverviewError({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 168,
      decoration: BoxDecoration(
        color: Theme.of(context).cardTheme.color,
        borderRadius: BorderRadius.circular(AppRadius.lg),
      ),
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              '概览加载失败',
              style: TextStyle(fontSize: 13, color: AppColors.textTertiary),
            ),
            const SizedBox(height: AppSpacing.sm),
            TextButton(onPressed: onRetry, child: const Text('重试')),
          ],
        ),
      ),
    );
  }
}

// -----------------------------------------------------------------------------
// 图标 / 颜色映射
// -----------------------------------------------------------------------------

/// 分类图标标识 → IconData
IconData _parseIcon(String? key) {
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

/// 十六进制色值 → Color
Color _parseColor(String? hex) {
  if (hex == null || hex.isEmpty) return AppColors.primary;
  var value = hex.replaceFirst('#', '');
  if (value.length == 6) value = 'FF$value';
  final parsed = int.tryParse(value, radix: 16);
  return parsed == null ? AppColors.primary : Color(parsed);
}
