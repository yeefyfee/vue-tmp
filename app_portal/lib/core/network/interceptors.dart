import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../config/app_config.dart';
import 'api_exception.dart';
import 'api_response.dart';

/// 鉴权拦截器
///
/// 职责：
/// 1. 从 TokenStorage 读取 accessToken 并注入 Authorization 头
/// 2. 跳过登录、验证码等公开接口
class AuthInterceptor extends Interceptor {
  AuthInterceptor({required this.readToken});

  /// 由外部注入的 Token 读取函数，避免网络层直接依赖存储实现
  final Future<String?> Function() readToken;

  /// 无需携带 Token 的路径
  static const List<String> _publicPaths = [
    '/auth/login',
    '/auth/captcha',
    '/auth/refresh-token',
    '/auth/sms/code',
  ];

  @override
  Future<void> onRequest(RequestOptions options, RequestInterceptorHandler handler) async {
    final path = options.path;
    final isPublic = _publicPaths.any(path.contains);

    if (!isPublic) {
      final token = await readToken();
      if (token != null && token.isNotEmpty) {
        options.headers['Authorization'] = 'Bearer $token';
      }
    }

    handler.next(options);
  }
}

/// 响应解包拦截器
///
/// 把 `{ code, msg, data }` 解包成纯业务数据：
/// - 成功 → `handler.resolve(response)`，response.data 变为 data 字段
/// - 失败 → 抛对应的 [ApiException]
class ResponseInterceptor extends Interceptor {
  @override
  void onResponse(Response response, ResponseInterceptorHandler handler) {
    final raw = response.data;

    // 非 JSON 结构（如文件流）直接放行
    if (raw is! Map<String, dynamic> || !raw.containsKey('code')) {
      handler.next(response);
      return;
    }

    final code = (raw['code'] ?? '').toString();
    final msg = (raw['msg'] ?? '').toString();

    if (code == ApiResponse.successCode) {
      response.data = raw['data'];
      handler.next(response);
      return;
    }

    if (ApiResponse.unauthorizedCodes.contains(code)) {
      handler.reject(
        DioException(
          requestOptions: response.requestOptions,
          error: const UnauthorizedException(),
          type: DioExceptionType.badResponse,
        ),
        true,
      );
      return;
    }

    if (code == ApiResponse.forbiddenCode) {
      handler.reject(
        DioException(
          requestOptions: response.requestOptions,
          error: ForbiddenException(msg.isEmpty ? '权限不足' : msg),
          type: DioExceptionType.badResponse,
        ),
        true,
      );
      return;
    }

    handler.reject(
      DioException(
        requestOptions: response.requestOptions,
        error: BusinessException(msg.isEmpty ? '请求失败' : msg, code: code),
        type: DioExceptionType.badResponse,
      ),
      true,
    );
  }
}

/// 错误归一化拦截器
///
/// 把 Dio 的各种异常统一转换成 [ApiException]，让上层只处理一种异常类型。
class ErrorInterceptor extends Interceptor {
  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    final ApiException mapped;

    // 已由 ResponseInterceptor 转换过的业务异常，保持原样
    if (err.error is ApiException) {
      handler.next(err);
      return;
    }

    switch (err.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
      case DioExceptionType.transformTimeout:
        mapped = const NetworkException('请求超时，请稍后重试');
      case DioExceptionType.connectionError:
        mapped = const NetworkException();
      case DioExceptionType.cancel:
        mapped = const CancelledException();
      case DioExceptionType.badCertificate:
        mapped = const NetworkException('安全证书校验失败');
      case DioExceptionType.badResponse:
        final status = err.response?.statusCode ?? 0;
        if (status == 401) {
          mapped = const UnauthorizedException();
        } else if (status == 403) {
          mapped = const ForbiddenException();
        } else if (status >= 500) {
          mapped = const ServerException();
        } else {
          mapped = BusinessException('请求失败（$status）');
        }
      case DioExceptionType.unknown:
        mapped = err.error is ApiException
            ? err.error as ApiException
            : const NetworkException();
    }

    handler.next(
      DioException(
        requestOptions: err.requestOptions,
        response: err.response,
        type: err.type,
        error: mapped,
        stackTrace: err.stackTrace,
      ),
    );
  }
}

/// 日志拦截器（仅开发环境启用）
class LoggerInterceptor extends Interceptor {
  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    if (AppConfig.enableNetworkLog) {
      debugPrint('→ ${options.method} ${options.uri}');
      if (options.data != null) debugPrint('  body: ${options.data}');
    }
    handler.next(options);
  }

  @override
  void onResponse(Response response, ResponseInterceptorHandler handler) {
    if (AppConfig.enableNetworkLog) {
      debugPrint('← ${response.statusCode} ${response.requestOptions.uri}');
    }
    handler.next(response);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    if (AppConfig.enableNetworkLog) {
      debugPrint('✗ ${err.requestOptions.uri} → ${err.error ?? err.message}');
    }
    handler.next(err);
  }
}
