/// API 业务异常基类
///
/// UI 层只需捕获 [ApiException]，不必解析后端 code。
sealed class ApiException implements Exception {
  const ApiException(this.message);

  final String message;

  @override
  String toString() => message;
}

/// 后端返回的业务错误（code != 00000）
class BusinessException extends ApiException {
  const BusinessException(super.message, {this.code});

  final String? code;

  @override
  String toString() => message;
}

/// 登录态失效（Token 过期 / 被踢下线）
class UnauthorizedException extends ApiException {
  const UnauthorizedException([super.message = '登录已过期，请重新登录']);
}

/// 权限不足
class ForbiddenException extends ApiException {
  const ForbiddenException([super.message = '权限不足']);
}

/// 网络不可达 / 超时
class NetworkException extends ApiException {
  const NetworkException([super.message = '网络连接失败，请检查网络后重试']);
}

/// 服务端异常（5xx）
class ServerException extends ApiException {
  const ServerException([super.message = '服务器开小差了，请稍后重试']);
}

/// 请求被取消
class CancelledException extends ApiException {
  const CancelledException([super.message = '请求已取消']);
}
