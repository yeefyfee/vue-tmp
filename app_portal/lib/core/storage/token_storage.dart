import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Token 安全存储
///
/// accessToken / refreshToken 属敏感数据，必须存放在系统密钥链
/// （Android: EncryptedSharedPreferences，Windows: DPAPI），
/// 不使用 SharedPreferences 明文保存。
class TokenStorage {
  TokenStorage({FlutterSecureStorage? storage})
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
            );

  final FlutterSecureStorage _storage;

  static const String _kAccessToken = 'auth_access_token';
  static const String _kRefreshToken = 'auth_refresh_token';
  static const String _kExpiresAt = 'auth_expires_at';

  Future<String?> readAccessToken() async {
    try {
      return await _storage.read(key: _kAccessToken);
    } catch (_) {
      return null;
    }
  }

  Future<String?> readRefreshToken() async {
    try {
      return await _storage.read(key: _kRefreshToken);
    } catch (_) {
      return null;
    }
  }

  /// 写入令牌
  ///
  /// [expiresIn] 为后端返回的有效期（秒），换算成绝对过期时间戳保存，
  /// 便于请求前判断是否需要提前刷新。
  Future<void> save({
    required String accessToken,
    required String refreshToken,
    required int expiresIn,
  }) async {
    final expiresAt = DateTime.now().add(Duration(seconds: expiresIn)).millisecondsSinceEpoch;
    await _storage.write(key: _kAccessToken, value: accessToken);
    await _storage.write(key: _kRefreshToken, value: refreshToken);
    await _storage.write(key: _kExpiresAt, value: expiresAt.toString());
  }

  /// 仅更新 accessToken（刷新令牌后调用）
  Future<void> updateAccessToken(String accessToken, int expiresIn) async {
    final expiresAt = DateTime.now().add(Duration(seconds: expiresIn)).millisecondsSinceEpoch;
    await _storage.write(key: _kAccessToken, value: accessToken);
    await _storage.write(key: _kExpiresAt, value: expiresAt.toString());
  }

  /// 本地是否已存在令牌（用于启动时判断登录态，避免闪屏）
  Future<bool> hasToken() async {
    final token = await readAccessToken();
    return token != null && token.isNotEmpty;
  }

  Future<void> clear() async {
    await _storage.delete(key: _kAccessToken);
    await _storage.delete(key: _kRefreshToken);
    await _storage.delete(key: _kExpiresAt);
  }
}
