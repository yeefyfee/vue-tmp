/// 当前登录用户信息
///
/// 对应后端 `GET /api/v1/users/me` 返回结构。
class UserInfo {
  const UserInfo({
    required this.userId,
    required this.username,
    this.nickname,
    this.avatar,
    this.mobile,
    this.email,
    this.deptId,
    this.deptName,
    this.gender,
    this.roles = const [],
    this.perms = const [],
  });

  final String userId;
  final String username;
  final String? nickname;
  final String? avatar;
  final String? mobile;
  final String? email;
  final String? deptId;
  final String? deptName;
  final int? gender;
  final List<String> roles;
  final List<String> perms;

  /// 展示名：昵称优先，回退用户名
  String get displayName => (nickname?.isNotEmpty == true) ? nickname! : username;

  /// 头像首字母（无头像时兜底展示）
  String get initial => displayName.isNotEmpty ? displayName.substring(0, 1) : '?';

  factory UserInfo.fromJson(Map<String, dynamic> json) {
    return UserInfo(
      userId: (json['userId'] ?? json['id'] ?? '').toString(),
      username: (json['username'] ?? '').toString(),
      nickname: json['nickname']?.toString(),
      avatar: json['avatar']?.toString(),
      mobile: json['mobile']?.toString(),
      email: json['email']?.toString(),
      deptId: json['deptId']?.toString(),
      deptName: json['deptName']?.toString(),
      gender: json['gender'] == null ? null : int.tryParse(json['gender'].toString()),
      roles: (json['roles'] as List?)?.map((e) => e.toString()).toList() ?? const [],
      perms: (json['perms'] as List?)?.map((e) => e.toString()).toList() ?? const [],
    );
  }

  @override
  String toString() => 'UserInfo($userId, $username)';
}
