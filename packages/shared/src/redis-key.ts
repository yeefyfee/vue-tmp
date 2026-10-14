/**
 * Redis 键规范（CROSS-10，决策 A2）
 *
 * **键格式**：`业务:对象:标识`（如 `auth:token:access`、`captcha:image`）；
 * **多租户前缀**：`tenant:<租户ID>:`（写入时由后端 `RedisService.resolveKey`
 * 按请求上下文自动添加，PEL-11；业务代码永远只操作逻辑键）；
 * **默认 TTL**：1 小时（{@link DEFAULT_TTL_SECONDS}）—— 允许显式覆盖，
 * 但不传 TTL 的写入一律落默认值，防止无主键堆积。
 *
 * 约束：本模块只放「纯常量 + 纯函数」，供三端与后端共用（键名审计、生成对齐）。
 */

/** 键分段之间的分隔符 */
export const REDIS_KEY_SEPARATOR = ":";

/** 多租户键前缀（与后端 `tenant.constants.ts` 的 `TENANT_REDIS_PREFIX` 保持一致） */
export const TENANT_REDIS_KEY_PREFIX = "tenant:";

/** 默认 TTL（秒）：1 小时。不显式传 TTL 的写入按此过期 */
export const DEFAULT_TTL_SECONDS = 3600;

/** 键分段允许的字符：小写字母 / 数字 / 下划线 / 连字符 */
const SEGMENT_RE = /^[a-z0-9_-]+$/;

/**
 * 拼接规范键：`业务:对象:标识`。
 *
 * @example
 * redisKey("auth", "token", "access")          // "auth:token:access"
 * redisKey("auth", "token", accessToken)       // "auth:token:access:<token>"
 * redisKey("captcha", "image", captchaId)      // "captcha:image:<id>"
 *
 * @throws 分段为空或含非法字符（大写 / 空白 / 冒号等）时抛错，
 *         把键名拼装错误拦在生成期而不是线上 Redis。
 */
export function redisKey(...segments: Array<string | number>): string {
  if (segments.length === 0) {
    throw new Error("[redisKey] 至少需要一个键分段（业务:对象:标识）");
  }
  const parts = segments.map((s) => String(s));
  for (const part of parts) {
    if (part.trim() === "" || !SEGMENT_RE.test(part)) {
      throw new Error(
        `[redisKey] 键分段 "${part}" 非法：只允许小写字母/数字/下划线/连字符，且不能为空`
      );
    }
  }
  return parts.join(REDIS_KEY_SEPARATOR);
}

/** 在逻辑键上叠加租户前缀（后端 resolveKey 的共享实现；业务代码一般不需要直接用） */
export function withTenantPrefix(tenantId: string | null | undefined, logicalKey: string): string {
  const tenant = tenantId === null || tenantId === undefined ? "" : String(tenantId).trim();
  return tenant !== "" ? `${TENANT_REDIS_KEY_PREFIX}${tenant}:${logicalKey}` : logicalKey;
}
