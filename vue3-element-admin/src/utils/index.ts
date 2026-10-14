/**
 * 工具函数统一导出
 */

// 数据验证
export { isExternal, isValidURL, isEmail, isMobile, VALIDATORS } from "./validate";

// 数据格式化
export { formatGrowthRate, formatFileSize, formatNumber, formatCurrency } from "./format";

// 金额（统一以「分」为单位，来源 @peluvida/shared）
// ⚠️ 金额相关的新代码请使用本模块的 formatCents / parseAmountToCents，
//    不要再使用 formatCurrency（其入参是「元」），避免 100 倍误差。
export {
  Money,
  CENTS_PER_YUAN,
  yuanToCents,
  centsToYuan,
  formatCents,
  formatMoney,
  formatYuan,
  parseAmountToCents,
  centsToInputText,
} from "./money";

// 文件下载
export { downloadFile } from "./download";

// 本地存储
export { Storage } from "./storage";
