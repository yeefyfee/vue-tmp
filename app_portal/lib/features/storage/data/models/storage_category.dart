/// 收纳分类
class StorageCategory {
  const StorageCategory({
    required this.id,
    required this.name,
    this.icon,
    this.color,
    this.sort = 0,
    this.status = 1,
    this.remark,
    this.itemCount = 0,
    this.isPublic = false,
  });

  final String id;
  final String name;
  final String? icon;
  final String? color;
  final int sort;
  final int status;
  final String? remark;

  /// 该分类下的物品数量
  final int itemCount;

  /// 是否为公共分类（owner_id 为 NULL，所有用户可见但不可改）
  final bool isPublic;

  factory StorageCategory.fromJson(Map<String, dynamic> json) {
    return StorageCategory(
      id: (json['id'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      icon: json['icon']?.toString(),
      color: json['color']?.toString(),
      sort: int.tryParse((json['sort'] ?? 0).toString()) ?? 0,
      status: int.tryParse((json['status'] ?? 1).toString()) ?? 1,
      remark: json['remark']?.toString(),
      itemCount: int.tryParse((json['itemCount'] ?? 0).toString()) ?? 0,
      isPublic: json['isPublic'] == true || json['ownerId'] == null,
    );
  }
}

/// 收纳标签
class StorageTag {
  const StorageTag({
    required this.id,
    required this.name,
    this.color,
    this.itemCount = 0,
    this.isPublic = false,
  });

  final String id;
  final String name;
  final String? color;
  final int itemCount;
  final bool isPublic;

  factory StorageTag.fromJson(Map<String, dynamic> json) {
    return StorageTag(
      id: (json['id'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      color: json['color']?.toString(),
      itemCount: int.tryParse((json['itemCount'] ?? 0).toString()) ?? 0,
      isPublic: json['isPublic'] == true || json['ownerId'] == null,
    );
  }
}
