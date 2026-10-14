/**
 * 数据格式化相关工具函数
 */

/**
 * 格式化增长率
 * 保留两位小数，去掉末尾的 0，取绝对值
 *
 * @param growthRate 增长率（小数形式，如 0.15 表示 15%）
 * @returns 格式化后的增长率字符串
 *
 * @example
 * ```ts
 * formatGrowthRate(0.1234);  // "12.34%"
 * formatGrowthRate(0.1000);  // "10%"
 * formatGrowthRate(0);       // "-"
 * formatGrowthRate(-0.05);   // "5%"（取绝对值）
 * ```
 */
export function formatGrowthRate(growthRate: number): string {
  if (growthRate === 0) {
    return "-";
  }

  const formattedRate = Math.abs(growthRate * 100)
    .toFixed(2)
    .replace(/\.?0+$/, "");

  return formattedRate + "%";
}

/**
 * 格式化文件大小
 * @param bytes 字节数
 * @param decimals 保留小数位数，默认 2
 * @returns 格式化后的文件大小字符串
 *
 * @example
 * ```ts
 * formatFileSize(1024);      // "1 KB"
 * formatFileSize(1048576);   // "1 MB"
 * formatFileSize(1234567);   // "1.18 MB"
 * ```
 */
export function formatFileSize(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + " " + sizes[i];
}

/**
 * 格式化数字，添加千分位分隔符
 * @param num 数字
 * @returns 格式化后的字符串
 *
 * @example
 * ```ts
 * formatNumber(1234567);     // "1,234,567"
 * formatNumber(1234567.89);  // "1,234,567.89"
 * ```
 */
export function formatNumber(num: number): string {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * 格式化金额（人民币）
 * @param amount 金额
 * @param decimals 保留小数位数，默认 2
 * @returns 格式化后的金额字符串
 *
 * @example
 * ```ts
 * formatCurrency(1234567);      // "¥1,234,567.00"
 * formatCurrency(1234567.8);    // "¥1,234,567.80"
 * formatCurrency(1234567, 0);   // "¥1,234,567"
 * ```
 */
export function formatCurrency(amount: number, decimals: number = 2): string {
  const formatted = amount.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return "¥" + formatted;
}

/** 时间列相对表达标签（由调用方注入 i18n 文案，工具层不持有多语言） */
export interface RelativeDateLabels {
  /** 今天 */
  today: string;
  /** 昨天 */
  yesterday: string;
  /** 前天 */
  beforeYesterday: string;
}

const DEFAULT_RELATIVE_LABELS: RelativeDateLabels = {
  today: "今天",
  yesterday: "昨天",
  beforeYesterday: "前天",
};

/** 一天毫秒数 */
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 格式化列表时间列（PRD《Web规范》§表格规范 第 4 条）
 *
 * 口径：统一展示 `YYYY-MM-DD HH:mm`，**三天内**改用相对表达（今天 / 昨天 / 前天 + HH:mm）。
 *
 * 实现要点：
 *  · 后端时间已按应用时区序列化为 `yyyy-MM-dd HH:mm:ss`（`ResponseInterceptor`），
 *    故按字符串取年月日时分，**不做时区换算**（避免 `Date.parse` 对无时区串的隐式 UTC 解读）；
 *  · 天数差以「本地零点」为基准计算，跨夏令时/跨月不会错位；
 *  · 无法识别的输入原样返回，不产生 `Invalid Date`。
 *
 * @param value 时间字符串（`yyyy-MM-dd HH:mm:ss` / ISO 8601）
 * @param labels 相对表达文案（多语言由调用方注入）
 *
 * @example
 * ```ts
 * formatTableDateTime("2026-10-09 14:30:00");  // "今天 14:30"
 * formatTableDateTime("2026-10-08 09:05:00");  // "昨天 09:05"
 * formatTableDateTime("2026-09-01 09:05:00");  // "2026-09-01 09:05"
 * ```
 */
export function formatTableDateTime(
  value?: string | number | null,
  labels: Partial<RelativeDateLabels> = {}
): string {
  if (value === undefined || value === null || value === "") return "-";

  const raw = String(value);
  const matched = raw.replace("T", " ").match(/^(\d{4})-(\d{2})-(\d{2})[ ]?(\d{2}):(\d{2})/);
  if (!matched) return raw;

  const [, year, month, day, hour, minute] = matched;
  const absolute = `${year}-${month}-${day} ${hour}:${minute}`;

  const target = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(target.getTime())) return absolute;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((startOfToday.getTime() - target.getTime()) / ONE_DAY_MS);
  const labels_ = { ...DEFAULT_RELATIVE_LABELS, ...labels };

  if (diffDays === 0) return `${labels_.today} ${hour}:${minute}`;
  if (diffDays === 1) return `${labels_.yesterday} ${hour}:${minute}`;
  if (diffDays === 2) return `${labels_.beforeYesterday} ${hour}:${minute}`;

  return absolute;
}
