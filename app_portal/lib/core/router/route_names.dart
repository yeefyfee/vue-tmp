/// 路由路径与名称常量
///
/// 集中管理，避免散落的字符串字面量。
class AppRoutes {
  AppRoutes._();

  // --- 认证 ------------------------------------------------------------------
  static const String splash = '/splash';
  static const String login = '/login';

  // --- 门户主体（底部导航）----------------------------------------------------
  static const String portal = '/portal';
  static const String home = '/portal/home';
  static const String apps = '/portal/apps';
  static const String profile = '/portal/profile';

  // --- 物品收纳 --------------------------------------------------------------
  static const String storage = '/storage';
  static const String storageItems = '/storage/items';
  static const String storageItemDetail = '/storage/items/detail';
  static const String storageItemForm = '/storage/items/form';
  static const String storageCategories = '/storage/categories';
  static const String storageTags = '/storage/tags';

  // --- 通用 ------------------------------------------------------------------
  static const String settings = '/settings';
  static const String about = '/about';

  /// 物品详情路径
  static String storageItemDetailOf(String id) => '$storageItemDetail/$id';

  /// 物品新增/编辑路径（[id] 为空表示新增）
  static String storageItemFormOf({String? id}) =>
      id == null ? storageItemForm : '$storageItemForm/$id';
}
