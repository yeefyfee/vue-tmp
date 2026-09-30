import 'dart:io';

import 'package:flutter/foundation.dart';

/// 编译期环境标识
enum AppEnv { dev, prod }

/// 全局环境配置
///
/// 通过 `--dart-define=APP_ENV=prod` 切换环境，
/// 默认走开发环境，避免误连生产。
class Env {
  Env._();

  static const String _raw = String.fromEnvironment('APP_ENV', defaultValue: 'dev');

  static AppEnv get current => _raw == 'prod' ? AppEnv.prod : AppEnv.dev;

  static bool get isProd => current == AppEnv.prod;
  static bool get isDev => !isProd;
}

/// 应用级配置：后端地址、超时、开关
class AppConfig {
  AppConfig._();

  static const String appName = 'App 门户';
  static const String appVersion = '1.0.0';

  /// 后端基础地址
  ///
  /// - Android 模拟器中 `localhost` 指向模拟器自身，访问宿主机须用 `10.0.2.2`
  /// - Windows 桌面 / iOS 模拟器可直接用 `localhost`
  /// - 可通过 `--dart-define=API_BASE_URL=xxx` 覆盖
  static const String _override = String.fromEnvironment('API_BASE_URL');

  static String get apiBaseUrl {
    if (_override.isNotEmpty) return _override;

    if (Env.isProd) return 'https://api.theobuild.top';

    // 开发环境：按平台选择可达的宿主机地址
    if (!kIsWeb && Platform.isAndroid) {
      return 'http://10.0.2.2:8000';
    }
    return 'http://localhost:8000';
  }

  /// 全局 API 前缀（后端 setGlobalPrefix）
  static const String apiPrefix = '/api/v1';

  /// 网络超时
  static const Duration connectTimeout = Duration(seconds: 15);
  static const Duration receiveTimeout = Duration(seconds: 30);
  static const Duration sendTimeout = Duration(seconds: 30);

  /// 分页默认值
  static const int defaultPageSize = 10;
  static const int maxPageSize = 100;

  /// 是否输出网络日志
  static bool get enableNetworkLog => Env.isDev;
}
