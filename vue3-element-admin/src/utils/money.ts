/**
 * 金额工具（前端唯一入口）
 *
 * 全链路金额以「分」为最小单位（决策 A1 / Q6）：
 * - 后端 API 传「分」整数，DB 为 `BIGINT`；
 * - 展示层一律走本模块的 `formatCents()` / `formatMoney()`，**禁止页面内自行 toFixed**；
 * - 用户输入用 `parseAmountToCents()` 解析为「分」后再提交。
 *
 * ⚠️ 与 `@/utils/format` 的 `formatCurrency(amount)` 的区别：
 *    后者入参是「元」（历史实现），本模块的 `formatCents(cents)` 入参是「分」。
 *    金额相关的新代码请统一使用本模块，避免 100 倍误差。
 */

export {
  Money,
  CENTS_PER_YUAN,
  asCents,
  isCents,
  yuanToCents,
  centsToYuan,
  formatCents,
  formatMoney,
  formatYuan,
  parseAmountToCents,
  centsToInputText,
} from "@peluvida/shared";

export type { Cents, Yuan, FormatMoneyOptions } from "@peluvida/shared";
