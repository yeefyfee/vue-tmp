import 'package:flutter/material.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../core/utils/formatters.dart';
import '../../../../shared/widgets/app_scaffold.dart';
import '../../data/models/storage_item.dart';

/// 物品卡片（列表形态）
class ItemCard extends StatelessWidget {
  const ItemCard({
    super.key,
    required this.item,
    this.onTap,
    this.onQuantityChanged,
    this.onMore,
    this.selectionMode = false,
    this.selected = false,
    this.onSelectChanged,
  });

  final StorageItem item;
  final VoidCallback? onTap;
  final void Function(int delta)? onQuantityChanged;
  final VoidCallback? onMore;
  final bool selectionMode;
  final bool selected;
  final ValueChanged<bool>? onSelectChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.listItemGap),
      decoration: BoxDecoration(
        color: Theme.of(context).cardTheme.color,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: selected
            ? Border.all(color: AppColors.primary, width: 1.5)
            : Border.all(color: Colors.transparent, width: 1.5),
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(AppRadius.md),
        child: InkWell(
          onTap: selectionMode ? () => onSelectChanged?.call(!selected) : onTap,
          borderRadius: BorderRadius.circular(AppRadius.md),
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (selectionMode) ...[
                  Checkbox(
                    value: selected,
                    onChanged: (v) => onSelectChanged?.call(v ?? false),
                    activeColor: AppColors.primary,
                    visualDensity: VisualDensity.compact,
                  ),
                  const SizedBox(width: AppSpacing.xs),
                ],

                // --- 封面 -------------------------------------------------
                _ItemThumb(item: item),

                const SizedBox(width: AppSpacing.md),

                // --- 信息 -------------------------------------------------
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              item.name,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ),
                          if (item.isArchived)
                            const _Badge(text: '已归档', color: AppColors.textTertiary),
                          if (item.isExpired)
                            const _Badge(text: '已过期', color: AppColors.danger)
                          else if (item.isExpiringSoon)
                            _Badge(
                              text: '${item.daysUntilExpire}天后过期',
                              color: AppColors.warning,
                            ),
                        ],
                      ),

                      if (item.categoryName != null) ...[
                        const SizedBox(height: 3),
                        Row(
                          children: [
                            const Icon(
                              Icons.folder_outlined,
                              size: 12,
                              color: AppColors.textTertiary,
                            ),
                            const SizedBox(width: 3),
                            Text(
                              item.categoryName!,
                              style: const TextStyle(
                                fontSize: 12,
                                color: AppColors.textTertiary,
                              ),
                            ),
                          ],
                        ),
                      ],

                      if (item.location?.isNotEmpty == true) ...[
                        const SizedBox(height: 2),
                        Row(
                          children: [
                            const Icon(
                              Icons.place_outlined,
                              size: 12,
                              color: AppColors.textTertiary,
                            ),
                            const SizedBox(width: 3),
                            Expanded(
                              child: Text(
                                item.location!,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: AppColors.textTertiary,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],

                      if (item.tags.isNotEmpty) ...[
                        const SizedBox(height: AppSpacing.sm),
                        Wrap(
                          spacing: AppSpacing.xs,
                          runSpacing: AppSpacing.xs,
                          children: item.tags
                              .take(3)
                              .map(
                                (t) => ColorTag(
                                  label: t.name,
                                  color: parseHexColor(t.color),
                                  dense: true,
                                ),
                              )
                              .toList(),
                        ),
                      ],

                      const SizedBox(height: AppSpacing.sm),

                      // --- 底部：价格 + 数量 ---------------------------------
                      Row(
                        children: [
                          if (item.price != null)
                            Text(
                              Formatters.money(item.price),
                              style: const TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                                color: AppColors.danger,
                              ),
                            ),
                          const Spacer(),
                          if (onQuantityChanged != null)
                            _QuantityStepper(
                              value: item.quantity,
                              unit: item.unit,
                              onChanged: onQuantityChanged!,
                            )
                          else
                            Text(
                              '×${item.quantity}${item.unit ?? ''}',
                              style: const TextStyle(
                                fontSize: 13,
                                color: AppColors.textSecondary,
                              ),
                            ),
                        ],
                      ),
                    ],
                  ),
                ),

                if (onMore != null && !selectionMode)
                  IconButton(
                    icon: const Icon(Icons.more_vert, size: 18),
                    color: AppColors.textTertiary,
                    visualDensity: VisualDensity.compact,
                    onPressed: onMore,
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// 物品缩略图
class _ItemThumb extends StatelessWidget {
  const _ItemThumb({required this.item});

  final StorageItem item;

  @override
  Widget build(BuildContext context) {
    if (item.coverUrl?.isNotEmpty == true) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(AppRadius.sm),
        child: Image.network(
          item.coverUrl!,
          width: 54,
          height: 54,
          fit: BoxFit.cover,
          errorBuilder: (_, __, ___) => _placeholder(),
        ),
      );
    }
    return _placeholder();
  }

  Widget _placeholder() {
    return Container(
      width: 54,
      height: 54,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: AppColors.primaryLight,
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      child: Text(
        item.name.isNotEmpty ? item.name.characters.first : '?',
        style: const TextStyle(
          fontSize: 20,
          fontWeight: FontWeight.w600,
          color: AppColors.primary,
        ),
      ),
    );
  }
}

/// 数量步进器
class _QuantityStepper extends StatelessWidget {
  const _QuantityStepper({
    required this.value,
    required this.onChanged,
    this.unit,
  });

  final int value;
  final void Function(int delta) onChanged;
  final String? unit;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        _StepButton(
          icon: Icons.remove,
          onTap: value > 0 ? () => onChanged(-1) : null,
        ),
        Container(
          constraints: const BoxConstraints(minWidth: 34),
          alignment: Alignment.center,
          child: Text(
            '$value${unit ?? ''}',
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
          ),
        ),
        _StepButton(icon: Icons.add, onTap: () => onChanged(1)),
      ],
    );
  }
}

class _StepButton extends StatelessWidget {
  const _StepButton({required this.icon, this.onTap});

  final IconData icon;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 24,
        height: 24,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: enabled ? AppColors.primaryLight : Theme.of(context).dividerColor,
          borderRadius: BorderRadius.circular(AppRadius.xs),
        ),
        child: Icon(
          icon,
          size: 14,
          color: enabled ? AppColors.primary : AppColors.textTertiary,
        ),
      ),
    );
  }
}

/// 小角标
class _Badge extends StatelessWidget {
  const _Badge({required this.text, required this.color});

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(left: AppSpacing.xs),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(AppRadius.xs),
      ),
      child: Text(
        text,
        style: TextStyle(fontSize: 10, color: color, fontWeight: FontWeight.w500),
      ),
    );
  }
}

/// 十六进制色值解析（供标签/分类复用）
Color parseHexColor(String? hex, {Color fallback = AppColors.primary}) {
  if (hex == null || hex.isEmpty) return fallback;
  var value = hex.replaceFirst('#', '');
  if (value.length == 6) value = 'FF$value';
  final parsed = int.tryParse(value, radix: 16);
  return parsed == null ? fallback : Color(parsed);
}
