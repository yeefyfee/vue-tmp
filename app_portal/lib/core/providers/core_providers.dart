import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../network/api_client.dart';
import '../storage/pref_storage.dart';
import '../storage/token_storage.dart';

/// 基础设施依赖注入
///
/// 所有 core 层的单例统一在此声明，业务层通过 `ref.read(xxxProvider)` 获取。
/// 这层是唯一的"装配点"，替换实现只需改这里。

/// 偏好存储（在 main 中 override 为已初始化的实例）
final prefStorageProvider = Provider<PrefStorage>((ref) {
  throw UnimplementedError('prefStorageProvider 需在 main.dart 中 override');
});

/// Token 存储
final tokenStorageProvider = Provider<TokenStorage>((ref) => TokenStorage());

/// 全局 HTTP 客户端
final apiClientProvider = Provider<ApiClient>((ref) {
  final tokenStorage = ref.watch(tokenStorageProvider);
  return ApiClient(readToken: tokenStorage.readAccessToken);
});
