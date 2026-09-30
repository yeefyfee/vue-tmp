import 'package:flutter/material.dart';

import '../../../core/router/route_names.dart';
import '../../../core/theme/app_colors.dart';

/// 门户功能入口定义
///
/// 这是**新增功能模块的唯一接入点**：
/// 在 [kFeatureRegistry] 追加一条记录 + 在路由表注册对应 GoRoute，
/// 首页宫格与「全部功能」页会自动生效，无需改动门户代码。
class FeatureEntry {
  const FeatureEntry({
    required this.id,
    required this.title,
    required this.icon,
    required this.route,
    required this.color,
    this.subtitle,
    this.badge,
    this.requiresAuth = true,
    this.order = 0,
    this.pinned = true,
  });

  /// 唯一标识（与路由对应，如 'storage'）
  final String id;

  /// 功能名称
  final String title;

  /// 副标题 / 一句话说明
  final String? subtitle;

  /// 图标
  final IconData icon;

  /// 主题色
  final Color color;

  /// 跳转路由（对应 [AppRoutes] 中的常量）
  final String route;

  /// 角标文案（如 'New'）
  final String? badge;

  /// 是否需要登录
  final bool requiresAuth;

  /// 宫格排序，越小越靠前
  final int order;

  /// 是否在首页宫格展示（false 则只在「全部功能」中出现）
  final bool pinned;
}

/// 功能注册表
///
/// ⚠️ 新增功能模块时在下方追加即可。
const List<FeatureEntry> kFeatureRegistry = <FeatureEntry>[
  FeatureEntry(
    id: 'storage',
    title: '物品收纳',
    subtitle: '管理你的个人物品',
    icon: Icons.inventory_2_outlined,
    color: AppColors.primary,
    route: AppRoutes.storage,
    order: 1,
  ),

  // ---------------------------------------------------------------------------
  // 后续模块在此扩展，例如：
  //
  // FeatureEntry(
  //   id: 'ledger',
  //   title: '记账本',
  //   subtitle: '记录每一笔收支',
  //   icon: Icons.account_balance_wallet_outlined,
  //   color: Color(0xFFFF7A45),
  //   route: AppRoutes.ledger,
  //   order: 2,
  // ),
  // ---------------------------------------------------------------------------
];

/// 首页宫格展示的功能（按 order 排序）
List<FeatureEntry> get pinnedFeatures {
  final list = kFeatureRegistry.where((f) => f.pinned).toList()
    ..sort((a, b) => a.order.compareTo(b.order));
  return list;
}

/// 全部分类（按 order 排序）
List<FeatureEntry> get allFeatures {
  final list = [...kFeatureRegistry]..sort((a, b) => a.order.compareTo(b.order));
  return list;
}
