/**
 * 接口错误上报（01-06 · 全局请求层）
 *
 * 与请求适配器分离，避免 `request.ts` 承载埋点接入点后形成模块环。
 * 采用「可注册上报器 + window 事件」双通道：
 * - 未接入真实埋点时为零副作用（仅派发事件，无人监听即丢弃）；
 * - 宿主可在启动时 `setApiErrorReporter(fn)` 接入监控平台，或监听 `app:api-error`。
 */

import type { ApiErrorReport } from "@/utils/api-error";

/** 接口错误上报事件名（供宿主监听） */
export const API_ERROR_EVENT = "app:api-error";

type ApiErrorReporter = (report: ApiErrorReport) => void;

let errorReporter: ApiErrorReporter | null = null;

/**
 * 注册接口错误上报器
 *
 * @param reporter 上报函数；传 `null` 可注销
 */
export function setApiErrorReporter(reporter: ApiErrorReporter | null): void {
  errorReporter = reporter;
}

/**
 * 上报一次接口错误
 *
 * 上报器自身异常不得影响请求主流程，故整体 try/catch 兜底。
 */
export function reportApiError(report: ApiErrorReport): void {
  try {
    errorReporter?.(report);
  } catch {
    // 上报器异常不影响业务流程
  }

  try {
    window.dispatchEvent(new CustomEvent<ApiErrorReport>(API_ERROR_EVENT, { detail: report }));
  } catch {
    // 非浏览器环境（SSR / 单测）忽略
  }
}
