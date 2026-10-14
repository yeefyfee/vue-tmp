import { Injectable, Logger } from "@nestjs/common";
import { RedisService as LiaoliaRedisService } from "@liaoliaots/nestjs-redis";
import type { Redis } from "ioredis";
import { DEFAULT_TTL_SECONDS } from "@peluvida/shared";
import { RequestContext } from "../context/request-context";
import { TENANT_REDIS_PREFIX } from "../../tenant/tenant.constants";

/**
 * Redis 服务（缓存抽象，基于 ioredis）
 *
 * 提供常用的缓存操作方法，支持：
 * - 基础 KV 操作（set/get/del）
 * - Hash 操作（hset/hget/hdel/hmget）
 * - 模式匹配删除
 *
 * **多租户键前缀（PEL-11）**：当前请求上下文带租户ID 时，所有键自动改写为
 * `tenant:<租户ID>:<原键>`（决策 A2：Redis 键带 `tenant:` 前缀）；无租户上下文
 * （平台级缓存、未登录请求、定时任务）保持原键，行为与历史完全一致。
 * 租户ID 唯一来源是 JWT → RequestContext，**不接受业务代码显式传入**。
 */
@Injectable()
export class RedisService {
  private readonly client: Redis;
  private readonly logger = new Logger(RedisService.name);

  constructor(private redisService: LiaoliaRedisService) {
    this.client = this.redisService.getOrThrow();
  }

  /**
   * 优雅关闭（P0-01-03）：SIGTERM/SIGINT → enableShutdownHooks → onModuleDestroy。
   * quit 等待挂起命令完成后断开，避免容器滚动时连接泄漏；失败仅记日志不阻断关闭链。
   */
  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.quit();
    } catch (err) {
      this.logger.warn("Redis 优雅关闭异常（连接可能已断开）", err as Error);
    }
  }

  /**
   * 按当前租户上下文改写键名：
   * `key` → `tenant:<tenantId>:key`（有租户上下文时），否则原样返回。
   */
  private resolveKey(key: string): string {
    const tenantId = RequestContext.getTenantId();
    return tenantId ? `${TENANT_REDIS_PREFIX}${tenantId}:${key}` : key;
  }

  /**
   * 获取原生 Redis 客户端（用于特殊操作如 incr/expire）
   *
   * ⚠️ 走原生客户端的键**不会**自动加租户前缀；租户范围的键请用本服务的方法，
   * 或显式调用 `scopedKey()` 后再操作。
   */
  getClient(): Redis {
    return this.client;
  }

  /** 显式按当前租户上下文改写键名（供原生客户端特殊操作时对齐前缀规则） */
  scopedKey(key: string): string {
    return this.resolveKey(key);
  }

  /**
   * ── 全局键操作（**不做租户前缀改写**，CROSS-10 键规范的有据例外）──
   *
   * 适用判定（两条同时成立才用本组方法）：
   *  1. 键名自身已**全局唯一**（`userId` / `jti` / 令牌串等全局标识）；
   *  2. 存在**「租户上下文尚未装配」的读取路径** —— `JwtStrategy.validate` 早于
   *     `DataScopeGuard` 写 ALS，此时 `RequestContext.getTenantId()` 恒为 null。
   *
   * 若这类键走 `set/get/hasKey`，会因「写入请求（已认证，带租户上下文）」与
   * 「读取请求（认证链中，无租户上下文）」**解析出两个不同的物理键**而读写错位，
   * 安全校验恒 miss —— 这正是「登出黑名单失效 / 踢下线失效」的根因（缺陷登记见 PITFALLS）。
   *
   * 当前使用方：认证域 3 组键 ——
   *  · `auth:token:blacklist:<jti>`（登出 / 刷新旋转）
   *  · `auth:user:token_version:<userId>`（踢下线 / 改密 / 重放吊销）
   *  · `auth:user:jwt_session:<userId>` 及 redis-token 模式 access/refresh 映射
   */
  async setGlobal(key: string, value: any, ttl?: number): Promise<boolean> {
    try {
      const serialized = JSON.stringify(value);
      const effectiveTtl = ttl && ttl > 0 ? ttl : DEFAULT_TTL_SECONDS;
      await this.client.setex(key, effectiveTtl, serialized);
      return true;
    } catch (err) {
      this.logger.error("Redis setGlobal error", err);
      return false;
    }
  }

  /** 读取全局键（不做租户前缀改写），不存在返回 null */
  async getGlobal<T = any>(key: string): Promise<T | null> {
    try {
      const data = await this.client.get(key);
      return data ? JSON.parse(data) : null;
    } catch (err) {
      this.logger.error("Redis getGlobal error", err);
      return null;
    }
  }

  /** 全局键是否存在（不做租户前缀改写） */
  async hasGlobalKey(key: string): Promise<boolean> {
    try {
      return (await this.client.exists(key)) === 1;
    } catch (err) {
      this.logger.error("Redis hasGlobalKey error", err);
      return false;
    }
  }

  /** 删除全局键（不做租户前缀改写） */
  async delGlobal(key: string): Promise<boolean> {
    try {
      return (await this.client.del(key)) === 1;
    } catch (err) {
      this.logger.error("Redis delGlobal error", err);
      return false;
    }
  }

  /** 全局键自增（返回自增后的值）；不做租户前缀改写 */
  async incrGlobal(key: string): Promise<number> {
    return this.client.incr(key);
  }

  /** 设置全局键过期时间（秒）；不做租户前缀改写 */
  async expireGlobal(key: string, ttl: number): Promise<boolean> {
    return (await this.client.expire(key, ttl)) === 1;
  }

  /**
   * 写入缓存（CROSS-10 键规范：默认 TTL 1h）
   *
   * 不传 `ttl` 或传非正数时落 {@link DEFAULT_TTL_SECONDS}（1 小时）——
   * 防止无主键堆积；存量调用全部显式传 TTL，行为不变。
   * 需要永不过期的键（极少数）请走 `getClient()` 原生 set 并在键名审计中登记。
   */
  async set(key: string, value: any, ttl?: number): Promise<boolean> {
    try {
      const serialized = JSON.stringify(value);
      const resolved = this.resolveKey(key);
      const effectiveTtl = ttl && ttl > 0 ? ttl : DEFAULT_TTL_SECONDS;
      await this.client.setex(resolved, effectiveTtl, serialized);
      return true;
    } catch (err) {
      this.logger.error("Redis set error", err);
      return false;
    }
  }

  async get<T = any>(key: string): Promise<T | null> {
    try {
      const data = await this.client.get(this.resolveKey(key));
      return data ? JSON.parse(data) : null;
    } catch (err) {
      this.logger.error("Redis get error", err);
      return null;
    }
  }

  async del(key: string): Promise<boolean> {
    try {
      const result = await this.client.del(this.resolveKey(key));
      return result === 1;
    } catch (err) {
      this.logger.error("Redis delete error", err);
      return false;
    }
  }

  async delMultiple(keys: string[]): Promise<number> {
    try {
      if (keys.length === 0) return 0;
      return await this.client.del(...keys.map((k) => this.resolveKey(k)));
    } catch (err) {
      this.logger.error("Redis bulk delete error", err);
      return 0;
    }
  }

  async deletePattern(pattern: string): Promise<number> {
    try {
      // KEYS 返回的已是带前缀的物理键名（resolveKey 已应用），必须用原生客户端直删；
      // 不能走 delMultiple —— 它会对键名再次前缀，导致删到不存在的键（返回 0）
      const keys = await this.client.keys(this.resolveKey(pattern));
      if (keys.length === 0) return 0;
      return await this.client.del(...keys);
    } catch (err) {
      this.logger.error("Redis pattern delete error", err);
      return 0;
    }
  }

  async hasKey(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(this.resolveKey(key));
      return result === 1;
    } catch (err) {
      this.logger.error("Redis exists check error", err);
      return false;
    }
  }

  /**
   * 设置 Hash 字段值
   *
   * @param key Hash 键名
   * @param field 字段名
   * @param value 字段值（自动 JSON 序列化）
   */
  async hset(key: string, field: string, value: any): Promise<boolean> {
    try {
      const serialized = JSON.stringify(value);
      await this.client.hset(this.resolveKey(key), field, serialized);
      return true;
    } catch (err) {
      this.logger.error("Redis hset error", err);
      return false;
    }
  }

  /**
   * 获取 Hash 字段值
   *
   * @param key Hash 键名
   * @param field 字段名
   * @returns 字段值（自动 JSON 反序列化），不存在返回 null
   */
  async hget<T = any>(key: string, field: string): Promise<T | null> {
    try {
      const data = await this.client.hget(this.resolveKey(key), field);
      return data ? JSON.parse(data) : null;
    } catch (err) {
      this.logger.error("Redis hget error", err);
      return null;
    }
  }

  /**
   * 删除 Hash 字段
   *
   * @param key Hash 键名
   * @param fields 要删除的字段名（支持多个）
   * @returns 删除的字段数量
   */
  async hdel(key: string, ...fields: string[]): Promise<number> {
    try {
      if (fields.length === 0) return 0;
      return await this.client.hdel(this.resolveKey(key), ...fields);
    } catch (err) {
      this.logger.error("Redis hdel error", err);
      return 0;
    }
  }

  /**
   * 批量获取 Hash 字段值
   *
   * @param key Hash 键名
   * @param fields 字段名列表
   * @returns 字段值数组，顺序与 fields 对应，不存在的字段为 null
   */
  async hmget<T = any>(key: string, fields: string[]): Promise<(T | null)[]> {
    try {
      if (fields.length === 0) return [];
      const results = await this.client.hmget(this.resolveKey(key), ...fields);
      return results.map((data) => (data ? JSON.parse(data) : null));
    } catch (err) {
      this.logger.error("Redis hmget error", err);
      return fields.map(() => null);
    }
  }

  /**
   * 删除整个 Hash 键
   *
   * @param key Hash 键名
   */
  async delHash(key: string): Promise<boolean> {
    return this.del(key);
  }

  /**
   * 检查 Hash 字段是否存在
   *
   * @param key Hash 键名
   * @param field 字段名
   */
  async hexists(key: string, field: string): Promise<boolean> {
    try {
      const result = await this.client.hexists(this.resolveKey(key), field);
      return result === 1;
    } catch (err) {
      this.logger.error("Redis hexists error", err);
      return false;
    }
  }
}
