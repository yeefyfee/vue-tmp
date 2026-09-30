import 'package:dio/dio.dart';

import '../config/app_config.dart';
import 'api_exception.dart';
import 'interceptors.dart';

/// 全局 HTTP 客户端
///
/// 装配顺序很重要：Auth(注入 Token) → Logger(日志) → Response(解包) → Error(归一化)。
/// 拦截器按注册顺序执行 onRequest，按**逆序**执行 onResponse。
class ApiClient {
  ApiClient({required Future<String?> Function() readToken}) {
    _dio = Dio(
      BaseOptions(
        baseUrl: AppConfig.apiBaseUrl,
        connectTimeout: AppConfig.connectTimeout,
        receiveTimeout: AppConfig.receiveTimeout,
        sendTimeout: AppConfig.sendTimeout,
        headers: {'Accept': 'application/json'},
        // 交由 ResponseInterceptor 判定成败，避免 Dio 对非 2xx 直接抛错
        validateStatus: (status) => status != null && status < 500,
      ),
    );

    _dio.interceptors.addAll([
      AuthInterceptor(readToken: readToken),
      if (AppConfig.enableNetworkLog) LoggerInterceptor(),
      ResponseInterceptor(),
      ErrorInterceptor(),
    ]);
  }

  late final Dio _dio;

  Dio get dio => _dio;

  /// GET
  Future<T> get<T>(
    String path, {
    Map<String, dynamic>? queryParameters,
    CancelToken? cancelToken,
  }) async {
    return _execute<T>(
      () => _dio.get<dynamic>(path, queryParameters: queryParameters, cancelToken: cancelToken),
    );
  }

  /// POST
  Future<T> post<T>(
    String path, {
    Object? data,
    Map<String, dynamic>? queryParameters,
    CancelToken? cancelToken,
  }) async {
    return _execute<T>(
      () => _dio.post<dynamic>(
        path,
        data: data,
        queryParameters: queryParameters,
        cancelToken: cancelToken,
      ),
    );
  }

  /// PUT
  Future<T> put<T>(
    String path, {
    Object? data,
    Map<String, dynamic>? queryParameters,
    CancelToken? cancelToken,
  }) async {
    return _execute<T>(
      () => _dio.put<dynamic>(
        path,
        data: data,
        queryParameters: queryParameters,
        cancelToken: cancelToken,
      ),
    );
  }

  /// PATCH
  Future<T> patch<T>(
    String path, {
    Object? data,
    Map<String, dynamic>? queryParameters,
    CancelToken? cancelToken,
  }) async {
    return _execute<T>(
      () => _dio.patch<dynamic>(
        path,
        data: data,
        queryParameters: queryParameters,
        cancelToken: cancelToken,
      ),
    );
  }

  /// DELETE
  Future<T> delete<T>(
    String path, {
    Object? data,
    Map<String, dynamic>? queryParameters,
    CancelToken? cancelToken,
  }) async {
    return _execute<T>(
      () => _dio.delete<dynamic>(
        path,
        data: data,
        queryParameters: queryParameters,
        cancelToken: cancelToken,
      ),
    );
  }

  /// 上传文件（multipart/form-data，字段名 file）
  Future<T> upload<T>(
    String path, {
    required String filePath,
    required String fileName,
    String fieldName = 'file',
    void Function(int sent, int total)? onProgress,
    CancelToken? cancelToken,
  }) async {
    final formData = FormData.fromMap({
      fieldName: await MultipartFile.fromFile(filePath, filename: fileName),
    });

    return _execute<T>(
      () => _dio.post<dynamic>(
        path,
        data: formData,
        cancelToken: cancelToken,
        onSendProgress: onProgress,
      ),
    );
  }

  /// 统一执行并转换异常
  Future<T> _execute<T>(Future<Response<dynamic>> Function() request) async {
    try {
      final response = await request();
      return response.data as T;
    } on DioException catch (e) {
      throw e.error is ApiException ? e.error as ApiException : NetworkException(e.message ?? '');
    }
  }
}
