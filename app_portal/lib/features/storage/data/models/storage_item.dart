/// 收纳物品模型
class StorageItem {
  const StorageItem({
    required this.id,
    required this.name,
    this.categoryId,
    this.categoryName,
    this.categoryIcon,
    this.categoryColor,
    this.coverUrl,
    this.imageUrls = const [],
    this.quantity = 1,
    this.unit,
    this.price,
    this.purchaseDate,
    this.expireDate,
    this.location,
    this.remark,
    this.status = 1,
    this.tags = const [],
    this.createTime,
    this.updateTime,
  });

  final String id;
  final String name;

  final String? categoryId;
  final String? categoryName;
  final String? categoryIcon;
  final String? categoryColor;

  final String? coverUrl;
  final List<String> imageUrls;

  final int quantity;
  final String? unit;
  final double? price;

  final DateTime? purchaseDate;
  final DateTime? expireDate;

  final String? location;
  final String? remark;

  /// 1-在库 0-已归档
  final int status;

  final List<ItemTag> tags;

  final DateTime? createTime;
  final DateTime? updateTime;

  bool get isArchived => status == 0;

  /// 距离过期的天数（null 表示无过期日期）
  int? get daysUntilExpire {
    if (expireDate == null) return null;
    final today = DateTime.now();
    final expire = DateTime(expireDate!.year, expireDate!.month, expireDate!.day);
    final now = DateTime(today.year, today.month, today.day);
    return expire.difference(now).inDays;
  }

  /// 是否临期（30 天内过期）
  bool get isExpiringSoon {
    final days = daysUntilExpire;
    return days != null && days >= 0 && days <= 30;
  }

  /// 是否已过期
  bool get isExpired {
    final days = daysUntilExpire;
    return days != null && days < 0;
  }

  factory StorageItem.fromJson(Map<String, dynamic> json) {
    return StorageItem(
      id: (json['id'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      categoryId: json['categoryId']?.toString(),
      categoryName: json['categoryName']?.toString(),
      categoryIcon: json['categoryIcon']?.toString(),
      categoryColor: json['categoryColor']?.toString(),
      coverUrl: json['coverUrl']?.toString(),
      imageUrls: _parseStringList(json['imageUrls']),
      quantity: int.tryParse((json['quantity'] ?? 1).toString()) ?? 1,
      unit: json['unit']?.toString(),
      price: _parseDouble(json['price']),
      purchaseDate: _parseDate(json['purchaseDate']),
      expireDate: _parseDate(json['expireDate']),
      location: json['location']?.toString(),
      remark: json['remark']?.toString(),
      status: int.tryParse((json['status'] ?? 1).toString()) ?? 1,
      tags: (json['tags'] as List?)
              ?.whereType<Map>()
              .map((e) => ItemTag.fromJson(Map<String, dynamic>.from(e)))
              .toList() ??
          const [],
      createTime: _parseDate(json['createTime']),
      updateTime: _parseDate(json['updateTime']),
    );
  }

  static List<String> _parseStringList(dynamic value) {
    if (value is List) return value.map((e) => e.toString()).toList();
    return const [];
  }

  static double? _parseDouble(dynamic value) {
    if (value == null || value == '') return null;
    return double.tryParse(value.toString());
  }

  static DateTime? _parseDate(dynamic value) {
    if (value == null || value.toString().isEmpty) return null;
    return DateTime.tryParse(value.toString().replaceFirst(' ', 'T'));
  }
}

/// 物品标签
class ItemTag {
  const ItemTag({required this.id, required this.name, this.color});

  final String id;
  final String name;
  final String? color;

  factory ItemTag.fromJson(Map<String, dynamic> json) {
    return ItemTag(
      id: (json['id'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      color: json['color']?.toString(),
    );
  }
}

/// 收纳概览统计
class StorageOverview {
  const StorageOverview({
    this.itemCount = 0,
    this.inStockCount = 0,
    this.archivedCount = 0,
    this.categoryCount = 0,
    this.tagCount = 0,
    this.totalValue = 0,
    this.totalQuantity = 0,
    this.expiringSoonCount = 0,
  });

  final int itemCount;
  final int inStockCount;
  final int archivedCount;
  final int categoryCount;
  final int tagCount;
  final double totalValue;
  final int totalQuantity;
  final int expiringSoonCount;

  factory StorageOverview.fromJson(Map<String, dynamic> json) {
    int toInt(dynamic v) => int.tryParse((v ?? 0).toString()) ?? 0;
    double toDouble(dynamic v) => double.tryParse((v ?? 0).toString()) ?? 0;

    return StorageOverview(
      itemCount: toInt(json['itemCount']),
      inStockCount: toInt(json['inStockCount']),
      archivedCount: toInt(json['archivedCount']),
      categoryCount: toInt(json['categoryCount']),
      tagCount: toInt(json['tagCount']),
      totalValue: toDouble(json['totalValue']),
      totalQuantity: toInt(json['totalQuantity']),
      expiringSoonCount: toInt(json['expiringSoonCount']),
    );
  }
}
