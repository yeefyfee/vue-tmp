import 'package:flutter/material.dart';

/// 应用色板
///
/// 所有颜色集中定义，业务代码禁止硬编码色值。
class AppColors {
  AppColors._();

  /// 品牌主色
  static const Color primary = Color(0xFF4F7CFF);
  static const Color primaryDark = Color(0xFF3A63E0);
  static const Color primaryLight = Color(0xFFDCE6FF);

  /// 功能色
  static const Color success = Color(0xFF52C41A);
  static const Color warning = Color(0xFFFAAD14);
  static const Color danger = Color(0xFFFF4D4F);
  static const Color info = Color(0xFF36CFC9);

  /// 中性色（浅色模式）
  static const Color textPrimary = Color(0xFF1F2329);
  static const Color textSecondary = Color(0xFF646A73);
  static const Color textTertiary = Color(0xFF8F959E);
  static const Color divider = Color(0xFFEFF0F1);
  static const Color background = Color(0xFFF5F6F8);
  static const Color surface = Color(0xFFFFFFFF);

  /// 中性色（深色模式）
  static const Color darkBackground = Color(0xFF121317);
  static const Color darkSurface = Color(0xFF1C1D22);
  static const Color darkDivider = Color(0xFF2A2B32);
  static const Color darkTextPrimary = Color(0xFFE8E9EB);
  static const Color darkTextSecondary = Color(0xFFA5A8B0);

  /// 门户宫格预设色（按注册表顺序取用）
  static const List<Color> featurePalette = [
    Color(0xFF4F7CFF),
    Color(0xFFFF7A45),
    Color(0xFF36CFC9),
    Color(0xFFF759AB),
    Color(0xFF52C41A),
    Color(0xFFFAAD14),
    Color(0xFF722ED1),
    Color(0xFF13C2C2),
  ];
}
