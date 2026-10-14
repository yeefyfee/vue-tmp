/**
 * P0-07-03 归属链越权防护基座 —— 公共出口
 *
 * 归属链校验的统一入口：类型、错误码、服务、装饰器、守卫一处导出。
 *
 * 逐端点 opt-in 接入时：`import { OwnershipService, RequireOwnership, OwnershipGuard }
 * from "../../common/ownership";`
 *
 * ⚠️ 本轮不接入既有业务端点，不改动其它目录；仅新增本目录文件。
 */
export * from "./ownership.types";
export * from "./ownership.error-codes";
export * from "./ownership.service";
export * from "./ownership.decorator";
export * from "./ownership.guard";
