/// 后端统一响应结构
///
/// 与 `niulai-nest` 的 ResponseInterceptor 保持一致：
/// ```json
/// { "code": "00000", "msg": "成功", "data": ... }
/// ```
class ApiResponse<T> {
  const ApiResponse({required this.code, required this.msg, this.data});

  final String code;
  final String msg;
  final T? data;

  /// 成功状态码
  static const String successCode = '00000';

  /// 登录态失效码
  static const List<String> unauthorizedCodes = ['A0230', 'A0231'];

  /// 权限不足码
  static const String forbiddenCode = 'A0301';

  bool get isSuccess => code == successCode;
  bool get isUnauthorized => unauthorizedCodes.contains(code);
  bool get isForbidden => code == forbiddenCode;

  factory ApiResponse.fromJson(
    Map<String, dynamic> json,
    T Function(dynamic data)? fromData,
  ) {
    final rawData = json['data'];
    return ApiResponse<T>(
      code: (json['code'] ?? '').toString(),
      msg: (json['msg'] ?? '').toString(),
      data: rawData == null ? null : (fromData != null ? fromData(rawData) : rawData as T),
    );
  }
}
