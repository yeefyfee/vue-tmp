import 'package:shared_preferences/shared_preferences.dart';

/// 轻量偏好存储
///
/// 仅存放非敏感配置（主题模式、列表密度等），敏感数据走 TokenStorage。
class PrefStorage {
  PrefStorage(this._prefs);

  final SharedPreferences _prefs;

  static Future<PrefStorage> create() async {
    return PrefStorage(await SharedPreferences.getInstance());
  }

  static const String _kThemeMode = 'pref_theme_mode';
  static const String _kStorageViewMode = 'pref_storage_view_mode';
  static const String _kLastLoginName = 'pref_last_login_name';

  // --- 主题模式：system / light / dark ---------------------------------------
  String get themeMode => _prefs.getString(_kThemeMode) ?? 'system';
  Future<void> setThemeMode(String value) => _prefs.setString(_kThemeMode, value);

  // --- 收纳列表展示模式：grid / list ------------------------------------------
  String get storageViewMode => _prefs.getString(_kStorageViewMode) ?? 'list';
  Future<void> setStorageViewMode(String value) => _prefs.setString(_kStorageViewMode, value);

  // --- 记住上次登录账号（仅用户名，不含密码）----------------------------------
  String get lastLoginName => _prefs.getString(_kLastLoginName) ?? '';
  Future<void> setLastLoginName(String value) => _prefs.setString(_kLastLoginName, value);
}
