import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers/core_providers.dart';
import '../data/auth_repository.dart';
import '../data/models/user_info.dart';

/// 认证数据源 Provider
final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return AuthRepository(
    client: ref.watch(apiClientProvider),
    tokenStorage: ref.watch(tokenStorageProvider),
  );
});

/// 登录态
///
/// - [unknown] 启动时尚未确定（本地有 token 但未校验）
/// - [unauthenticated] 未登录
/// - [authenticated] 已登录
enum AuthStatus { unknown, authenticated, unauthenticated }

class AuthState {
  const AuthState({
    required this.status,
    this.user,
    this.errorMessage,
    this.isSubmitting = false,
  });

  const AuthState.unknown() : this(status: AuthStatus.unknown);
  const AuthState.unauthenticated({String? errorMessage})
      : this(status: AuthStatus.unauthenticated, errorMessage: errorMessage);

  final AuthStatus status;
  final UserInfo? user;
  final String? errorMessage;
  final bool isSubmitting;

  bool get isAuthenticated => status == AuthStatus.authenticated;
  bool get isUnknown => status == AuthStatus.unknown;

  AuthState copyWith({
    AuthStatus? status,
    UserInfo? user,
    String? errorMessage,
    bool? isSubmitting,
    bool clearError = false,
  }) {
    return AuthState(
      status: status ?? this.status,
      user: user ?? this.user,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      isSubmitting: isSubmitting ?? this.isSubmitting,
    );
  }
}

/// 登录态控制器
class AuthController extends StateNotifier<AuthState> {
  AuthController(this._repository) : super(const AuthState.unknown());

  final AuthRepository _repository;

  /// 启动时恢复登录态
  ///
  /// 本地有令牌则拉取用户信息校验；令牌失效自动降级为未登录。
  Future<void> bootstrap() async {
    final loggedIn = await _repository.isLoggedIn();
    if (!loggedIn) {
      state = const AuthState.unauthenticated();
      return;
    }

    try {
      final user = await _repository.fetchCurrentUser();
      state = AuthState(status: AuthStatus.authenticated, user: user);
    } catch (_) {
      await _repository.logout();
      state = const AuthState.unauthenticated();
    }
  }

  /// 登录
  Future<bool> login({
    required String username,
    required String password,
    required String captchaId,
    required String captchaCode,
  }) async {
    state = state.copyWith(isSubmitting: true, clearError: true);

    try {
      await _repository.login(
        username: username,
        password: password,
        captchaId: captchaId,
        captchaCode: captchaCode,
      );
      final user = await _repository.fetchCurrentUser();
      state = AuthState(status: AuthStatus.authenticated, user: user);
      return true;
    } catch (e) {
      state = AuthState.unauthenticated(errorMessage: e.toString());
      return false;
    }
  }

  /// 刷新用户信息
  Future<void> refreshUser() async {
    if (!state.isAuthenticated) return;
    try {
      final user = await _repository.fetchCurrentUser();
      state = state.copyWith(user: user);
    } catch (_) {
      // 静默失败，保留现有信息
    }
  }

  /// 登出
  Future<void> logout() async {
    await _repository.logout();
    state = const AuthState.unauthenticated();
  }

  void clearError() => state = state.copyWith(clearError: true);
}

/// 登录态 Provider
final authControllerProvider = StateNotifierProvider<AuthController, AuthState>((ref) {
  return AuthController(ref.watch(authRepositoryProvider));
});

/// 当前用户（便捷读取）
final currentUserProvider = Provider<UserInfo?>((ref) {
  return ref.watch(authControllerProvider).user;
});

/// 图形验证码 Provider（页面进入时拉取，可 invalidate 刷新）
final captchaProvider = FutureProvider.autoDispose((ref) {
  return ref.watch(authRepositoryProvider).fetchCaptcha();
});
