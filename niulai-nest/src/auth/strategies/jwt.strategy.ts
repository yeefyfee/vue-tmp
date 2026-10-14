import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { RedisService } from "../../common/redis/redis.service";
import { RoleService } from "../../system/role/role.service";
import { RedisConstants } from "../../common/constants/redis.constants";
import { RequestContext } from "../../common/context/request-context";

/**
 * JWT 认证策略
 *
 * 解析并验证 JWT 令牌，将令牌载荷转换为标准化的用户对象
 * 处理令牌过期、签名有效性等底层验证
 *
 * 注意：权限标识（perms）不在此处获取，而是在权限守卫中从角色权限缓存动态读取
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly redisCacheService: RedisService,
    private readonly roleService: RoleService
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>("jwt.secretKey"),
    });
  }

  /**
   * 验证并标准化 JWT 载荷
   *
   * @param payload 解码后的 JWT 载荷
   * @returns 标准用户对象 (将挂载到 req.user)
   */
  async validate(payload: any) {
    if (!payload.sub || !payload.username) {
      throw new UnauthorizedException("无效的令牌载荷");
    }

    const userId = payload.sub;

    // 校验 Token 版本号
    // ⚠️ 用 getGlobal：本方法在 DataScopeGuard **之前**执行，请求上下文里还没有租户ID，
    // 带前缀的 get 会解析出与「踢下线 / 重放吊销」写入端不同的物理键（读侧恒 0 → 吊销失效）。
    const tokenVersion: number = payload.tokenVersion ?? 0;
    const versionKey = `${RedisConstants.Auth.USER_TOKEN_VERSION}:${userId}`;
    const currentVersionRaw = await this.redisCacheService.getGlobal<number>(versionKey);
    const currentVersion = currentVersionRaw ?? 0;

    if (tokenVersion < currentVersion) {
      throw new UnauthorizedException("Token 已失效，请重新登录");
    }

    // 校验黑名单（同为全局键，理由同上）
    const jti: string | undefined = payload.jti;
    if (jti) {
      const blacklistKey = `${RedisConstants.Auth.TOKEN_BLACKLIST}:${jti}`;
      const inBlacklist = await this.redisCacheService.hasGlobalKey(blacklistKey);
      if (inBlacklist) {
        throw new UnauthorizedException("Token 已失效，请重新登录");
      }
    }

    const roles: string[] = payload.roles || [];

    // 获取角色的数据权限列表
    const dataScopes = await this.roleService.getRoleDataScopes(roles);

    // 门店上下文随动（P0-02-06）：switch-context 签发的令牌内嵌 activeStoreId。
    // 优先级：x-store-id 请求头（用户显式指定，中间件已写入 ALS）**显式优先**于
    // 令牌内嵌值 —— 仅在 ALS 尚无门店上下文时兜底写入；携带请求头即可覆盖令牌默认值。
    const activeStoreId: string | null = payload.activeStoreId ?? null;
    if (activeStoreId && !RequestContext.getStoreId()) {
      RequestContext.setStoreId(activeStoreId);
    }

    return {
      userId,
      username: payload.username,
      roles,
      deptId: payload.deptId,
      dataScopes,
      deptTreePath: payload.deptTreePath,
      // 租户归属只信令牌，不接受请求参数传入（PEL-11）；平台账号当前为 null
      tenantId: payload.tenantId ?? null,
      // 门店上下文随令牌（P0-02-06）；未切换过上下文的旧令牌为 null
      activeStoreId,
    };
  }
}
