/// 分页结果通用模型
class PageResult<T> {
  const PageResult({
    required this.list,
    required this.total,
    this.pageNum = 1,
    this.pageSize = 10,
  });

  final List<T> list;
  final int total;
  final int pageNum;
  final int pageSize;

  bool get isEmpty => list.isEmpty;
  bool get hasMore => pageNum * pageSize < total;

  /// 从后端响应解析
  ///
  /// 后端分页接口经 ResponseInterceptor 解包后形如 `{ list, total }`。
  factory PageResult.fromJson(
    dynamic json,
    T Function(Map<String, dynamic>) itemParser,
  ) {
    if (json is! Map) {
      return const PageResult(list: [], total: 0) as PageResult<T>;
    }

    final rawList = json['list'] ?? json['records'] ?? const [];
    final list = rawList is List
        ? rawList
            .whereType<Map>()
            .map((e) => itemParser(Map<String, dynamic>.from(e)))
            .toList()
        : <T>[];

    return PageResult<T>(
      list: list,
      total: int.tryParse((json['total'] ?? 0).toString()) ?? 0,
    );
  }

  /// 空结果
  static PageResult<T> empty<T>() => PageResult<T>(list: const [], total: 0);

  /// 追加下一页数据
  PageResult<T> append(PageResult<T> next) => PageResult<T>(
        list: [...list, ...next.list],
        total: next.total,
        pageNum: next.pageNum,
        pageSize: next.pageSize,
      );

  PageResult<T> copyWith({List<T>? list, int? total, int? pageNum, int? pageSize}) => PageResult<T>(
        list: list ?? this.list,
        total: total ?? this.total,
        pageNum: pageNum ?? this.pageNum,
        pageSize: pageSize ?? this.pageSize,
      );
}
