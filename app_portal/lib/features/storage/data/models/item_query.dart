/// 物品列表查询参数
class ItemQuery {
  const ItemQuery({
    this.pageNum = 1,
    this.pageSize = 10,
    this.keywords,
    this.categoryId,
    this.tagId,
    this.status,
    this.sortBy,
    this.order,
  });

  final int pageNum;
  final int pageSize;
  final String? keywords;
  final String? categoryId;
  final String? tagId;
  final int? status;
  final String? sortBy;
  final String? order;

  ItemQuery copyWith({
    int? pageNum,
    int? pageSize,
    String? keywords,
    String? categoryId,
    String? tagId,
    int? status,
    String? sortBy,
    String? order,
    bool clearCategory = false,
    bool clearTag = false,
    bool clearStatus = false,
    bool clearKeywords = false,
  }) {
    return ItemQuery(
      pageNum: pageNum ?? this.pageNum,
      pageSize: pageSize ?? this.pageSize,
      keywords: clearKeywords ? null : (keywords ?? this.keywords),
      categoryId: clearCategory ? null : (categoryId ?? this.categoryId),
      tagId: clearTag ? null : (tagId ?? this.tagId),
      status: clearStatus ? null : (status ?? this.status),
      sortBy: sortBy ?? this.sortBy,
      order: order ?? this.order,
    );
  }

  /// 转为查询参数（自动剔除空值）
  Map<String, dynamic> toQueryParameters() {
    final map = <String, dynamic>{
      'pageNum': pageNum,
      'pageSize': pageSize,
    };
    if (keywords?.isNotEmpty == true) map['keywords'] = keywords;
    if (categoryId != null) map['categoryId'] = categoryId;
    if (tagId != null) map['tagId'] = tagId;
    if (status != null) map['status'] = status;
    if (sortBy != null) map['sortBy'] = sortBy;
    if (order != null) map['order'] = order;
    return map;
  }
}
