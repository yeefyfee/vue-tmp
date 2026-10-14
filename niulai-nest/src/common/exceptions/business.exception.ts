import { HttpException, HttpStatus } from "@nestjs/common";
import { ErrorCode } from "../enums/error-code.enum";
import type { DomainErrorEntry } from "../enums/domain-error-code.enum";

// 增强类型定义
type BusinessError =
  | ((typeof ErrorCode)[keyof typeof ErrorCode] & { httpStatus?: HttpStatus })
  | { code: string; msg: string; httpStatus?: HttpStatus }
  /** 业务域错误码条目（CROSS-13）：信封 code 对外取 `域_对象_原因` 命名（entry.name） */
  | DomainErrorEntry;

/**
 * 业务异常（CROSS-13）
 *
 * 错误信封：`{ code, msg, details? }` —— 字段名保留 `msg`（决策 A4）。
 * `details` 为**可选**的结构化错误明细（如字段级校验失败列表）：
 *  - 第三参传入时随响应透传（`HttpExceptionFilter` 负责放进信封）；
 *  - 不传时响应体与历史完全一致（`details` 键不出现），存量前端零感知。
 */
export class BusinessException extends HttpException {
  constructor(errorInfo: BusinessError, details?: unknown);
  constructor(msg: string, httpStatus?: HttpStatus, details?: unknown);
  constructor(arg: BusinessError | string, second?: unknown, third?: unknown) {
    if (typeof arg === "string") {
      // (msg, httpStatus?, details?)：字符串分支，second 是 httpStatus，third 是 details
      super(
        {
          code: ErrorCode.SYSTEM_ERROR.code,
          msg: arg,
          ...(third !== undefined ? { details: third } : {}),
        },
        typeof second === "number" ? second : HttpStatus.BAD_REQUEST
      );
    } else {
      // (errorInfo, details?)：对象分支，second 就是 details
      const statusCode = arg.httpStatus || HttpStatus.BAD_REQUEST;
      // 域错误码条目的 `code` 是数字分段码（内部监控用），对外信封取 `name`（域_对象_原因）
      const envelopeCode =
        typeof (arg as DomainErrorEntry).code === "number" && "name" in arg
          ? (arg as DomainErrorEntry).name
          : arg.code || ErrorCode.SYSTEM_ERROR.code;
      super(
        {
          code: envelopeCode,
          msg: arg.msg || ErrorCode.SYSTEM_ERROR.msg,
          ...(second !== undefined ? { details: second } : {}),
        },
        statusCode
      );
    }
  }
}
