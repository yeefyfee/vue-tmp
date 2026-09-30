import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/config/app_config.dart';
import 'core/providers/core_providers.dart';
import 'core/router/app_router.dart';
import 'core/theme/app_theme.dart';
import 'features/auth/providers/auth_provider.dart';

/// 应用根组件
///
/// 装配：主题 + 路由 + 启动时的登录态恢复。
class AppPortal extends ConsumerStatefulWidget {
  const AppPortal({super.key});

  @override
  ConsumerState<AppPortal> createState() => _AppPortalState();
}

class _AppPortalState extends ConsumerState<AppPortal> {
  @override
  void initState() {
    super.initState();
    // 启动时恢复登录态：本地有令牌则校验并拉取用户信息
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(authControllerProvider.notifier).bootstrap();
    });
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(appRouterProvider);
    final themeModePref = ref.watch(prefStorageProvider).themeMode;

    return MaterialApp.router(
      title: AppConfig.appName,
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      themeMode: switch (themeModePref) {
        'light' => ThemeMode.light,
        'dark' => ThemeMode.dark,
        _ => ThemeMode.system,
      },
      routerConfig: router,
    );
  }
}
