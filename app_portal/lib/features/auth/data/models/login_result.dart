/// 登录接口响应
class LoginResult {
  const LoginResult({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresIn,
    this.tokenType = 'Bearer',
  });

  final String accessToken;
  final String refreshToken;
  final int expiresIn;
  final String tokenType;

  factory LoginResult.fromJson(Map<String, dynamic> json) {
    return LoginResult(
      accessToken: (json['accessToken'] ?? '').toString(),
      refreshToken: (json['refreshToken'] ?? '').toString(),
      expiresIn: int.tryParse((json['expiresIn'] ?? 7200).toString()) ?? 7200,
      tokenType: (json['tokenType'] ?? 'Bearer').toString(),
    );
  }
}

/// 图形验证码
class CaptchaResult {
  const CaptchaResult({required this.captchaId, required this.captchaBase64});

  final String captchaId;

  /// base64 图片数据（后端返回的 svg 已转 base64）
  final String captchaBase64;

  /// 去掉 data URI 前缀，供 Image.memory 使用
  String get base64Payload {
    final idx = captchaBase64.indexOf('base64,');
    return idx >= 0 ? captchaBase64.substring(idx + 7) : captchaBase64;
  }

  factory CaptchaResult.fromJson(Map<String, dynamic> json) {
    return CaptchaResult(
      captchaId: (json['captchaId'] ?? '').toString(),
      captchaBase64: (json['captchaBase64'] ?? '').toString(),
    );
  }
}
