import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'core/providers/core_providers.dart';
import 'core/storage/pref_storage.dart';

/// 应用入口
///
/// 启动前先完成 SharedPreferences 初始化，
/// 再通过 ProviderScope.overrides 注入，保证首帧即可读取偏好配置。
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final prefStorage = await PrefStorage.create();

  runApp(
    ProviderScope(
      overrides: [
        prefStorageProvider.overrideWithValue(prefStorage),
      ],
      child: const AppPortal(),
    ),
  );
}
