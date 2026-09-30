/// 接口路径常量
///
/// 所有后端路径集中在此处维护，Repository 层禁止硬编码路径字符串。
/// 路径已包含 `/api/v1` 前缀（见 [AppConfig.apiPrefix]）。
class ApiEndpoints {
  ApiEndpoints._();

  static const String prefix = '/api/v1';

  // ---------------------------------------------------------------------------
  // 认证
  // ---------------------------------------------------------------------------
  static const String login = '$prefix/auth/login';
  static const String logout = '$prefix/auth/logout';
  static const String captcha = '$prefix/auth/captcha';
  static const String refreshToken = '$prefix/auth/refresh-token';

  // ---------------------------------------------------------------------------
  // 用户
  // ---------------------------------------------------------------------------
  static const String currentUser = '$prefix/users/me';
  static const String userProfile = '$prefix/users/profile';
  static const String changePassword = '$prefix/users/password';

  // ---------------------------------------------------------------------------
  // 文件
  // ---------------------------------------------------------------------------
  static const String uploadFile = '$prefix/files';

  // ---------------------------------------------------------------------------
  // 物品收纳
  // ---------------------------------------------------------------------------
  static const String storageOverview = '$prefix/storage/overview';

  static const String storageItems = '$prefix/storage/items';
  static String storageItem(String id) => '$prefix/storage/items/$id';
  static String storageItemQuantity(String id) => '$prefix/storage/items/$id/quantity';
  static String storageItemStatus(String id) => '$prefix/storage/items/$id/status';

  static const String storageCategories = '$prefix/storage/categories';
  static const String storageCategoryOptions = '$prefix/storage/categories/options';
  static String storageCategory(String id) => '$prefix/storage/categories/$id';

  static const String storageTags = '$prefix/storage/tags';
  static String storageTag(String id) => '$prefix/storage/tags/$id';
}
