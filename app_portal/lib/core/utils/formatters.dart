import 'package:intl/intl.dart';

/// 日期与数值格式化工具
class Formatters {
  Formatters._();

  static final DateFormat _date = DateFormat('yyyy-MM-dd');
  static final DateFormat _dateTime = DateFormat('yyyy-MM-dd HH:mm');
  static final DateFormat _monthDay = DateFormat('MM-dd');

  /// yyyy-MM-dd
  static String date(DateTime? value) => value == null ? '-' : _date.format(value);

  /// yyyy-MM-dd HH:mm
  static String dateTime(DateTime? value) => value == null ? '-' : _dateTime.format(value);

  /// MM-dd
  static String monthDay(DateTime? value) => value == null ? '-' : _monthDay.format(value);

  /// 接口传输格式（后端 date 字段接受 yyyy-MM-dd）
  static String toApiDate(DateTime value) => _date.format(value);

  /// 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 / 具体日期
  static String relative(DateTime? value) {
    if (value == null) return '-';

    final diff = DateTime.now().difference(value);
    if (diff.inSeconds < 60) return '刚刚';
    if (diff.inMinutes < 60) return '${diff.inMinutes} 分钟前';
    if (diff.inHours < 24) return '${diff.inHours} 小时前';
    if (diff.inDays < 30) return '${diff.inDays} 天前';
    return _date.format(value);
  }

  /// 距离过期天数：正数表示还剩 N 天，负数表示已过期 N 天
  static int? daysUntil(DateTime? expireDate) {
    if (expireDate == null) return null;
    final today = DateTime.now();
    final expire = DateTime(expireDate.year, expireDate.month, expireDate.day);
    final now = DateTime(today.year, today.month, today.day);
    return expire.difference(now).inDays;
  }

  /// 金额：¥1,234.50
  static String money(num? value) {
    if (value == null) return '-';
    return '¥${NumberFormat('#,##0.00').format(value)}';
  }

  /// 大数字紧凑显示：1.2万 / 3.4亿
  static String compactNumber(num? value) {
    if (value == null) return '0';
    final v = value.toDouble();
    if (v.abs() >= 100000000) return '${(v / 100000000).toStringAsFixed(1)}亿';
    if (v.abs() >= 10000) return '${(v / 10000).toStringAsFixed(1)}万';
    return v.toInt().toString();
  }
}
