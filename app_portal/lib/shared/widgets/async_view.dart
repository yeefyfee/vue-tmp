import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_exception.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';

/// 异步三态渲染封装
///
/// 统一处理 loading / error / data 三种状态，业务页面无需重复写分支：
/// ```dart
/// AsyncView<PageResult<StorageItem>>(
///   value: ref.watch(itemListProvider),
///   onRetry: () => ref.invalidate(itemListProvider),
///   builder: (data) => ItemListView(items: data.list),
/// )
/// ```
class AsyncView<T> extends StatelessWidget {
  const AsyncView({
    super.key,
    required this.value,
    required this.builder,
    this.onRetry,
    this.loading,
    this.errorBuilder,
    this.emptyCheck,
    this.emptyView,
  });

  final AsyncValue<T> value;
  final Widget Function(T data) builder;
  final VoidCallback? onRetry;
  final Widget? loading;
  final Widget Function(ApiException error)? errorBuilder;

  /// 判定数据是否为空；返回 true 时展示 [emptyView]
  final bool Function(T data)? emptyCheck;
  final Widget? emptyView;

  @override
  Widget build(BuildContext context) {
    return value.when(
      loading: () => loading ?? const LoadingView(),
      error: (error, _) {
        final apiError = error is ApiException ? error : BusinessException(error.toString());
        return errorBuilder?.call(apiError) ?? ErrorView(error: apiError, onRetry: onRetry);
      },
      data: (data) {
        if (emptyCheck?.call(data) == true && emptyView != null) {
          return emptyView!;
        }
        return builder(data);
      },
    );
  }
}

/// 加载态
class LoadingView extends StatelessWidget {
  const LoadingView({super.key, this.message});

  final String? message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(
            width: 28,
            height: 28,
            child: CircularProgressIndicator(strokeWidth: 2.4, color: AppColors.primary),
          ),
          if (message != null) ...[
            const SizedBox(height: AppSpacing.md),
            Text(
              message!,
              style: const TextStyle(fontSize: 13, color: AppColors.textTertiary),
            ),
          ],
        ],
      ),
    );
  }
}

/// 空态
class EmptyView extends StatelessWidget {
  const EmptyView({
    super.key,
    this.title = '暂无数据',
    this.subtitle,
    this.icon = Icons.inbox_outlined,
    this.actionLabel,
    this.onAction,
  });

  final String title;
  final String? subtitle;
  final IconData icon;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 56, color: AppColors.textTertiary.withValues(alpha: 0.5)),
            const SizedBox(height: AppSpacing.lg),
            Text(
              title,
              style: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w500,
                color: AppColors.textSecondary,
              ),
            ),
            if (subtitle != null) ...[
              const SizedBox(height: AppSpacing.sm),
              Text(
                subtitle!,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 13, color: AppColors.textTertiary),
              ),
            ],
            if (actionLabel != null && onAction != null) ...[
              const SizedBox(height: AppSpacing.xl),
              FilledButton(
                onPressed: onAction,
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 12),
                ),
                child: Text(actionLabel!),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// 错误态
class ErrorView extends StatelessWidget {
  const ErrorView({super.key, required this.error, this.onRetry});

  final ApiException error;
  final VoidCallback? onRetry;

  IconData get _icon => switch (error) {
        NetworkException() => Icons.wifi_off_outlined,
        ServerException() => Icons.cloud_off_outlined,
        UnauthorizedException() => Icons.lock_outline,
        _ => Icons.error_outline,
      };

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(_icon, size: 56, color: AppColors.textTertiary.withValues(alpha: 0.6)),
            const SizedBox(height: AppSpacing.lg),
            Text(
              error.message,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 14, color: AppColors.textSecondary),
            ),
            if (onRetry != null) ...[
              const SizedBox(height: AppSpacing.xl),
              OutlinedButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh, size: 18),
                label: const Text('重新加载'),
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 10),
                  minimumSize: const Size(0, 40),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
