import '../../../core/network/api_client.dart';
import '../../../core/network/api_endpoints.dart';
import '../../../core/storage/token_storage.dart';
import 'models/login_result.dart';
import 'models/user_info.dart';

/// 认证数据源
///
/// 负责登录/登出/验证码/用户信息的接口调用与令牌持久化。
class AuthRepository {
  AuthRepository({required ApiClient client, required TokenStorage tokenStorage})
      : _client = client,
        _tokenStorage = tokenStorage;

  final ApiClient _client;
  final TokenStorage _tokenStorage;

  /// 获取图形验证码
  Future<CaptchaResult> fetchCaptcha() async {
    final data = await _client.get<Map<String, dynamic>>(ApiEndpoints.captcha);
    return CaptchaResult.fromJson(data);
  }

  /// 账号密码登录
  Future<LoginResult> login({
    required String username,
    required String password,
    required String captchaId,
    required String captchaCode,
  }) async {
    final data = await _client.post<Map<String, dynamic>>(
      ApiEndpoints.login,
      data: {
        'username': username,
        'password': password,
        'captchaId': captchaId,
        'captchaCode': captchaCode,
      },
    );

    final result = LoginResult.fromJson(data);
    await _tokenStorage.save(
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
    );
    return result;
  }

  /// 获取当前登录用户信息
  Future<UserInfo> fetchCurrentUser() async {
    final data = await _client.get<Map<String, dynamic>>(ApiEndpoints.currentUser);
    return UserInfo.fromJson(data);
  }

  /// 是否已登录（本地存在令牌）
  Future<bool> isLoggedIn() => _tokenStorage.hasToken();

  /// 登出：通知后端后清理本地令牌
  Future<void> logout() async {
    try {
      await _client.delete<dynamic>(ApiEndpoints.logout);
    } catch (_) {
      // 后端登出失败不阻断本地清理，避免用户卡在登录态
    } finally {
      await _tokenStorage.clear();
    }
  }
}
