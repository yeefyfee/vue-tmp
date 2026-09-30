import '../../../core/network/api_client.dart';
import '../../../core/network/api_endpoints.dart';
import '../../../shared/models/page_result.dart';
import 'models/item_query.dart';
import 'models/storage_category.dart';
import 'models/storage_item.dart';

/// 收纳数据源
///
/// 只负责接口调用与模型转换，不含业务规则与状态管理。
class StorageRepository {
  StorageRepository(this._client);

  final ApiClient _client;

  // ---------------------------------------------------------------------------
  // 概览
  // ---------------------------------------------------------------------------

  Future<StorageOverview> fetchOverview() async {
    final data = await _client.get<Map<String, dynamic>>(ApiEndpoints.storageOverview);
    return StorageOverview.fromJson(data);
  }

  // ---------------------------------------------------------------------------
  // 物品
  // ---------------------------------------------------------------------------

  /// 物品分页列表
  Future<PageResult<StorageItem>> fetchItems(ItemQuery query) async {
    final data = await _client.get<dynamic>(
      ApiEndpoints.storageItems,
      queryParameters: query.toQueryParameters(),
    );
    final result = PageResult.fromJson(data, StorageItem.fromJson);
    // 补齐分页元信息，供"加载更多"判断
    return result.copyWith(pageNum: query.pageNum, pageSize: query.pageSize);
  }

  /// 物品详情
  Future<StorageItem> fetchItemDetail(String id) async {
    final data = await _client.get<Map<String, dynamic>>(ApiEndpoints.storageItem(id));
    return StorageItem.fromJson(data);
  }

  /// 新增物品
  Future<StorageItem> createItem(Map<String, dynamic> payload) async {
    final data = await _client.post<Map<String, dynamic>>(
      ApiEndpoints.storageItems,
      data: payload,
    );
    return StorageItem.fromJson(data);
  }

  /// 修改物品
  Future<StorageItem> updateItem(String id, Map<String, dynamic> payload) async {
    final data = await _client.put<Map<String, dynamic>>(
      ApiEndpoints.storageItem(id),
      data: payload,
    );
    return StorageItem.fromJson(data);
  }

  /// 删除物品（支持批量，逗号分隔）
  Future<void> deleteItems(List<String> ids) async {
    await _client.delete<dynamic>(ApiEndpoints.storageItem(ids.join(',')));
  }

  /// 调整数量
  Future<void> changeQuantity(String id, int delta) async {
    await _client.patch<dynamic>(
      ApiEndpoints.storageItemQuantity(id),
      data: {'delta': delta},
    );
  }

  /// 归档 / 恢复
  Future<void> toggleStatus(String id, int status) async {
    await _client.patch<dynamic>(
      ApiEndpoints.storageItemStatus(id),
      queryParameters: {'status': status},
    );
  }

  // ---------------------------------------------------------------------------
  // 分类
  // ---------------------------------------------------------------------------

  /// 分类下拉选项（含物品数量，供选择器使用）
  Future<List<StorageCategory>> fetchCategoryOptions() async {
    final data = await _client.get<List<dynamic>>(ApiEndpoints.storageCategoryOptions);
    return data
        .whereType<Map>()
        .map((e) => StorageCategory.fromJson(Map<String, dynamic>.from(e)))
        .toList();
  }

  /// 分类分页列表
  Future<PageResult<StorageCategory>> fetchCategories({
    int pageNum = 1,
    int pageSize = 100,
    String? keywords,
  }) async {
    final data = await _client.get<dynamic>(
      ApiEndpoints.storageCategories,
      queryParameters: {
        'pageNum': pageNum,
        'pageSize': pageSize,
        if (keywords?.isNotEmpty == true) 'keywords': keywords,
      },
    );
    return PageResult.fromJson(data, StorageCategory.fromJson);
  }

  Future<StorageCategory> createCategory(Map<String, dynamic> payload) async {
    final data =
        await _client.post<Map<String, dynamic>>(ApiEndpoints.storageCategories, data: payload);
    return StorageCategory.fromJson(data);
  }

  Future<StorageCategory> updateCategory(String id, Map<String, dynamic> payload) async {
    final data = await _client.put<Map<String, dynamic>>(
      ApiEndpoints.storageCategory(id),
      data: payload,
    );
    return StorageCategory.fromJson(data);
  }

  Future<void> deleteCategories(List<String> ids) async {
    await _client.delete<dynamic>(ApiEndpoints.storageCategory(ids.join(',')));
  }

  // ---------------------------------------------------------------------------
  // 标签
  // ---------------------------------------------------------------------------

  Future<List<StorageTag>> fetchTags() async {
    final data = await _client.get<List<dynamic>>(ApiEndpoints.storageTags);
    return data
        .whereType<Map>()
        .map((e) => StorageTag.fromJson(Map<String, dynamic>.from(e)))
        .toList();
  }

  Future<StorageTag> createTag(Map<String, dynamic> payload) async {
    final data = await _client.post<Map<String, dynamic>>(ApiEndpoints.storageTags, data: payload);
    return StorageTag.fromJson(data);
  }

  Future<StorageTag> updateTag(String id, Map<String, dynamic> payload) async {
    final data =
        await _client.put<Map<String, dynamic>>(ApiEndpoints.storageTag(id), data: payload);
    return StorageTag.fromJson(data);
  }

  Future<void> deleteTags(List<String> ids) async {
    await _client.delete<dynamic>(ApiEndpoints.storageTag(ids.join(',')));
  }

  // ---------------------------------------------------------------------------
  // 文件上传
  // ---------------------------------------------------------------------------

  /// 上传图片，返回可访问 URL
  Future<String> uploadImage({
    required String filePath,
    required String fileName,
    void Function(int sent, int total)? onProgress,
  }) async {
    final data = await _client.upload<Map<String, dynamic>>(
      ApiEndpoints.uploadFile,
      filePath: filePath,
      fileName: fileName,
      onProgress: onProgress,
    );
    return (data['url'] ?? '').toString();
  }
}
