import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/presentation/pages/login_page.dart';
import '../../features/auth/providers/auth_provider.dart';
import '../../features/portal/presentation/pages/apps_page.dart';
import '../../features/portal/presentation/pages/home_page.dart';
import '../../features/portal/presentation/pages/portal_shell.dart';
import '../../features/portal/presentation/pages/profile_page.dart';
import '../../features/storage/presentation/pages/category_manage_page.dart';
import '../../features/storage/presentation/pages/item_detail_page.dart';
import '../../features/storage/presentation/pages/item_form_page.dart';
import '../../features/storage/presentation/pages/item_list_page.dart';
import '../../features/storage/presentation/pages/storage_home_page.dart';
import '../../features/storage/presentation/pages/tag_manage_page.dart';
import 'route_names.dart';

/// 全局导航 Key（供非 Widget 环境跳转使用）
final rootNavigatorKey = GlobalKey<NavigatorState>(debugLabel: 'root');

/// 路由配置
final appRouterProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    navigatorKey: rootNavigatorKey,
    initialLocation: AppRoutes.home,
    debugLogDiagnostics: false,

    /// 登录守卫
    ///
    /// 未登录访问受保护路由 → 重定向到登录页；
    /// 已登录访问登录页 → 重定向回首页。
    redirect: (context, state) {
      final auth = ref.read(authControllerProvider);
      final location = state.matchedLocation;

      // 启动中：停在欢迎页，避免闪屏
      if (auth.isUnknown) {
        return location == AppRoutes.splash ? null : AppRoutes.splash;
      }

      final isOnLogin = location == AppRoutes.login;
      final isOnSplash = location == AppRoutes.splash;

      if (!auth.isAuthenticated) {
        return isOnLogin ? null : AppRoutes.login;
      }

      // 已登录时不再停留在登录页 / 欢迎页
      if (isOnLogin || isOnSplash) {
        return AppRoutes.home;
      }

      return null;
    },

    routes: [
      // --- 欢迎页 ------------------------------------------------------------
      GoRoute(
        path: AppRoutes.splash,
        builder: (context, state) => const _SplashPage(),
      ),

      // --- 登录 --------------------------------------------------------------
      GoRoute(
        path: AppRoutes.login,
        builder: (context, state) => const LoginPage(),
      ),

      // --- 门户主体（底部导航壳）----------------------------------------------
      ShellRoute(
        builder: (context, state, child) => PortalShell(child: child),
        routes: [
          GoRoute(
            path: AppRoutes.home,
            pageBuilder: (context, state) => const NoTransitionPage(child: HomePage()),
          ),
          GoRoute(
            path: AppRoutes.apps,
            pageBuilder: (context, state) => const NoTransitionPage(child: AppsPage()),
          ),
          GoRoute(
            path: AppRoutes.profile,
            pageBuilder: (context, state) => const NoTransitionPage(child: ProfilePage()),
          ),
        ],
      ),

      // --- 物品收纳模块 -------------------------------------------------------
      GoRoute(
        path: AppRoutes.storage,
        builder: (context, state) => const StorageHomePage(),
        routes: [
          GoRoute(
            path: 'items',
            builder: (context, state) {
              // 从分类入口进入时携带筛选条件
              final extra = state.extra;
              if (extra is Map) {
                return ItemListPage(
                  initialCategoryId: extra['categoryId']?.toString(),
                  initialCategoryName: extra['categoryName']?.toString(),
                );
              }
              return const ItemListPage();
            },
            routes: [
              GoRoute(
                path: 'detail/:id',
                builder: (context, state) =>
                    ItemDetailPage(itemId: state.pathParameters['id']!),
              ),
              GoRoute(
                path: 'form',
                builder: (context, state) => const ItemFormPage(),
                routes: [
                  GoRoute(
                    path: ':id',
                    builder: (context, state) =>
                        ItemFormPage(itemId: state.pathParameters['id']),
                  ),
                ],
              ),
            ],
          ),
          GoRoute(
            path: 'categories',
            builder: (context, state) => const CategoryManagePage(),
          ),
          GoRoute(
            path: 'tags',
            builder: (context, state) => const TagManagePage(),
          ),
        ],
      ),
    ],
  );
});

/// 启动欢迎页（登录态校验期间展示）
class _SplashPage extends StatelessWidget {
  const _SplashPage();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(
        child: SizedBox(
          width: 28,
          height: 28,
          child: CircularProgressIndicator(strokeWidth: 2.4),
        ),
      ),
    );
  }
}
