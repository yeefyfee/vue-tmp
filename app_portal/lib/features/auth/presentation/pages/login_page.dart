import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/network/api_exception.dart';
import '../../../../core/providers/core_providers.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../providers/auth_provider.dart';

/// 登录页
///
/// 对接后端 `POST /api/v1/auth/login`，需同时提交图形验证码。
class LoginPage extends ConsumerStatefulWidget {
  const LoginPage({super.key});

  @override
  ConsumerState<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends ConsumerState<LoginPage> {
  final _formKey = GlobalKey<FormState>();
  final _usernameCtrl = TextEditingController();
  final _passwordCtrl = TextEditingController();
  final _captchaCtrl = TextEditingController();

  bool _obscurePassword = true;
  String _captchaId = '';

  @override
  void initState() {
    super.initState();
    // 回填上次登录的账号
    _usernameCtrl.text = ref.read(prefStorageProvider).lastLoginName;
  }

  @override
  void dispose() {
    _usernameCtrl.dispose();
    _passwordCtrl.dispose();
    _captchaCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    if (_captchaId.isEmpty) {
      _showError('验证码尚未加载，请点击图片刷新');
      return;
    }

    final controller = ref.read(authControllerProvider.notifier);
    final ok = await controller.login(
      username: _usernameCtrl.text.trim(),
      password: _passwordCtrl.text,
      captchaId: _captchaId,
      captchaCode: _captchaCtrl.text.trim(),
    );

    if (!mounted) return;

    if (ok) {
      // 记住账号（不含密码）
      await ref.read(prefStorageProvider).setLastLoginName(_usernameCtrl.text.trim());
      // 登录成功由路由守卫自动跳转，无需手动导航
    } else {
      // 登录失败：刷新验证码并清空输入
      _captchaCtrl.clear();
      ref.invalidate(captchaProvider);
      final msg = ref.read(authControllerProvider).errorMessage ?? '登录失败';
      _showError(msg);
    }
  }

  void _showError(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          backgroundColor: AppColors.danger,
          duration: const Duration(seconds: 3),
        ),
      );
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authControllerProvider);
    final captchaAsync = ref.watch(captchaProvider);

    // 同步验证码 ID
    captchaAsync.whenData((captcha) {
      if (_captchaId != captcha.captchaId) {
        _captchaId = captcha.captchaId;
      }
    });

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _formKey,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // --- 品牌区 -------------------------------------------------
                    Container(
                      width: 68,
                      height: 68,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          colors: [AppColors.primary, AppColors.primaryDark],
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                        ),
                        borderRadius: BorderRadius.circular(AppRadius.lg),
                      ),
                      child: const Icon(Icons.apps_rounded, size: 34, color: Colors.white),
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    const Text(
                      'App 门户',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 22, fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: AppSpacing.xs),
                    const Text(
                      '一个入口，聚合你的全部工具',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 13, color: AppColors.textTertiary),
                    ),

                    const SizedBox(height: AppSpacing.xxl),

                    // --- 账号 ---------------------------------------------------
                    TextFormField(
                      controller: _usernameCtrl,
                      textInputAction: TextInputAction.next,
                      decoration: const InputDecoration(
                        hintText: '请输入用户名',
                        prefixIcon: Icon(Icons.person_outline, size: 20),
                      ),
                      validator: (v) => (v == null || v.trim().isEmpty) ? '请输入用户名' : null,
                    ),
                    const SizedBox(height: AppSpacing.md),

                    // --- 密码 ---------------------------------------------------
                    TextFormField(
                      controller: _passwordCtrl,
                      obscureText: _obscurePassword,
                      textInputAction: TextInputAction.next,
                      decoration: InputDecoration(
                        hintText: '请输入密码',
                        prefixIcon: const Icon(Icons.lock_outline, size: 20),
                        suffixIcon: IconButton(
                          icon: Icon(
                            _obscurePassword
                                ? Icons.visibility_off_outlined
                                : Icons.visibility_outlined,
                            size: 20,
                          ),
                          onPressed: () =>
                              setState(() => _obscurePassword = !_obscurePassword),
                        ),
                      ),
                      validator: (v) => (v == null || v.isEmpty) ? '请输入密码' : null,
                    ),
                    const SizedBox(height: AppSpacing.md),

                    // --- 验证码 -------------------------------------------------
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: TextFormField(
                            controller: _captchaCtrl,
                            textInputAction: TextInputAction.done,
                            decoration: const InputDecoration(
                              hintText: '请输入验证码',
                              prefixIcon: Icon(Icons.verified_outlined, size: 20),
                            ),
                            validator: (v) =>
                                (v == null || v.trim().isEmpty) ? '请输入验证码' : null,
                            onFieldSubmitted: (_) => _submit(),
                          ),
                        ),
                        const SizedBox(width: AppSpacing.sm),
                        _CaptchaImage(
                          async: captchaAsync,
                          onRefresh: () => ref.invalidate(captchaProvider),
                        ),
                      ],
                    ),

                    const SizedBox(height: AppSpacing.xl),

                    // --- 登录按钮 -----------------------------------------------
                    ElevatedButton(
                      onPressed: authState.isSubmitting ? null : _submit,
                      child: authState.isSubmitting
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Text('登 录'),
                    ),

                    const SizedBox(height: AppSpacing.lg),
                    const Text(
                      '默认账号 admin / 123456',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 12, color: AppColors.textTertiary),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// 图形验证码展示（后端返回 SVG 转成的 base64 PNG）
class _CaptchaImage extends StatelessWidget {
  const _CaptchaImage({required this.async, required this.onRefresh});

  final AsyncValue<dynamic> async;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onRefresh,
      child: Container(
        width: 104,
        height: 48,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: Theme.of(context).inputDecorationTheme.fillColor,
          borderRadius: BorderRadius.circular(AppRadius.sm),
          border: Border.all(color: AppColors.divider),
        ),
        child: async.when(
          loading: () => const SizedBox(
            width: 16,
            height: 16,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          error: (e, _) => const Icon(Icons.refresh, size: 20, color: AppColors.textTertiary),
          data: (captcha) {
            try {
              final bytes = base64Decode(captcha.base64Payload as String);
              return ClipRRect(
                borderRadius: BorderRadius.circular(AppRadius.xs),
                child: Image.memory(
                  bytes,
                  width: 96,
                  height: 40,
                  fit: BoxFit.contain,
                  gaplessPlayback: true,
                  errorBuilder: (_, __, ___) => const Icon(
                    Icons.refresh,
                    size: 20,
                    color: AppColors.textTertiary,
                  ),
                ),
              );
            } catch (e) {
              if (e is ApiException) rethrow;
              return const Icon(Icons.refresh, size: 20, color: AppColors.textTertiary);
            }
          },
        ),
      ),
    );
  }
}
