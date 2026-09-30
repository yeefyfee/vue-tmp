/// 间距与圆角规范
///
/// 统一使用 4 的倍数，避免页面间视觉节奏不一致。
class AppSpacing {
  AppSpacing._();

  static const double xxs = 2;
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 24;
  static const double xxl = 32;

  /// 页面默认水平内边距
  static const double pagePadding = 16;

  /// 卡片内边距
  static const double cardPadding = 16;

  /// 列表项垂直间距
  static const double listItemGap = 12;
}

/// 圆角规范
class AppRadius {
  AppRadius._();

  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 20;

  /// 全圆角（胶囊形）
  static const double pill = 999;
}
